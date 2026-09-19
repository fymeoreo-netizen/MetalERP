import type { WattaMatrixRow } from "@/lib/scrapObligationTypes";

export type WattaFormValues = {
    id?: string;
    party_id: string | null;
    direction: "sales" | "purchase";
    product_kind: "enamel" | "wire8" | "rod";
    wire8_grade: "Fail" | "Pass" | "Special" | null;
    swg_min: number | null;
    swg_max: number | null;
    base_watta: number;
    increment_per_swg: number;
    effective_from: string;
    is_active: boolean;
    remarks: string | null;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateWattaForm(values: WattaFormValues): ValidationResult {
    if (values.base_watta < 0) return { ok: false, error: "Base watta cannot be negative." };
    if (values.increment_per_swg < 0) return { ok: false, error: "Increment per SWG cannot be negative." };
    if (!values.effective_from?.trim()) return { ok: false, error: "Effective from date is required." };

    if (values.direction === "sales") {
        if (values.product_kind !== "enamel") {
            return { ok: false, error: "Premium sales rows must use enamel (SWG bands)." };
        }
        if (values.swg_min == null || values.swg_max == null) {
            return { ok: false, error: "SWG min and max are required for enamel." };
        }
        if (values.swg_min > values.swg_max) {
            return { ok: false, error: "SWG min must be less than or equal to SWG max." };
        }
    }

    if (values.direction === "purchase") {
        if (values.product_kind === "wire8" && !values.wire8_grade) {
            return { ok: false, error: "Wire No 8 grade (Fail / Pass / Special) is required." };
        }
        if (values.product_kind === "rod" && values.wire8_grade) {
            return { ok: false, error: "Copper rod rows must not have a wire grade." };
        }
        if (values.product_kind !== "enamel" && (values.swg_min != null || values.swg_max != null)) {
            return { ok: false, error: "SWG bands apply only to enamel (sales)." };
        }
    }

    return { ok: true };
}

function swgRangesOverlap(
    aMin: number | null,
    aMax: number | null,
    bMin: number | null,
    bMax: number | null,
): boolean {
    const loA = aMin ?? -Infinity;
    const hiA = aMax ?? Infinity;
    const loB = bMin ?? -Infinity;
    const hiB = bMax ?? Infinity;
    return loA <= hiB && loB <= hiA;
}

/** Non-blocking warning when an active row may conflict with another. */
export function findWattaOverlapWarning(
    values: WattaFormValues,
    existing: WattaMatrixRow[],
): string | null {
    const partyKey = values.party_id ?? null;
    for (const row of existing) {
        if (row.id === values.id) continue;
        if (!row.is_active || !values.is_active) continue;
        if (row.direction !== values.direction) continue;
        if (row.product_kind !== values.product_kind) continue;
        const rowPartyKey = row.party_code ?? row.party_id ?? null;
        if (rowPartyKey !== partyKey) continue;
        if (row.effective_from !== values.effective_from) continue;
        if (values.product_kind === "wire8" && row.wire8_grade !== values.wire8_grade) continue;
        if (values.product_kind === "enamel") {
            if (!swgRangesOverlap(values.swg_min, values.swg_max, row.swg_min, row.swg_max)) continue;
        }
        return `Another active row overlaps this band (${row.party_name ?? "Default"}, effective ${row.effective_from}). Save anyway if intentional.`;
    }
    return null;
}

export const STANDARD_ENAMEL_PRESETS: Omit<WattaFormValues, "id" | "party_id">[] = [
    {
        direction: "sales",
        product_kind: "enamel",
        wire8_grade: null,
        swg_min: 1,
        swg_max: 24,
        base_watta: 503,
        increment_per_swg: 0,
        effective_from: new Date().toISOString().slice(0, 10),
        is_active: true,
        remarks: "Default enamel SWG 1–24",
    },
    {
        direction: "sales",
        product_kind: "enamel",
        wire8_grade: null,
        swg_min: 25,
        swg_max: 30,
        base_watta: 503,
        increment_per_swg: 20,
        effective_from: new Date().toISOString().slice(0, 10),
        is_active: true,
        remarks: "+20 per SWG above band min (25+)",
    },
];

/** Prefer item sizeSpec (Fail/Pass/Special), then name heuristics. */
/** Parse SWG from gauge field, size spec, or plain number. */
export function parseSwgFromText(text: string | null | undefined): number | null {
    if (!text?.trim()) return null;
    const m = text.trim().match(/SWG\s*(\d+)/i);
    if (m) return Number(m[1]);
    if (/^\d+$/.test(text.trim())) return Number(text.trim());
    return null;
}

/** Decimal SWG for valuation bands (e.g. SWG 19.5). */
export function parseSwgDecimalFromText(text: string | null | undefined): number | null {
    if (!text?.trim()) return null;
    const m = text.trim().match(/SWG\s*(\d+(?:\.\d+)?)/i);
    if (m) return Number(m[1]);
    if (/^\d+(?:\.\d+)?$/.test(text.trim())) return Number(text.trim());
    return null;
}

export function inferWire8Grade(itemName: string, sizeSpec?: string | null): "Fail" | "Pass" | "Special" | undefined {
    const spec = (sizeSpec ?? "").trim();
    if (/^fail$/i.test(spec)) return "Fail";
    if (/^special$/i.test(spec)) return "Special";
    if (/^pass$/i.test(spec)) return "Pass";
    const n = itemName.toLowerCase();
    if (n.includes("fail")) return "Fail";
    if (n.includes("special")) return "Special";
    if (n.includes("rod")) return undefined;
    if (n.includes("wire") || n.includes("w8")) return "Pass";
    return undefined;
}

export function hasStandardEnamelDefaults(rows: WattaMatrixRow[]): boolean {
    const salesEnamel = rows.filter((r) => r.direction === "sales" && r.product_kind === "enamel" && !r.party_id && r.is_active);
    const hasLow = salesEnamel.some((r) => r.swg_min === 1 && r.swg_max === 24);
    const hasHigh = salesEnamel.some((r) => r.swg_min === 25 && r.swg_max === 30);
    return hasLow && hasHigh;
}
