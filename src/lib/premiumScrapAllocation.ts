import type { ScrapPayableLotRow } from "@/lib/scrapObligationTypes";

export type WireLineForAllocation = {
    lineKey: string;
    itemCode: string;
    itemName?: string;
    netWeight: number;
    wire8Grade?: "Fail" | "Pass" | "Special";
};

export type ScrapLotBucket = {
    lotId: string;
    rate: number;
    openKg: number;
};

export type AllocationSegment = {
    lineKey: string;
    scrapLotId: string;
    allocatedKg: number;
    scrapRate: number;
    wattaRate: number;
    derivedUnitRate: number;
    isMazdooriPending: boolean;
};

/** FIFO scrap by rate → wire lines in order. Partial wire receipt allowed. */
export function allocateScrapToWireLines(
    lots: ScrapLotBucket[],
    wireLines: WireLineForAllocation[],
    resolveWatta: (line: WireLineForAllocation) => number,
): {
    segments: AllocationSegment[];
    totalScrapUsed: number;
    totalWireAllocated: number;
    totalScrapSelected: number;
    totalWireKg: number;
    scrapRemainingKg: number;
    error?: string;
} {
    const buckets = lots
        .map((l) => ({ ...l, remaining: l.openKg }))
        .filter((l) => l.remaining > 0.001)
        .sort((a, b) => a.rate - b.rate);

    const totalScrap = buckets.reduce((s, b) => s + b.remaining, 0);
    const totalWire = wireLines.reduce((s, l) => s + (l.netWeight > 0 ? l.netWeight : 0), 0);

    if (totalScrap <= 0.001) {
        return {
            segments: [],
            totalScrapUsed: 0,
            totalWireAllocated: totalWire,
            totalScrapSelected: 0,
            totalWireKg: totalWire,
            scrapRemainingKg: 0,
            error: "Select scrap lots with open weight",
        };
    }

    const segments: AllocationSegment[] = [];
    let lotIdx = 0;
    let lotRemaining = buckets[0]?.remaining ?? 0;
    let currentRate = buckets[0]?.rate ?? 0;
    let currentLotId = buckets[0]?.lotId ?? "";

    const advanceLot = () => {
        lotIdx += 1;
        if (lotIdx < buckets.length) {
            lotRemaining = buckets[lotIdx].remaining;
            currentRate = buckets[lotIdx].rate;
            currentLotId = buckets[lotIdx].lotId;
        } else {
            lotRemaining = 0;
            currentLotId = "";
        }
    };

    let scrapLeft = totalScrap;

    for (let li = 0; li < wireLines.length; li++) {
        const line = wireLines[li];
        const lineWt = line.netWeight;
        if (lineWt <= 0) continue;
        const watta = resolveWatta(line);
        let wireLeft = lineWt;

        while (wireLeft > 0.001 && scrapLeft > 0.001) {
            if (lotRemaining <= 0.001) {
                advanceLot();
                if (lotRemaining <= 0.001) break;
            }
            const chunk = Math.min(wireLeft, lotRemaining, scrapLeft);
            segments.push({
                lineKey: line.lineKey,
                scrapLotId: currentLotId,
                allocatedKg: chunk,
                scrapRate: currentRate,
                wattaRate: watta,
                derivedUnitRate: currentRate + watta,
                isMazdooriPending: false,
            });
            buckets[lotIdx].remaining -= chunk;
            lotRemaining -= chunk;
            wireLeft -= chunk;
            scrapLeft -= chunk;
        }

        if (wireLeft > 0.001) {
            segments.push({
                lineKey: line.lineKey,
                scrapLotId: currentLotId || buckets[buckets.length - 1]?.lotId || "",
                allocatedKg: wireLeft,
                scrapRate: 0,
                wattaRate: watta,
                derivedUnitRate: watta,
                isMazdooriPending: true,
            });
        }
    }

    const used = totalScrap - scrapLeft;
    return {
        segments,
        totalScrapUsed: used,
        totalWireAllocated: totalWire,
        totalScrapSelected: totalScrap,
        totalWireKg: totalWire,
        scrapRemainingKg: Math.max(0, scrapLeft),
    };
}

export function summarizeAllocationByRate(
    segments: AllocationSegment[],
    lots: ScrapPayableLotRow[],
): { rate: number; allocatingKg: number; afterPiKg: number; openKg: number }[] {
    const openByRate = groupLotsByRate(lots);
    const allocByRate = new Map<number, number>();
    for (const s of segments) {
        if (s.isMazdooriPending || s.scrapRate <= 0) continue;
        allocByRate.set(s.scrapRate, (allocByRate.get(s.scrapRate) ?? 0) + s.allocatedKg);
    }
    return openByRate.map((g) => ({
        rate: g.rate,
        openKg: g.openKg,
        allocatingKg: allocByRate.get(g.rate) ?? 0,
        afterPiKg: Math.max(0, g.openKg - (allocByRate.get(g.rate) ?? 0)),
    }));
}

export function summarizeLineAllocation(
    segments: AllocationSegment[],
    wireLines: WireLineForAllocation[],
): {
    lineKey: string;
    itemCode: string;
    itemName?: string;
    wireKg: number;
    scrapKg: number;
    derivedRate: number;
    detail: string;
}[] {
    return wireLines
        .filter((l) => l.netWeight > 0)
        .map((line) => {
            const segs = segments.filter((s) => s.lineKey === line.lineKey && !s.isMazdooriPending);
            const scrapKg = segs.reduce((s, x) => s + x.allocatedKg, 0);
            const amt = segs.reduce((s, x) => s + x.allocatedKg * x.derivedUnitRate, 0);
            const mazdoori = segments.filter((s) => s.lineKey === line.lineKey && s.isMazdooriPending);
            const mazdooriKg = mazdoori.reduce((s, x) => s + x.allocatedKg, 0);
            const derivedRate = scrapKg > 0 ? amt / scrapKg : (mazdoori[0]?.derivedUnitRate ?? 0);
            const rateParts = [...new Set(segs.map((s) => s.scrapRate))].sort((a, b) => a - b);
            const detail =
                segs.length === 0
                    ? mazdooriKg > 0
                        ? "Mazdoori only (no scrap match)"
                        : "—"
                    : rateParts.map((r) => `@ ${r.toLocaleString()}`).join(" → ");
            return {
                lineKey: line.lineKey,
                itemCode: line.itemCode,
                itemName: line.itemName,
                wireKg: line.netWeight,
                scrapKg,
                derivedRate,
                detail,
            };
        });
}

export function isValidClientLineId(id: string | undefined): boolean {
    if (!id) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export function groupLotsByRate(lots: ScrapPayableLotRow[]): { rate: number; openKg: number; lotIds: string[] }[] {
    const map = new Map<number, { rate: number; openKg: number; lotIds: string[] }>();
    for (const l of lots) {
        const r = l.unit_rate;
        const g = map.get(r) ?? { rate: r, openKg: 0, lotIds: [] };
        g.openKg += l.open_kg;
        g.lotIds.push(l.lot_id);
        map.set(r, g);
    }
    return Array.from(map.values()).sort((a, b) => a.rate - b.rate);
}

export function lotsToBuckets(lots: ScrapPayableLotRow[]): ScrapLotBucket[] {
    return lots.map((l) => ({ lotId: l.lot_id, rate: l.unit_rate, openKg: l.open_kg }));
}
