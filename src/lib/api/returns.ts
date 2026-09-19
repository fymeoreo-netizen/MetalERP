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
    type PurchaseReturnPayload,
    type SalesReturnPayload,
} from "@/lib/domain/invoice/documentPayloads";
import { asRowOrNull, asRows } from "./contracts/shared";
import type {
    PurchaseReturnDocumentRow,
    PurchaseReturnListRow,
    SalesReturnDocumentRow,
    SalesReturnListRow,
} from "./contracts/returns";
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
import { getInvoiceIdByNo } from "./invoiceShared";
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

export async function createSalesReturnDocument(payload: unknown): Promise<Result<{ id: string }>> {
    const validated = validateDocumentPayload(salesReturnPayloadSchema, payload);
    if (!validated.ok) return validated;
    const doc = validated.data;
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const context = await resolvePostingContext();
    if (!context) return { ok: false, error: "No posting access found for your user. Verify your role access." };
    const partyId = await getPartyIdByCode(doc.header.customerId);
    if (!partyId) return { ok: false, error: "Customer not found in ERP parties." };
    const itemMap = await getItemIdsByCode(doc.items.map((l) => l.itemCode));
    const warehouseId = await getWarehouseIdByType("finished_goods");
    const refInvoiceId = await getInvoiceIdByNo(doc.header?.originalInv);

    const { data: header, error: headerError } = await supabase
        .schema("erp")
        .from("sales_returns")
        .insert({
            return_no: doc.header.returnId,
            return_date: doc.header.date ? new Date(doc.header.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            party_id: partyId,
            ref_invoice_id: refInvoiceId,
            return_action: doc.header.returnAction ?? "restock",
            grand_total: Number(doc.totalCreditAmount ?? doc.totals?.grandTotal ?? 0),
            remarks: doc.header.remarks || null,
        })
        .select("id")
        .single();

    if (headerError || !header) return { ok: false, error: formatDbError(headerError, "Failed to create sales return.") };

    const lines = doc.items
        .filter((l) => l.itemCode && Number(l.netWeight) > 0 && itemMap[l.itemCode])
        .map((line, idx) => ({
            sales_return_id: header.id,
            line_no: idx + 1,
            item_id: itemMap[line.itemCode],
            warehouse_id: warehouseId,
            qty: Number(line.netWeight),
            uom_code: "KG",
            unit_count: Number(line.unitCount ?? line.quantity ?? 0),
            ...lineRateFields({ rateStatus: line.rateStatus, rate: line.rate, amount: line.creditAmount }),
        }));
    if (lines.length) {
        const { error: lineError } = await supabase.schema("erp").from("sales_return_lines").insert(lines);
        if (lineError) return { ok: false, error: formatDbError(lineError, "Failed to create sales return lines.") };
    }
    return { ok: true, data: { id: header.id } };
}


export async function createPurchaseReturnDocument(payload: unknown): Promise<Result<{ id: string }>> {
    const validated = validateDocumentPayload(purchaseReturnPayloadSchema, payload);
    if (!validated.ok) return validated;
    const doc = validated.data;
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const context = await resolvePostingContext();
    if (!context) return { ok: false, error: "No posting access found for your user. Verify your role access." };
    const partyCode = doc.header.supplierId ?? doc.header.supplier;
    const partyId = partyCode ? await getPartyIdByCode(partyCode) : null;
    if (!partyId) return { ok: false, error: "Supplier not found in ERP parties." };
    const itemMap = await getItemIdsByCode(doc.items.map((l) => l.itemCode ?? l.item));
    const warehouseId = await getWarehouseIdByType("raw_material");

    const { data: header, error: headerError } = await supabase
        .schema("erp")
        .from("purchase_returns")
        .insert({
            return_no: doc.header.returnId,
            return_date: doc.header.date ? new Date(doc.header.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            party_id: partyId,
            return_action: doc.header.returnAction === "financial" ? "financial_only" : "stock",
            grand_total: Number(doc.totalDebit ?? doc.totals?.grandTotal ?? 0),
            remarks: doc.header.remarks || null,
        })
        .select("id")
        .single();

    if (headerError || !header) return { ok: false, error: formatDbError(headerError, "Failed to create purchase return.") };

    const lines = doc.items
        .filter((l) => (l.itemCode ?? l.item) && Number(l.netWeight ?? l.weight) > 0)
        .map((line, idx) => ({
            purchase_return_id: header.id,
            line_no: idx + 1,
            item_id: itemMap[line.itemCode ?? line.item],
            warehouse_id: warehouseId,
            qty: Number(line.netWeight ?? line.weight ?? 0),
            uom_code: "KG",
            unit_count: Number(line.unitCount ?? 0),
            ...lineRateFields({ rateStatus: line.rateStatus, rate: line.rate, amount: line.amount }),
        }))
        .filter((line) => Boolean(line.item_id));

    if (lines.length) {
        const { error: lineError } = await supabase.schema("erp").from("purchase_return_lines").insert(lines);
        if (lineError) return { ok: false, error: formatDbError(lineError, "Failed to create purchase return lines.") };
    }
    return { ok: true, data: { id: header.id } };
}

/** PostgREST matches RPC args by parameter name (not position). */
const POST_RPC_ALT_ARG: Record<string, string> = {
    post_scrap_receipt: "p_doc_id",
    post_drawing_weekly_wage_sheet: "p_sheet_id",
    hard_delete_scrap_trade: "p_doc_id",
    hard_delete_scrap_receipt: "p_doc_id",
};

const POST_RPC_MIGRATION_HINT: Partial<Record<string, string>> = {
    post_scrap_receipt: "Apply Supabase migrations 76 and 81 (post_scrap_receipt), then run: notify pgrst, 'reload schema';",
    post_scrap_trade:
        "Duplicate scrap payable lot (SPL-…): apply migration 165_scrap_payable_lot_duplicate_repair.sql. Missing GL maps: run 99_repair_scrap_trade_posting_map.sql.",
    post_purchase_invoice:
        "Apply migrations 87–88 on Supabase, then: select * from erp.fn_post_purchase_invoice_deploy_check(); notify pgrst, 'reload schema';",
    post_sales_invoice:
        "Run migrations 96–97 and repair_all_posting_maps.sql. Use Dashboard → Posting health while logged in.",
};

/** Run in SQL editor if purchase post still returns 400. */

export async function fetchSalesReturnsDocsPage(
    options: DocListPageOpts = {},
): Promise<Result<PaginatedRows<SalesReturnListRow>>> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: true, data: { rows: [], total: 0, hasMore: false } };
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? ERP_DOC_LIST_PAGE_SIZE;
    let query = supabase
        .schema("erp")
        .from("sales_returns")
        .select(
            "id,return_no,return_date,grand_total,return_action,posting_status,ref_invoice_id,sales_invoices!sales_returns_ref_invoice_id_fkey(invoice_no),parties(code,name)",
            { count: "exact" },
        )
        .order("created_at", { ascending: false });
    const term = options.search?.trim();
    if (term) query = query.ilike("return_no", `%${escapeLikePattern(term)}%`);
    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return { ok: false, error: formatDbError(error, "Failed to load sales returns.") };
    const total = count ?? 0;
    return {
        ok: true,
        data: {
            rows: asRows<SalesReturnListRow>(data),
            total,
            hasMore: offset + (data?.length ?? 0) < total,
        },
    };
}


export async function fetchSalesReturnsDocsResult(): Promise<Result<SalesReturnListRow[]>> {
    const page = await fetchSalesReturnsDocsPage({ offset: 0, limit: 100 });
    if (!page.ok) return page;
    return { ok: true, data: page.data.rows };
}


export async function fetchSalesReturnsDocs(): Promise<SalesReturnListRow[]> {
    const result = await fetchSalesReturnsDocsResult();
    return result.ok ? result.data : [];
}


export async function fetchPurchaseReturnsDocsPage(
    options: DocListPageOpts = {},
): Promise<Result<PaginatedRows<PurchaseReturnListRow>>> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: true, data: { rows: [], total: 0, hasMore: false } };
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? ERP_DOC_LIST_PAGE_SIZE;
    let query = supabase
        .schema("erp")
        .from("purchase_returns")
        .select("id,return_no,return_date,grand_total,return_action,posting_status,remarks,parties(code,name)", {
            count: "exact",
        })
        .order("created_at", { ascending: false });
    const term = options.search?.trim();
    if (term) query = query.ilike("return_no", `%${escapeLikePattern(term)}%`);
    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return { ok: false, error: formatDbError(error, "Failed to load purchase returns.") };
    const total = count ?? 0;
    return {
        ok: true,
        data: {
            rows: asRows<PurchaseReturnListRow>(data),
            total,
            hasMore: offset + (data?.length ?? 0) < total,
        },
    };
}


export async function fetchPurchaseReturnsDocsResult(): Promise<Result<PurchaseReturnListRow[]>> {
    const page = await fetchPurchaseReturnsDocsPage({ offset: 0, limit: 100 });
    if (!page.ok) return page;
    return { ok: true, data: page.data.rows };
}


export async function fetchPurchaseReturnsDocs(): Promise<PurchaseReturnListRow[]> {
    const result = await fetchPurchaseReturnsDocsResult();
    return result.ok ? result.data : [];
}


export async function fetchSalesReturnDocument(id: string): Promise<SalesReturnDocumentRow | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data } = await supabase
        .schema("erp")
        .from("sales_returns")
        .select(
            "id,return_no,return_date,return_action,grand_total,remarks,posting_status,parties(code,name),sales_invoices!sales_returns_ref_invoice_id_fkey(invoice_no),sales_return_lines(id,line_no,qty,unit_count,unit_price,line_amount,rate_status,items(code,name))"
        )
        .eq("id", id)
        .maybeSingle();
    return asRowOrNull<SalesReturnDocumentRow>(data);
}


export async function fetchPurchaseReturnDocument(id: string): Promise<PurchaseReturnDocumentRow | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data } = await supabase
        .schema("erp")
        .from("purchase_returns")
        .select(
            "id,return_no,return_date,return_action,grand_total,remarks,posting_status,parties(code,name),purchase_return_lines(id,line_no,qty,unit_count,unit_price,line_amount,rate_status,items(code,name))"
        )
        .eq("id", id)
        .maybeSingle();
    return asRowOrNull<PurchaseReturnDocumentRow>(data);
}

async function replaceSalesReturnLines(
    returnId: string,
    payload: SalesReturnPayload,
    itemMap: Record<string, string>,
    warehouseId: string
): Promise<Result<true>> {
    await supabase.schema("erp").from("sales_return_lines").delete().eq("sales_return_id", returnId);

    const lines = payload.items
        .filter((l) => l.itemCode && Number(l.netWeight) > 0 && itemMap[l.itemCode])
        .map((line, idx) => ({
            sales_return_id: returnId,
            line_no: idx + 1,
            item_id: itemMap[line.itemCode],
            warehouse_id: warehouseId,
            qty: Number(line.netWeight),
            uom_code: "KG",
            unit_count: Number(line.unitCount ?? line.quantity ?? 0),
            ...lineRateFields({ rateStatus: line.rateStatus, rate: line.rate, amount: line.creditAmount }),
        }));

    if (lines.length) {
        const { error: lineError } = await supabase.schema("erp").from("sales_return_lines").insert(lines);
        if (lineError) return { ok: false, error: formatDbError(lineError, "Failed to save sales return lines.") };
    }
    return { ok: true, data: true };
}


export async function updateSalesReturnDocument(id: string, payload: unknown): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const validated = validateDocumentPayload(salesReturnPayloadSchema, payload);
    if (!validated.ok) return validated;
    const doc = validated.data;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("sales_returns")
        .select("id,posting_status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Sales return not found.") };
    // Posted returns are updated in place, then inventory/GL replayed via repost_sales_return.

    const partyId = await getPartyIdByCode(doc.header.customerId);
    if (!partyId) return { ok: false, error: "Customer not found in ERP parties." };
    const itemMap = await getItemIdsByCode(doc.items.map((l) => l.itemCode));
    const warehouseId = await getWarehouseIdByType("finished_goods");
    if (!warehouseId) return { ok: false, error: "Finished goods warehouse not found." };
    const refInvoiceId = await getInvoiceIdByNo(doc.header.originalInv);

    const { error: headerError } = await supabase
        .schema("erp")
        .from("sales_returns")
        .update({
            return_date: doc.header.date ? new Date(doc.header.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            party_id: partyId,
            ref_invoice_id: refInvoiceId,
            return_action: doc.header.returnAction ?? "restock",
            grand_total: Number(doc.totalCreditAmount ?? 0),
            remarks: doc.header.remarks || null,
        })
        .eq("id", id);
    if (headerError) return { ok: false, error: formatDbError(headerError, "Failed to update sales return.") };

    const lineResult = await replaceSalesReturnLines(id, doc, itemMap, warehouseId);
    if (!lineResult.ok) return lineResult;

    if (existing.posting_status === "posted") {
        const repost = await runErpRpc<unknown>("repost sales return", "repost_sales_return", {
            p_doc_id: id,
        });
        if (!repost.ok) return { ok: false, error: repost.error };
        const parsed = parseRpcJsonResult(repost.data);
        if (!parsed.ok) {
            return { ok: false, error: parsed.error ?? "Failed to repost sales return after edit." };
        }
    }

    return { ok: true, data: { id } };
}


export async function deleteSalesReturnDocument(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("sales_returns")
        .select("id,posting_status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Sales return not found.") };
    const { error: deleteErr } = await supabase.schema("erp").from("sales_returns").delete().eq("id", id);
    if (deleteErr) return { ok: false, error: formatDbError(deleteErr, "Failed to delete sales return.") };
    return { ok: true, data: { id } };
}


export async function hardDeleteSalesReturnDocument(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("hard delete sales return", "hard_delete_sales_return", { p_doc_id: id }, (data) => {
        const parsed = parseRpcJsonResult(data);
        if (!parsed.ok) return { ok: false, error: parsed.error ?? "Failed to delete sales return." };
        return { ok: true, data: { id } };
    }, "Failed to delete sales return.");
}

async function replacePurchaseReturnLines(
    returnId: string,
    payload: PurchaseReturnPayload,
    itemMap: Record<string, string>,
    warehouseId: string
): Promise<Result<true>> {
    await supabase.schema("erp").from("purchase_return_lines").delete().eq("purchase_return_id", returnId);

    const lines = payload.items
        .filter((l) => (l.itemCode ?? l.item) && Number(l.netWeight ?? l.weight) > 0)
        .map((line, idx) => {
            const itemCode = line.itemCode ?? line.item;
            return {
                purchase_return_id: returnId,
                line_no: idx + 1,
                item_id: itemMap[itemCode],
                warehouse_id: warehouseId,
                qty: Number(line.netWeight ?? line.weight ?? 0),
                uom_code: "KG",
                ...lineRateFields({ rateStatus: line.rateStatus, rate: line.rate, amount: line.amount }),
            };
        })
        .filter((line) => Boolean(line.item_id));

    if (lines.length) {
        const { error: lineError } = await supabase.schema("erp").from("purchase_return_lines").insert(lines);
        if (lineError) return { ok: false, error: formatDbError(lineError, "Failed to save purchase return lines.") };
    }
    return { ok: true, data: true };
}


export async function updatePurchaseReturnDocument(id: string, payload: unknown): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const validated = validateDocumentPayload(purchaseReturnPayloadSchema, payload);
    if (!validated.ok) return validated;
    const doc = validated.data;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("purchase_returns")
        .select("id,posting_status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Purchase return not found.") };
    // Posted returns are updated in place, then inventory/GL replayed via repost_purchase_return.

    const partyCode = doc.header.supplierId;
    const partyId = partyCode ? await getPartyIdByCode(partyCode) : null;
    if (!partyId) return { ok: false, error: "Supplier not found in ERP parties." };
    const itemMap = await getItemIdsByCode(doc.items.map((l) => l.itemCode ?? l.item));
    const warehouseId = await getWarehouseIdByType("raw_material");
    if (!warehouseId) return { ok: false, error: "Raw material warehouse not found." };

    const { error: headerError } = await supabase
        .schema("erp")
        .from("purchase_returns")
        .update({
            return_date: doc.header.date ? new Date(doc.header.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            party_id: partyId,
            return_action: doc.header.returnAction === "financial" ? "financial_only" : "stock",
            grand_total: Number(doc.totalDebit ?? 0),
            remarks: doc.header.remarks || null,
        })
        .eq("id", id);
    if (headerError) return { ok: false, error: formatDbError(headerError, "Failed to update purchase return.") };

    const lineResult = await replacePurchaseReturnLines(id, doc, itemMap, warehouseId);
    if (!lineResult.ok) return lineResult;

    if (existing.posting_status === "posted") {
        const repost = await runErpRpc<unknown>("repost purchase return", "repost_purchase_return", {
            p_doc_id: id,
        });
        if (!repost.ok) return { ok: false, error: repost.error };
        const parsed = parseRpcJsonResult(repost.data);
        if (!parsed.ok) {
            return { ok: false, error: parsed.error ?? "Failed to repost purchase return after edit." };
        }
    }

    return { ok: true, data: { id } };
}


export async function deletePurchaseReturnDocument(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("purchase_returns")
        .select("id,posting_status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Purchase return not found.") };
    if (existing.posting_status === "posted") {
        return {
            ok: false,
            error: "Posted debit notes cannot be deleted. Void the original invoice instead.",
        };
    }

    const { error: deleteErr } = await supabase.schema("erp").from("purchase_returns").delete().eq("id", id);
    if (deleteErr) return { ok: false, error: formatDbError(deleteErr, "Failed to delete purchase return.") };
    return { ok: true, data: { id } };
}


export async function hardDeletePurchaseReturnDocument(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("hard delete purchase return", "hard_delete_purchase_return", { p_doc_id: id }, (data) => {
        const parsed = parseRpcJsonResult(data);
        if (!parsed.ok) return { ok: false, error: parsed.error ?? "Failed to delete purchase return." };
        return { ok: true, data: { id } };
    }, "Failed to delete purchase return.");
}

