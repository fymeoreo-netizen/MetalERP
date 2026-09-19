import type { ScrapObligationRow } from "@/lib/scrapObligationTypes";

const KG_EPS = 0.001;

export type ScrapCreditAllocationLine = {
    scrapCreditId: string;
    tradeNo: string;
    openKg: number;
    allocatedKg: number;
    remainingOpenKg: number;
};

export type ScrapReceivableAllocationLine = {
    obligationId: string;
    salesInvoiceNo: string;
    refScrapRate: number;
    openKg: number;
    allocatedKg: number;
    remainingOpenKg: number;
    lineSeq: number;
};

export function sortObligationsFifo(obligations: ScrapObligationRow[]): ScrapObligationRow[] {
    return [...obligations].sort((a, b) => {
        const ta = parseInvoiceDateMs(a.invoice_date);
        const tb = parseInvoiceDateMs(b.invoice_date);
        if (ta !== tb) return ta - tb;
        return a.sales_invoice_no.localeCompare(b.sales_invoice_no);
    });
}

function parseInvoiceDateMs(dateStr: string): number {
    if (!dateStr?.trim()) return Number.MAX_SAFE_INTEGER;
    const normalized = dateStr.includes("T") ? dateStr : `${dateStr.trim()}T12:00:00`;
    const ms = Date.parse(normalized);
    return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
}

/** Minimum FIFO set of obligation ids whose combined open kg covers netKg. */
export function suggestObligationIdsFifo(netKg: number, obligations: ScrapObligationRow[]): string[] {
    if (netKg <= KG_EPS) return [];
    const sorted = sortObligationsFifo(obligations).filter((o) => o.open_kg > KG_EPS);
    const ids: string[] = [];
    let remaining = netKg;
    for (const o of sorted) {
        if (remaining <= KG_EPS) break;
        ids.push(o.obligation_id);
        remaining -= o.open_kg;
    }
    return ids;
}

export function totalOpenKg(obligations: ScrapObligationRow[]): number {
    return obligations.reduce((sum, o) => sum + Math.max(0, o.open_kg), 0);
}

export function remainderKgAfterCredits(physicalKg: number, creditAllocatedKg: number): number {
    return roundKg(Math.max(0, physicalKg - creditAllocatedKg));
}

export function totalCreditAllocatedKg(lines: ScrapCreditAllocationLine[]): number {
    return roundKg(lines.reduce((s, l) => s + l.allocatedKg, 0));
}

export function computeCreditAllocations(
    physicalKg: number,
    selectedCreditIds: string[],
    credits: Array<{ credit_id: string; trade_no: string; open_kg: number }>,
): { lines: ScrapCreditAllocationLine[]; error?: string } {
    if (!selectedCreditIds.length) return { lines: [] };
    const byId = new Map(credits.map((c) => [c.credit_id, c]));
    let remainingPhysical = physicalKg;
    const lines: ScrapCreditAllocationLine[] = [];

    for (const id of selectedCreditIds) {
        const credit = byId.get(id);
        if (!credit) {
            return { lines: [], error: "Selected advance scrap is no longer available." };
        }
        if (remainingPhysical <= KG_EPS) break;

        const openKg = Math.max(0, credit.open_kg);
        const allocatedKg = roundKg(Math.min(openKg, remainingPhysical));
        if (allocatedKg <= KG_EPS) continue;

        lines.push({
            scrapCreditId: credit.credit_id,
            tradeNo: credit.trade_no,
            openKg,
            allocatedKg,
            remainingOpenKg: roundKg(Math.max(0, openKg - allocatedKg)),
        });
        remainingPhysical = roundKg(remainingPhysical - allocatedKg);
    }

    return { lines };
}

export function computeReceivableAllocation(
    netKg: number,
    orderedObligationIds: string[],
    obligations: ScrapObligationRow[],
): { lines: ScrapReceivableAllocationLine[]; error?: string } {
    if (netKg <= KG_EPS) {
        return { lines: [] };
    }
    if (!orderedObligationIds.length) {
        return { lines: [], error: "Select at least one invoice to allocate premium scrap." };
    }

    const byId = new Map(obligations.map((o) => [o.obligation_id, o]));
    let remainingNet = netKg;
    const lines: ScrapReceivableAllocationLine[] = [];

    for (let i = 0; i < orderedObligationIds.length; i++) {
        const id = orderedObligationIds[i];
        const obl = byId.get(id);
        if (!obl) {
            return { lines: [], error: "Selected invoice is no longer available for this party." };
        }
        if (remainingNet <= KG_EPS) break;

        const openKg = Math.max(0, obl.open_kg);
        const isLast = i === orderedObligationIds.length - 1;
        const allocatedKg = isLast
            ? roundKg(remainingNet)
            : roundKg(Math.min(openKg, remainingNet));

        if (allocatedKg <= KG_EPS) continue;

        if (allocatedKg > openKg + KG_EPS) {
            const selectedOpen = orderedObligationIds.reduce(
                (sum, oid) => sum + Math.max(0, byId.get(oid)?.open_kg ?? 0),
                0,
            );
            const shortfall = roundKg(netKg - selectedOpen);
            return {
                lines: [],
                error: `Selected invoices cover ${selectedOpen.toLocaleString()} kg open — need ${shortfall.toLocaleString()} kg more.`,
            };
        }

        lines.push({
            obligationId: obl.obligation_id,
            salesInvoiceNo: obl.sales_invoice_no,
            refScrapRate: obl.ref_scrap_rate,
            openKg,
            allocatedKg,
            remainingOpenKg: roundKg(Math.max(0, openKg - allocatedKg)),
            lineSeq: lines.length + 1,
        });
        remainingNet = roundKg(remainingNet - allocatedKg);
    }

    if (remainingNet > KG_EPS) {
        const selectedOpen = orderedObligationIds.reduce((sum, id) => sum + Math.max(0, byId.get(id)?.open_kg ?? 0), 0);
        const shortfall = roundKg(netKg - selectedOpen);
        return {
            lines: [],
            error: `Selected invoices cover ${selectedOpen.toLocaleString()} kg open — need ${shortfall.toLocaleString()} kg more.`,
        };
    }

    const allocatedSum = roundKg(lines.reduce((s, l) => s + l.allocatedKg, 0));
    if (Math.abs(allocatedSum - netKg) > KG_EPS) {
        return { lines: [], error: "Allocation does not match net weight." };
    }

    return { lines };
}

export function totalAllocationAmount(lines: ScrapReceivableAllocationLine[]): number {
    return roundKg(lines.reduce((s, l) => s + l.allocatedKg * l.refScrapRate, 0));
}

export function lineAllocationAmount(line: ScrapReceivableAllocationLine): number {
    return roundKg(line.allocatedKg * line.refScrapRate);
}

export function allocationShortfallKg(netKg: number, orderedObligationIds: string[], obligations: ScrapObligationRow[]): number {
    const selectedOpen = orderedObligationIds.reduce((sum, id) => {
        const obl = obligations.find((o) => o.obligation_id === id);
        return sum + Math.max(0, obl?.open_kg ?? 0);
    }, 0);
    return roundKg(Math.max(0, netKg - selectedOpen));
}

function roundKg(n: number): number {
    return Math.round(n * 1000) / 1000;
}
