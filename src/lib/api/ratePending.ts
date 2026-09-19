import { mapPendingRateRegisterRow, type RateFixLineInput } from "@/lib/ratePending";
import type { PendingRateItemRow } from "@/lib/ratePending";
import { supabase } from "@/lib/supabase";
import { ensureConfigured, ensureEnabled, formatDbError } from "@/lib/api/core";
import { runErpRpc } from "@/lib/api/mutations";
import type { Result } from "@/lib/api/types";
import { invalidateTransactionDocsAfterRateFix } from "@/lib/queryClient";

export type PendingRateAlertRow = {
    alertType: string;
    partyCode: string;
    partyName: string;
    sourceDocNo: string;
    qty: number;
    daysPending: number;
    originalPostingDate: string;
};

export type PendingRateQuery = {
    partyCode?: string;
    from?: string;
    to?: string;
    openOnly?: boolean;
};

export async function fetchPendingRateItems(
    params?: PendingRateQuery,
): Promise<Result<PendingRateItemRow[]>> {
    const configured = ensureConfigured();
    if (!configured.ok) return { ok: true, data: [] };

    const { data, error } = await supabase.schema("erp").rpc("fn_pending_rate_register", {
        p_party_code: params?.partyCode ?? null,
        p_from: params?.from ?? null,
        p_to: params?.to ?? null,
        p_open_only: params?.openOnly ?? true,
    });
    if (error) {
        return { ok: false, error: formatDbError(error, "Failed to load pending rate register.") };
    }
    return { ok: true, data: (data ?? []).map((row: Record<string, unknown>) => mapPendingRateRegisterRow(row)) };
}

/** Legacy callers expect an array; logs nothing on failure. */
export async function fetchPendingRateItemsOrEmpty(params?: PendingRateQuery): Promise<PendingRateItemRow[]> {
    const result = await fetchPendingRateItems(params);
    if (!result.ok) {
        console.warn("[ERP] fn_pending_rate_register", result.error);
        return [];
    }
    return result.data;
}

export async function fixPendingRateItems(
    items: RateFixLineInput[],
    remarks?: string,
    proofUrl?: string,
): Promise<Result<{ rateFixId: string; fixedCount: number }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const payload = items.map((i) => ({ pending_item_id: i.pendingItemId, unit_rate: i.unitRate }));
    const result = await runErpRpc(
        "fix pending rates",
        "fix_pending_rate_items",
        {
            p_items: payload,
            p_remarks: remarks ?? null,
            p_proof_url: proofUrl ?? null,
        },
        (data): Result<{ rateFixId: string; fixedCount: number }> => {
            const body = (data ?? {}) as { ok?: boolean; rate_fix_id?: string; fixed_count?: number; error?: string };
            if (body?.error) return { ok: false, error: body.error };
            return {
                ok: true,
                data: { rateFixId: String(body?.rate_fix_id ?? ""), fixedCount: Number(body?.fixed_count ?? 0) },
            };
        },
        "Failed to fix pending rates.",
    );
    if (!result.ok) return result;
    await invalidateTransactionDocsAfterRateFix();
    return result;
}

export async function fetchPendingRateAlerts(days = 3): Promise<Result<PendingRateAlertRow[]>> {
    const configured = ensureConfigured();
    if (!configured.ok) return { ok: true, data: [] };

    const { data, error } = await supabase.schema("erp").rpc("fn_pending_rate_alerts", { p_days: days });
    if (error) {
        return { ok: false, error: formatDbError(error, "Failed to load pending rate alerts.") };
    }
    return {
        ok: true,
        data: (data ?? []).map((r: Record<string, unknown>) => ({
            alertType: String(r.alert_type ?? ""),
            partyCode: String(r.party_code ?? ""),
            partyName: String(r.party_name ?? ""),
            sourceDocNo: String(r.source_doc_no ?? ""),
            qty: Number(r.qty ?? 0),
            daysPending: Number(r.days_pending ?? 0),
            originalPostingDate: String(r.original_posting_date ?? ""),
        })),
    };
}

export async function fetchPendingRateAlertsOrEmpty(days = 3): Promise<PendingRateAlertRow[]> {
    const result = await fetchPendingRateAlerts(days);
    if (!result.ok) return [];
    return result.data;
}
