import { isErpLiveMode } from "@/lib/backendFlags";
import { categoryToInventoryGroup, inventoryGroupToCategory } from "@/lib/itemProductTypes";
import { supabase } from "@/lib/supabase";

export type ItemCategory =
    | "Enameled"
    | "Strip"
    | "Copper Wire"
    | "Raw Material"
    | "Packing Material"
    | "Chemicals"
    // Legacy categories retained for backward compatibility with old local data.
    | "Finished Goods"
    | "Scrap"
    | "Chemical"
    | "Consumable";

export type WarehouseType =
    | "finished_goods"
    | "raw_material"
    | "packing_material"
    | "varnish";

export type InventorySection =
    | "fg_enameled"
    | "fg_strip"
    | "fg_copper_wire"
    | "rm_scrap"
    | "rm_wire8"
    | "rm_rod"
    | "packing"
    | "varnish";

export type FinishedGoodsStore = "STORE_FG_ENAMELED" | "STORE_FG_STRIP";

export interface ItemMasterRecord {
    code: string;
    name: string;
    category: ItemCategory;
    itemType: string;
    sizeSpec: string;
    unit: "KG" | "Drum" | "Roll" | "Piece";
    stdCost: string;
}

const CATALOG_STORAGE_KEY = "coppersync_item_catalog_v1";

export const seedItemCatalog: ItemMasterRecord[] = [
    { code: "FG-STR-001", name: "Copper Strip 6 mm × 1.5 mm", category: "Strip", itemType: "Strip", sizeSpec: "6 mm × 1.5 mm", unit: "KG", stdCost: "₨ 2,520" },
    { code: "FG-STR-002", name: "Copper Strip 8 mm × 2.0 mm", category: "Strip", itemType: "Strip", sizeSpec: "8 mm × 2.0 mm", unit: "KG", stdCost: "₨ 2,560" },
    { code: "FG-ENW-001", name: "Enameled Wire SWG 18 (Golden)", category: "Enameled", itemType: "Enameled Wire", sizeSpec: "SWG 18", unit: "KG", stdCost: "₨ 2,780" },
    { code: "FG-ENW-002", name: "Enameled Wire SWG 20 (Black)", category: "Enameled", itemType: "Enameled Wire", sizeSpec: "SWG 20", unit: "KG", stdCost: "₨ 2,810" },
    { code: "FG-ENW-003", name: "Enameled Wire SWG 22 (Golden)", category: "Enameled", itemType: "Enameled Wire", sizeSpec: "SWG 22", unit: "KG", stdCost: "₨ 2,860" },
    { code: "RM-W8-001", name: "Wire No 8", category: "Raw Material", itemType: "Wire", sizeSpec: "—", unit: "KG", stdCost: "₨ 2,420" },
    { code: "RM-CR-001", name: "Copper Rod 8 mm", category: "Raw Material", itemType: "Rod", sizeSpec: "8 mm", unit: "KG", stdCost: "₨ 2,450" },
    { code: "RM-SCP-001", name: "Copper Scrap", category: "Raw Material", itemType: "Scrap Feed", sizeSpec: "Mixed Grade", unit: "KG", stdCost: "₨ 1,980" },
    { code: "CHM-VAR-001", name: "Varnish Drum (Golden)", category: "Chemicals", itemType: "Varnish", sizeSpec: "200 kg/drum", unit: "Drum", stdCost: "₨ 78,000" },
    { code: "CHM-VAR-002", name: "Varnish Drum (Black)", category: "Chemicals", itemType: "Varnish", sizeSpec: "200 kg/drum", unit: "Drum", stdCost: "₨ 78,000" },
    { code: "CON-GOT-001", name: "Goat 5 kg (Enamel Wire)", category: "Packing Material", itemType: "Goats", sizeSpec: "5 kg (Enamel Wire)", unit: "Roll", stdCost: "₨ 4,800" },
    { code: "CON-GOT-002", name: "Goat 10 kg (Enamel Wire)", category: "Packing Material", itemType: "Goats", sizeSpec: "10 kg (Enamel Wire)", unit: "Roll", stdCost: "₨ 5,200" },
    { code: "CON-PAP-001", name: "Paper", category: "Packing Material", itemType: "Paper", sizeSpec: "0.25 mm", unit: "Roll", stdCost: "₨ 6,500" },
    { code: "CON-WRP-001", name: "Wrapper Standard", category: "Packing Material", itemType: "Wrappers", sizeSpec: "Standard", unit: "Roll", stdCost: "₨ 3,200" },
    { code: "CON-STK-001", name: "Sticker Standard", category: "Packing Material", itemType: "Stickers", sizeSpec: "Standard", unit: "Piece", stdCost: "₨ 120" },
];

export const seedInventoryBalances: Record<string, number> = {
    "FG-STR-001": 620,
    "FG-STR-002": 480,
    "FG-ENW-001": 710,
    "FG-ENW-002": 560,
    "FG-ENW-003": 430,
    "RM-W8-001": 2055,
    "RM-CR-001": 1490,
    "RM-SCP-001": 390,
    "CHM-VAR-001": 18,
    "CHM-VAR-002": 12,
    "CON-GOT-001": 42,
    "CON-GOT-002": 28,
    "CON-PAP-001": 65,
    "CON-WRP-001": 30,
    "CON-STK-001": 500,
};

export const seedReorderLevels: Record<string, number> = {
    "FG-STR-001": 250,
    "FG-STR-002": 220,
    "FG-ENW-001": 300,
    "FG-ENW-002": 260,
    "FG-ENW-003": 220,
    "RM-W8-001": 900,
    "RM-CR-001": 850,
    "RM-SCP-001": 450,
    "CHM-VAR-002": 20,
    "CON-GOT-001": 35,
    "CON-GOT-002": 25,
    "CON-PAP-001": 40,
    "CON-WRP-001": 20,
    "CON-STK-001": 100,
};

/** @deprecated use getItemCatalog() */
export const itemCatalog = seedItemCatalog;

/** @deprecated use inventoryStore.getBalance */
export const inventoryBalances = seedInventoryBalances;

/** @deprecated use getReorderLevel from inventoryStore */
export const reorderLevel = seedReorderLevels;

const REORDER_STORAGE_KEY = "coppersync_reorder_levels_v1";

function loadReorderLevels(): Record<string, number> {
    try {
        const raw = localStorage.getItem(REORDER_STORAGE_KEY);
        if (raw) return { ...seedReorderLevels, ...JSON.parse(raw) };
    } catch {
        /* seed */
    }
    return { ...seedReorderLevels };
}

let reorderState: Record<string, number> = loadReorderLevels();

function saveReorderLevels() {
    if (isErpLiveMode()) return;
    try {
        localStorage.setItem(REORDER_STORAGE_KEY, JSON.stringify(reorderState));
    } catch {
        /* ignore */
    }
}

export function getReorderLevelForItem(code: string): number {
    return reorderState[code] ?? 0;
}

export function setReorderLevelForItem(code: string, level: number) {
    reorderState = { ...reorderState, [code]: level };
    saveReorderLevels();
}

const catalogListeners = new Set<() => void>();

function loadCatalog(): ItemMasterRecord[] {
    if (isErpLiveMode()) {
        return [];
    }
    try {
        const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as ItemMasterRecord[];
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch {
        /* seed */
    }
    return [...seedItemCatalog];
}

let catalogState: ItemMasterRecord[] = loadCatalog();

function saveCatalog() {
    if (isErpLiveMode()) {
        catalogListeners.forEach((fn) => fn());
        return;
    }
    try {
        localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalogState));
    } catch {
        /* ignore */
    }
    catalogListeners.forEach((fn) => fn());
}

export function subscribeCatalog(listener: () => void): () => void {
    catalogListeners.add(listener);
    return () => catalogListeners.delete(listener);
}

function mapInventoryGroupToCategory(group: string): ItemCategory {
    return inventoryGroupToCategory(group);
}

function mapCategoryToInventoryGroup(category: ItemCategory) {
    return categoryToInventoryGroup(category);
}

let initItemPromise: Promise<void> | null = null;

export async function initItemCatalog(): Promise<void> {
    if (!isErpLiveMode()) return;
    if (initItemPromise) return initItemPromise;
    initItemPromise = (async () => {
    const { data, error } = await supabase
        .schema("erp")
        .from("items")
        .select("code,name,inventory_group,item_type,size_spec,base_uom,standard_cost,reorder_level,is_active")
        .eq("is_active", true)
        .order("code");

    if (error || !data) return;
    const mapped: ItemMasterRecord[] = data.map((row) => ({
        code: row.code,
        name: row.name,
        category: mapInventoryGroupToCategory(row.inventory_group),
        itemType: row.item_type ?? "General",
        sizeSpec: row.size_spec ?? "—",
        unit: (row.base_uom as ItemMasterRecord["unit"]) ?? "KG",
        stdCost: `₨ ${Number(row.standard_cost ?? 0).toLocaleString()}`,
    }));

    catalogState = mapped;
    reorderState = {
        ...reorderState,
        ...Object.fromEntries(data.map((row) => [row.code, Number(row.reorder_level ?? 0)])),
    };
    saveReorderLevels();
    saveCatalog();
    })();
    await initItemPromise;
}

export function getItemCatalog(): ItemMasterRecord[] {
    return [...catalogState];
}

export function getCatalogItem(code: string): ItemMasterRecord | undefined {
    return catalogState.find((i) => i.code === code);
}

export async function addCatalogItem(item: ItemMasterRecord, reorderLevel = 0): Promise<void> {
    if (catalogState.some((i) => i.code === item.code)) {
        throw new Error(`Item code already exists: ${item.code}`);
    }
    if (isErpLiveMode()) {
        const { data: existing } = await supabase
            .schema("erp")
            .from("items")
            .select("id,is_active")
            .eq("code", item.code)
            .maybeSingle();
        if (existing?.id) {
            throw new Error(
                existing.is_active === false
                    ? `Item code ${item.code} exists but is inactive. Reactivate it or use a new code.`
                    : `Item code ${item.code} already exists in the database. Close this form and add again for the next code.`
            );
        }

        const { error } = await supabase.schema("erp").from("items").insert({
            code: item.code,
            name: item.name,
            inventory_group: mapCategoryToInventoryGroup(item.category),
            item_type: item.itemType,
            size_spec: item.sizeSpec,
            base_uom: item.unit,
            standard_cost: parseStdCost(item.stdCost),
            reorder_level: reorderLevel,
            gst_rate: 0,
            is_active: true,
        });
        if (error) {
            const msg = error.message || "Failed to insert item.";
            if (error.code === "23505") {
                throw new Error(`Item code ${item.code} already exists. Refresh the page and try again.`);
            }
            throw new Error(msg);
        }
    }
    if (reorderLevel > 0) {
        reorderState = { ...reorderState, [item.code]: reorderLevel };
        saveReorderLevels();
    }
    catalogState = [...catalogState, item];
    saveCatalog();
}

export async function updateCatalogItem(code: string, patch: Partial<Omit<ItemMasterRecord, "code">>): Promise<void> {
    const idx = catalogState.findIndex((i) => i.code === code);
    if (idx < 0) throw new Error(`Item not found: ${code}`);
    const current = catalogState[idx];
    const next = {
        ...current,
        ...patch,
        category: patch.category ?? current.category,
    };
    if (isErpLiveMode()) {
        const { error } = await supabase
            .schema("erp")
            .from("items")
            .update({
                name: next.name,
                inventory_group: mapCategoryToInventoryGroup(next.category),
                item_type: next.itemType,
                size_spec: next.sizeSpec,
                base_uom: next.unit,
                standard_cost: parseStdCost(next.stdCost),
            })
            .eq("code", code);
        if (error) throw new Error(error.message);
    }
    catalogState = catalogState.map((item, i) =>
        i === idx
            ? {
                  ...item,
                  ...patch,
                  category: patch.category ?? item.category,
              }
            : item
    );
    saveCatalog();
}

export type ReclassifyItemResult = {
    ok: boolean;
    code?: string;
    oldGroup?: string;
    newGroup?: string;
    warnings?: string[];
    error?: string;
};

export async function reclassifyCatalogItem(
    code: string,
    payload: { targetProductTypeSlug: string; name: string; sizeSpec: string },
): Promise<ReclassifyItemResult> {
    const idx = catalogState.findIndex((i) => i.code === code);
    if (idx < 0) return { ok: false, error: `Item not found: ${code}` };

    if (!isErpLiveMode()) {
        const targetGroup =
            payload.targetProductTypeSlug === "copper_wire"
                ? "Copper Wire"
                : payload.targetProductTypeSlug === "copper_strip"
                  ? "Strip"
                  : payload.targetProductTypeSlug === "enamel_wire"
                    ? "Enameled"
                    : catalogState[idx].category;
        catalogState = catalogState.map((item, i) =>
            i === idx
                ? {
                      ...item,
                      category: targetGroup as ItemCategory,
                      name: payload.name,
                      sizeSpec: payload.sizeSpec,
                      itemType:
                          payload.targetProductTypeSlug === "copper_wire"
                              ? "Copper Wire"
                              : payload.targetProductTypeSlug === "copper_strip"
                                ? "Strip"
                                : payload.targetProductTypeSlug === "enamel_wire"
                                  ? "Enameled Wire"
                                  : item.itemType,
                  }
                : item,
        );
        saveCatalog();
        return { ok: true, code, warnings: ["Demo mode — reclassified locally only."] };
    }

    const { data: itemRow, error: fetchErr } = await supabase
        .schema("erp")
        .from("items")
        .select("id")
        .eq("code", code)
        .single();
    if (fetchErr || !itemRow) return { ok: false, error: fetchErr?.message ?? "Item not found in database." };

    const { data, error } = await supabase.schema("erp").rpc("reclassify_item", {
        p_item_id: itemRow.id,
        p_target_product_type_slug: payload.targetProductTypeSlug,
        p_name: payload.name,
        p_size_spec: payload.sizeSpec,
    });
    if (error) return { ok: false, error: error.message };

    let parsed: {
        ok?: boolean;
        error?: string;
        code?: string;
        old_group?: string;
        new_group?: string;
        warnings?: string[];
    } = {};
    if (typeof data === "string") {
        try {
            parsed = JSON.parse(data);
        } catch {
            parsed = {};
        }
    } else if (data && typeof data === "object") {
        parsed = data as typeof parsed;
    }
    if (!parsed.ok) return { ok: false, error: parsed.error ?? "Reclassification failed." };

    initItemPromise = null;
    await initItemCatalog();

    return {
        ok: true,
        code: parsed.code ?? code,
        oldGroup: parsed.old_group,
        newGroup: parsed.new_group,
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
}

export async function removeCatalogItem(code: string): Promise<void> {
    const exists = catalogState.some((i) => i.code === code);
    if (!exists) throw new Error(`Item not found: ${code}`);
    if (isErpLiveMode()) {
        const { data, error } = await supabase.schema("erp").rpc("fn_deactivate_item", { p_code: code });
        if (error) {
            const msg = error.message ?? "Failed to deactivate item.";
            if (msg.includes("fn_deactivate_item")) {
                throw new Error("Item deactivate is not available on the server. Run migration 56 in Supabase.");
            }
            throw new Error(msg);
        }
        let parsed: { ok?: boolean; error?: string } = {};
        if (typeof data === "string") {
            try {
                parsed = JSON.parse(data) as { ok?: boolean; error?: string };
            } catch {
                parsed = {};
            }
        } else if (data && typeof data === "object") {
            parsed = data as { ok?: boolean; error?: string };
        }
        if (!parsed.ok) {
            throw new Error(parsed.error ?? `Could not deactivate ${code}.`);
        }
    }
    catalogState = catalogState.filter((i) => i.code !== code);
    delete reorderState[code];
    saveReorderLevels();
    saveCatalog();
}

export function normalizeItemCategory(category: ItemCategory): Exclude<ItemCategory, "Finished Goods" | "Scrap" | "Chemical" | "Consumable"> {
    if (category === "Scrap") return "Raw Material";
    if (category === "Chemical") return "Chemicals";
    if (category === "Consumable") return "Packing Material";
    if (category === "Finished Goods") return "Enameled";
    return category;
}

export function getManagedCategoryForItem(item: ItemMasterRecord): Exclude<ItemCategory, "Finished Goods" | "Scrap" | "Chemical" | "Consumable"> {
    if (item.category === "Finished Goods") {
        if (item.itemType === "Strip") return "Strip";
        if (item.itemType === "Copper Wire") return "Copper Wire";
        return "Enameled";
    }
    if (item.category === "Copper Wire") return "Copper Wire";
    if (item.category === "Scrap") return "Raw Material";
    if (item.category === "Chemical") return "Chemicals";
    if (item.category === "Consumable") return "Packing Material";
    return item.category;
}

export function getWarehouseType(item: ItemMasterRecord): WarehouseType {
    const category = getManagedCategoryForItem(item);
    if (category === "Enameled" || category === "Strip" || category === "Copper Wire") return "finished_goods";
    if (category === "Raw Material") return "raw_material";
    if (category === "Packing Material") return "packing_material";
    return "varnish";
}

export function getInventorySection(item: ItemMasterRecord): InventorySection {
    const category = getManagedCategoryForItem(item);
    if (category === "Enameled") return "fg_enameled";
    if (category === "Strip") return "fg_strip";
    if (category === "Copper Wire") return "fg_copper_wire";
    if (category === "Chemicals" || item.itemType === "Varnish") return "varnish";
    if (category === "Packing Material") return "packing";
    if (category === "Raw Material") {
        if (item.itemType === "Scrap" || item.itemType === "Scrap Feed" || /scrap/i.test(item.name)) return "rm_scrap";
        if (item.itemType === "Wire" || /wire no 8/i.test(item.name)) return "rm_wire8";
        if (item.itemType === "Rod" || /rod/i.test(item.name)) return "rm_rod";
        return "rm_scrap";
    }
    return "varnish";
}

const UNIT_TRACKING_SECTIONS: InventorySection[] = [
    "fg_enameled",
    "fg_strip",
    "fg_copper_wire",
    "rm_scrap",
    "rm_wire8",
    "rm_rod",
    "varnish",
];

/** Whether this item participates in parallel unit-count inventory (FG/RM). */
export function itemTracksUnitCount(item: ItemMasterRecord): boolean {
    return UNIT_TRACKING_SECTIONS.includes(getInventorySection(item));
}

export function getFinishedGoodsStore(item: ItemMasterRecord): FinishedGoodsStore | null {
    const category = getManagedCategoryForItem(item);
    if (category !== "Enameled" && category !== "Strip") return null;
    return category === "Strip" || item.itemType === "Strip" ? "STORE_FG_STRIP" : "STORE_FG_ENAMELED";
}

export function isFinishedGoodsItem(item: ItemMasterRecord): boolean {
    return getWarehouseType(item) === "finished_goods";
}

export function getItemsBySection(section: InventorySection): ItemMasterRecord[] {
    return getItemCatalog().filter((i) => getInventorySection(i) === section);
}

export function getFinishedGoodsItems(): ItemMasterRecord[] {
    return getItemCatalog().filter((i) => getWarehouseType(i) === "finished_goods");
}

export function getPurchaseableItems(): ItemMasterRecord[] {
    return getItemCatalog().filter((i) => getWarehouseType(i) === "raw_material");
}

/** Finished goods plus raw materials (wire no 8, scrap, etc.) for sales invoices. */
export function getSalesInvoiceItemOptions(): ItemMasterRecord[] {
    return getItemCatalog()
        .filter((i) => {
            const cat = getManagedCategoryForItem(i);
            return cat === "Enameled" || cat === "Strip" || cat === "Copper Wire" || cat === "Raw Material";
        })
        .sort((a, b) => {
            const rank = (item: ItemMasterRecord) => {
                const cat = getManagedCategoryForItem(item);
                if (cat === "Enameled") return 0;
                if (cat === "Copper Wire") return 1;
                if (cat === "Strip") return 2;
                if (item.itemType === "Wire") return 3;
                if (item.itemType === "Scrap" || item.itemType === "Scrap Feed") return 4;
                return 5;
            };
            const diff = rank(a) - rank(b);
            return diff !== 0 ? diff : a.name.localeCompare(b.name);
        });
}

export function getSalesInvoiceItemGroupLabel(item: ItemMasterRecord): string {
    const cat = getManagedCategoryForItem(item);
    if (cat === "Enameled") return "Finished Goods — Enameled Wire";
    if (cat === "Copper Wire") return "Finished Goods — Copper Wire";
    if (cat === "Strip") return "Finished Goods — Copper Strip";
    if (item.itemType === "Wire") return "Raw Material — Wire No 8";
    if (item.itemType === "Scrap" || item.itemType === "Scrap Feed") return "Raw Material — Scrap";
    if (item.itemType === "Rod") return "Raw Material — Copper Rod";
    return "Raw Material — Other";
}

export function parseStdCost(stdCost: string): number {
    return Number(String(stdCost).replace(/[^\d.]/g, "")) || 0;
}

export function getItemCodePrefix(category: ItemCategory, itemType?: string): string {
    const normalized = normalizeItemCategory(category);
    if (normalized === "Enameled") return "FG-ENW";
    if (normalized === "Copper Wire") return "FG-CUW";
    if (normalized === "Strip") return "FG-STR";
    if (normalized === "Chemicals") return "CHM-VAR";
    if (normalized === "Packing Material") {
        const type = (itemType ?? "").toLowerCase();
        if (type.includes("goat")) return "CON-GOT";
        if (type.includes("paper")) return "CON-PAP";
        if (type.includes("wrapper")) return "CON-WRP";
        if (type.includes("sticker")) return "CON-STK";
        return "CON-GEN";
    }
    const type = (itemType ?? "").toLowerCase();
    if (type.includes("rod")) return "RM-CR";
    if (type.includes("wire")) return "RM-W8";
    if (type.includes("scrap")) return "RM-SCP";
    return "RM-GEN";
}

function codePrefixForCategory(category: ItemCategory, itemType?: string): string {
    return getItemCodePrefix(category, itemType);
}

function parseCodeSequence(code: string, prefix: string): number {
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`, "i");
    const match = code.match(re);
    return match ? Number(match[1]) : 0;
}

export async function allocateNextItemCode(
    category: ItemCategory,
    itemType?: string,
    codePrefixOverride?: string,
): Promise<string> {
    const prefix = codePrefixOverride?.trim() || codePrefixForCategory(category, itemType);
    const localMax = catalogState.reduce((max, item) => {
        return Math.max(max, parseCodeSequence(item.code, prefix));
    }, 0);

    if (isErpLiveMode()) {
        const { data } = await supabase
            .schema("erp")
            .from("items")
            .select("code")
            .ilike("code", `${prefix}-%`);
        const remoteMax = (data ?? []).reduce((max, row) => {
            return Math.max(max, parseCodeSequence(String(row.code ?? ""), prefix));
        }, 0);
        const next = Math.max(localMax, remoteMax) + 1;
        return `${prefix}-${String(next).padStart(3, "0")}`;
    }

    const next = localMax + 1;
    return `${prefix}-${String(next).padStart(3, "0")}`;
}

export function getSectionLabel(section: InventorySection): string {
    const labels: Record<InventorySection, string> = {
        fg_enameled: "Finished Goods — Enameled Wire",
        fg_strip: "Finished Goods — Copper Strip",
        fg_copper_wire: "Finished Goods — Copper Wire",
        rm_scrap: "Scrap",
        rm_wire8: "Wire No 8",
        rm_rod: "Copper Rod",
        packing: "Packing Material",
        varnish: "Varnish",
    };
    return labels[section];
}

export function getWarehouseLabel(warehouse: WarehouseType): string {
    const labels: Record<WarehouseType, string> = {
        finished_goods: "Finished Goods",
        raw_material: "Raw Material",
        packing_material: "Packing Material",
        varnish: "Varnish",
    };
    return labels[warehouse];
}
