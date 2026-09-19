import type { TopCategory } from "@/lib/itemFormSchema";

export type ItemFormTemplate =
    | "enamel_gauge_color"
    | "strip_dimensions"
    | "free_text"
    | "none"
    | "machine_scrap"
    | "goat_packing"
    | "packing_spec"
    | "varnish_drum";

export type InventoryGroupDb =
    | "enameled"
    | "strip"
    | "copper_wire"
    | "raw_material"
    | "packing_material"
    | "chemicals";

export type ItemProductTypeRow = {
    id: string;
    topCategory: TopCategory;
    label: string;
    slug: string;
    inventoryGroup: InventoryGroupDb;
    itemType: string;
    codePrefix: string;
    formTemplate: ItemFormTemplate;
    sortOrder: number;
    isActive: boolean;
    isSystem: boolean;
    tracksUnitCount: boolean;
};

const UNIT_TRACKING_GROUPS: InventoryGroupDb[] = ["enameled", "strip", "copper_wire", "raw_material"];

export function inventoryGroupTracksUnits(group: InventoryGroupDb | string): boolean {
    return UNIT_TRACKING_GROUPS.includes(group as InventoryGroupDb);
}

export const FORM_TEMPLATE_LABELS: Record<ItemFormTemplate, string> = {
    enamel_gauge_color: "SWG gauge + enamel color (+ optional custom name)",
    strip_dimensions: "Strip dimensions",
    free_text: "Custom name + spec",
    none: "Fixed label (no extra fields)",
    machine_scrap: "Department + optional label",
    goat_packing: "Goat product + weight/size",
    packing_spec: "Spec text",
    varnish_drum: "Varnish color + drum weight",
};

export const INVENTORY_GROUP_OPTIONS: Record<TopCategory, InventoryGroupDb[]> = {
    "Finished Goods": ["enameled", "strip", "copper_wire"],
    "Raw Material": ["raw_material"],
    "Packing Material": ["packing_material"],
    Chemicals: ["chemicals"],
};

/** Offline / pre-migration fallback — mirrors DB seed in migration 197. */
const _FALLBACK_ITEM_PRODUCT_TYPES_RAW: Omit<ItemProductTypeRow, "tracksUnitCount">[] = [
    {
        id: "fallback-enamel",
        topCategory: "Finished Goods",
        label: "Enameled Wire",
        slug: "enamel_wire",
        inventoryGroup: "enameled",
        itemType: "Enameled Wire",
        codePrefix: "FG-ENW",
        formTemplate: "enamel_gauge_color",
        sortOrder: 10,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-strip",
        topCategory: "Finished Goods",
        label: "Copper Strip",
        slug: "copper_strip",
        inventoryGroup: "strip",
        itemType: "Strip",
        codePrefix: "FG-STR",
        formTemplate: "strip_dimensions",
        sortOrder: 20,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-copper-wire",
        topCategory: "Finished Goods",
        label: "Copper Wire",
        slug: "copper_wire",
        inventoryGroup: "copper_wire",
        itemType: "Copper Wire",
        codePrefix: "FG-CUW",
        formTemplate: "free_text",
        sortOrder: 30,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-w8",
        topCategory: "Raw Material",
        label: "Wire No 8",
        slug: "wire_no_8",
        inventoryGroup: "raw_material",
        itemType: "Wire",
        codePrefix: "RM-W8",
        formTemplate: "none",
        sortOrder: 10,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-rod",
        topCategory: "Raw Material",
        label: "Copper Rod 8mm",
        slug: "copper_rod",
        inventoryGroup: "raw_material",
        itemType: "Rod",
        codePrefix: "RM-CR",
        formTemplate: "none",
        sortOrder: 20,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-scrap-feed",
        topCategory: "Raw Material",
        label: "Copper Scrap",
        slug: "copper_scrap",
        inventoryGroup: "raw_material",
        itemType: "Scrap Feed",
        codePrefix: "RM-SCP",
        formTemplate: "none",
        sortOrder: 30,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-machine-scrap",
        topCategory: "Raw Material",
        label: "Machine Scrap",
        slug: "machine_scrap",
        inventoryGroup: "raw_material",
        itemType: "Scrap",
        codePrefix: "RM-SCP",
        formTemplate: "machine_scrap",
        sortOrder: 40,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-custom-rm",
        topCategory: "Raw Material",
        label: "Custom",
        slug: "custom_rm",
        inventoryGroup: "raw_material",
        itemType: "General",
        codePrefix: "RM-GEN",
        formTemplate: "free_text",
        sortOrder: 50,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-goats",
        topCategory: "Packing Material",
        label: "Goats",
        slug: "goats",
        inventoryGroup: "packing_material",
        itemType: "Goats",
        codePrefix: "CON-GOT",
        formTemplate: "goat_packing",
        sortOrder: 10,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-paper",
        topCategory: "Packing Material",
        label: "Paper",
        slug: "paper",
        inventoryGroup: "packing_material",
        itemType: "Paper",
        codePrefix: "CON-PAP",
        formTemplate: "packing_spec",
        sortOrder: 20,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-wrappers",
        topCategory: "Packing Material",
        label: "Wrappers",
        slug: "wrappers",
        inventoryGroup: "packing_material",
        itemType: "Wrappers",
        codePrefix: "CON-WRP",
        formTemplate: "packing_spec",
        sortOrder: 30,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-stickers",
        topCategory: "Packing Material",
        label: "Stickers",
        slug: "stickers",
        inventoryGroup: "packing_material",
        itemType: "Stickers",
        codePrefix: "CON-STK",
        formTemplate: "packing_spec",
        sortOrder: 40,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-varnish",
        topCategory: "Chemicals",
        label: "Varnish Drum",
        slug: "varnish_drum",
        inventoryGroup: "chemicals",
        itemType: "Varnish",
        codePrefix: "CHM-VAR",
        formTemplate: "varnish_drum",
        sortOrder: 10,
        isActive: true,
        isSystem: true,
    },
    {
        id: "fallback-custom-chem",
        topCategory: "Chemicals",
        label: "Custom",
        slug: "custom_chemical",
        inventoryGroup: "chemicals",
        itemType: "Chemical",
        codePrefix: "CHM-GEN",
        formTemplate: "free_text",
        sortOrder: 20,
        isActive: true,
        isSystem: true,
    },
];

export const FALLBACK_ITEM_PRODUCT_TYPES: ItemProductTypeRow[] = _FALLBACK_ITEM_PRODUCT_TYPES_RAW.map((r) => ({
    ...r,
    tracksUnitCount: inventoryGroupTracksUnits(r.inventoryGroup) || r.formTemplate === "varnish_drum",
}));

export function mapDbProductTypeRow(row: Record<string, unknown>): ItemProductTypeRow {
    return {
        id: String(row.id),
        topCategory: String(row.top_category) as TopCategory,
        label: String(row.label),
        slug: String(row.slug),
        inventoryGroup: String(row.inventory_group) as InventoryGroupDb,
        itemType: String(row.item_type),
        codePrefix: String(row.code_prefix),
        formTemplate: String(row.form_template) as ItemFormTemplate,
        sortOrder: Number(row.sort_order ?? 0),
        isActive: row.is_active !== false,
        isSystem: row.is_system === true,
        tracksUnitCount:
            row.tracks_unit_count === true ||
            inventoryGroupTracksUnits(String(row.inventory_group ?? "")) ||
            String(row.form_template ?? "") === "varnish_drum",
    };
}

export function getProductTypesForCategory(
    types: ItemProductTypeRow[],
    topCategory: TopCategory,
    activeOnly = true,
): ItemProductTypeRow[] {
    return types
        .filter((t) => t.topCategory === topCategory && (!activeOnly || t.isActive))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export function findProductTypeBySlug(
    types: ItemProductTypeRow[],
    slug: string,
): ItemProductTypeRow | undefined {
    return types.find((t) => t.slug === slug);
}

export function findProductTypeForItem(
    types: ItemProductTypeRow[],
    item: { category: string; itemType: string; name: string },
    topCategory: TopCategory,
): ItemProductTypeRow | undefined {
    const inCategory = types.filter((t) => t.topCategory === topCategory);
    const byType = inCategory.find((t) => t.itemType === item.itemType);
    if (byType) return byType;
    if (item.category === "Enameled") return inCategory.find((t) => t.slug === "enamel_wire");
    if (item.category === "Strip") return inCategory.find((t) => t.slug === "copper_strip");
    if (item.category === "Copper Wire" || item.itemType === "Copper Wire") {
        return inCategory.find((t) => t.slug === "copper_wire");
    }
    if (item.itemType === "Wire") return inCategory.find((t) => t.slug === "wire_no_8");
    if (item.itemType === "Rod") return inCategory.find((t) => t.slug === "copper_rod");
    if (item.itemType === "Scrap Feed") return inCategory.find((t) => t.slug === "copper_scrap");
    if (item.itemType === "Scrap") return inCategory.find((t) => t.slug === "machine_scrap");
    if (item.itemType === "Varnish") return inCategory.find((t) => t.slug === "varnish_drum");
    if (item.itemType === "Goats") return inCategory.find((t) => t.slug === "goats");
    if (item.itemType === "Paper") return inCategory.find((t) => t.slug === "paper");
    if (item.itemType === "Wrappers") return inCategory.find((t) => t.slug === "wrappers");
    if (item.itemType === "Stickers") return inCategory.find((t) => t.slug === "stickers");
    return inCategory.find((t) => t.formTemplate === "free_text") ?? inCategory[0];
}

export function defaultProductTypeSlug(types: ItemProductTypeRow[], topCategory: TopCategory): string {
    const first = getProductTypesForCategory(types, topCategory)[0];
    return first?.slug ?? FALLBACK_ITEM_PRODUCT_TYPES.find((t) => t.topCategory === topCategory)?.slug ?? "";
}

export function inventoryGroupToCategory(group: string): import("@/lib/itemCatalog").ItemCategory {
    if (group === "enameled") return "Enameled";
    if (group === "strip") return "Strip";
    if (group === "copper_wire") return "Copper Wire";
    if (group === "raw_material") return "Raw Material";
    if (group === "packing_material") return "Packing Material";
    return "Chemicals";
}

export function categoryToInventoryGroup(
    category: import("@/lib/itemCatalog").ItemCategory,
): InventoryGroupDb {
    if (category === "Enameled") return "enameled";
    if (category === "Strip") return "strip";
    if (category === "Copper Wire") return "copper_wire";
    if (category === "Raw Material" || category === "Scrap") return "raw_material";
    if (category === "Packing Material" || category === "Consumable") return "packing_material";
    return "chemicals";
}
