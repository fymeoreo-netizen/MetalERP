import {
    ensureEnabled,
    formatDbError,
    getItemIdsByCode,
    getPartyIdByCode,
    resolvePartyId,
} from "../core";
import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { runErpRpc } from "../mutations";
import type { Result } from "../types";
import { supabase } from "@/lib/supabase";
import type { Wire8Grade } from "@/lib/productionWire8Settings";
import type { WattaMatrixRow } from "@/lib/scrapObligationTypes";

/**
 * Watta matrix admin + resolution API.
 * Split verbatim from api/scrap.ts (roadmap CSERP-RRM-2026-08-25 §4.2-E).
 * RPC lineage: resolve_watta; apply_watta_matrix_recalc (mig 185 lineage).
 */

export async function resolveWatta(params: {
    partyId?: string | null;
    partyCode?: string | null;
    itemCode?: string;
    itemId?: string;
    direction: "sales" | "purchase";
    asOf?: string;
    swgOverride?: number | null;
    wire8Grade?: Wire8Grade | null;
}): Promise<number> {
    const res = await resolveWattaDetailed(params);
    return res.ok ? res.data : 0;
}


export async function resolveWattaDetailed(params: {
    partyId?: string | null;
    partyCode?: string | null;
    itemCode?: string;
    itemId?: string;
    direction: "sales" | "purchase";
    asOf?: string;
    swgOverride?: number | null;
    wire8Grade?: Wire8Grade | null;
}): Promise<Result<number>> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: true, data: 0 };
    }
    let partyId = params.partyId ?? null;
    if (!partyId && params.partyCode) {
        partyId = await getPartyIdByCode(params.partyCode);
    }
    let itemId = params.itemId ?? null;
    if (!itemId && params.itemCode) {
        const map = await getItemIdsByCode([params.itemCode]);
        itemId = map[params.itemCode] ?? null;
    }
    if (!itemId) {
        return { ok: false, error: "Item not found for watta lookup." };
    }
    const { data, error } = await supabase.schema("erp").rpc("resolve_watta", {
        p_party_id: partyId,
        p_item_id: itemId,
        p_direction: params.direction,
        p_as_of: params.asOf ?? new Date().toISOString().slice(0, 10),
        p_swg_override: params.swgOverride ?? null,
        p_wire8_grade: params.wire8Grade ?? null,
    });
    if (error) {
        return { ok: false, error: formatDbError(error, "Failed to resolve watta.") };
    }
    return { ok: true, data: Number(data ?? 0) };
}


export type WattaRecalcBatchResult = {
    ok: boolean;
    done?: boolean;
    dry_run?: boolean;
    estimated_total?: number;
    last_invoice_id?: string | null;
    processed?: number;
    updated_drafts?: number;
    updated_posted?: number;
    skipped?: number;
    unchanged?: number;
    skipped_items?: { invoice_id?: string; reason?: string }[];
    error?: string;
};


export async function applyWattaMatrixRecalc(params: {
    direction?: "sales";
    effectiveFrom: string;
    partyId?: string | null;
    productKind?: "enamel";
    includePosted?: boolean;
    batchSize?: number;
    afterInvoiceId?: string | null;
    dryRun?: boolean;
}): Promise<Result<WattaRecalcBatchResult>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("watta recalc batch", "apply_watta_matrix_recalc", {
        p_direction: params.direction ?? "sales",
        p_effective_from: params.effectiveFrom,
        p_party_id: params.partyId ?? null,
        p_product_kind: params.productKind ?? "enamel",
        p_wire8_grade: null,
        p_include_posted: params.includePosted ?? true,
        p_batch_size: params.batchSize ?? 25,
        p_after_invoice_id: params.afterInvoiceId ?? null,
        p_dry_run: params.dryRun ?? false,
    }, (data) => {
        const row = (data ?? {}) as Record<string, unknown>;
        if (row.ok === false) {
            return { ok: false, error: String(row.error ?? "Watta recalc failed.") };
        }
        return {
            ok: true,
            data: {
                ok: true,
                done: Boolean(row.done),
                dry_run: Boolean(row.dry_run),
                estimated_total: Number(row.estimated_total ?? 0),
                last_invoice_id: (row.last_invoice_id as string) ?? null,
                processed: Number(row.processed ?? 0),
                updated_drafts: Number(row.updated_drafts ?? 0),
                updated_posted: Number(row.updated_posted ?? 0),
                skipped: Number(row.skipped ?? 0),
                unchanged: Number(row.unchanged ?? 0),
                skipped_items: (row.skipped_items as WattaRecalcBatchResult["skipped_items"]) ?? [],
            },
        };
    }, "Watta recalc batch failed.");
}


function mapWattaMatrixRow(r: Record<string, unknown>): WattaMatrixRow {
    const parties = r.parties as { code?: string; name?: string } | null | undefined;
    return {
        id: String(r.id),
        party_id: (r.party_id as string | null) ?? null,
        party_code: parties?.code ?? null,
        party_name: parties?.name ?? null,
        direction: r.direction as WattaMatrixRow["direction"],
        product_kind: r.product_kind as WattaMatrixRow["product_kind"],
        wire8_grade: (r.wire8_grade as WattaMatrixRow["wire8_grade"]) ?? null,
        swg_min: r.swg_min != null ? Number(r.swg_min) : null,
        swg_max: r.swg_max != null ? Number(r.swg_max) : null,
        base_watta: Number(r.base_watta ?? 0),
        increment_per_swg: Number(r.increment_per_swg ?? 0),
        effective_from: String(r.effective_from),
        is_active: Boolean(r.is_active),
        remarks: (r.remarks as string | null) ?? null,
    };
}

export async function fetchWattaMatrix(): Promise<WattaMatrixRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase
        .schema("erp")
        .from("watta_matrix")
        .select("*,parties(code,name)")
        .order("effective_from", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => mapWattaMatrixRow(r as Record<string, unknown>));
}


export async function upsertWattaMatrix(
    row: Partial<WattaMatrixRow> & { direction: string; product_kind: string },
): Promise<Result<{ id: string; row: WattaMatrixRow }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const partyId = await resolvePartyId(row.party_id ?? row.party_code ?? null);
    if ((row.party_id ?? row.party_code) && !partyId) {
        return { ok: false, error: "Party not found in ERP parties." };
    }

    const patch = {
        party_id: partyId,
        direction: row.direction,
        product_kind: row.product_kind,
        wire8_grade: row.wire8_grade ?? null,
        swg_min: row.swg_min ?? null,
        swg_max: row.swg_max ?? null,
        base_watta: row.base_watta ?? 0,
        increment_per_swg: row.increment_per_swg ?? 0,
        effective_from: row.effective_from ?? new Date().toISOString().slice(0, 10),
        is_active: row.is_active ?? true,
        remarks: row.remarks ?? null,
    };
    const select = "*,parties(code,name)";

    if (row.id) {
        const { data, error } = await supabase
            .schema("erp")
            .from("watta_matrix")
            .update(patch)
            .eq("id", row.id)
            .select(select)
            .single();
        if (error || !data) return { ok: false, error: formatDbError(error, "Failed to update watta row.") };
        return { ok: true, data: { id: data.id, row: mapWattaMatrixRow(data as Record<string, unknown>) } };
    }
    const { data, error } = await supabase
        .schema("erp")
        .from("watta_matrix")
        .insert(patch)
        .select(select)
        .single();
    if (error || !data) return { ok: false, error: formatDbError(error, "Failed to create watta row.") };
    return { ok: true, data: { id: data.id, row: mapWattaMatrixRow(data as Record<string, unknown>) } };
}


export async function deleteWattaMatrix(id: string): Promise<Result<true>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const { error } = await supabase.schema("erp").from("watta_matrix").delete().eq("id", id);
    if (error) return { ok: false, error: formatDbError(error, "Failed to delete watta row.") };
    return { ok: true, data: true };
}
