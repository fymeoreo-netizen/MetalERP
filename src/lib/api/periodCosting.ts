import { supabase } from "@/lib/supabase";
import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { ensureEnabled, fetchReportRpc, formatDbError, isMissingRpc } from "@/lib/api/core";
import type { Result } from "@/lib/api/types";

export type AccountingPeriodStatus = "open" | "draft" | "locked";

export type AccountingPeriodRow = {
    id: string;
    period_code: string | null;
    start_date: string;
    end_date: string;
    status: AccountingPeriodStatus;
    actual_overhead_rate: number | null;
    actual_overhead_amount: number | null;
    proxy_overhead_rate_used: number | null;
    proxy_source_period_id: string | null;
    locked_at: string | null;
    last_run_at: string | null;
    last_run_mode: "draft" | "final" | null;
};

export type PeriodCostRateClass =
    | "rm_copper"
    | "rm_rod"
    | "rm_varnish"
    | "rm_packing"
    | "fg_enamel";

export type PeriodCostRateRow = {
    id: string;
    period_id: string;
    item_id: string;
    item_code: string | null;
    rate_class: PeriodCostRateClass;
    opening_qty: number;
    opening_value: number;
    purchase_qty: number;
    purchase_value: number;
    pac_unit_cost: number;
    rm_copper_per_kg: number | null;
    rm_varnish_per_kg: number | null;
    rm_packing_per_kg: number | null;
    oh_per_kg: number | null;
    production_qty: number | null;
    is_draft: boolean;
    computed_at: string;
};

export type PeriodCostingRunRow = {
    id: string;
    period_id: string;
    mode: "draft" | "final";
    started_at: string;
    finished_at: string | null;
    ok: boolean;
    overhead_rate_used: number | null;
    error_text: string | null;
    stats: Record<string, unknown> | null;
};

export type PeriodCostingPreview = {
    fg_output_kg: number;
    overhead_rate_used: number;
    overhead_amount?: number | null;
    overhead_amount_source?: string | null;
    proxy_source_period: string | null;
};

export type RunPeriodicCostingInput = {
    startDate: string;
    endDate: string;
    isDraft: boolean;
    actualOverheadRate?: number | null;
    actualOverheadAmount?: number | null;
    periodCode?: string | null;
};

export type RunPeriodicCostingResult = {
    ok: boolean;
    period_id: string;
    mode: "draft" | "final";
    overhead_rate_used: number;
    stats: {
        rm_rates?: Array<Record<string, unknown>>;
        production?: Record<string, unknown>;
        cogs?: Record<string, unknown>;
        warnings?: Array<Record<string, unknown>>;
    };
};

function mapPeriod(raw: Record<string, unknown>): AccountingPeriodRow {
    return {
        id: String(raw.id),
        period_code: raw.period_code != null ? String(raw.period_code) : null,
        start_date: String(raw.start_date).slice(0, 10),
        end_date: String(raw.end_date).slice(0, 10),
        status: (raw.status as AccountingPeriodStatus) ?? "open",
        actual_overhead_rate: raw.actual_overhead_rate != null ? Number(raw.actual_overhead_rate) : null,
        actual_overhead_amount: raw.actual_overhead_amount != null ? Number(raw.actual_overhead_amount) : null,
        proxy_overhead_rate_used:
            raw.proxy_overhead_rate_used != null ? Number(raw.proxy_overhead_rate_used) : null,
        proxy_source_period_id:
            raw.proxy_source_period_id != null ? String(raw.proxy_source_period_id) : null,
        locked_at: raw.locked_at != null ? String(raw.locked_at) : null,
        last_run_at: raw.last_run_at != null ? String(raw.last_run_at) : null,
        last_run_mode: (raw.last_run_mode as AccountingPeriodRow["last_run_mode"]) ?? null,
    };
}

function mapRate(raw: Record<string, unknown>): PeriodCostRateRow {
    return {
        id: String(raw.id),
        period_id: String(raw.period_id),
        item_id: String(raw.item_id),
        item_code: raw.item_code != null ? String(raw.item_code) : null,
        rate_class: (raw.rate_class as PeriodCostRateClass) ?? "rm_copper",
        opening_qty: Number(raw.opening_qty ?? 0),
        opening_value: Number(raw.opening_value ?? 0),
        purchase_qty: Number(raw.purchase_qty ?? 0),
        purchase_value: Number(raw.purchase_value ?? 0),
        pac_unit_cost: Number(raw.pac_unit_cost ?? 0),
        rm_copper_per_kg: raw.rm_copper_per_kg != null ? Number(raw.rm_copper_per_kg) : null,
        rm_varnish_per_kg: raw.rm_varnish_per_kg != null ? Number(raw.rm_varnish_per_kg) : null,
        rm_packing_per_kg: raw.rm_packing_per_kg != null ? Number(raw.rm_packing_per_kg) : null,
        oh_per_kg: raw.oh_per_kg != null ? Number(raw.oh_per_kg) : null,
        production_qty: raw.production_qty != null ? Number(raw.production_qty) : null,
        is_draft: Boolean(raw.is_draft),
        computed_at: String(raw.computed_at ?? ""),
    };
}

function mapRun(raw: Record<string, unknown>): PeriodCostingRunRow {
    return {
        id: String(raw.id),
        period_id: String(raw.period_id),
        mode: (raw.mode as "draft" | "final") ?? "draft",
        started_at: String(raw.started_at ?? ""),
        finished_at: raw.finished_at != null ? String(raw.finished_at) : null,
        ok: Boolean(raw.ok),
        overhead_rate_used:
            raw.overhead_rate_used != null ? Number(raw.overhead_rate_used) : null,
        error_text: raw.error_text != null ? String(raw.error_text) : null,
        stats: (raw.stats as Record<string, unknown> | null) ?? null,
    };
}

export async function listAccountingPeriods(): Promise<AccountingPeriodRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    try {
        const rows = await fetchReportRpc(
            "accounting periods",
            () => supabase.schema("erp").rpc("list_costing_periods"),
            [] as Record<string, unknown>[],
        );
        return rows.map((r: Record<string, unknown>) => mapPeriod(r));
    } catch (err) {
        if (isMissingRpc(err)) return [];
        throw err;
    }
}

export async function listPeriodCostRates(periodId: string): Promise<PeriodCostRateRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase
        .schema("erp")
        .from("period_cost_rates")
        .select("*, items:items(code)")
        .eq("period_id", periodId)
        .order("rate_class", { ascending: true })
        .order("pac_unit_cost", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
        const obj = r as Record<string, unknown>;
        const items = obj.items as { code: string } | null;
        return mapRate({ ...obj, item_code: items?.code ?? null });
    });
}

export async function listPeriodCostingRuns(periodId: string): Promise<PeriodCostingRunRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase
        .schema("erp")
        .from("period_costing_runs")
        .select("*")
        .eq("period_id", periodId)
        .order("started_at", { ascending: false })
        .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => mapRun(r as Record<string, unknown>));
}

export async function getPeriodCostingPreview(
    startDate: string,
    endDate: string,
    isDraft: boolean,
    actualOverheadRate?: number | null,
    actualOverheadAmount?: number | null,
): Promise<Result<PeriodCostingPreview>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    try {
        const { data, error } = await supabase.schema("erp").rpc("get_period_costing_preview", {
            p_start_date: startDate,
            p_end_date: endDate,
            p_is_draft: isDraft,
            p_actual_overhead_rate: actualOverheadRate ?? null,
            p_actual_overhead_amount: actualOverheadAmount ?? null,
        });
        if (error) return { ok: false, error: formatDbError(error, "Failed to load preview.") };
        const obj = (data ?? {}) as Record<string, unknown>;
        return {
            ok: true,
            data: {
                fg_output_kg: Number(obj.fg_output_kg ?? 0),
                overhead_rate_used: Number(obj.overhead_rate_used ?? 0),
                overhead_amount: obj.overhead_amount != null ? Number(obj.overhead_amount) : null,
                overhead_amount_source:
                    obj.overhead_amount_source != null ? String(obj.overhead_amount_source) : null,
                proxy_source_period:
                    obj.proxy_source_period != null ? String(obj.proxy_source_period) : null,
            },
        };
    } catch (err) {
        if (isMissingRpc(err)) {
            return {
                ok: false,
                error: "PAC engine not deployed yet. Apply migrations 256–258 first.",
            };
        }
        return { ok: false, error: err instanceof Error ? err.message : "Preview failed." };
    }
}

export async function runPeriodicCosting(
    input: RunPeriodicCostingInput,
): Promise<Result<RunPeriodicCostingResult>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    try {
        const { data, error } = await supabase.schema("erp").rpc("run_periodic_costing", {
            p_start_date: input.startDate,
            p_end_date: input.endDate,
            p_is_draft: input.isDraft,
            p_actual_overhead_rate: input.actualOverheadRate ?? null,
            p_actual_overhead_amount: input.actualOverheadAmount ?? null,
            p_period_code: input.periodCode ?? null,
        });
        if (error) return { ok: false, error: formatDbError(error, "PAC run failed.") };
        const obj = (data ?? {}) as Record<string, unknown>;
        const stats = (obj.stats as RunPeriodicCostingResult["stats"]) ?? {};
        return {
            ok: true,
            data: {
                ok: Boolean(obj.ok),
                period_id: String(obj.period_id ?? ""),
                mode: (obj.mode as "draft" | "final") ?? (input.isDraft ? "draft" : "final"),
                overhead_rate_used: Number(obj.overhead_rate_used ?? 0),
                stats,
            },
        };
    } catch (err) {
        if (isMissingRpc(err)) {
            return {
                ok: false,
                error: "PAC engine not deployed yet. Apply migrations 256–258 first.",
            };
        }
        return { ok: false, error: err instanceof Error ? err.message : "PAC run failed." };
    }
}

export async function reopenAccountingPeriod(periodId: string): Promise<Result<void>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const { error } = await supabase.schema("erp").rpc("reopen_accounting_period", {
        p_period_id: periodId,
    });
    if (error) return { ok: false, error: formatDbError(error, "Failed to reopen period.") };
    return { ok: true, data: undefined };
}

export async function fetchPacFeatureFlag(): Promise<boolean> {
    if (!isSupabaseConfigured() || !hasErpContext()) return false;
    try {
        const { data, error } = await supabase.schema("erp").rpc("pac_costing_enabled");
        if (error) return false;
        return Boolean(data);
    } catch {
        return false;
    }
}
