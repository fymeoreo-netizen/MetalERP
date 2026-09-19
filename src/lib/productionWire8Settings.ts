import { getCatalogItem } from "@/lib/itemCatalog";
import { productionStandardText, type ProductionStandardRow } from "@/lib/api/production";

export type Wire8Grade = "Fail" | "Pass" | "Special";

export const WIRE8_ITEM_CODE_KEY = "wire8_item_code";
export const DEFAULT_WIRE8_ITEM_CODE = "RM-W8-001";

export const WIRE8_GRADE_OPTIONS: Wire8Grade[] = ["Fail", "Pass", "Special"];

export function parseWire8Grade(value: string | null | undefined): Wire8Grade {
    const normalized = String(value ?? "").trim();
    if (normalized === "Fail" || normalized === "Special") return normalized;
    return "Pass";
}

export function resolveWire8ItemCode(standards: ProductionStandardRow[]): string {
    return productionStandardText(standards, WIRE8_ITEM_CODE_KEY, DEFAULT_WIRE8_ITEM_CODE).trim();
}

export function isWire8ItemCode(code: string): boolean {
    const normalized = String(code ?? "").trim();
    if (normalized.toUpperCase().startsWith("RM-W8")) return true;
    const item = getCatalogItem(normalized);
    if (!item) return false;
    return item.itemType === "Wire" && /wire\s*(no\.?\s*)?8\b/i.test(item.name);
}

export function validateWire8ItemSettings(standards: ProductionStandardRow[]): string | null {
    const code = resolveWire8ItemCode(standards);
    if (!code) {
        return "Wire No 8 item code is not configured. Set it in Production Settings.";
    }
    if (!getCatalogItem(code)) {
        return `Wire No 8 item "${code}" is missing in Item Master. Add the item or update Production Settings.`;
    }
    return null;
}

/** @deprecated Use validateWire8ItemSettings */
export function validateWire8Settings(_standards: ProductionStandardRow[], _process?: string): string | null {
    return validateWire8ItemSettings(_standards);
}

// ---------------------------------------------------------------------------
// Copper Rod input (workshop / strip production). Parallel to Wire No 8.
// Strip (FG-STR-*) is rolled from copper rod (RM-CR-001), 1:1 by weight.
// ---------------------------------------------------------------------------

export const ROD_ITEM_CODE_KEY = "rod_input_item_code";
export const DEFAULT_ROD_ITEM_CODE = "RM-CR-001";

export function resolveRodItemCode(standards: ProductionStandardRow[]): string {
    return productionStandardText(standards, ROD_ITEM_CODE_KEY, DEFAULT_ROD_ITEM_CODE).trim();
}

export function validateRodItemSettings(standards: ProductionStandardRow[]): string | null {
    const code = resolveRodItemCode(standards);
    if (!code) {
        return "Rod input item code is not configured. Set it in Production Settings.";
    }
    if (!getCatalogItem(code)) {
        return `Rod input item "${code}" is missing in Item Master. Add the item or update Production Settings.`;
    }
    return null;
}
