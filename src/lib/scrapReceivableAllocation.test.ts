import { describe, expect, it } from "vitest";
import {
    allocationShortfallKg,
    computeCreditAllocations,
    computeReceivableAllocation,
    lineAllocationAmount,
    remainderKgAfterCredits,
    sortObligationsFifo,
    suggestObligationIdsFifo,
    totalAllocationAmount,
    totalCreditAllocatedKg,
    totalOpenKg,
} from "./scrapReceivableAllocation";
import type { ScrapObligationRow } from "./scrapObligationTypes";

function obligation(overrides: Partial<ScrapObligationRow> & { obligation_id: string }): ScrapObligationRow {
    return {
        obligation_no: `OBL-${overrides.obligation_id}`,
        sales_invoice_id: `si-${overrides.obligation_id}`,
        sales_invoice_no: `SI-${overrides.obligation_id}`,
        invoice_date: "2026-07-01",
        ref_scrap_rate: 980,
        expected_kg: 100,
        received_kg: 0,
        open_kg: 100,
        status: "open",
        ...overrides,
    };
}

const fifoSet = [
    obligation({ obligation_id: "o2", sales_invoice_no: "SI-2", invoice_date: "2026-07-02", open_kg: 60 }),
    obligation({ obligation_id: "o1", sales_invoice_no: "SI-1", invoice_date: "2026-07-01", open_kg: 40 }),
];

describe("sortObligationsFifo", () => {
    it("orders by invoice date, then invoice no; undated rows sink to the end", () => {
        const sorted = sortObligationsFifo([
            ...fifoSet,
            obligation({ obligation_id: "oX", invoice_date: "" }),
            obligation({ obligation_id: "oY", invoice_date: "not-a-date" }),
        ]);
        expect(sorted.map((o) => o.obligation_id)).toEqual(["o1", "o2", "oX", "oY"]);
    });

    it("breaks date ties by invoice number", () => {
        const tied = [
            obligation({ obligation_id: "b", sales_invoice_no: "SI-B", invoice_date: "2026-07-01" }),
            obligation({ obligation_id: "a", sales_invoice_no: "SI-A", invoice_date: "2026-07-01" }),
        ];
        expect(sortObligationsFifo(tied).map((o) => o.sales_invoice_no)).toEqual(["SI-A", "SI-B"]);
    });
});

describe("suggestObligationIdsFifo", () => {
    it("returns the minimal prefix set covering the requested kg", () => {
        expect(suggestObligationIdsFifo(80, fifoSet)).toEqual(["o1", "o2"]);
        expect(suggestObligationIdsFifo(40, fifoSet)).toEqual(["o1"]);
    });

    it("returns nothing for non-positive weights or fully-consumed obligations", () => {
        expect(suggestObligationIdsFifo(0, fifoSet)).toEqual([]);
        expect(suggestObligationIdsFifo(-5, fifoSet)).toEqual([]);
        expect(suggestObligationIdsFifo(80, fifoSet.map((o) => ({ ...o, open_kg: 0 })))).toEqual([]);
    });
});

describe("computeReceivableAllocation", () => {
    it("allocates in order with sequence numbers and remaining-open tracking", () => {
        const result = computeReceivableAllocation(80, ["o1", "o2"], fifoSet);
        expect(result.error).toBeUndefined();
        expect(result.lines).toHaveLength(2);
        expect(result.lines[0]).toMatchObject({
            obligationId: "o1",
            salesInvoiceNo: "SI-1",
            allocatedKg: 40,
            remainingOpenKg: 0,
            lineSeq: 1,
        });
        expect(result.lines[1]).toMatchObject({
            obligationId: "o2",
            allocatedKg: 40,
            remainingOpenKg: 20,
            lineSeq: 2,
        });
    });

    it("lets the final selected obligation absorb only up to its open weight", () => {
        const over = computeReceivableAllocation(120, ["o1", "o2"], fifoSet);
        expect(over.lines).toHaveLength(0);
        expect(over.error).toContain("kg more");

        const exact = computeReceivableAllocation(100, ["o1", "o2"], fifoSet);
        expect(exact.error).toBeUndefined();
        expect(exact.lines.reduce((s, l) => s + l.allocatedKg, 0)).toBe(100);
    });

    it("guards empty selections, unknown ids, and non-positive weights", () => {
        expect(computeReceivableAllocation(0, [], fifoSet).lines).toEqual([]);
        expect(computeReceivableAllocation(10, [], fifoSet).error).toContain("at least one invoice");
        expect(computeReceivableAllocation(10, ["ghost"], fifoSet).error).toContain("no longer available");
    });
});

describe("credit allocation helpers", () => {
    const credits = [
        { credit_id: "c1", trade_no: "T-1", open_kg: 30 },
        { credit_id: "c2", trade_no: "T-2", open_kg: 45 },
    ];

    it("computes credit allocations against physical kg in selection order", () => {
        const result = computeCreditAllocations(60, ["c1", "c2"], credits);
        expect(result.error).toBeUndefined();
        expect(result.lines).toEqual([
            { scrapCreditId: "c1", tradeNo: "T-1", openKg: 30, allocatedKg: 30, remainingOpenKg: 0 },
            { scrapCreditId: "c2", tradeNo: "T-2", openKg: 45, allocatedKg: 30, remainingOpenKg: 15 },
        ]);
    });

    it("fails loud when a selected credit vanished between pick and save", () => {
        expect(computeCreditAllocations(10, ["ghost"], credits).error).toContain("no longer available");
        expect(computeCreditAllocations(10, [], credits).lines).toEqual([]);
    });

    it("totals and remainders round to the 3-decimal kg convention", () => {
        expect(totalCreditAllocatedKg([
            { scrapCreditId: "c1", tradeNo: "T", openKg: 10, allocatedKg: 3.3335, remainingOpenKg: 6.6665 },
        ])).toBeCloseTo(3.334, 9);
        expect(remainderKgAfterCredits(50.0004, 20.0001)).toBeCloseTo(30.000, 9);
    });
});

describe("amount + shortfall math", () => {
    it("multiplies allocated kg by ref rate with 3-decimal rounding", () => {
        const lines = computeReceivableAllocation(80, ["o1", "o2"], fifoSet).lines;
        expect(lines).not.toHaveLength(0);
        expect(lineAllocationAmount(lines[0])).toBeCloseTo(40 * 980, 6);
        expect(totalAllocationAmount(lines)).toBeCloseTo(80 * 980, 6);
    });

    it("reports shortfall against selected open weight", () => {
        expect(allocationShortfallKg(120, ["o1"], fifoSet)).toBe(80);
        expect(allocationShortfallKg(80, ["o1", "o2"], fifoSet)).toBe(0);
    });

    it("totalOpenKg clamps negatives to zero", () => {
        expect(totalOpenKg([...fifoSet, obligation({ obligation_id: "neg", open_kg: -10 })])).toBe(100);
    });
});
