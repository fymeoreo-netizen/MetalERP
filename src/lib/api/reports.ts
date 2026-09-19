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
import { runMutation, runRpcMutation, runThrowingMutation } from "./mutations";
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

export async function fetchTrialBalance(from?: string, to?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string> = {};
    if (from) params.p_from = from;
    if (to) params.p_to = to;
    const data = await fetchReportRpc(
        "trial balance",
        () => supabase.schema("erp").rpc("fn_trial_balance", params),
        [] as any[],
    );
    const { enrichTrialBalanceRows } = await import("@/lib/reportCoaEnrichment");
    return enrichTrialBalanceRows(data);
}


export async function fetchProfitLoss(from?: string, to?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string> = {};
    if (from) params.p_from = from;
    if (to) params.p_to = to;
    const data = await fetchReportRpc(
        "profit & loss",
        () => supabase.schema("erp").rpc("fn_profit_loss", params),
        [] as any[],
    );
    const { enrichProfitLossRows } = await import("@/lib/reportCoaEnrichment");
    return enrichProfitLossRows(data);
}

export type ProfitLossRevenueCategoryRow = {
    category_code: string;
    category_name: string;
    amount: number;
    kg: number;
    sort_order: number;
};

export type ProfitLossSalesCogsCategoryRow = ProfitLossRevenueCategoryRow;

function mapProfitLossCategoryRows(data: any[] | null | undefined): ProfitLossRevenueCategoryRow[] {
    return (data ?? []).map((r: Record<string, unknown>) => ({
        category_code: String(r.category_code ?? ""),
        category_name: String(r.category_name ?? r.category_code ?? ""),
        amount: Number(r.amount ?? 0),
        kg: Number(r.kg ?? 0),
        sort_order: Number(r.sort_order ?? 99),
    }));
}

/** Document-level operating revenue split (enameled / copper wire / strip / scrap…). */
export async function fetchProfitLossRevenueByCategory(
    from?: string,
    to?: string,
): Promise<ProfitLossRevenueCategoryRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string> = {};
    if (from) params.p_from = from;
    if (to) params.p_to = to;
    const data = await fetchReportRpc(
        "profit & loss revenue by category",
        () => supabase.schema("erp").rpc("fn_profit_loss_revenue_by_category", params),
        [] as any[],
    );
    return mapProfitLossCategoryRows(data);
}

/** Sales COGS (direct RM) split by product category. */
export async function fetchProfitLossSalesCogsByCategory(
    from?: string,
    to?: string,
): Promise<ProfitLossSalesCogsCategoryRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string> = {};
    if (from) params.p_from = from;
    if (to) params.p_to = to;
    const data = await fetchReportRpc(
        "profit & loss sales COGS by category",
        () => supabase.schema("erp").rpc("fn_profit_loss_sales_cogs_by_category", params),
        [] as any[],
    );
    return mapProfitLossCategoryRows(data);
}


export async function fetchBalanceSheet(asOf?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string> = {};
    if (asOf) params.p_as_of = asOf;
    const data = await fetchReportRpc(
        "balance sheet",
        () => supabase.schema("erp").rpc("fn_balance_sheet", params),
        [] as any[],
    );
    const { enrichBalanceSheetRows } = await import("@/lib/reportCoaEnrichment");
    return enrichBalanceSheetRows(data);
}


/** Default server-side page size for ledger RPCs (migration 225). */
export const LEDGER_RPC_DEFAULT_LIMIT = 500;

export type LedgerFetchOpts = {
    limit?: number | null;
    offset?: number;
};

async function callPartyLedgerRpc(params: Record<string, string | number | null>): Promise<any[]> {
    const { data, error } = await supabase.schema("erp").rpc("fn_party_ledger", params);
    if (error) throw error;
    return data ?? [];
}

export async function fetchPartyLedger(
    partyCode?: string,
    from?: string,
    to?: string,
    opts?: LedgerFetchOpts,
): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string | number | null> = {};
    if (partyCode !== undefined) params.p_party_code = partyCode || null;
    if (from) params.p_from = from;
    if (to) params.p_to = to;
    const limit = opts?.limit !== undefined ? opts.limit : LEDGER_RPC_DEFAULT_LIMIT;
    const offset = opts?.offset ?? 0;
    if (limit != null) params.p_limit = limit;
    params.p_offset = offset;
    try {
        return await callPartyLedgerRpc(params);
    } catch (error: unknown) {
        if (isMissingRpc(error as { message?: string })) {
            const legacyParams: Record<string, string | null> = {};
            if (partyCode !== undefined) legacyParams.p_party_code = partyCode || null;
            if (from) legacyParams.p_from = from;
            if (to) legacyParams.p_to = to;
            const rows = await callPartyLedgerRpc(legacyParams);
            const cap = limit ?? LEDGER_RPC_DEFAULT_LIMIT;
            return rows.length > cap ? rows.slice(0, cap) : rows;
        }
        const message = error instanceof Error ? error.message : "Failed to load party ledger";
        console.error("[erp] fn_party_ledger failed", message, params);
        throw new Error(message);
    }
}


export async function fetchArAging(asOf?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string> = {};
    if (asOf) params.p_as_of = asOf;
    return fetchReportRpc(
        "AR aging",
        () => supabase.schema("erp").rpc("fn_ar_aging", params),
        [] as any[],
    );
}


export async function fetchApAging(asOf?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string> = {};
    if (asOf) params.p_as_of = asOf;
    return fetchReportRpc(
        "AP aging",
        () => supabase.schema("erp").rpc("fn_ap_aging", params),
        [] as any[],
    );
}


async function callAccountLedgerRpc(params: Record<string, string | number | null>): Promise<any[]> {
    const { data, error } = await supabase.schema("erp").rpc("fn_account_ledger", params);
    if (error) throw error;
    return data ?? [];
}

export async function fetchAccountLedger(
    accountCode?: string,
    from?: string,
    to?: string,
    opts?: LedgerFetchOpts,
): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const limit = opts?.limit !== undefined ? opts.limit : LEDGER_RPC_DEFAULT_LIMIT;
    const offset = opts?.offset ?? 0;
    const params: Record<string, string | number | null> = {
        p_account_code: accountCode ?? null,
        p_from: from ?? null,
        p_to: to ?? null,
        p_offset: offset,
    };
    if (limit != null) params.p_limit = limit;
    try {
        return await callAccountLedgerRpc(params);
    } catch (error: unknown) {
        if (isMissingRpc(error as { message?: string })) {
            const rows = await callAccountLedgerRpc({
                p_account_code: accountCode ?? null,
                p_from: from ?? null,
                p_to: to ?? null,
            });
            const cap = limit ?? LEDGER_RPC_DEFAULT_LIMIT;
            return rows.length > cap ? rows.slice(0, cap) : rows;
        }
        const message = error instanceof Error ? error.message : "Failed to load account ledger";
        console.error("[erp] fn_account_ledger failed", message, { accountCode, from, to });
        throw new Error(message);
    }
}


export async function fetchReconciliationChecks(): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data } = await supabase.schema("erp").rpc("fn_reconciliation_checks");
    return data ?? [];
}


export { fetchStockValuationReport as fetchStockValuation } from "./inventoryValuation";


export async function fetchPartyStockMovement(from?: string, to?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    return fetchReportRpc(
        "party stock movement",
        () =>
            supabase.schema("erp").rpc("fn_party_stock_movement", {
                p_from: from ?? null,
                p_to: to ?? null,
            }),
        [] as any[],
    );
}


export type DailyProductionRow = {
    batch_date: string;
    process_type: string;
    batch_no: string;
    total_input_kg: number;
    total_output_kg: number;
    total_scrap_kg: number;
};


export type DailyProductionDetailRow = {
    batch_date: string;
    batch_no: string;
    process_type: string;
    line_no?: number;
    machine_code?: string | null;
    machine_name?: string | null;
    item_code: string;
    item_name: string;
    item_category?: string;
    unit_count: number;
    gross_weight: number;
    tare_weight: number;
    net_weight: number;
    line_input_kg: number;
    batch_input_kg?: number;
};


export async function fetchDailyProductionDetail(
    from?: string,
    to?: string,
    processType?: "enamel" | "drawing" | "workshop",
): Promise<DailyProductionDetailRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_daily_production_detail", {
        p_from: from ?? null,
        p_to: to ?? null,
        p_process_type: processType ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchDailyProductionDetail", error);
        throw new Error(error.message || "Failed to load daily production detail.");
    }
    return (data ?? []) as DailyProductionDetailRow[];
}


export async function fetchDailyProduction(from?: string, to?: string): Promise<DailyProductionRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_daily_production", {
        p_from: from ?? null,
        p_to: to ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchDailyProduction", error);
        throw new Error(error.message || "Failed to load daily production report.");
    }
    return (data ?? []) as DailyProductionRow[];
}


export async function fetchPartyMetalLedger(
    partyCode?: string,
    from?: string,
    to?: string,
): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string | null> = { p_party_code: partyCode ?? null };
    if (from) params.p_from = from;
    if (to) params.p_to = to;
    const { data } = await supabase.schema("erp").rpc("fn_party_metal_ledger", params);
    return data ?? [];
}


export async function fetchPartyBalanceSnapshot(asOf?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    return fetchReportRpc(
        "party balance snapshot",
        () => supabase.schema("erp").rpc("fn_party_balance_snapshot", asOf ? { p_as_of: asOf } : {}),
        [] as any[],
    );
}


export async function fetchParchis(options?: { includeVoid?: boolean; partyCode?: string }): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    let query = supabase
        .schema("erp")
        .from("parchi_instruments")
        .select("id,parchi_no,parchi_type,direction,issue_date,due_date,total_amount,cleared_amount,open_amount,status,bank_name,cheque_no,guarantor,narration,parties!inner(code,name)")
        .order("issue_date", { ascending: false })
        .limit(200);
    if (!options?.includeVoid) {
        query = query.neq("status", "void");
    }
    if (options?.partyCode?.trim()) {
        query = query.eq("parties.code", options.partyCode.trim());
    }
    const { data } = await query;
    return data ?? [];
}

/** Reverse legacy PARCHI_ISSUE GL for voided instruments (run once after migration 112). */

export async function fetchParchiClearancesForPayment(
    paymentId: string,
): Promise<Array<{ parchiId: string; parchiNo: string; amount: number }>> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data } = await supabase
        .schema("erp")
        .from("parchi_clearances")
        .select("amount, parchi_id, parchi_instruments(parchi_no)")
        .eq("payment_id", paymentId);
    return (data ?? []).map((row) => {
        const instrument = row.parchi_instruments as { parchi_no?: string } | null;
        return {
            parchiId: String(row.parchi_id),
            parchiNo: String(instrument?.parchi_no ?? ""),
            amount: Number(row.amount ?? 0),
        };
    });
}


export async function fetchParchiClearanceForPayment(
    paymentId: string,
): Promise<{ parchiId: string; parchiNo: string } | null> {
    const rows = await fetchParchiClearancesForPayment(paymentId);
    if (!rows.length) return null;
    return { parchiId: rows[0].parchiId, parchiNo: rows[0].parchiNo };
}


export type UnitEconomicsExpenseLine = {
    code: string;
    name: string;
    bucket: string;
    amount: number;
};


export type UnitEconomicsReport = {
    period: { from: string; to: string };
    pacStatus?: { status: string; periodCode: string | null };
    volumes: {
        productionKg: number;
        soldKg: number;
        scrapKg: number;
        purchasedRmKg: number;
        varnishConsumedKg: number;
        varnishDrumsConsumed: number;
        varnishDrumWeightKg: number;
        yieldPct: number | null;
        warnings: string[];
    };
    totals: {
        directRm: number;
        directConversion: number;
        factoryOverhead: number;
        wastage?: number;
        unabsorbed?: number;
        varnishCost: number;
        selling: number;
        admin: number;
        totalCogs: number;
        revenue: number;
        otherIncome: number;
        revenueTotal: number;
        totalExpense: number;
        grossProfit: number;
    };
    expenseLines: UnitEconomicsExpenseLine[];
    layers: {
        l1Conversion: {
            directConversionPerKg: number | null;
            factoryOverheadPerKg: number | null;
            varnishPerKgProduced: number | null;
            conversionBurdenPerKgProduced: number | null;
            adminPerKgSold: number | null;
            sellingPerKgSold: number | null;
            commercialBurdenPerKgSold: number | null;
            breakEvenWattaPkrPerKg: number | null;
        };
        l2Landed: {
            rmPerKgSold: number | null;
            varnishPerKgSold: number | null;
            rmBurdenPerKgSold: number | null;
            conversionPerKgProduced: number | null;
            commercialPerKgSold: number | null;
            totalLandedPerKgSold: number | null;
            note?: string | null;
        };
        l2SalesCogs?: {
            salesCogsPerKgSold: number | null;
            commercialPerKgSold: number | null;
            totalSalesLandedPerKgSold: number | null;
            note?: string | null;
        };
        l2CashPeriod?: {
            salesCogsPerKgSold: number | null;
            periodConversionPerKgProduced: number | null;
            commercialPerKgSold: number | null;
            totalCashLandedPerKg: number | null;
            note?: string | null;
        };
        l3Margin: {
            revenuePerKg: number | null;
            grossMarginPerKg: number | null;
            netMarginPerKg: number | null;
        };
    };
};

function numOrNull(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function mapUnitEconomicsPayload(raw: Record<string, unknown>): UnitEconomicsReport {
    const period = (raw.period ?? {}) as Record<string, unknown>;
    const pacRaw = (raw.pac_status ?? {}) as Record<string, unknown>;
    const volumes = (raw.volumes ?? {}) as Record<string, unknown>;
    const totals = (raw.totals ?? {}) as Record<string, unknown>;
    const layers = (raw.layers ?? {}) as Record<string, unknown>;
    const l1 = (layers.l1_conversion ?? {}) as Record<string, unknown>;
    const l2 = (layers.l2_landed ?? {}) as Record<string, unknown>;
    const l2Sales = (layers.l2_sales_cogs ?? {}) as Record<string, unknown>;
    const l2Cash = (layers.l2_cash_period ?? {}) as Record<string, unknown>;
    const l3 = (layers.l3_margin ?? {}) as Record<string, unknown>;
    const linesRaw = Array.isArray(raw.expense_lines) ? raw.expense_lines : [];

    return {
        period: {
            from: String(period.from ?? ""),
            to: String(period.to ?? ""),
        },
        pacStatus: {
            status: String(pacRaw.status ?? "none"),
            periodCode: pacRaw.period_code != null ? String(pacRaw.period_code) : null,
        },
        volumes: {
            productionKg: Number(volumes.production_kg ?? 0),
            soldKg: Number(volumes.sold_kg ?? 0),
            scrapKg: Number(volumes.scrap_kg ?? 0),
            purchasedRmKg: Number(volumes.purchased_rm_kg ?? 0),
            varnishConsumedKg: Number(volumes.varnish_consumed_kg ?? 0),
            varnishDrumsConsumed: Number(volumes.varnish_drums_consumed ?? 0),
            varnishDrumWeightKg: Number(volumes.varnish_drum_weight_kg ?? 200),
            yieldPct: numOrNull(volumes.yield_pct),
            warnings: Array.isArray(volumes.warnings)
                ? volumes.warnings.map((w) => String(w))
                : [],
        },
        totals: {
            directRm: Number(totals.direct_rm ?? 0),
            directConversion: Number(totals.direct_conversion ?? 0),
            factoryOverhead: Number(totals.factory_overhead ?? 0),
            wastage: Number(totals.wastage ?? 0),
            unabsorbed: Number(totals.unabsorbed ?? 0),
            varnishCost: Number(totals.varnish_cost ?? 0),
            selling: Number(totals.selling ?? 0),
            admin: Number(totals.admin ?? 0),
            totalCogs: Number(totals.total_cogs ?? 0),
            revenue: Number(totals.revenue ?? 0),
            otherIncome: Number(totals.other_income ?? 0),
            revenueTotal: Number(totals.revenue_total ?? 0),
            totalExpense: Number(totals.total_expense ?? 0),
            grossProfit: Number(totals.gross_profit ?? 0),
        },
        // Collapse duplicate (code, bucket) rows from the RPC so React keys stay unique
        // and the expense table doesn't list the same account twice.
        expenseLines: (() => {
            const byKey = new Map<string, UnitEconomicsExpenseLine>();
            for (const row of linesRaw) {
                const r = row as Record<string, unknown>;
                const code = String(r.code ?? "");
                const bucket = String(r.bucket ?? "");
                const key = `${bucket}::${code}`;
                const amount = Number(r.amount ?? 0);
                const existing = byKey.get(key);
                if (existing) {
                    existing.amount += amount;
                } else {
                    byKey.set(key, {
                        code,
                        name: String(r.name ?? r.code ?? ""),
                        bucket,
                        amount,
                    });
                }
            }
            return Array.from(byKey.values());
        })(),
        layers: {
            l1Conversion: {
                directConversionPerKg: numOrNull(l1.direct_conversion_per_kg),
                factoryOverheadPerKg: numOrNull(l1.factory_overhead_per_kg),
                varnishPerKgProduced: numOrNull(l1.varnish_per_kg_produced),
                conversionBurdenPerKgProduced: numOrNull(l1.conversion_burden_per_kg_produced),
                adminPerKgSold: numOrNull(l1.admin_per_kg_sold),
                sellingPerKgSold: numOrNull(l1.selling_per_kg_sold),
                commercialBurdenPerKgSold: numOrNull(l1.commercial_burden_per_kg_sold),
                breakEvenWattaPkrPerKg: numOrNull(l1.break_even_watta_pkr_per_kg),
            },
            l2Landed: {
                rmPerKgSold: numOrNull(l2.rm_per_kg_sold),
                varnishPerKgSold: numOrNull(l2.varnish_per_kg_sold),
                rmBurdenPerKgSold: numOrNull(l2.rm_burden_per_kg_sold),
                conversionPerKgProduced: numOrNull(l2.conversion_per_kg_produced),
                commercialPerKgSold: numOrNull(l2.commercial_per_kg_sold),
                totalLandedPerKgSold: numOrNull(l2.total_landed_per_kg_sold),
                note: l2.note != null ? String(l2.note) : null,
            },
            l2SalesCogs: {
                salesCogsPerKgSold: numOrNull(l2Sales.sales_cogs_per_kg_sold ?? l2.rm_per_kg_sold),
                commercialPerKgSold: numOrNull(l2Sales.commercial_per_kg_sold ?? l2.commercial_per_kg_sold),
                totalSalesLandedPerKgSold: numOrNull(
                    l2Sales.total_sales_landed_per_kg_sold ?? l2.total_landed_per_kg_sold,
                ),
                note: l2Sales.note != null ? String(l2Sales.note) : null,
            },
            l2CashPeriod: {
                salesCogsPerKgSold: numOrNull(l2Cash.sales_cogs_per_kg_sold ?? l2.rm_per_kg_sold),
                periodConversionPerKgProduced: numOrNull(
                    l2Cash.period_conversion_per_kg_produced ?? l2.conversion_per_kg_produced,
                ),
                commercialPerKgSold: numOrNull(l2Cash.commercial_per_kg_sold ?? l2.commercial_per_kg_sold),
                totalCashLandedPerKg: numOrNull(l2Cash.total_cash_landed_per_kg),
                note: l2Cash.note != null ? String(l2Cash.note) : null,
            },
            l3Margin: {
                revenuePerKg: numOrNull(l3.revenue_per_kg),
                grossMarginPerKg: numOrNull(l3.gross_margin_per_kg),
                netMarginPerKg: numOrNull(l3.net_margin_per_kg),
            },
        },
    };
}

const EMPTY_UNIT_ECONOMICS: UnitEconomicsReport = {
    period: { from: "", to: "" },
    pacStatus: { status: "none", periodCode: null },
    volumes: {
        productionKg: 0,
        soldKg: 0,
        scrapKg: 0,
        purchasedRmKg: 0,
        varnishConsumedKg: 0,
        varnishDrumsConsumed: 0,
        varnishDrumWeightKg: 200,
        yieldPct: null,
        warnings: [],
    },
    totals: {
        directRm: 0,
        directConversion: 0,
        factoryOverhead: 0,
        wastage: 0,
        unabsorbed: 0,
        varnishCost: 0,
        selling: 0,
        admin: 0,
        totalCogs: 0,
        revenue: 0,
        otherIncome: 0,
        revenueTotal: 0,
        totalExpense: 0,
        grossProfit: 0,
    },
    expenseLines: [],
    layers: {
        l1Conversion: {
            directConversionPerKg: null,
            factoryOverheadPerKg: null,
            varnishPerKgProduced: null,
            conversionBurdenPerKgProduced: null,
            adminPerKgSold: null,
            sellingPerKgSold: null,
            commercialBurdenPerKgSold: null,
            breakEvenWattaPkrPerKg: null,
        },
        l2Landed: {
            rmPerKgSold: null,
            varnishPerKgSold: null,
            rmBurdenPerKgSold: null,
            conversionPerKgProduced: null,
            commercialPerKgSold: null,
            totalLandedPerKgSold: null,
            note: null,
        },
        l2SalesCogs: {
            salesCogsPerKgSold: null,
            commercialPerKgSold: null,
            totalSalesLandedPerKgSold: null,
            note: null,
        },
        l2CashPeriod: {
            salesCogsPerKgSold: null,
            periodConversionPerKgProduced: null,
            commercialPerKgSold: null,
            totalCashLandedPerKg: null,
            note: null,
        },
        l3Margin: {
            revenuePerKg: null,
            grossMarginPerKg: null,
            netMarginPerKg: null,
        },
    },
};


export async function fetchUnitEconomics(from: string, to: string): Promise<UnitEconomicsReport> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ...EMPTY_UNIT_ECONOMICS, period: { from, to } };
    }
    const { data, error } = await supabase.schema("erp").rpc("fn_unit_economics", {
        p_from: from,
        p_to: to,
    });
    if (error) {
        console.error("[erp] fn_unit_economics failed", error.message, { from, to });
        throw new Error(formatDbError(error, "Failed to load unit economics report."));
    }
    if (!data || typeof data !== "object") {
        return { ...EMPTY_UNIT_ECONOMICS, period: { from, to } };
    }
    return mapUnitEconomicsPayload(data as Record<string, unknown>);
}


export async function fetchTrueExpenseSummary(from: string, to: string): Promise<{
    productionKg: number;
    soldKg: number;
    factoryOverhead: { code: string; name: string; amount: number }[];
    adminOverhead: { code: string; name: string; amount: number }[];
}> {
    const report = await fetchUnitEconomics(from, to);
    const factoryBuckets = new Set(["direct_conversion", "factory_overhead"]);
    const adminBuckets = new Set(["admin", "selling"]);
    return {
        productionKg: report.volumes.productionKg,
        soldKg: report.volumes.soldKg,
        factoryOverhead: report.expenseLines
            .filter((l) => factoryBuckets.has(l.bucket))
            .map((l) => ({ code: l.code, name: l.name, amount: l.amount })),
        adminOverhead: report.expenseLines
            .filter((l) => adminBuckets.has(l.bucket))
            .map((l) => ({ code: l.code, name: l.name, amount: l.amount })),
    };
}


// ---------------------------------------------------------------------------
// Sales / Purchase register reports (migration 278)
// ---------------------------------------------------------------------------

export type InvoiceRegisterRow = {
    doc_date: string;
    doc_no: string;
    party_code: string;
    party_name: string;
    item_code: string;
    item_name: string;
    size_spec: string | null;
    qty_kg: number;
    unit_count: number;
    unit_price: number;
    line_amount: number;
};

export type InvoiceRegisterDocSide = "sale" | "return";

function mapInvoiceRegisterRows(data: unknown): InvoiceRegisterRow[] {
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        doc_date: String(r.doc_date ?? "").slice(0, 10),
        doc_no: String(r.doc_no ?? ""),
        party_code: String(r.party_code ?? ""),
        party_name: String(r.party_name ?? ""),
        item_code: String(r.item_code ?? ""),
        item_name: String(r.item_name ?? ""),
        size_spec: r.size_spec != null ? String(r.size_spec) : null,
        qty_kg: Number(r.qty_kg ?? 0),
        unit_count: Number(r.unit_count ?? 0),
        unit_price: Number(r.unit_price ?? 0),
        line_amount: Number(r.line_amount ?? 0),
    }));
}

export async function fetchSalesRegisterReport(opts: {
    from?: string;
    to?: string;
    docSide: InvoiceRegisterDocSide;
}): Promise<InvoiceRegisterRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const rows = await fetchReportRpc(
        "sales register report",
        () =>
            supabase.schema("erp").rpc("fn_sales_register_report", {
                p_from: opts.from ?? null,
                p_to: opts.to ?? null,
                p_doc_side: opts.docSide,
            }),
        [] as Record<string, unknown>[],
    );
    return mapInvoiceRegisterRows(rows);
}

export async function fetchPurchaseRegisterReport(opts: {
    from?: string;
    to?: string;
    docSide: InvoiceRegisterDocSide;
}): Promise<InvoiceRegisterRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const rows = await fetchReportRpc(
        "purchase register report",
        () =>
            supabase.schema("erp").rpc("fn_purchase_register_report", {
                p_from: opts.from ?? null,
                p_to: opts.to ?? null,
                p_doc_side: opts.docSide,
            }),
        [] as Record<string, unknown>[],
    );
    return mapInvoiceRegisterRows(rows);
}

// ---------------------------------------------------------------------------
// Sales, Production & Item Tracker report (migration 248)
// ---------------------------------------------------------------------------

export type SalesDetailRow = {
    direction: "sale" | "return";
    doc_no: string;
    doc_date: string;
    party_code: string;
    party_name: string;
    item_code: string;
    item_name: string;
    size_spec: string | null;
    net_weight: number;
    unit_count: number;
    unit_price: number;
    line_amount: number;
};

export async function fetchSalesDetailReport(opts: {
    from?: string;
    to?: string;
    partyCode?: string;
    itemCode?: string;
    sizeSpec?: string;
}): Promise<SalesDetailRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    return fetchReportRpc(
        "sales detail report",
        () =>
            supabase.schema("erp").rpc("fn_sales_detail_report", {
                p_from: opts.from ?? null,
                p_to: opts.to ?? null,
                p_party_code: opts.partyCode ?? null,
                p_item_code: opts.itemCode ?? null,
                p_size_spec: opts.sizeSpec ?? null,
            }),
        [] as SalesDetailRow[],
    );
}

export type ProductionDetailRow = {
    batch_no: string;
    batch_date: string;
    machine_id: string | null;
    machine_code: string | null;
    machine_name: string | null;
    department: string;
    line_type: string;
    item_code: string;
    item_name: string;
    size_spec: string | null;
    net_weight: number;
    unit_count: number;
};

export async function fetchProductionDetailReport(opts: {
    from?: string;
    to?: string;
    machineId?: string;
    sizeSpec?: string;
    department?: string;
}): Promise<ProductionDetailRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    return fetchReportRpc(
        "production detail report",
        () =>
            supabase.schema("erp").rpc("fn_production_detail_report", {
                p_from: opts.from ?? null,
                p_to: opts.to ?? null,
                p_machine_id: opts.machineId ?? null,
                p_size_spec: opts.sizeSpec ?? null,
                p_department: opts.department ?? null,
            }),
        [] as ProductionDetailRow[],
    );
}

export type ItemLedgerRow = {
    posting_date: string;
    movement_type: string;
    source_doc_type: string;
    source_doc_no: string;
    party_code: string | null;
    party_name: string | null;
    reference_no: string | null;
    qty_in: number;
    qty_out: number;
    units_in: number;
    units_out: number;
    running_qty: number;
    running_units: number;
};

export async function fetchItemLedger(opts: {
    itemCode: string;
    from: string;
    to: string;
    warehouseId?: string;
}): Promise<ItemLedgerRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    return fetchReportRpc(
        "item ledger",
        () =>
            supabase.schema("erp").rpc("fn_item_ledger", {
                p_item_code: opts.itemCode,
                p_from: opts.from,
                p_to: opts.to,
                p_warehouse_id: opts.warehouseId ?? null,
            }),
        [] as ItemLedgerRow[],
    );
}

export type WarehouseFilterRow = {
    id: string;
    code: string;
    name: string;
    wh_type: string;
};

export async function fetchWarehousesForFilter(): Promise<WarehouseFilterRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase
        .schema("erp")
        .from("warehouses")
        .select("id,code,name,wh_type")
        .eq("is_active", true)
        .order("code");
    if (error) {
        console.warn("[erp] fetchWarehousesForFilter", error);
        return [];
    }
    return (data ?? []) as WarehouseFilterRow[];
}

export type ExpenseRegisterRow = {
    posting_date: string;
    voucher_no: string;
    account_code: string;
    account_name: string;
    report_group: string;
    party_name: string;
    narration: string;
    debit_amount: number;
    credit_amount: number;
    net_amount: number;
};

export async function fetchExpenseRegisterReport(opts: {
    from?: string;
    to?: string;
    reportGroup?: string | null;
}): Promise<ExpenseRegisterRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const rows = await fetchReportRpc(
        "expense register report",
        () =>
            supabase.schema("erp").rpc("fn_expense_register_report", {
                p_from: opts.from ?? null,
                p_to: opts.to ?? null,
                p_report_group: opts.reportGroup && opts.reportGroup !== "all" ? opts.reportGroup : null,
            }),
        [] as Record<string, unknown>[],
    );
    return rows.map((r: Record<string, unknown>) => ({
        posting_date: String(r.posting_date ?? "").slice(0, 10),
        voucher_no: String(r.voucher_no ?? ""),
        account_code: String(r.account_code ?? ""),
        account_name: String(r.account_name ?? ""),
        report_group: String(r.report_group ?? ""),
        party_name: String(r.party_name ?? ""),
        narration: String(r.narration ?? ""),
        debit_amount: Number(r.debit_amount ?? 0),
        credit_amount: Number(r.credit_amount ?? 0),
        net_amount: Number(r.net_amount ?? 0),
    }));
}
