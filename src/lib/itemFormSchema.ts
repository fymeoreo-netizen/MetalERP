import type { ItemCategory, ItemMasterRecord } from "@/lib/itemCatalog";
import {
    categoryToInventoryGroup,
    findProductTypeBySlug,
    findProductTypeForItem,
    getProductTypesForCategory,
    inventoryGroupToCategory,
    type ItemProductTypeRow,
} from "@/lib/itemProductTypes";

export type TopCategory = "Finished Goods" | "Raw Material" | "Chemicals" | "Packing Material";

export type EnamelColor = "Golden" | "Black";
export type MachineScrapDepartment = "Drawing" | "Enamel" | "Workshop";
export type GoatProduct = "Enamel Wire" | "Strip";
export type GoatEnamelWeight = "5 kg" | "10 kg" | "Custom";

/** @deprecated Use product type rows from DB */
export type FgProductType = "Enameled Wire" | "Copper Strip" | "Copper Wire";
/** @deprecated Use product type rows from DB */
export type RawMaterialType = "Wire No 8" | "Copper Rod 8mm" | "Copper Scrap" | "Machine Scrap" | "Custom";
/** @deprecated Use product type rows from DB */
export type PackingType = "Goats" | "Paper" | "Wrappers" | "Stickers";
/** @deprecated Use product type rows from DB */
export type ChemicalType = "Varnish Drum" | "Custom";

export const TOP_CATEGORIES: TopCategory[] = [
    "Finished Goods",
    "Raw Material",
    "Chemicals",
    "Packing Material",
];

export const ENAMEL_COLORS: EnamelColor[] = ["Golden", "Black"];
export const ENAMEL_GAUGES: number[] = Array.from({ length: 24 }, (_, i) => i + 15);
export const MACHINE_SCRAP_DEPARTMENTS: MachineScrapDepartment[] = ["Drawing", "Enamel", "Workshop"];
export const GOAT_PRODUCTS: GoatProduct[] = ["Enamel Wire", "Strip"];
export const GOAT_ENAMEL_WEIGHTS: GoatEnamelWeight[] = ["5 kg", "10 kg", "Custom"];

/** @deprecated Loaded from item_product_types */
export const FG_PRODUCT_TYPES: FgProductType[] = ["Enameled Wire", "Copper Strip", "Copper Wire"];
/** @deprecated Loaded from item_product_types */
export const RAW_MATERIAL_TYPES: RawMaterialType[] = [
    "Wire No 8",
    "Copper Rod 8mm",
    "Copper Scrap",
    "Machine Scrap",
    "Custom",
];
/** @deprecated Loaded from item_product_types */
export const PACKING_TYPES: PackingType[] = ["Goats", "Paper", "Wrappers", "Stickers"];
/** @deprecated Loaded from item_product_types */
export const CHEMICAL_TYPES: ChemicalType[] = ["Varnish Drum", "Custom"];

export type ItemFormState = {
    topCategory: TopCategory;
    productTypeSlug: string;
    enamelGaugePreset: string;
    enamelGaugeCustom: string;
    enamelGaugeIsCustom: boolean;
    enamelColor: EnamelColor;
    enamelCustomName: string;
    stripSize: string;
    freeTextName: string;
    freeTextSpec: string;
    goatProduct: GoatProduct;
    goatEnamelWeight: GoatEnamelWeight;
    goatCustomWeight: string;
    goatStripSize: string;
    packingSpec: string;
    chemicalCustomSpec: string;
    varnishColor: EnamelColor;
    varnishDrumWeightKg: string;
    machineScrapDepartment: MachineScrapDepartment;
    machineScrapLabel: string;
    unit: ItemMasterRecord["unit"];
    cost: string;
    solidContent: string;
    wastagePct: string;
};

export function defaultItemFormState(
    topCategory: TopCategory = "Raw Material",
    productTypeSlug = "",
): ItemFormState {
    return {
        topCategory,
        productTypeSlug,
        enamelGaugePreset: "22",
        enamelGaugeCustom: "",
        enamelGaugeIsCustom: false,
        enamelColor: "Golden",
        enamelCustomName: "",
        stripSize: "",
        freeTextName: "",
        freeTextSpec: "",
        goatProduct: "Enamel Wire",
        goatEnamelWeight: "5 kg",
        goatCustomWeight: "",
        goatStripSize: "",
        packingSpec: "",
        chemicalCustomSpec: "",
        varnishColor: "Golden",
        varnishDrumWeightKg: "",
        machineScrapDepartment: "Drawing",
        machineScrapLabel: "",
        unit: defaultUnitForCategory(topCategory),
        cost: "",
        solidContent: "",
        wastagePct: "",
    };
}

export function defaultUnitForCategory(topCategory: TopCategory): ItemMasterRecord["unit"] {
    if (topCategory === "Chemicals") return "Drum";
    if (topCategory === "Packing Material") return "Roll";
    return "KG";
}

export function getDisplayCategory(item: ItemMasterRecord): TopCategory {
    const cat = item.category;
    if (cat === "Enameled" || cat === "Strip" || cat === "Copper Wire" || cat === "Finished Goods") {
        return "Finished Goods";
    }
    if (cat === "Raw Material" || cat === "Scrap") return "Raw Material";
    if (cat === "Packing Material" || cat === "Consumable") return "Packing Material";
    return "Chemicals";
}

export function getDisplayType(item: ItemMasterRecord, productTypes?: ItemProductTypeRow[]): string {
    if (productTypes?.length) {
        const pt = findProductTypeForItem(productTypes, item, getDisplayCategory(item));
        if (pt) return pt.label;
    }
    if (item.category === "Copper Wire" || item.itemType === "Copper Wire") return "Copper Wire";
    if (item.category === "Enameled" || item.itemType === "Enameled Wire") return "Enameled Wire";
    if (item.category === "Strip" || item.itemType === "Strip") return "Copper Strip";
    if (item.itemType === "Wire") return "Wire No 8";
    if (item.itemType === "Rod") return "Copper Rod 8mm";
    if (item.itemType === "Scrap Feed") return "Copper Scrap";
    if (item.itemType === "Scrap" || /machine scrap/i.test(item.name)) return "Machine Scrap";
    if (["Goats", "Paper", "Wrappers", "Stickers"].includes(item.itemType)) return item.itemType;
    if (item.itemType === "Varnish" || item.category === "Chemicals") return "Varnish Drum";
    return item.itemType || "—";
}

export function getDisplaySpec(item: ItemMasterRecord): string {
    const spec = item.sizeSpec === "—" ? "" : item.sizeSpec;
    if (!spec) return "—";
    return spec;
}

function resolveEnamelGauge(form: ItemFormState): string {
    if (form.enamelGaugeIsCustom) return form.enamelGaugeCustom.trim();
    return form.enamelGaugePreset.trim();
}

function formatEnamelGaugeLabel(gauge: string): string {
    if (!gauge) return "";
    if (/swg/i.test(gauge)) return gauge;
    if (/^\d+$/.test(gauge)) return `SWG ${gauge}`;
    return gauge;
}

export function buildAutoEnamelName(form: ItemFormState): string {
    const gauge = formatEnamelGaugeLabel(resolveEnamelGauge(form));
    return `Enameled Wire ${gauge} (${form.enamelColor})`.replace(/\s+/g, " ").trim();
}

export function composeItemFromForm(
    form: ItemFormState,
    code: string,
    productType: ItemProductTypeRow,
): ItemMasterRecord {
    const stdCost = form.cost ? `₨ ${Number(form.cost).toLocaleString()}` : "₨ 0";
    const category = inventoryGroupToCategory(productType.inventoryGroup);
    const base = {
        code,
        unit: form.unit,
        stdCost,
        itemType: productType.itemType,
    };

    switch (productType.formTemplate) {
        case "enamel_gauge_color": {
            const gauge = formatEnamelGaugeLabel(resolveEnamelGauge(form));
            const name = form.enamelCustomName.trim() || buildAutoEnamelName(form);
            return {
                ...base,
                name,
                category,
                sizeSpec: gauge || "—",
            };
        }
        case "strip_dimensions": {
            const stripSize = form.stripSize.trim() || "—";
            const name = stripSize !== "—" ? `Copper Strip ${stripSize}` : "Copper Strip";
            return { ...base, name, category, sizeSpec: stripSize };
        }
        case "free_text": {
            const name = form.freeTextName.trim() || productType.label;
            const spec = form.freeTextSpec.trim() || "—";
            return { ...base, name, category, sizeSpec: spec };
        }
        case "none": {
            const fixedNames: Record<string, { name: string; sizeSpec: string }> = {
                wire_no_8: { name: "Wire No 8", sizeSpec: "—" },
                copper_rod: { name: "Copper Rod 8 mm", sizeSpec: "8 mm" },
                copper_scrap: { name: "Copper Scrap", sizeSpec: "Mixed Grade" },
            };
            const fixed = fixedNames[productType.slug];
            return {
                ...base,
                name: fixed?.name ?? productType.label,
                category,
                sizeSpec: fixed?.sizeSpec ?? "—",
            };
        }
        case "machine_scrap": {
            const label = form.machineScrapLabel.trim();
            const dept = form.machineScrapDepartment;
            const name = label || `${dept} Machine Scrap`;
            return { ...base, name, category, sizeSpec: dept };
        }
        case "goat_packing": {
            if (form.goatProduct === "Enamel Wire") {
                const weight =
                    form.goatEnamelWeight === "Custom"
                        ? form.goatCustomWeight.trim()
                        : form.goatEnamelWeight;
                const sizeSpec = weight ? `${weight} (Enamel Wire)` : "Enamel Wire";
                return {
                    ...base,
                    name: weight ? `Goat ${weight} (Enamel Wire)` : "Goat (Enamel Wire)",
                    category,
                    sizeSpec,
                };
            }
            const stripSize = form.goatStripSize.trim() || "—";
            return {
                ...base,
                name: stripSize !== "—" ? `Goat ${stripSize} (Strip)` : "Goat (Strip)",
                category,
                sizeSpec: stripSize !== "—" ? `${stripSize} (Strip)` : "Strip",
            };
        }
        case "packing_spec": {
            const spec = form.packingSpec.trim() || "Standard";
            const baseName =
                productType.slug === "paper"
                    ? "Paper"
                    : productType.slug === "wrappers"
                      ? "Wrapper"
                      : "Sticker";
            return {
                ...base,
                name: spec !== "Standard" ? `${baseName} ${spec}` : baseName,
                category,
                sizeSpec: spec,
            };
        }
        case "varnish_drum": {
            const drumWt = form.varnishDrumWeightKg.trim();
            const drumSpec = drumWt ? `${drumWt} kg/drum` : form.chemicalCustomSpec.trim() || "Standard Drum";
            return {
                ...base,
                name: `Varnish Drum (${form.varnishColor})`,
                category,
                sizeSpec: drumSpec,
            };
        }
        default:
            return { ...base, name: productType.label, category, sizeSpec: "—" };
    }
}

export function parseDrumWeightKgFromSpec(spec: string): number {
    const m = spec.match(/([\d.]+)\s*kg\s*\/?\s*drum/i) ?? spec.match(/([\d.]+)\s*kg/i);
    return m ? Number(m[1]) || 0 : 0;
}

export function resolveStorageCategoryForCode(
    form: ItemFormState,
    productType: ItemProductTypeRow,
): ItemCategory {
    return composeItemFromForm(form, "TMP", productType).category;
}

export function resolveItemTypeForCode(form: ItemFormState, productType: ItemProductTypeRow): string {
    return composeItemFromForm(form, "TMP", productType).itemType;
}

export function buildItemDisplayName(item: Pick<ItemMasterRecord, "name" | "itemType" | "sizeSpec">): string {
    const name = item.name?.trim() ?? "";
    const spec = item.sizeSpec === "—" ? "" : (item.sizeSpec?.trim() ?? "");

    if (
        name &&
        /\(Golden\)|\(Black\)|Wire No 8|Goat |Varnish Drum|Copper Strip|Copper Rod|Copper Scrap|Copper Wire/i.test(
            name,
        )
    ) {
        return name;
    }
    if (name && spec && !name.toLowerCase().includes(spec.toLowerCase())) {
        return `${name} — ${spec}`;
    }
    return name || spec || "Item";
}

export function validateItemForm(form: ItemFormState, productType: ItemProductTypeRow): string | null {
    switch (productType.formTemplate) {
        case "enamel_gauge_color": {
            const gauge = resolveEnamelGauge(form);
            if (!gauge) return "Select or enter an enamel wire gauge.";
            if (form.enamelGaugeIsCustom && !form.enamelGaugeCustom.trim()) return "Enter a custom gauge.";
            return null;
        }
        case "strip_dimensions":
            if (!form.stripSize.trim()) return "Enter copper strip dimensions.";
            return null;
        case "free_text":
            if (!form.freeTextName.trim()) return "Enter a name for this item.";
            return null;
        case "machine_scrap":
            if (!form.machineScrapLabel.trim() && !form.machineScrapDepartment) {
                return "Select a department or enter a scrap label.";
            }
            return null;
        case "goat_packing":
            if (form.goatProduct === "Enamel Wire" && form.goatEnamelWeight === "Custom" && !form.goatCustomWeight.trim()) {
                return "Enter custom goat weight for enamel wire.";
            }
            if (form.goatProduct === "Strip" && !form.goatStripSize.trim()) {
                return "Enter goat size for strip.";
            }
            return null;
        case "varnish_drum":
            return null;
        case "packing_spec":
            return null;
        default:
            return null;
    }
}

function parseSwgFromSpec(spec: string): { preset: string; isCustom: boolean; custom: string } {
    const m = spec.match(/(\d+)\s*SWG/i) ?? spec.match(/^(\d+)$/);
    if (m && ENAMEL_GAUGES.includes(Number(m[1]))) {
        return { preset: m[1], isCustom: false, custom: "" };
    }
    return { preset: "22", isCustom: true, custom: spec.replace(/SWG/i, "").trim() || spec };
}

function parseColorFromName(name: string, spec: string): EnamelColor {
    const text = `${name} ${spec}`;
    if (/black/i.test(text)) return "Black";
    return "Golden";
}

export function parseItemToForm(
    item: ItemMasterRecord,
    productTypes: ItemProductTypeRow[],
): ItemFormState {
    const topCategory = getDisplayCategory(item);
    const productType = findProductTypeForItem(productTypes, item, topCategory);
    const form = defaultItemFormState(topCategory, productType?.slug ?? "");
    form.unit = item.unit;
    form.cost = String(Number(String(item.stdCost).replace(/[^\d.]/g, "")) || "");

    if (!productType) return form;

    switch (productType.formTemplate) {
        case "enamel_gauge_color": {
            const gauge = parseSwgFromSpec(item.sizeSpec);
            form.enamelGaugePreset = gauge.preset;
            form.enamelGaugeIsCustom = gauge.isCustom;
            form.enamelGaugeCustom = gauge.custom;
            form.enamelColor = parseColorFromName(item.name, item.sizeSpec);
            const autoName = buildAutoEnamelName(form);
            if (item.name.trim() && item.name.trim() !== autoName) {
                form.enamelCustomName = item.name.trim();
            }
            break;
        }
        case "strip_dimensions":
            form.stripSize =
                item.sizeSpec === "—" ? item.name.replace(/^Copper Strip\s*/i, "") : item.sizeSpec;
            break;
        case "free_text":
            form.freeTextName = item.name;
            form.freeTextSpec = item.sizeSpec === "—" ? "" : item.sizeSpec;
            break;
        case "machine_scrap": {
            const dept = MACHINE_SCRAP_DEPARTMENTS.find((d) => item.sizeSpec === d || item.name.includes(d));
            form.machineScrapDepartment = dept ?? "Drawing";
            form.machineScrapLabel = item.name.replace(/^(Drawing|Enamel|Workshop)\s+Machine Scrap$/i, "").trim();
            if (form.machineScrapLabel === item.name) form.machineScrapLabel = "";
            break;
        }
        case "goat_packing": {
            if (/strip/i.test(item.sizeSpec) || /strip/i.test(item.name)) {
                form.goatProduct = "Strip";
                form.goatStripSize = item.sizeSpec.replace(/\s*\(Strip\)/i, "").trim();
            } else {
                form.goatProduct = "Enamel Wire";
                const wMatch = item.sizeSpec.match(/([\d.]+\s*kg)/i) ?? item.name.match(/([\d.]+\s*kg)/i);
                if (wMatch?.[1] === "5 kg") form.goatEnamelWeight = "5 kg";
                else if (wMatch?.[1] === "10 kg") form.goatEnamelWeight = "10 kg";
                else {
                    form.goatEnamelWeight = "Custom";
                    form.goatCustomWeight = wMatch?.[1] ?? item.sizeSpec.replace(/\s*\(Enamel Wire\)/i, "");
                }
            }
            break;
        }
        case "packing_spec":
            form.packingSpec = item.sizeSpec === "Standard" ? "" : item.sizeSpec;
            break;
        case "varnish_drum":
            form.varnishColor = parseColorFromName(item.name, item.sizeSpec);
            form.varnishDrumWeightKg = String(parseDrumWeightKgFromSpec(item.sizeSpec) || "");
            form.chemicalCustomSpec = item.sizeSpec === "Standard" || /kg\/drum/i.test(item.sizeSpec) ? "" : item.sizeSpec;
            break;
        default:
            break;
    }

    return form;
}

export function resolveProductTypeForForm(
    productTypes: ItemProductTypeRow[],
    form: ItemFormState,
): ItemProductTypeRow {
    const found = findProductTypeBySlug(productTypes, form.productTypeSlug);
    if (found) return found;
    const fallback = getProductTypesForCategory(productTypes, form.topCategory)[0];
    if (!fallback) throw new Error("No product types configured for this category.");
    return fallback;
}

export { categoryToInventoryGroup, inventoryGroupToCategory };
