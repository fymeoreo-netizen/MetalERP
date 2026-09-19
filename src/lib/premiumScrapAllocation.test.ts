import { describe, expect, it } from "vitest";
import {
    allocateScrapToWireLines,
    groupLotsByRate,
    isValidClientLineId,
    lotsToBuckets,
    summarizeAllocationByRate,
    summarizeLineAllocation,
    type WireLineForAllocation,
} from "./premiumScrapAllocation";
import type { ScrapPayableLotRow } from "./scrapObligationTypes";

function lot(overrides: Partial<ScrapPayableLotRow>): ScrapPayableLotRow {
    return {
        lot_id: "L1",
        lot_no: "LOT-1",
        source_doc_no: "PI-1",
        lot_date: "2026-07-01",
        unit_rate: 100,
        original_kg: 500,
        allocated_kg: 0,
        open_kg: 500,
        status: "open",
        ...overrides,
    };
}

function wire(overrides: Partial<WireLineForAllocation>): WireLineForAllocation {
    return { lineKey: "A", itemCode: "WIRE", netWeight: 300, ...overrides };
}

describe("allocateScrapToWireLines — FIFO by rate (migs 137–140 lineage)", () => {
    it("fills lines in order from the cheapest lot, then flags the uncovered remainder as mazdoori-pending", () => {
        const result = allocateScrapToWireLines(
            [{ lotId: "L1", rate: 100, openKg: 500 }],
            [wire({ lineKey: "A" }), wire({ lineKey: "B" })],
            (l) => (l.lineKey === "A" ? 20 : 30),
        );

        expect(result.error).toBeUndefined();
        expect(result.segments).toHaveLength(3);

        const [segA, segB1, segB2] = result.segments;
        expect(segA).toEqual({
            lineKey: "A",
            scrapLotId: "L1",
            allocatedKg: 300,
            scrapRate: 100,
            wattaRate: 20,
            derivedUnitRate: 120,
            isMazdooriPending: false,
        });
        expect(segB1).toMatchObject({
            lineKey: "B",
            allocatedKg: 200,
            scrapRate: 100,
            wattaRate: 30,
            derivedUnitRate: 130,
            isMazdooriPending: false,
        });

        // Uncovered wire weight becomes a mazdoori-pending segment at watta-only rate.
        expect(segB2).toMatchObject({
            lineKey: "B",
            allocatedKg: 100,
            scrapRate: 0,
            derivedUnitRate: 30,
            isMazdooriPending: true,
        });
        // Lot id falls back to the last bucket when all lots are exhausted.
        expect(segB2.scrapLotId).toBe("L1");

        expect(result.totalScrapUsed).toBe(500);
        expect(result.totalScrapSelected).toBe(500);
        expect(result.totalWireKg).toBe(600);
        expect(result.totalWireAllocated).toBe(600);
        expect(result.scrapRemainingKg).toBe(0);
    });

    it("consumes cheaper lots first regardless of input order", () => {
        const result = allocateScrapToWireLines(
            [
                { lotId: "EXPENSIVE", rate: 300, openKg: 100 },
                { lotId: "CHEAP", rate: 100, openKg: 100 },
            ],
            [wire({ lineKey: "A", netWeight: 150 })],
            () => 10,
        );
        expect(result.segments[0].scrapLotId).toBe("CHEAP");
        expect(result.segments[1].scrapLotId).toBe("EXPENSIVE");
    });

    it("errors on empty selection and skips zero-weight wire lines entirely", () => {
        const empty = allocateScrapToWireLines([], [wire({})], () => 5);
        expect(empty.error).toBe("Select scrap lots with open weight");
        expect(empty.segments).toHaveLength(0);
        expect(empty.totalWireAllocated).toBe(300);

        const withDeadLine = allocateScrapToWireLines(
            [{ lotId: "L1", rate: 100, openKg: 100 }],
            [wire({ lineKey: "Z", netWeight: 0 }), wire({ lineKey: "NEG", netWeight: -50 })],
            () => 5,
        );
        expect(withDeadLine.segments).toHaveLength(0);
        expect(withDeadLine.totalWireKg).toBe(0);
    });
});

describe("allocation summaries", () => {
    const lots = [lot({}), lot({ lot_id: "L2", lot_no: "LOT-2", unit_rate: 120 })];

    it("groupLotsByRate merges same-rate lots and sorts ascending", () => {
        const groups = groupLotsByRate([
            lot({ unit_rate: 120, open_kg: 30 }),
            lot({ unit_rate: 100, open_kg: 40 }),
            lot({ lot_id: "L2", unit_rate: 120, open_kg: 70 }),
        ]);
        expect(groups).toEqual([
            { rate: 100, openKg: 40, lotIds: ["L1"] },
            { rate: 120, openKg: 100, lotIds: ["L1", "L2"] },
        ]);
    });

    it("lotsToBuckets projects rows into FIFO buckets", () => {
        expect(lotsToBuckets(lots)).toEqual([
            { lotId: "L1", rate: 100, openKg: 500 },
            { lotId: "L2", rate: 120, openKg: 500 },
        ]);
    });

    it("summarizeAllocationByRate excludes mazdoori segments and clamps after-PI at zero", () => {
        const summary = summarizeAllocationByRate(
            [
                { lineKey: "A", scrapLotId: "L1", allocatedKg: 60, scrapRate: 100, wattaRate: 0, derivedUnitRate: 100, isMazdooriPending: false },
                { lineKey: "B", scrapLotId: "", allocatedKg: 40, scrapRate: 0, wattaRate: 25, derivedUnitRate: 25, isMazdooriPending: true },
            ],
            [lot({ open_kg: 50 })],
        );
        expect(summary).toEqual([{ rate: 100, openKg: 50, allocatingKg: 60, afterPiKg: 0 }]);
    });

    it("summarizeLineAllocation computes weighted derived rates and rate-chain details", () => {
        const summary = summarizeLineAllocation(
            [
                { lineKey: "A", scrapLotId: "L1", allocatedKg: 100, scrapRate: 100, wattaRate: 20, derivedUnitRate: 120, isMazdooriPending: false },
                { lineKey: "A", scrapLotId: "L2", allocatedKg: 100, scrapRate: 200, wattaRate: 20, derivedUnitRate: 220, isMazdooriPending: false },
                { lineKey: "A", scrapLotId: "L1", allocatedKg: 50, scrapRate: 0, wattaRate: 20, derivedUnitRate: 20, isMazdooriPending: true },
            ],
            [wire({ lineKey: "A", netWeight: 250 })],
        );
        expect(summary).toHaveLength(1);
        const row = summary[0];
        expect(row.wireKg).toBe(250);
        expect(row.scrapKg).toBe(200);
        expect(row.derivedRate).toBeCloseTo((100 * 120 + 100 * 220) / 200, 6);
        expect(row.detail).toContain("@ 100");
        expect(row.detail).toContain("@ 200");
        expect(row.detail).toContain("→");
    });
});

describe("isValidClientLineId — UUID v4-ish guard before client-side ids hit RPCs", () => {
    it("accepts canonical lowercase/uppercase v4 uuids", () => {
        expect(isValidClientLineId("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")).toBe(true);
        expect(isValidClientLineId("A1B2C3D4-E5F6-4A7B-9C9D-0E1F2A3B4C5D")).toBe(true);
    });

    it("rejects missing values and non-conforming strings", () => {
        expect(isValidClientLineId(undefined)).toBe(false);
        expect(isValidClientLineId("")).toBe(false);
        expect(isValidClientLineId("not-a-uuid")).toBe(false);
        expect(isValidClientLineId("a1b2c3d4-e5f6-7a7b-8c9d-0e1f2a3b4c5d")).toBe(false);
    });
});
