import { parseDrumWeightKgFromSpec } from "@/lib/itemFormSchema";
import {
    getItemsBySection,
    getWarehouseType,
    type ItemMasterRecord,
    type WarehouseType,
} from "@/lib/itemCatalog";

export type SuppliesRestockKind = "varnish" | "packing";

/** Standard net weight per varnish drum (kg). Used when item spec is missing. */
export const DEFAULT_VARNISH_DRUM_WEIGHT_KG = 200;

export function getSuppliesRestockItems(kind: SuppliesRestockKind): ItemMasterRecord[] {
    const section = kind === "varnish" ? "varnish" : "packing";
    return getItemsBySection(section).sort((a, b) => a.name.localeCompare(b.name));
}

export function defaultDrumWeightKg(item?: ItemMasterRecord | null): number {
    if (!item) return DEFAULT_VARNISH_DRUM_WEIGHT_KG;
    const parsed = parseDrumWeightKgFromSpec(item.sizeSpec);
    return parsed > 0 ? parsed : DEFAULT_VARNISH_DRUM_WEIGHT_KG;
}

export function computeVarnishRestockKg(drumCount: number, drumWeightKg: number): number {
    if (drumCount <= 0 || drumWeightKg <= 0) return 0;
    return Math.round(drumCount * drumWeightKg * 1000) / 1000;
}

/** Convert drum purchase price to per-kg unit cost stored on inventory movements. */
export function computeVarnishUnitCostPerKg(pricePerDrum: number, drumWeightKg: number): number {
    if (pricePerDrum <= 0 || drumWeightKg <= 0) return 0;
    return Math.round((pricePerDrum / drumWeightKg) * 1000000) / 1000000;
}

/** kg on hand → equivalent full/partial drums at standard drum weight. */
export function kgToVarnishDrums(kg: number, drumWeightKg: number): number {
    if (kg <= 0 || drumWeightKg <= 0) return 0;
    return Math.round((kg / drumWeightKg) * 1000) / 1000;
}

export function formatVarnishDrums(kg: number, drumWeightKg: number): string {
    const drums = kgToVarnishDrums(kg, drumWeightKg);
    return `${drums.toLocaleString(undefined, { maximumFractionDigits: 2 })} drum${drums === 1 ? "" : "s"}`;
}

export function suppliesWarehouseType(kind: SuppliesRestockKind): WarehouseType {
    return kind === "varnish" ? "varnish" : "packing_material";
}

/** Varnish stock is tracked in kg; packing uses the item UOM. */
export function suppliesStockUnit(kind: SuppliesRestockKind, item?: ItemMasterRecord | null): string {
    return kind === "varnish" ? "kg" : item?.unit ?? "units";
}

export function assertItemMatchesRestockKind(item: ItemMasterRecord, kind: SuppliesRestockKind): boolean {
    return getWarehouseType(item) === suppliesWarehouseType(kind);
}

export type SuppliesRestockRow = {
    id: string;
    itemCode: string;
    itemName: string;
    postingDate: string;
    qtyKg: number;
    unitCostPerKg: number;
    totalValue: number;
    remarks: string | null;
};

export type SuppliesRestockTotals = {
    lineCount: number;
    totalKg: number;
    totalValue: number;
    avgUnitCostPerKg: number | null;
};

/** Parse "N drum(s) × W kg @ ₨ P/drum" from restock reference text. */
export function parseVarnishRestockRemark(
    remarks: string | null | undefined,
): { drumCount: number | null; drumWeightKg: number | null; pricePerDrum: number | null } {
    if (!remarks) return { drumCount: null, drumWeightKg: null, pricePerDrum: null };
    const drumMatch = remarks.match(/(\d+(?:\.\d+)?)\s*drum/i);
    const weightMatch = remarks.match(/×\s*(\d+(?:\.\d+)?)\s*kg/i);
    const priceMatch = remarks.match(/@\s*₨?\s*([\d,]+(?:\.\d+)?)\s*\/?\s*drum/i);
    return {
        drumCount: drumMatch ? Number(drumMatch[1]) : null,
        drumWeightKg: weightMatch ? Number(weightMatch[1]) : null,
        pricePerDrum: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
    };
}

export function formatVarnishRestockRemark(
    drumCount: number,
    drumWeightKg: number,
    pricePerDrum: number,
): string {
    return `${drumCount} drum(s) × ${drumWeightKg} kg @ ₨ ${pricePerDrum.toLocaleString()}/drum`;
}

export function deriveVarnishRestockFields(
    row: SuppliesRestockRow,
    drumWeightKg: number,
): { drumCount: number; drumWeightKg: number; pricePerDrum: number } {
    const parsed = parseVarnishRestockRemark(row.remarks);
    const weight = parsed.drumWeightKg && parsed.drumWeightKg > 0 ? parsed.drumWeightKg : drumWeightKg;
    // qty_kg is authoritative — remarks text can be stale after edits
    const drumCount =
        weight > 0 ? Math.round((row.qtyKg / weight) * 1000) / 1000 : parsed.drumCount && parsed.drumCount > 0 ? parsed.drumCount : 0;
    const pricePerDrum =
        parsed.pricePerDrum && parsed.pricePerDrum > 0
            ? parsed.pricePerDrum
            : row.unitCostPerKg > 0 && weight > 0
              ? Math.round(row.unitCostPerKg * weight)
              : 0;
    return { drumCount, drumWeightKg: weight, pricePerDrum };
}

export function summarizeSuppliesRestockTotals(rows: SuppliesRestockRow[]): SuppliesRestockTotals {
    const totalKg = rows.reduce((s, r) => s + r.qtyKg, 0);
    const totalValue = rows.reduce((s, r) => s + r.totalValue, 0);
    return {
        lineCount: rows.length,
        totalKg: Math.round(totalKg * 1000) / 1000,
        totalValue: Math.round(totalValue * 100) / 100,
        avgUnitCostPerKg:
            totalKg > 0 && totalValue > 0 ? Math.round((totalValue / totalKg) * 1_000_000) / 1_000_000 : null,
    };
}
