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
import { fetchSalesInvoiceDeployCheck, fetchPurchaseInvoiceDeployCheck } from "./diagnostics";
import { parseRpcJsonResult, tryInvoiceDeleteRpc, type InvoiceDeleteFn } from "./documentRpc";
import { POST_RPC_ALT_ARG, POST_RPC_MIGRATION_HINT } from "./postingConstants";
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

function shouldRetryPostRpc(error: { code?: string; message?: string } | null, hasAltArg: boolean): boolean {
    if (!error || !hasAltArg) return false;
    const code = error.code ?? "";
    const msg = (error.message ?? "").toLowerCase();
    if (code === "PGRST202") return true;
    if (code === "PGRST204" || code === "42883") return true;
    if (msg.includes("could not find the function") || msg.includes("not found")) return true;
    return false;
}


export async function postDocument(
    fnName: string,
    docId: string,
    extraArgs?: Record<string, string | null | undefined>,
): Promise<void> {
    const enabled = ensureEnabled();
    if (!enabled.ok) throw new Error(enabled.error);
    const postingCtx = await resolvePostingContext();
    if (!postingCtx) {
        throw new Error(
            "No active sign-in session for posting. Sign out and sign in again, then retry.",
        );
    }
    const altArg = POST_RPC_ALT_ARG[fnName];
    const extras = Object.fromEntries(
        Object.entries(extraArgs ?? {}).filter(([, v]) => v != null && v !== ""),
    ) as Record<string, string>;
    const attempts: Record<string, string>[] = [];
    if (altArg) {
        attempts.push({ [altArg]: docId, ...extras });
        if (!fnName.startsWith("hard_delete_")) {
            attempts.push({ doc_id: docId, ...extras });
        }
    } else {
        attempts.push({ doc_id: docId, ...extras });
    }

    let lastError: { message?: string; code?: string; status?: number } | null = null;
    for (const args of attempts) {
        const { error } = await supabase.schema("erp").rpc(fnName, args);
        if (!error) return;
        lastError = error;
        if (!shouldRetryPostRpc(error, Boolean(altArg))) break;
    }
    agentDebugLog("erpApi.ts:postDocument", "postDocument failed", {
        fnName,
        docId,
        code: lastError?.code,
        msg: lastError?.message?.slice(0, 200),
    });
    const hint = POST_RPC_MIGRATION_HINT[fnName];
    const verb = fnName.startsWith("hard_delete") ? "Failed deleting via" : "Failed posting document via";
    const base = formatDbError(lastError, `${verb} ${fnName}.`);
    let extra = hint ? ` ${hint}` : "";
    if (/posting denied|missing transactions\.post|missing posting map/i.test(base)) {
        extra +=
            " Run supabase/migrations/96_fix_posting_access.sql and supabase/repair_all_posting_maps.sql in SQL Editor.";
    }
    if (fnName === "post_purchase_invoice") {
        try {
            const check = await fetchPurchaseInvoiceDeployCheck();
            if (check.ok) {
                const bad = check.data.filter((r: { status: string }) => r.status !== "OK");
                if (bad.length) {
                    extra += ` Deploy: ${bad.map((r: { check_name: string; status: string }) => `${r.check_name}=${r.status}`).join("; ")}.`;
                }
            }
        } catch {
            /* ignore */
        }
    }
    if (fnName === "post_sales_invoice") {
        try {
            const check = await fetchSalesInvoiceDeployCheck();
            if (check.ok) {
                const bad = check.data.filter((r: { status: string }) => r.status !== "OK");
                if (bad.length) {
                    extra += ` Deploy: ${bad.map((r: { check_name: string; status: string }) => `${r.check_name}=${r.status}`).join("; ")}.`;
                }
            }
        } catch {
            /* ignore */
        }
    }
    throw new Error(`${base}${extra}`);
}

/** Remove stale payable lots that block SPL-{tradeNo} after a trade was deleted and re-created. */

export async function deactivatePartyRpc(partyCode: string): Promise<Result<{ partyCode?: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("deactivate party", "deactivate_party", { p_party_code: partyCode }, (data) => {
        const parsed = (typeof data === "string" ? JSON.parse(data) : data) as
            | { ok: boolean; party_code?: string; error?: string }
            | null;
        if (!parsed?.ok) {
            return { ok: false, error: parsed?.error ?? "Party deactivation failed." };
        }
        return { ok: true, data: { partyCode: parsed.party_code ?? partyCode } };
    }, "Failed to deactivate party.");
}


export async function repairInactivePartyOpeningGlRpc(): Promise<Result<{ partiesRepaired: number }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("repair party opening GL", "repair_inactive_party_opening_gl", {}, (data) => {
        const parsed = (typeof data === "string" ? JSON.parse(data) : data) as
            | { ok: boolean; parties_repaired?: number; error?: string }
            | null;
        if (!parsed?.ok) {
            return { ok: false, error: parsed?.error ?? "Repair failed." };
        }
        return { ok: true, data: { partiesRepaired: Number(parsed.parties_repaired ?? 0) } };
    }, "Failed to repair party opening GL.");
}


export async function postPartyOpeningBalanceRpc(
    partyId: string,
    fin: number,
    metal: number,
): Promise<Result<{ partyCode?: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("post opening balance", "post_party_opening_balance", {
        p_party_id: partyId,
        p_fin: fin,
        p_metal: metal,
    }, (data) => {
        const parsed = (typeof data === "string" ? JSON.parse(data) : data) as
            | { ok: boolean; party_code?: string; error?: string }
            | null;
        if (!parsed || !parsed.ok) {
            return { ok: false, error: parsed?.error ?? "Opening balance posting failed." };
        }
        return { ok: true, data: { partyCode: parsed.party_code } };
    }, "Failed to post opening balance.");
}


export async function postPartyOpeningScrapReceivableRpc(
    partyId: string,
    expectedKg: number,
    refRate: number,
    asOfDate?: string,
): Promise<Result<{ partyCode?: string }>> {
    return syncPartyOpeningScrapReceivablesRpc(partyId, [
        {
            expectedKg,
            refRate,
            asOfDate: asOfDate ?? new Date().toISOString().slice(0, 10),
            label: "Opening Balance",
        },
    ]);
}


export type OpeningScrapLineInput = {
    obligationId?: string;
    expectedKg: number;
    refRate: number;
    asOfDate?: string;
    label?: string;
};


export type OpeningScrapLineRecord = OpeningScrapLineInput & {
    obligationId: string;
    receivedKg: number;
    displayLabel: string;
};


export async function fetchOpeningScrapLinesForParty(partyCode: string): Promise<OpeningScrapLineRecord[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const partyId = await getPartyIdByCode(partyCode);
    if (!partyId) return [];
    const { data, error } = await supabase
        .schema("erp")
        .from("scrap_receivable_obligations")
        .select("id,expected_kg,ref_scrap_rate,invoice_date,sales_invoice_no,received_kg,obligation_no")
        .eq("party_id", partyId)
        .eq("obligation_source", "opening")
        .order("invoice_date", { ascending: false })
        .order("obligation_no", { ascending: true });
    if (error) throw new Error(error.message || "Failed to load opening scrap lines.");
    return (data ?? []).map((row) => ({
        obligationId: String(row.id),
        expectedKg: Number(row.expected_kg ?? 0),
        refRate: Number(row.ref_scrap_rate ?? 0),
        asOfDate: String(row.invoice_date ?? ""),
        label: String(row.sales_invoice_no ?? ""),
        displayLabel: String(row.sales_invoice_no ?? "Opening Balance"),
        receivedKg: Number(row.received_kg ?? 0),
    }));
}


export async function syncPartyOpeningScrapReceivablesRpc(
    partyId: string,
    lines: OpeningScrapLineInput[],
): Promise<Result<{ partyCode?: string; lineCount?: number }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const payload = lines
        .filter((line) => Number(line.expectedKg) > 0 || Number(line.refRate) > 0)
        .map((line) => ({
            obligation_id: line.obligationId ?? null,
            expected_kg: Number(line.expectedKg),
            ref_rate: Number(line.refRate),
            as_of_date: line.asOfDate ?? new Date().toISOString().slice(0, 10),
            label: line.label?.trim() || null,
        }));
    return runErpRpc("sync opening scrap receivables", "sync_party_opening_scrap_receivables", {
        p_party_id: partyId,
        p_lines: payload,
    }, (data) => {
        const parsed = (typeof data === "string" ? JSON.parse(data) : data) as
            | { ok: boolean; party_code?: string; line_count?: number; error?: string }
            | null;
        if (!parsed || !parsed.ok) {
            return { ok: false, error: parsed?.error ?? "Opening scrap receivable sync failed." };
        }
        return { ok: true, data: { partyCode: parsed.party_code, lineCount: parsed.line_count } };
    }, "Failed to sync opening scrap receivable lines.");
}


export async function postOpeningStock(
    itemId: string,
    warehouseId: string,
    qty: number,
    unitCost = 0,
    asOf?: string,
    unitCount = 0,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: true };
    const result = await runErpRpcVoid("post opening stock", "post_opening_stock", {
        p_item_id: itemId,
        p_warehouse_id: warehouseId,
        p_qty: qty,
        p_unit_cost: unitCost,
        p_as_of: asOf ?? null,
        p_unit_count: unitCount,
    }, "Failed to post opening stock.");
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true };
}

export type ItemOpeningStockRow = {
    warehouse_id: string;
    warehouse_code: string;
    qty: number;
    unit_count: number;
    unit_cost: number;
    as_of: string;
    value_amount: number;
};

export async function fetchItemOpeningStock(
    itemId: string,
    warehouseId?: string | null,
): Promise<ItemOpeningStockRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("get_item_opening_stock", {
        p_item_id: itemId,
        p_warehouse_id: warehouseId ?? null,
    });
    if (error) {
        console.warn("[ERP] get_item_opening_stock", error);
        return [];
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        warehouse_id: String(r.warehouse_id ?? ""),
        warehouse_code: String(r.warehouse_code ?? ""),
        qty: Number(r.qty ?? 0),
        unit_count: Number(r.unit_count ?? 0),
        unit_cost: Number(r.unit_cost ?? 0),
        as_of: String(r.as_of ?? "").slice(0, 10),
        value_amount: Number(r.value_amount ?? 0),
    }));
}

/** Replace (or clear when qty ≤ 0) opening stock for item + warehouse. */
export async function upsertOpeningStock(
    itemId: string,
    warehouseId: string,
    qty: number,
    unitCost = 0,
    asOf?: string,
    unitCount = 0,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: true };
    const result = await runErpRpcVoid(
        "upsert opening stock",
        "upsert_opening_stock",
        {
            p_item_id: itemId,
            p_warehouse_id: warehouseId,
            p_qty: qty,
            p_unit_cost: unitCost,
            p_as_of: asOf ?? null,
            p_unit_count: unitCount,
        },
        "Failed to update opening stock.",
    );
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true };
}


export type OpeningStockBatchError = { line?: number; item_code?: string; error?: string };


export async function postOpeningStockBatch(
    rows: Array<{
        item_code: string;
        warehouse_code: string;
        qty: number;
        unit_cost: number;
        unit_count?: number;
        as_of?: string;
    }>,
): Promise<
    | { ok: true; posted: number }
    | { ok: false; error: string; posted?: number; errors?: OpeningStockBatchError[] }
> {
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: true, posted: rows.length };
    const batchInner = await runRpcMutation<{
        posted: number;
        batchErrors: OpeningStockBatchError[];
        success: boolean;
        errorMsg?: string;
    }>(
        "post opening stock batch",
        () => supabase.schema("erp").rpc("post_opening_stock_batch", { p_rows: rows }),
        (data) => {
            const parsed = (typeof data === "string" ? JSON.parse(data) : data) as {
                ok?: boolean;
                posted?: number;
                errors?: OpeningStockBatchError[];
                error?: string;
            } | null;
            const posted = Number(parsed?.posted ?? 0);
            const batchErrors = Array.isArray(parsed?.errors) ? parsed.errors : [];
            if (!parsed?.ok) {
                return {
                    ok: true,
                    data: {
                        posted,
                        batchErrors,
                        success: false,
                        errorMsg:
                            batchErrors[0]?.error ??
                            parsed?.error ??
                            `Batch import completed with ${batchErrors.length} error(s).`,
                    },
                };
            }
            return { ok: true, data: { posted, batchErrors: [], success: true } };
        },
        "Failed to post opening stock batch.",
    );
    if (!batchInner.ok) return { ok: false, error: batchInner.error };
    if (!batchInner.data.success) {
        return {
            ok: false,
            error: batchInner.data.errorMsg!,
            posted: batchInner.data.posted,
            errors: batchInner.data.batchErrors,
        };
    }
    return { ok: true, posted: batchInner.data.posted };
}


function parseRpcOkBody(data: unknown): { ok?: boolean; error?: string } {
    if (typeof data === "string") {
        try {
            return JSON.parse(data) as { ok?: boolean; error?: string };
        } catch {
            return {};
        }
    }
    if (data && typeof data === "object") {
        return data as { ok?: boolean; error?: string };
    }
    return {};
}

export async function postSuppliesRestock(
    itemCode: string,
    qty: number,
    unitCost = 0,
    remarks?: string,
    postingDate?: string,
    unitCount?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: true };
    const result = await runErpRpc("restock supplies", "post_supplies_restock", {
        p_item_code: itemCode,
        p_qty: qty,
        p_unit_cost: unitCost,
        p_remarks: remarks ?? null,
        p_posting_date: postingDate ?? null,
        p_unit_count: unitCount ?? null,
    }, (data) => {
        const parsed = parseRpcOkBody(data);
        if (parsed.ok === false) {
            return { ok: false, error: parsed.error ?? "Restock failed." };
        }
        return { ok: true, data: true };
    }, "Failed to restock supplies.");
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true };
}


export async function postSuppliesStockSet(
    itemCode: string,
    newQty: number,
    remarks?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: true };
    const result = await runErpRpc("update stock", "post_supplies_stock_set", {
        p_item_code: itemCode,
        p_new_qty: newQty,
        p_remarks: remarks ?? null,
    }, (data) => {
        const parsed = parseRpcOkBody(data);
        if (parsed.ok === false) {
            return { ok: false, error: parsed.error ?? "Stock update failed." };
        }
        return { ok: true, data: true };
    }, "Failed to update stock.");
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true };
}


export async function fetchSuppliesRestockHistory(kind: SuppliesRestockKind) {
    return getSuppliesRestockMovements(kind);
}


export async function updateSuppliesRestock(
    movementId: string,
    itemCode: string,
    qty: number,
    unitCost: number,
    postingDate?: string,
    remarks?: string,
    unitCount?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        try {
            updateDemoSuppliesRestock(movementId, itemCode, qty, unitCost, postingDate, remarks);
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : "Failed to update restock." };
        }
    }
    const result = await runErpRpc("update restock", "update_supplies_restock", {
        p_movement_id: movementId,
        p_qty: qty,
        p_unit_cost: unitCost,
        p_posting_date: postingDate ?? null,
        p_remarks: remarks ?? null,
        p_item_code: itemCode,
        p_unit_count: unitCount ?? null,
    }, (data) => {
        const parsed = parseRpcOkBody(data);
        if (parsed.ok === false) {
            return { ok: false, error: parsed.error ?? "Update failed." };
        }
        return { ok: true, data: true };
    }, "Failed to update restock.");
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true };
}


export type PaymentEntryKind = "party_receipt" | "party_payment" | "gl_receipt" | "gl_payment" | "party_settlement";


export async function createPaymentDocument(payload: {
    paymentNo: string;
    paymentType: "receipt" | "payment";
    paymentDate: string;
    partyCode?: string;
    amount: number;
    paymentMode?: string;
    voucherSubtype?: "CRV" | "CPV" | "PARCHI_CLEAR" | "CROSS_SETTLE";
    bankAccountCode?: string;
    counterAccountCode?: string;
    entryKind?: PaymentEntryKind;
    pageNo?: string;
    referenceNo?: string;
    remarks?: string;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    let partyId: string | null = null;
    if (payload.partyCode) partyId = await getPartyIdByCode(payload.partyCode);

    let entryKind = payload.entryKind;
    if (!entryKind) {
        if (payload.partyCode) {
            entryKind = payload.paymentType === "receipt" ? "party_receipt" : "party_payment";
        } else if (payload.counterAccountCode) {
            entryKind = payload.paymentType === "receipt" ? "gl_receipt" : "gl_payment";
        } else {
            entryKind = payload.paymentType === "receipt" ? "party_receipt" : "party_payment";
        }
    }

    const { data, error } = await supabase
        .schema("erp")
        .from("payments")
        .insert({
            payment_no: payload.paymentNo,
            payment_type: payload.paymentType,
            payment_mode: payload.paymentMode ?? "cash",
            payment_date: payload.paymentDate,
            party_id: partyId,
            amount: payload.amount,
            voucher_subtype: payload.voucherSubtype ?? (payload.paymentType === "receipt" ? "CRV" : "CPV"),
            bank_account_code: payload.bankAccountCode ?? null,
            counter_account_code: payload.counterAccountCode ?? null,
            entry_kind: entryKind,
            page_no: payload.pageNo ?? null,
            reference_no: payload.referenceNo ?? null,
            remarks: payload.remarks ?? null,
        })
        .select("id")
        .single();
    if (error || !data) return { ok: false, error: formatDbError(error, "Failed to create payment.") };
    return { ok: true, data: { id: data.id } };
}


export type ParchiClearanceInput = { parchiId: string; amount: number };


export async function saveAndPostPayment(payload: {
    replacePaymentId?: string;
    paymentNo: string;
    paymentType: "receipt" | "payment" | "adjustment";
    paymentDate: string;
    partyCode?: string;
    counterPartyCode?: string;
    amount: number;
    paymentMode?: string;
    voucherSubtype?: "CRV" | "CPV" | "PARCHI_CLEAR" | "CROSS_SETTLE";
    bankAccountCode?: string;
    counterAccountCode?: string;
    entryKind?: PaymentEntryKind;
    pageNo?: string;
    referenceNo?: string;
    remarks?: string;
    isAdvance?: boolean;
    parchiClearances?: ParchiClearanceInput[];
}): Promise<Result<{ id: string; parchiRows?: unknown[] }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    let entryKind = payload.entryKind;
    if (!entryKind) {
        if (payload.partyCode) {
            entryKind = payload.paymentType === "receipt" ? "party_receipt" : "party_payment";
        } else if (payload.counterAccountCode) {
            entryKind = payload.paymentType === "receipt" ? "gl_receipt" : "gl_payment";
        } else {
            entryKind = payload.paymentType === "receipt" ? "party_receipt" : "party_payment";
        }
    }

    const pPayload: Record<string, unknown> = {
        payment_no: payload.paymentNo,
        payment_type: payload.paymentType,
        payment_date: payload.paymentDate,
        party_code: payload.partyCode ?? null,
        counter_party_code: payload.counterPartyCode ?? null,
        amount: payload.amount,
        payment_mode: payload.paymentMode ?? (payload.entryKind === "party_settlement" ? "adjustment" : "cash"),
        voucher_subtype: payload.voucherSubtype ?? (payload.entryKind === "party_settlement" ? "CROSS_SETTLE" : payload.paymentType === "receipt" ? "CRV" : "CPV"),
        bank_account_code: payload.bankAccountCode ?? null,
        counter_account_code: payload.counterAccountCode ?? null,
        entry_kind: entryKind,
        page_no: payload.pageNo ?? null,
        reference_no: payload.referenceNo ?? null,
        remarks: payload.remarks ?? null,
        is_advance: Boolean(payload.isAdvance),
        parchi_clearances: (payload.parchiClearances ?? []).map((a) => ({
            parchi_id: a.parchiId,
            amount: a.amount,
        })),
    };
    if (payload.replacePaymentId) {
        pPayload.replace_payment_id = payload.replacePaymentId;
    }

    return runErpRpc("save payment", "save_and_post_payment", { p_payload: pPayload }, (data) => {
        const parsed = parseRpcJsonResult(data);
        if (!parsed.ok) return { ok: false, error: parsed.error ?? "Failed to save payment." };
        let row: Record<string, unknown> = {};
        if (typeof data === "string") {
            try {
                row = JSON.parse(data) as Record<string, unknown>;
            } catch {
                row = {};
            }
        } else if (data && typeof data === "object") {
            row = data as Record<string, unknown>;
        }
        const paymentId = String(row.payment_id ?? "");
        const parchi = row.parchi as { parchi_rows?: unknown[] } | undefined;
        return {
            ok: true,
            data: { id: paymentId, parchiRows: parchi?.parchi_rows ?? [] },
        };
    }, "Failed to save payment.");
}

export type OpenPartyAdvance = {
    paymentId: string;
    paymentNo: string;
    paymentType: string;
    entryKind: string;
    paymentDate: string;
    partyId: string;
    partyCode: string;
    partyName: string;
    advanceSide: "customer" | "vendor";
    amount: number;
    allocated: number;
    openAdvance: number;
    remarks: string | null;
};

export type OpenSubledgerDoc = {
    id: string;
    sourceDocType: string;
    sourceDocNo: string | null;
    docDate: string;
    amount: number;
    openAmount: number;
    status: string;
};

export async function fetchOpenPartyAdvances(partyCode?: string): Promise<OpenPartyAdvance[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    let q = supabase
        .schema("erp")
        .from("v_open_party_advances")
        .select(
            "payment_id,payment_no,payment_type,entry_kind,payment_date,party_id,party_code,party_name,advance_side,amount,allocated,open_advance,remarks",
        )
        .order("payment_date", { ascending: true });
    if (partyCode) q = q.eq("party_code", partyCode);
    const { data, error } = await q;
    if (error) throw new Error(formatDbError(error, "Failed to load open advances."));
    return (data ?? []).map((r: Record<string, unknown>) => ({
        paymentId: String(r.payment_id),
        paymentNo: String(r.payment_no ?? ""),
        paymentType: String(r.payment_type ?? ""),
        entryKind: String(r.entry_kind ?? ""),
        paymentDate: String(r.payment_date ?? ""),
        partyId: String(r.party_id ?? ""),
        partyCode: String(r.party_code ?? ""),
        partyName: String(r.party_name ?? ""),
        advanceSide: r.advance_side === "vendor" ? "vendor" : "customer",
        amount: Number(r.amount ?? 0),
        allocated: Number(r.allocated ?? 0),
        openAdvance: Number(r.open_advance ?? 0),
        remarks: r.remarks != null ? String(r.remarks) : null,
    }));
}

export async function fetchOpenArDocsForParty(partyId: string): Promise<OpenSubledgerDoc[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase
        .schema("erp")
        .from("ar_documents")
        .select("id,source_doc_type,source_doc_no,doc_date,amount,open_amount,status")
        .eq("party_id", partyId)
        .in("status", ["open", "partially_settled"])
        .gt("open_amount", 0.01)
        .order("doc_date", { ascending: true });
    if (error) throw new Error(formatDbError(error, "Failed to load open AR documents."));
    return (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        sourceDocType: String(r.source_doc_type ?? ""),
        sourceDocNo: r.source_doc_no != null ? String(r.source_doc_no) : null,
        docDate: String(r.doc_date ?? ""),
        amount: Number(r.amount ?? 0),
        openAmount: Number(r.open_amount ?? 0),
        status: String(r.status ?? ""),
    }));
}

export async function fetchOpenApDocsForParty(partyId: string): Promise<OpenSubledgerDoc[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase
        .schema("erp")
        .from("ap_documents")
        .select("id,source_doc_type,source_doc_no,doc_date,amount,open_amount,status")
        .eq("party_id", partyId)
        .in("status", ["open", "partially_settled"])
        .gt("open_amount", 0.01)
        .order("doc_date", { ascending: true });
    if (error) throw new Error(formatDbError(error, "Failed to load open AP documents."));
    return (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        sourceDocType: String(r.source_doc_type ?? ""),
        sourceDocNo: r.source_doc_no != null ? String(r.source_doc_no) : null,
        docDate: String(r.doc_date ?? ""),
        amount: Number(r.amount ?? 0),
        openAmount: Number(r.open_amount ?? 0),
        status: String(r.status ?? ""),
    }));
}

export async function consumePartyAdvance(
    paymentId: string,
    docId: string,
    amount: number,
): Promise<Result<{ voucherNo?: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc(
        "consume party advance",
        "consume_party_advance",
        { p_payment_id: paymentId, p_doc_id: docId, p_amount: amount },
        (data) => {
            const parsed = parseRpcJsonResult(data);
            if (!parsed.ok) return { ok: false, error: parsed.error ?? "Failed to consume advance." };
            let row: Record<string, unknown> = {};
            if (typeof data === "string") {
                try {
                    row = JSON.parse(data) as Record<string, unknown>;
                } catch {
                    row = {};
                }
            } else if (data && typeof data === "object") {
                row = data as Record<string, unknown>;
            }
            if (row.ok === false) {
                return { ok: false, error: String(row.error ?? "Failed to consume advance.") };
            }
            return { ok: true, data: { voucherNo: row.voucher_no != null ? String(row.voucher_no) : undefined } };
        },
        "Failed to consume advance.",
    );
}

export async function fetchPayments(): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const pageSize = 1000;
    const rows: any[] = [];

    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .schema("erp")
            .from("payments")
            .select(
                "id,payment_no,payment_type,payment_date,amount,posting_status,voided_at,voucher_subtype,page_no,remarks,entry_kind,counter_account_code,bank_account_code,party:party_id(code,name),counter_party:counter_party_id(code,name)"
            )
            .eq("posting_status", "posted")
            .is("voided_at", null)
            .order("payment_date", { ascending: true })
            .order("payment_no", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw new Error(formatDbError(error, "Failed to load posted cashbook payments."));

        const page = data ?? [];
        rows.push(...page);
        if (page.length < pageSize) break;
    }

    return rows;
}


/** Void a posted payment (or hard-delete a draft). Prefer this for cashbook remove. */
export async function voidPaymentDocument(
    id: string,
    reason?: string,
): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc(
        "void payment",
        "void_payment",
        { p_doc_id: id, p_reason: reason ?? "Deleted from cashbook" },
        (data) => {
            const parsed = parseRpcJsonResult(data);
            if (!parsed.ok) return { ok: false, error: parsed.error ?? "Failed to void payment." };
            return { ok: true, data: { id } };
        },
        "Failed to void payment.",
    );
}

/**
 * Remove a cashbook payment. Posted rows are voided (GL reversed); drafts are hard-deleted.
 * Uses hard_delete_payment which routes posted → void_payment server-side.
 */
export async function deletePaymentDocument(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc("delete payment", "hard_delete_payment", { p_doc_id: id }, (data) => {
        const parsed = parseRpcJsonResult(data);
        if (!parsed.ok) return { ok: false, error: parsed.error ?? "Failed to delete payment." };
        return { ok: true, data: { id } };
    }, "Failed to delete payment.");
}


export async function createParchiDocument(payload: {
    parchiNo: string;
    parchiType: "company_parchi" | "bank_cheque";
    direction: "received" | "issued";
    partyCode: string;
    issueDate: string;
    dueDate?: string;
    totalAmount: number;
    bankName?: string;
    chequeNo?: string;
    guarantor?: string;
    narration?: string;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const partyId = await getPartyIdByCode(payload.partyCode);
    if (!partyId) return { ok: false, error: "Party not found." };

    const { data, error } = await supabase
        .schema("erp")
        .from("parchi_instruments")
        .insert({
            parchi_no: payload.parchiNo,
            parchi_type: payload.parchiType,
            direction: payload.direction,
            party_id: partyId,
            issue_date: payload.issueDate,
            due_date: payload.dueDate ?? null,
            total_amount: payload.totalAmount,
            open_amount: payload.totalAmount,
            bank_name: payload.bankName ?? null,
            cheque_no: payload.chequeNo ?? null,
            guarantor: payload.guarantor ?? null,
            narration: payload.narration ?? null,
        })
        .select("id")
        .single();
    if (error || !data) return { ok: false, error: formatDbError(error, "Failed to create parchi.") };
    return { ok: true, data: { id: data.id } };
}


export async function updateParchiDocument(
    id: string,
    payload: {
        partyCode?: string;
        parchiType?: "company_parchi" | "bank_cheque";
        direction?: "received" | "issued";
        issueDate?: string;
        dueDate?: string;
        totalAmount?: number;
        bankName?: string;
        chequeNo?: string;
        guarantor?: string;
        narration?: string;
    }
): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchError } = await supabase
        .schema("erp")
        .from("parchi_instruments")
        .select("id,status,cleared_amount,total_amount")
        .eq("id", id)
        .single();
    if (fetchError || !existing) {
        return { ok: false, error: formatDbError(fetchError, "Parchi not found.") };
    }
    if (existing.status === "void") {
        return { ok: false, error: "Cannot edit a voided parchi." };
    }

    const cleared = Number(existing.cleared_amount ?? 0);
    const updates: Record<string, unknown> = {};

    if (payload.partyCode) {
        const partyId = await getPartyIdByCode(payload.partyCode);
        if (!partyId) return { ok: false, error: "Party not found." };
        updates.party_id = partyId;
    }
    if (payload.parchiType) updates.parchi_type = payload.parchiType;
    if (payload.direction) updates.direction = payload.direction;
    if (payload.issueDate) updates.issue_date = payload.issueDate;
    if (payload.dueDate !== undefined) updates.due_date = payload.dueDate || null;
    if (payload.bankName !== undefined) updates.bank_name = payload.bankName || null;
    if (payload.chequeNo !== undefined) updates.cheque_no = payload.chequeNo || null;
    if (payload.guarantor !== undefined) updates.guarantor = payload.guarantor === "none" ? null : payload.guarantor || null;
    if (payload.narration !== undefined) updates.narration = payload.narration || null;

    if (payload.totalAmount !== undefined) {
        if (payload.totalAmount < cleared) {
            return {
                ok: false,
                error: `Total cannot be less than cleared amount (₨ ${cleared.toLocaleString()}).`,
            };
        }
        updates.total_amount = payload.totalAmount;
        const open = payload.totalAmount - cleared;
        updates.open_amount = open;
        updates.status = open <= 0.01 ? "cleared" : cleared > 0 ? "partial" : "open";
    }

    const { data, error } = await supabase
        .schema("erp")
        .from("parchi_instruments")
        .update(updates)
        .eq("id", id)
        .select("id")
        .single();
    if (error || !data) return { ok: false, error: formatDbError(error, "Failed to update parchi.") };
    return { ok: true, data: { id: data.id } };
}


export async function voidParchiDocument(id: string, reason?: string): Promise<Result<{ id: string; glReversed?: number }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc("void parchi", "void_parchi_instrument", {
        p_parchi_id: id,
        p_reason: reason ?? null,
    }, (data) => {
        const parsed = data as { ok?: boolean; error?: string; id?: string; gl_reversed?: number; already_voided?: boolean };
        if (!parsed?.ok) {
            return { ok: false, error: parsed?.error ?? "Failed to void parchi." };
        }
        return {
            ok: true,
            data: { id: parsed.id ?? id, glReversed: Number(parsed.gl_reversed ?? 0) },
        };
    }, "Failed to void parchi.");
}


export async function repairVoidedParchiOrphanGl(): Promise<Result<{ reversed: number }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("repair parchi GL", "repair_voided_parchi_orphan_gl", {}, (data) => ({
        ok: true,
        data: { reversed: Number(data ?? 0) },
    }), "Parchi GL repair failed.");
}


export async function clearParchiWithPayment(
    parchiId: string,
    paymentId: string,
    amount: number,
    clearanceDate?: string
): Promise<void> {
    if (!isSupabaseConfigured() || !hasErpContext()) return;
    await supabase.schema("erp").from("parchi_clearances").insert({
        parchi_id: parchiId,
        payment_id: paymentId,
        amount,
        clearance_date: clearanceDate ?? new Date().toISOString().slice(0, 10),
    });
    const { data: parchi } = await supabase
        .schema("erp")
        .from("parchi_instruments")
        .select("cleared_amount,open_amount,total_amount")
        .eq("id", parchiId)
        .single();
    if (parchi) {
        const cleared = Number(parchi.cleared_amount) + amount;
        const open = Math.max(0, Number(parchi.total_amount) - cleared);
        const status = open <= 0.01 ? "cleared" : "partial";
        await supabase
            .schema("erp")
            .from("parchi_instruments")
            .update({ cleared_amount: cleared, open_amount: open, status })
            .eq("id", parchiId);
    }
}

// ---------------------------------------------------------------------------
// Manual Journal Voucher
// ---------------------------------------------------------------------------

export type PostedJournalVoucher = {
    voucherId: string;
    voucherNo: string;
    totalDebit: number;
    totalCredit: number;
};

export type JournalVoucherRow = {
    id: string;
    voucherNo: string;
    postingDate: string;
    narration: string | null;
    totalDebit: number;
    totalCredit: number;
    status: string;
};

type JournalVoucherRpcBody = {
    ok?: boolean;
    error?: string;
    voucher_id?: string;
    voucher_no?: string;
    total_debit?: number;
    total_credit?: number;
};

function parseJournalVoucherRpc(data: unknown): JournalVoucherRpcBody {
    if (typeof data === "string") {
        try {
            return JSON.parse(data) as JournalVoucherRpcBody;
        } catch {
            return {};
        }
    }
    if (data && typeof data === "object") {
        return data as JournalVoucherRpcBody;
    }
    return {};
}

export async function postJournalVoucher(payload: {
    postingDate: string;
    referenceNo?: string;
    narration?: string;
    lines: Array<{
        accountCode: string;
        partyCode?: string | null;
        debit: number;
        credit: number;
        remarks?: string;
    }>;
}): Promise<Result<PostedJournalVoucher>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc<PostedJournalVoucher>(
        "post journal voucher",
        "post_journal_voucher",
        {
            p_payload: {
                posting_date: payload.postingDate,
                reference_no: payload.referenceNo ?? null,
                narration: payload.narration ?? null,
                lines: payload.lines.map((l) => ({
                    account_code: l.accountCode,
                    party_code: l.partyCode ?? null,
                    debit: l.debit,
                    credit: l.credit,
                    remarks: l.remarks ?? null,
                })),
            },
        },
        (data) => {
            const parsed = parseJournalVoucherRpc(data);
            if (parsed.ok === false) {
                return { ok: false, error: parsed.error ?? "Journal voucher failed." };
            }
            const voucherId = String(parsed.voucher_id ?? "");
            const voucherNo = String(parsed.voucher_no ?? "");
            if (!voucherId) {
                return { ok: false, error: "Journal posted but no voucher id returned." };
            }
            return {
                ok: true,
                data: {
                    voucherId,
                    voucherNo,
                    totalDebit: Number(parsed.total_debit ?? 0),
                    totalCredit: Number(parsed.total_credit ?? 0),
                },
            };
        },
        "Failed to post journal voucher.",
    );
}

export async function fetchJournalVouchers(limit = 100): Promise<JournalVoucherRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];

    const { data, error } = await supabase
        .schema("erp")
        .from("journal_vouchers")
        .select("id,voucher_no,posting_date,narration,total_debit,total_credit,status")
        .order("posting_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) {
        console.error("[erp] fetchJournalVouchers failed", error.message);
        throw new Error(formatDbError(error, "Failed to load journal vouchers."));
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        voucherNo: String(row.voucher_no ?? ""),
        postingDate: String(row.posting_date ?? ""),
        narration: (row.narration as string | null) ?? null,
        totalDebit: Number(row.total_debit ?? 0),
        totalCredit: Number(row.total_credit ?? 0),
        status: String(row.status ?? "posted"),
    }));
}

export async function deleteJournalVoucher(voucherId: string): Promise<Result<true>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc(
        "delete journal voucher",
        "hard_delete_journal_voucher",
        { p_voucher_id: voucherId },
        (data) => {
            const parsed = parseJournalVoucherRpc(data);
            if (parsed.ok === false) {
                return { ok: false, error: parsed.error ?? "Failed to delete journal voucher." };
            }
            return { ok: true, data: true };
        },
        "Failed to delete journal voucher.",
    );
}

