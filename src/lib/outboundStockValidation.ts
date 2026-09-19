export type OutboundStockLine = {
    itemCode: string;
    netWeight?: number;
    quantity?: number;
    unitCount?: number;
    tracksUnits?: boolean;
};

export type OutboundStockAvailability = {
    getKg: (itemCode: string) => number;
    getUnits: (itemCode: string) => number;
};

function roundQty(n: number): number {
    return Math.round(n * 1000) / 1000;
}

function lineKg(line: OutboundStockLine): number {
    return roundQty(Math.max(0, Number(line.netWeight ?? 0)));
}

function lineUnits(line: OutboundStockLine): number {
    if (!line.tracksUnits) return 0;
    return roundQty(Math.max(0, Number(line.unitCount ?? line.quantity ?? 0)));
}

export function aggregateOutboundDemand(lines: OutboundStockLine[]): {
    kgByItem: Record<string, number>;
    unitsByItem: Record<string, number>;
} {
    const kgByItem: Record<string, number> = {};
    const unitsByItem: Record<string, number> = {};

    for (const line of lines) {
        const code = line.itemCode?.trim();
        if (!code) continue;
        const kg = lineKg(line);
        if (kg > 0) kgByItem[code] = roundQty((kgByItem[code] ?? 0) + kg);
        const units = lineUnits(line);
        if (units > 0) unitsByItem[code] = roundQty((unitsByItem[code] ?? 0) + units);
    }

    return { kgByItem, unitsByItem };
}

export function validateOutboundStock(params: {
    lines: OutboundStockLine[];
    availability: OutboundStockAvailability;
}): { ok: true } | { ok: false; errors: string[] } {
    const { kgByItem, unitsByItem } = aggregateOutboundDemand(params.lines);
    const errors: string[] = [];

    for (const [itemCode, requested] of Object.entries(kgByItem)) {
        const available = roundQty(params.availability.getKg(itemCode));
        if (available + 0.001 < requested) {
            errors.push(
                `${itemCode}: need ${requested.toLocaleString()} kg, on hand ${available.toLocaleString()} kg.`,
            );
        }
    }

    for (const [itemCode, requested] of Object.entries(unitsByItem)) {
        const available = roundQty(params.availability.getUnits(itemCode));
        if (available + 0.001 < requested) {
            errors.push(
                `${itemCode}: need ${requested.toLocaleString()} units, on hand ${available.toLocaleString()} units.`,
            );
        }
    }

    if (errors.length === 0) return { ok: true };
    return { ok: false, errors };
}

export function formatOutboundStockErrors(errors: string[]): string {
    if (!errors.length) return "";
    const head = errors[0];
    if (errors.length === 1) return `${head} Reduce quantity or post a receipt first.`;
    return `${head} Also short: ${errors.slice(1).join(" ")}`;
}
