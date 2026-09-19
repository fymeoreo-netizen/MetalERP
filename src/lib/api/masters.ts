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
import { runErpRpc, runMutation, runRpcMutation, runThrowingMutation } from "./mutations";
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

export type DbCoaRow = {
    id: string;
    code: string;
    name: string;
    account_type: string;
    account_nature: string;
    report_group: string;
    parent_id: string | null;
    is_group: boolean;
    is_posting: boolean;
    level: number;
    is_anchor: boolean;
    is_active?: boolean;
};


export async function fetchCoaAccounts(): Promise<DbCoaRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data } = await supabase
        .schema("erp")
        .from("coa_accounts")
        .select("id,code,name,account_type,account_nature,report_group,parent_id,is_group,is_posting,level,is_anchor,is_active")
        .order("code");
    return (data ?? []) as DbCoaRow[];
}


export async function fetchPostableCoaAccounts(context: CoaSelectContext): Promise<DbCoaRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data } = await supabase
        .schema("erp")
        .from("coa_accounts")
        .select("id,code,name,account_type,account_nature,report_group,parent_id,is_group,is_posting,level,is_anchor,is_active")
        .eq("is_active", true)
        .eq("is_posting", true)
        .eq("is_group", false)
        .order("code");
    return filterCoaForContext((data ?? []) as DbCoaRow[], context);
}


export async function updateCoaAccount(input: {
    code: string;
    name?: string;
    account_type?: string;
    account_nature?: string;
    report_group?: string;
    is_group?: boolean;
    is_posting?: boolean;
}): Promise<Result<{ code: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.account_type !== undefined) patch.account_type = input.account_type;
    if (input.account_nature !== undefined) patch.account_nature = input.account_nature;
    if (input.report_group !== undefined) patch.report_group = input.report_group;
    if (input.is_group !== undefined) patch.is_group = input.is_group;
    if (input.is_posting !== undefined) patch.is_posting = input.is_posting;
    if (Object.keys(patch).length === 0) return { ok: true, data: { code: input.code } };
    const { error } = await supabase
        .schema("erp")
        .from("coa_accounts")
        .update(patch)
        .eq("code", input.code);
    if (error) return { ok: false, error: formatDbError(error, "Failed to update account.") };
    return { ok: true, data: { code: input.code } };
}


export async function deleteCoaAccountSafe(code: string): Promise<Result<{ mode: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("delete account", "coa_account_safe_delete", { p_account_code: code }, (data) => {
        const parsed = (typeof data === "string" ? JSON.parse(data) : data) as
            | { ok: boolean; mode?: string; error?: string }
            | null;
        if (!parsed || !parsed.ok) {
            return { ok: false, error: parsed?.error ?? "Account delete failed." };
        }
        return { ok: true, data: { mode: parsed.mode ?? "deactivated" } };
    }, "Failed to delete account.");
}


export async function upsertCoaAccount(input: {
    code: string;
    name: string;
    account_type: string;
    account_nature: string;
    report_group: string;
    parent_id?: string | null;
    is_group?: boolean;
    is_posting?: boolean;
    level?: number;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const { data, error } = await supabase
        .schema("erp")
        .from("coa_accounts")
        .upsert(
            {
                code: input.code,
                name: input.name,
                account_type: input.account_type,
                account_nature: input.account_nature,
                report_group: input.report_group,
                parent_id: input.parent_id ?? null,
                is_group: input.is_group ?? false,
                is_posting: input.is_posting ?? true,
                level: input.level ?? 0,
            },
            { onConflict: "code" }
        )
        .select("id")
        .single();
    if (error || !data) return { ok: false, error: formatDbError(error, "Failed to save COA account.") };
    return { ok: true, data: { id: data.id } };
}

