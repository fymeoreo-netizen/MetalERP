import { supabase } from "@/lib/supabase";
import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { ensureEnabled, fetchReportRpc } from "@/lib/api/core";
import type { Result } from "@/lib/api/types";

export type InventoryValuationProductKind = "enamel" | "wire8" | "rod" | "scrap" | "copper_wire" | "strip";
export type Wire8Grade = "Fail" | "Pass" | "Special";
export type ScrapKind = "drawing" | "enamel" | "workshop" | "feed";

export type InventoryValuationRateRow = {
    id: string;
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

export type StockValuationRow = {
    item_code: string;
    item_name: string;
    warehouse_code: string;
    inventory_section: string;
    on_hand_qty: number;
    on_hand_units: number;
    pending_qty: number;
    book_unit_cost: number;
    book_value: number;
    valuation_unit_rate: number | null;
    valuation_value: number;
};

const DEMO_STORAGE_KEY = "coppersync_inventory_valuation_rates_v1";

function mapRow(raw: Record<string, unknown>): InventoryValuationRateRow {
    return {
        id: String(raw.id),
        product_kind: raw.product_kind as InventoryValuationProductKind,
        swg_min: raw.swg_min != null ? Number(raw.swg_min) : null,
        swg_max: raw.swg_max != null ? Number(raw.swg_max) : null,
        wire8_grade: (raw.wire8_grade as Wire8Grade | null) ?? null,
        scrap_kind: (raw.scrap_kind as ScrapKind | null) ?? null,
        spec_key: raw.spec_key != null ? String(raw.spec_key) : null,
        unit_rate: Number(raw.unit_rate ?? 0),
        effective_from: String(raw.effective_from).slice(0, 10),
        is_active: Boolean(raw.is_active),
        remarks: raw.remarks != null ? String(raw.remarks) : null,
    };
}

export function getDemoInventoryValuationRates(): InventoryValuationRateRow[] {
    try {
        const raw = localStorage.getItem(DEMO_STORAGE_KEY);
        if (raw) return JSON.parse(raw) as InventoryValuationRateRow[];
    } catch {
        /* ignore */
    }
    return [];
}

export function saveDemoInventoryValuationRates(rows: InventoryValuationRateRow[]): void {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(rows));
}

export async function fetchInventoryValuationRates(): Promise<InventoryValuationRateRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return getDemoInventoryValuationRates();
    const { data, error } = await supabase
        .schema("erp")
        .from("inventory_valuation_rates")
        .select("*")
        .order("effective_from", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function upsertInventoryValuationRate(
    row: Partial<InventoryValuationRateRow> & { product_kind: InventoryValuationProductKind },
): Promise<Result<{ id: string; row: InventoryValuationRateRow }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const patch = {
        product_kind: row.product_kind,
        swg_min: row.swg_min ?? null,
        swg_max: row.swg_max ?? null,
        wire8_grade: row.wire8_grade ?? null,
        scrap_kind: row.scrap_kind ?? null,
        spec_key: row.spec_key ?? null,
        unit_rate: row.unit_rate ?? 0,
        effective_from: row.effective_from ?? new Date().toISOString().slice(0, 10),
        is_active: row.is_active ?? true,
        remarks: row.remarks ?? null,
    };

    if (!isSupabaseConfigured() || !hasErpContext()) {
        const existing = getDemoInventoryValuationRates();
        const id = row.id ?? `demo-${Date.now()}`;
        const mapped = mapRow({ ...patch, id });
        const next = row.id
            ? existing.map((r) => (r.id === row.id ? mapped : r))
            : [...existing, mapped];
        saveDemoInventoryValuationRates(next);
        return { ok: true, data: { id, row: mapped } };
    }

    if (row.id) {
        const { data, error } = await supabase
            .schema("erp")
            .from("inventory_valuation_rates")
            .update(patch)
            .eq("id", row.id)
            .select("*")
            .single();
        if (error) return { ok: false, error: error.message };
        const mapped = mapRow(data as Record<string, unknown>);
        return { ok: true, data: { id: mapped.id, row: mapped } };
    }

    const { data, error } = await supabase
        .schema("erp")
        .from("inventory_valuation_rates")
        .insert(patch)
        .select("*")
        .single();
    if (error) return { ok: false, error: error.message };
    const mapped = mapRow(data as Record<string, unknown>);
    return { ok: true, data: { id: mapped.id, row: mapped } };
}

export async function deleteInventoryValuationRate(id: string): Promise<Result<void>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    if (!isSupabaseConfigured() || !hasErpContext()) {
        saveDemoInventoryValuationRates(getDemoInventoryValuationRates().filter((r) => r.id !== id));
        return { ok: true, data: undefined };
    }

    const { error } = await supabase.schema("erp").from("inventory_valuation_rates").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: undefined };
}

function mapStockValuationRow(raw: Record<string, unknown>): StockValuationRow {
    const bookUnit = raw.book_unit_cost ?? raw.avg_unit_cost;
    const bookVal = raw.book_value ?? raw.stock_value;
    const valRate = raw.valuation_unit_rate;
    const onHand = Number(raw.on_hand_qty ?? 0);
    const valUnit = valRate != null ? Number(valRate) : null;
    return {
        item_code: String(raw.item_code ?? ""),
        item_name: String(raw.item_name ?? ""),
        warehouse_code: String(raw.warehouse_code ?? ""),
        inventory_section: String(raw.inventory_section ?? ""),
        on_hand_qty: onHand,
        on_hand_units: Number(raw.on_hand_units ?? 0),
        pending_qty: Number(raw.pending_qty ?? 0),
        book_unit_cost: Number(bookUnit ?? 0),
        book_value: Number(bookVal ?? 0),
        valuation_unit_rate: valUnit,
        valuation_value: Number(raw.valuation_value ?? onHand * (valUnit ?? 0)),
    };
}

export async function fetchStockValuationReport(asOf?: string): Promise<StockValuationRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const rows = await fetchReportRpc(
        "stock valuation",
        () =>
            supabase.schema("erp").rpc("fn_stock_valuation", {
                p_as_of: asOf ?? new Date().toISOString().slice(0, 10),
            }),
        [] as Record<string, unknown>[],
    );
    return rows.map((r: Record<string, unknown>) => mapStockValuationRow(r));
}
