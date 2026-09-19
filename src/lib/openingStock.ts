/** Default inventory cutover date — align with party opening balances. */
export const DEFAULT_INVENTORY_CUTOVER_DATE = "2026-06-30";

/** Typical FG opening valuation rate (Rs/kg) — MBTZIL cutover (revalued from 3950). */
export const SUGGESTED_OPENING_UNIT_COST = 3830;

export type OpeningStockImportRow = {
    itemCode: string;
    warehouseCode: string;
    qty: number;
    unitCount: number;
    unitCost: number;
    asOf: string;
};

export const OPENING_STOCK_CSV_HEADER = "item_code,warehouse_code,qty,unit_count,unit_cost,as_of";

function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === "," && !inQuotes) {
            out.push(cur.trim());
            cur = "";
            continue;
        }
        cur += ch;
    }
    out.push(cur.trim());
    return out;
}

function isHeaderRow(cells: string[]): boolean {
    const first = cells[0]?.toLowerCase() ?? "";
    return first === "item_code" || first === "item code";
}

function headerHasUnitCount(cells: string[]): boolean {
    return cells.some((c) => c.toLowerCase().replace(/\s+/g, "_") === "unit_count");
}

export function parseOpeningStockCsv(text: string): { rows: OpeningStockImportRow[]; errors: string[] } {
    const errors: string[] = [];
    const rows: OpeningStockImportRow[] = [];
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

    let useUnitCountColumn = false;
    for (const line of lines) {
        const cells = parseCsvLine(line);
        if (isHeaderRow(cells)) {
            useUnitCountColumn = headerHasUnitCount(cells);
            continue;
        }

        const lineNo = rows.length + errors.length + 1;
        let itemCode = "";
        let warehouseCode = "";
        let qtyRaw = "";
        let unitCountRaw = "0";
        let unitCostRaw = "";
        let asOfRaw = "";

        if (useUnitCountColumn || cells.length >= 6) {
            [itemCode = "", warehouseCode = "", qtyRaw = "", unitCountRaw = "0", unitCostRaw = "", asOfRaw = ""] = cells;
        } else {
            [itemCode = "", warehouseCode = "", qtyRaw = "", unitCostRaw = "", asOfRaw = ""] = cells;
        }

        if (!itemCode || !warehouseCode) {
            errors.push(`Line ${lineNo}: item_code and warehouse_code are required`);
            continue;
        }

        const qty = Number(qtyRaw);
        const unitCount = Number(unitCountRaw || 0);
        const unitCost = Number(unitCostRaw);
        if (!Number.isFinite(qty) || qty <= 0) {
            errors.push(`Line ${lineNo} (${itemCode}): qty must be a positive number`);
            continue;
        }
        if (unitCountRaw.trim() !== "" && (!Number.isFinite(unitCount) || unitCount < 0)) {
            errors.push(`Line ${lineNo} (${itemCode}): unit_count must be zero or a positive number`);
            continue;
        }
        if (!Number.isFinite(unitCost) || unitCost <= 0) {
            errors.push(`Line ${lineNo} (${itemCode}): unit_cost must be a positive number`);
            continue;
        }

        const asOf = asOfRaw.trim() || DEFAULT_INVENTORY_CUTOVER_DATE;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
            errors.push(`Line ${lineNo} (${itemCode}): as_of must be YYYY-MM-DD`);
            continue;
        }

        rows.push({
            itemCode: itemCode.toUpperCase(),
            warehouseCode: warehouseCode.toUpperCase(),
            qty,
            unitCount: unitCount > 0 ? unitCount : 0,
            unitCost,
            asOf,
        });
    }

    return { rows, errors };
}

export function openingStockRowsToPayload(rows: OpeningStockImportRow[]) {
    return rows.map((r) => ({
        item_code: r.itemCode,
        warehouse_code: r.warehouseCode,
        qty: r.qty,
        unit_count: r.unitCount,
        unit_cost: r.unitCost,
        as_of: r.asOf,
    }));
}
