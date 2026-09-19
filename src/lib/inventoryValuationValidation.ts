import type { ItemMasterRecord } from "@/lib/itemCatalog";
import { getInventorySection } from "@/lib/itemCatalog";
import { inferWire8Grade, parseSwgDecimalFromText } from "@/lib/wattaMatrixValidation";
import type {
    InventoryValuationProductKind,
    InventoryValuationRateRow,
    ScrapKind,
    Wire8Grade,
} from "@/lib/api/inventoryValuation";

export type InventoryValuationFormValues = {
    id?: string;
    product_kind: InventoryValuationProductKind;
    swg_min: number | null;
    swg_max: number | null;
    wire8_grade: Wire8Grade | null;
    scrap_kind: ScrapKind | null;
    spec_key: string | null;
    unit_rate: number;
    effective_from: string;
    is_active: boolean;
    remarks: string | null;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

export type UnmatchedValuationItem = {
    item: ItemMasterRecord;
    section: string;
    specKey: string | null;
    productKind: InventoryValuationProductKind | null;
};

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

/** Client mirror of erp._normalize_valuation_spec_key */
export function normalizeValuationSpecKey(sizeSpec: string | null | undefined, name?: string | null): string | null {
    let v = (sizeSpec?.trim() || name?.trim() || "").toLowerCase();
    if (!v) return null;
    if (/swg\s*\d/i.test(v) || /^\d+(?:\.\d+)?$/.test(v)) return null;

    const thousand = v.match(/(\d+)\s*thousand/);
    if (thousand) return `${thousand[1]}_thousand`;

    const strip = v.match(/(\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/);
    if (strip) {
        return `${strip[1].replace(".", "_")}x${strip[2].replace(".", "_")}_mm`;
    }

    const mm = v.match(/^(\d+(?:\.\d+)?)\s*mm$/);
    if (mm) return `${mm[1].replace(".", "_")}_mm`;

    v = v.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return v || null;
}

export function formatValuationSpecKeyLabel(specKey: string): string {
    return specKey.replace(/_/g, " ");
}

export function validateInventoryValuationForm(values: InventoryValuationFormValues): ValidationResult {
    if (values.unit_rate < 0) return { ok: false, error: "Unit rate cannot be negative." };
    if (!values.effective_from?.trim()) return { ok: false, error: "Effective from date is required." };

    if (values.product_kind === "enamel") {
        if (values.swg_min == null || values.swg_max == null) {
            return { ok: false, error: "SWG min and max are required for enamel bands." };
        }
        if (values.swg_min > values.swg_max) {
            return { ok: false, error: "SWG min must be less than or equal to SWG max." };
        }
    }

    if (values.product_kind === "wire8" && !values.wire8_grade) {
        return { ok: false, error: "Wire No 8 grade (Fail / Pass / Special) is required." };
    }

    if (values.product_kind === "scrap" && !values.scrap_kind) {
        return { ok: false, error: "Scrap kind is required." };
    }

    if (values.product_kind === "rod") {
        if (values.swg_min != null || values.swg_max != null || values.wire8_grade || values.scrap_kind || values.spec_key) {
            return { ok: false, error: "Copper rod uses a single flat rate row only." };
        }
    }

    if (values.product_kind === "copper_wire" || values.product_kind === "strip") {
        if (!values.spec_key?.trim()) {
            return { ok: false, error: "Spec key is required (e.g. 7_thousand, 20_mm, 6x1_5_mm)." };
        }
        if (values.swg_min != null || values.swg_max != null || values.wire8_grade || values.scrap_kind) {
            return { ok: false, error: "Spec-key rates cannot include SWG or grade fields." };
        }
    }

    return { ok: true };
}

export function findValuationOverlapError(
    values: InventoryValuationFormValues,
    existing: InventoryValuationRateRow[],
): string | null {
    for (const row of existing) {
        if (row.id === values.id) continue;
        if (!row.is_active || !values.is_active) continue;
        if (row.product_kind !== values.product_kind) continue;
        if (row.effective_from !== values.effective_from) continue;

        if (values.product_kind === "enamel") {
            if (!swgRangesOverlap(values.swg_min, values.swg_max, row.swg_min, row.swg_max)) continue;
            return `An active enamel band overlaps SWG ${row.swg_min}–${row.swg_max} (effective ${row.effective_from}).`;
        }
        if (values.product_kind === "wire8" && row.wire8_grade === values.wire8_grade) {
            return `An active Wire No 8 ${values.wire8_grade} rate already exists for ${values.effective_from}.`;
        }
        if (values.product_kind === "scrap" && row.scrap_kind === values.scrap_kind) {
            return `An active ${values.scrap_kind} scrap rate already exists for ${values.effective_from}.`;
        }
        if (values.product_kind === "rod") {
            return `An active copper rod rate already exists for ${values.effective_from}.`;
        }
        if (
            (values.product_kind === "copper_wire" || values.product_kind === "strip") &&
            row.spec_key === values.spec_key
        ) {
            return `An active rate for spec "${values.spec_key}" already exists for ${values.effective_from}.`;
        }
    }
    return null;
}

export const STANDARD_ENAMEL_VALUATION_PRESETS: Omit<InventoryValuationFormValues, "id">[] = [
    {
        product_kind: "enamel",
        swg_min: 1,
        swg_max: 24,
        wire8_grade: null,
        scrap_kind: null,
        spec_key: null,
        unit_rate: 2780,
        effective_from: new Date().toISOString().slice(0, 10),
        is_active: true,
        remarks: "Default enamel SWG 1–24",
    },
    {
        product_kind: "enamel",
        swg_min: 25,
        swg_max: 30,
        wire8_grade: null,
        scrap_kind: null,
        spec_key: null,
        unit_rate: 2860,
        effective_from: new Date().toISOString().slice(0, 10),
        is_active: true,
        remarks: "Default enamel SWG 25–30",
    },
];

export function hasStandardEnamelValuationDefaults(rows: InventoryValuationRateRow[]): boolean {
    const enamel = rows.filter((r) => r.product_kind === "enamel" && r.is_active);
    const hasLow = enamel.some((r) => r.swg_min === 1 && r.swg_max === 24);
    const hasHigh = enamel.some((r) => r.swg_min === 25 && r.swg_max === 30);
    return hasLow && hasHigh;
}

export function getScrapKindFromItem(item: ItemMasterRecord): ScrapKind {
    const code = item.code.toUpperCase();
    const spec = (item.sizeSpec ?? "").toLowerCase();
    if (code.includes("-DRAW") || spec.includes("drawing")) return "drawing";
    if (code.includes("-ENAM") || spec.includes("enamel")) return "enamel";
    if (code.includes("-WS") || spec.includes("workshop")) return "workshop";
    return "feed";
}

function pickRate(
    candidates: InventoryValuationRateRow[],
    asOf: string,
): number | null {
    const eligible = candidates
        .filter((r) => r.is_active && r.effective_from <= asOf)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return eligible[0]?.unit_rate ?? null;
}

function pickSpecRate(
    rates: InventoryValuationRateRow[],
    productKind: "copper_wire" | "strip",
    specKey: string,
    asOf: string,
): number | null {
    return pickRate(
        rates.filter((r) => r.product_kind === productKind && r.spec_key === specKey),
        asOf,
    );
}

/** Client-side mirror of erp.resolve_inventory_valuation_rate for demo KPI / report. */
export function resolveInventoryValuationRateForItem(
    item: ItemMasterRecord,
    rates: InventoryValuationRateRow[],
    asOf: string = new Date().toISOString().slice(0, 10),
): number | null {
    const section = getInventorySection(item);

    if (section === "fg_enameled") {
        const swg = parseSwgDecimalFromText(item.sizeSpec);
        if (swg == null) return null;
        const bands = rates.filter(
            (r) =>
                r.product_kind === "enamel" &&
                r.is_active &&
                r.effective_from <= asOf &&
                r.swg_min != null &&
                r.swg_max != null &&
                swg >= r.swg_min &&
                swg <= r.swg_max,
        );
        bands.sort((a, b) => {
            const widthA = (a.swg_max ?? 0) - (a.swg_min ?? 0);
            const widthB = (b.swg_max ?? 0) - (b.swg_min ?? 0);
            if (widthA !== widthB) return widthA - widthB;
            return b.effective_from.localeCompare(a.effective_from);
        });
        return bands[0]?.unit_rate ?? null;
    }

    if (section === "fg_copper_wire") {
        const specKey = normalizeValuationSpecKey(item.sizeSpec, item.name);
        if (!specKey) return null;
        return pickSpecRate(rates, "copper_wire", specKey, asOf);
    }

    if (section === "fg_strip") {
        const specKey = normalizeValuationSpecKey(item.sizeSpec, item.name);
        if (!specKey) return null;
        return pickSpecRate(rates, "strip", specKey, asOf);
    }

    if (section === "rm_wire8") {
        const grade = inferWire8Grade(item.name, item.sizeSpec) ?? null;
        if (grade) {
            const match = pickRate(
                rates.filter((r) => r.product_kind === "wire8" && r.wire8_grade === grade),
                asOf,
            );
            if (match != null) return match;
        }
        const passRate = pickRate(
            rates.filter((r) => r.product_kind === "wire8" && r.wire8_grade === "Pass"),
            asOf,
        );
        if (passRate != null) return passRate;
        return pickRate(rates.filter((r) => r.product_kind === "wire8"), asOf);
    }

    if (section === "rm_rod") {
        return pickRate(rates.filter((r) => r.product_kind === "rod"), asOf);
    }

    if (section === "rm_scrap") {
        const kind = getScrapKindFromItem(item);
        return pickRate(
            rates.filter((r) => r.product_kind === "scrap" && r.scrap_kind === kind),
            asOf,
        );
    }

    return null;
}

export function findUnmatchedValuationItems(
    items: ItemMasterRecord[],
    rates: InventoryValuationRateRow[],
    asOf: string = new Date().toISOString().slice(0, 10),
): UnmatchedValuationItem[] {
    const out: UnmatchedValuationItem[] = [];
    for (const item of items) {
        const section = getInventorySection(item);
        if (section === "fg_enameled") {
            const swg = parseSwgDecimalFromText(item.sizeSpec);
            if (swg == null) {
                out.push({ item, section, specKey: normalizeValuationSpecKey(item.sizeSpec, item.name), productKind: null });
            } else if (resolveInventoryValuationRateForItem(item, rates, asOf) == null) {
                out.push({ item, section, specKey: null, productKind: "enamel" });
            }
            continue;
        }
        if (section === "fg_copper_wire" || section === "fg_strip") {
            const productKind = section === "fg_copper_wire" ? "copper_wire" : "strip";
            const specKey = normalizeValuationSpecKey(item.sizeSpec, item.name);
            if (resolveInventoryValuationRateForItem(item, rates, asOf) == null) {
                out.push({ item, section, specKey, productKind });
            }
        }
    }
    return out;
}
