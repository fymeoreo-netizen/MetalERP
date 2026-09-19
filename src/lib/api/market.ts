import { agentDebugLog } from "@/lib/agentDebugLog";
import { getAppSession, hasErpContext, isSupabaseConfigured, persistSessionPatch } from "@/lib/appSession";
import { isErpLiveMode } from "@/lib/backendFlags";
import { filterCoaForContext, type CoaSelectContext } from "@/lib/coaSelectors";
import {
    allocateNextDocumentNo,
    parseDocumentSequence as parseDocSequence,
} from "@/lib/documentNumbers";
import { fetchTransactionHistory } from "@/lib/repositories/auditRepo";
import { getSuppliesRestockMovements, updateDemoSuppliesRestock } from "@/lib/suppliesRestockHistory";
import type { SuppliesRestockKind } from "@/lib/suppliesRestock";
import { supabase } from "@/lib/supabase";
import type { ScrapPartySummaryRow, ScrapTollDropPartyRow, ScrapTradePremiumLine } from "@/lib/scrapTradeTypes";
import type {
    PartyScrapExpectationRow,
    ScrapObligationRow,
    ScrapPayableLotRow,
    ScrapAllocationLine,
    WattaMatrixRow,
} from "@/lib/scrapObligationTypes";
import { lineRateFields } from "@/lib/ratePending";
import {
    DEFAULT_WIRE8_ITEM_CODE,
    isWire8ItemCode,
    parseWire8Grade,
    resolveWire8ItemCode,
    type Wire8Grade,
} from "@/lib/productionWire8Settings";
import {
    purchaseInvoicePayloadSchema,
    purchaseReturnPayloadSchema,
    salesReturnPayloadSchema,
    validateDocumentPayload,
    salesInvoicePayloadSchema,
    type SalesInvoicePayload,
    type InvoiceLinePayload,
} from "@/lib/domain/invoice/documentPayloads";
import {
    ensureEnabled,
    ensureConfigured,
    escapeLikePattern,
    fetchReportRpc,
    findDraftDocumentId,
    formatDbError,
    getItemIdsByCode,
    getPartyIdByCode,
    getWarehouseIdByType,
    isMissingRpc,
    isMissingSchemaColumn,
    mapDbMovementType,
    resolvePartyId,
    resolvePostingContext,
    resolveWarehousesForItemCodes,
    resolveWarehousesForItemIds,
    round3,
} from "./core";
import { parseRpcJsonResult, tryInvoiceDeleteRpc, type InvoiceDeleteFn } from "./documentRpc";
import { runErpRpc, runErpRpcVoid, runMutation, runRpcMutation, runThrowingMutation } from "./mutations";
import {
    ERP_DOC_LIST_PAGE_SIZE,
    type DocActionResult,
    type DocListPageOpts,
    type InventoryBalancesSnapshot,
    type InventorySnapshot,
    type PaginatedRows,
    type PostingDiagnosticRow,
    type PostingDiagnostics,
    type Result,
    type StockCheckFailure,
} from "./types";
import { sortObligationsFifo } from "@/lib/scrapReceivableAllocation";
import type {
    MarketBrief,
    MarketErpContext,
    MarketHistoryPoint,
    MarketQuoteRow,
    MarketSettings,
} from "@/lib/marketTypes";

const DEMO_MARKET_QUOTES: MarketQuoteRow[] = [
    {
        code: "LME_COPPER_USD_T",
        label: "LME Copper",
        unit: "USD/tonne",
        value: 8450,
        currency: "USD",
        source: "seed",
        quoted_at: new Date().toISOString(),
        change_1d_pct: 1.2,
    },
    {
        code: "USD_PKR",
        label: "USD / PKR",
        unit: "PKR",
        value: 278.5,
        currency: "PKR",
        source: "seed",
        quoted_at: new Date().toISOString(),
        change_1d_pct: -0.1,
    },
    {
        code: "IMPLIED_COPPER_PKR_KG",
        label: "Implied copper (calc)",
        unit: "PKR/kg",
        value: 2354,
        currency: "PKR",
        source: "derived",
        quoted_at: new Date().toISOString(),
        change_1d_pct: null,
    },
];

export async function fetchMarketLatestQuotes(): Promise<MarketQuoteRow[]> {
    if (!isErpLiveMode()) return DEMO_MARKET_QUOTES;
    const { data, error } = await supabase.schema("erp").rpc("fn_market_latest_quotes");
    if (error) throw new Error(formatDbError(error, "Failed to load market quotes"));
    return (data ?? []) as MarketQuoteRow[];
}


export async function fetchMarketQuoteHistory(
    symbol: string,
    days = 30
): Promise<MarketHistoryPoint[]> {
    if (!isErpLiveMode()) {
        const base = symbol === "USD_PKR" ? 278 : 8400;
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return {
                quoted_at: d.toISOString(),
                value: base + (i - 3) * (symbol === "USD_PKR" ? 0.2 : 25),
                change_1d_pct: null,
            };
        });
    }
    const { data, error } = await supabase.schema("erp").rpc("fn_market_quote_history", {
        p_symbol: symbol,
        p_days: days,
    });
    if (error) throw new Error(formatDbError(error, "Failed to load quote history"));
    return (data ?? []) as MarketHistoryPoint[];
}


export async function fetchMarketErpContext(days = 7): Promise<MarketErpContext> {
    if (!isErpLiveMode()) {
        return {
            days,
            implied_pkr_per_kg: 2354,
            premium_ref_scrap_avg: 2380,
            premium_ref_scrap_min: 2320,
            premium_ref_scrap_max: 2410,
            premium_invoice_count: 12,
            avg_scrap_lot_rate: 2365,
            spread_vs_implied: 26,
            suggested_ref_scrap_low: 2307,
            suggested_ref_scrap_high: 2401,
        };
    }
    const { data, error } = await supabase.schema("erp").rpc("fn_market_erp_context", { p_days: days });
    if (error) throw new Error(formatDbError(error, "Failed to load ERP market context"));
    return data as MarketErpContext;
}


export async function fetchMarketSettings(): Promise<MarketSettings> {
    if (!isErpLiveMode()) {
        return {
            conversion_factor: 1,
            local_premium_pkr: 0,
            ai_brief_enabled: true,
            last_sync_at: null,
            last_sync_status: "demo",
        };
    }
    const { data, error } = await supabase.schema("erp").rpc("fn_market_get_settings");
    if (error) throw new Error(formatDbError(error, "Failed to load market settings"));
    return data as MarketSettings;
}


export async function updateMarketSettings(patch: {
    conversion_factor?: number;
    local_premium_pkr?: number;
    ai_brief_enabled?: boolean;
}): Promise<MarketSettings> {
    const result = await runErpRpc<MarketSettings>("update market settings", "fn_market_update_settings", {
        p_conversion_factor: patch.conversion_factor ?? null,
        p_local_premium_pkr: patch.local_premium_pkr ?? null,
        p_ai_brief_enabled: patch.ai_brief_enabled ?? null,
    }, undefined, "Failed to update market settings");
    if (!result.ok) throw new Error(result.error);
    return result.data;
}


export async function upsertMarketManualOverride(
    symbolCode: string,
    value: number,
    effectiveFrom?: string,
    remarks?: string
): Promise<void> {
    const result = await runErpRpcVoid("save manual override", "fn_market_upsert_manual_override", {
        p_symbol_code: symbolCode,
        p_value: value,
        p_effective_from: effectiveFrom ?? null,
        p_remarks: remarks ?? null,
    }, "Failed to save manual override");
    if (!result.ok) throw new Error(result.error);
}


export async function fetchMarketLatestBrief(): Promise<MarketBrief | null> {
    if (!isErpLiveMode()) return null;
    const { data, error } = await supabase.schema("erp").rpc("fn_market_latest_brief");
    if (error) throw new Error(formatDbError(error, "Failed to load market brief"));
    return (data as MarketBrief | null) ?? null;
}


export async function invokeMarketSync(): Promise<{ ok: boolean; message?: string }> {
    if (!isErpLiveMode()) return { ok: true, message: "Demo mode — sync skipped" };
    const { data, error } = await supabase.functions.invoke("market-sync", { body: {} });
    if (error) return { ok: false, message: error.message };
    const body = data as { ok?: boolean; message?: string; error?: string } | null;
    if (body?.error) return { ok: false, message: body.error };
    return { ok: body?.ok !== false, message: body?.message };
}


export async function invokeMarketBrief(): Promise<{ ok: boolean; message?: string }> {
    if (!isErpLiveMode()) return { ok: true, message: "Demo mode — brief skipped" };
    const { data, error } = await supabase.functions.invoke("market-brief", { body: {} });
    if (error) return { ok: false, message: error.message };
    const body = data as { ok?: boolean; message?: string; error?: string } | null;
    if (body?.error) return { ok: false, message: body.error };
    return { ok: body?.ok !== false, message: body?.message };
}

