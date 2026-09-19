import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { supabase } from "@/lib/supabase";
import { isMissingRpc } from "./core";
import type { DailyProductionRow } from "./reports";

export type DashboardKpiResult = {
    openPurchaseOrders: number;
    pendingSalesInvoices: number;
    parchisDueToday: number;
    monthRevenue: number;
    productionByDay: { name: string; total: number }[];
    parchisDueTodayRows: Array<{
        parchi_no: string;
        due_date: string;
        open_amount: number;
        parchi_type: string;
        parties?: { name?: string; code?: string };
    }>;
    topParties: Array<{
        party_code: string;
        party_name: string;
        party_type: string;
        fin_balance_pkr: number;
        metal_balance_kg: number;
    }>;
};

function mapProductionByDay(production: DailyProductionRow[]): { name: string; total: number }[] {
    const dayMap: Record<string, number> = {};
    production.forEach((r) => {
        const key = String(r.batch_date ?? "").slice(0, 10);
        if (!key) return;
        dayMap[key] = (dayMap[key] ?? 0) + Number(r.total_output_kg ?? 0);
    });
    return Object.entries(dayMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, total]) => ({
            name: new Date(date).toLocaleDateString(undefined, { weekday: "short" }),
            total: Math.round(total),
        }));
}

/** Skip repeat 404s when fn_dashboard_kpis (migration 155) is not on the remote DB. */
let dashboardKpisRpcAvailable: boolean | null = null;

/** Single round-trip when fn_dashboard_kpis exists; falls back to parallel client fetches. */
export async function fetchDashboardKpis(): Promise<DashboardKpiResult> {
    const empty: DashboardKpiResult = {
        openPurchaseOrders: 0,
        pendingSalesInvoices: 0,
        parchisDueToday: 0,
        monthRevenue: 0,
        productionByDay: [],
        parchisDueTodayRows: [],
        topParties: [],
    };
    if (!isSupabaseConfigured() || !hasErpContext()) return empty;

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date();
    from.setDate(from.getDate() - 6);
    const fromIso = from.toISOString().slice(0, 10);

    if (dashboardKpisRpcAvailable !== false) {
        const { data: rpcData, error: rpcError } = await supabase.schema("erp").rpc("fn_dashboard_kpis", {
            p_from: fromIso,
            p_to: today,
        });

        if (!rpcError && rpcData && typeof rpcData === "object") {
            dashboardKpisRpcAvailable = true;
            const d = rpcData as Record<string, unknown>;
            return {
                openPurchaseOrders: Number(d.open_purchase_orders ?? 0),
                pendingSalesInvoices: Number(d.pending_sales_invoices ?? 0),
                parchisDueToday: Number(d.parchis_due_today ?? 0),
                monthRevenue: Number(d.month_revenue ?? 0),
                productionByDay: Array.isArray(d.production_by_day)
                    ? (d.production_by_day as { name: string; total: number }[])
                    : [],
                parchisDueTodayRows: Array.isArray(d.parchis_due_today_rows)
                    ? (d.parchis_due_today_rows as DashboardKpiResult["parchisDueTodayRows"])
                    : [],
                topParties: Array.isArray(d.top_parties)
                    ? (d.top_parties as DashboardKpiResult["topParties"])
                    : [],
            };
        }

        if (isMissingRpc(rpcError)) {
            dashboardKpisRpcAvailable = false;
        }
    }

    const [
        { fetchPurchaseOrders },
        { fetchSalesInvoicesDocs },
        { fetchParchis },
        { fetchProfitLoss },
        { fetchDailyProduction },
        { fetchPartyBalanceSnapshot },
    ] = await Promise.all([
        import("./purchaseInvoices"),
        import("./salesInvoices"),
        import("./reports"),
        import("./reports"),
        import("./reports"),
        import("./reports"),
    ]);

    const [pos, invoices, parchis, pl, production, snapshot] = await Promise.all([
        fetchPurchaseOrders(),
        fetchSalesInvoicesDocs(),
        fetchParchis(),
        fetchProfitLoss(),
        fetchDailyProduction(fromIso, today).catch(() => [] as DailyProductionRow[]),
        fetchPartyBalanceSnapshot(),
    ]);

    const parchisDueTodayRows = (parchis as DashboardKpiResult["parchisDueTodayRows"]).filter(
        (p) => p.due_date === today && Number(p.open_amount ?? 0) > 0,
    );

    const topParties = (snapshot as Array<Record<string, unknown>>)
        .map((r) => ({
            party_code: String(r.party_code ?? ""),
            party_name: String(r.party_name ?? r.party_code ?? "—"),
            party_type: String(r.party_type ?? ""),
            fin_balance_pkr: Number(r.fin_balance_pkr ?? 0),
            metal_balance_kg: Number(r.metal_balance_kg ?? 0),
        }))
        .filter((r) => Math.abs(r.fin_balance_pkr) > 0.5 || Math.abs(r.metal_balance_kg) > 0.001)
        .sort((a, b) => Math.abs(b.fin_balance_pkr) - Math.abs(a.fin_balance_pkr))
        .slice(0, 5);

    return {
        openPurchaseOrders: pos.filter((o) => o.status === "open" || o.status === "partial").length,
        pendingSalesInvoices: invoices.filter((i) => i.posting_status !== "posted").length,
        parchisDueToday: parchisDueTodayRows.length,
        monthRevenue: pl
            .filter((r: { account_type?: string }) => r.account_type === "income")
            .reduce((s: number, r: { amount?: number }) => s + Number(r.amount ?? 0), 0),
        productionByDay: mapProductionByDay(production),
        parchisDueTodayRows,
        topParties,
    };
}

export { fetchCoaAccounts, fetchPostableCoaAccounts } from "./masters";
export { fetchPartyBalanceSnapshot } from "./reports";
export { fetchMyErpAccess } from "./diagnostics";
export { fetchProductionAlerts, evaluateProductionAlerts, type ProductionAlertRow } from "./production";
