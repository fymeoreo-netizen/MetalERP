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
import { toDocDateISO } from "@/lib/partyCatalog";
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
    type PurchaseInvoicePayload,
} from "@/lib/domain/invoice/documentPayloads";
import { asRowOrNull, asRows } from "./contracts/shared";
import type {
    PurchaseInvoiceDocumentRow,
    PurchaseInvoiceListRow,
    PurchaseOrderRow,
} from "./contracts/purchaseInvoices";
import {
    ensureEnabled,
    ensureConfigured,
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
import {
    assertActiveWire8PostingTarget,
    buildPurchaseInvoiceLineRow,
    collectPurchaseLineItemCodes,
    getPurchaseOrderLineLookup,
    resolveCanonicalWire8CodeForPosting,
    resolveSalesOrderLineId,
    validatePurchaseInvoiceLinesPersisted,
    type HardDeleteInvoiceResult,
} from "./invoiceShared";
import { rpcHardDeleteInvoice } from "./salesInvoices";
import { savePremiumScrapAllocations } from "./scrap";
import { parseRpcJsonResult, tryInvoiceDeleteRpc } from "./documentRpc";
import { fetchInvoiceListSearchPage } from "./invoiceListSearch";
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

export type PurchaseCogsCascadeSummary = {
    directPairsRestamped: number;
    salesOutRestamped: number;
    periodDraftSalesRestamped: number;
    lockedOrFinalSalesSkipped: number;
    salesInvoicesGlSynced: number;
    productionBatchesRecosted: number;
    productionJournalsVoided: number;
    productionGlSynced: number;
};

function parsePurchaseCogsCascade(data: unknown): PurchaseCogsCascadeSummary | undefined {
    let row: unknown = data;
    if (typeof row === "string") {
        try {
            row = JSON.parse(row);
        } catch {
            return undefined;
        }
    }
    if (!row || typeof row !== "object") return undefined;
    const cascade = (row as Record<string, unknown>).cogs_cascade;
    if (!cascade || typeof cascade !== "object") return undefined;
    const c = cascade as Record<string, unknown>;
    const num = (key: string) => Number(c[key] ?? 0) || 0;
    return {
        directPairsRestamped: num("direct_pairs_restamped"),
        salesOutRestamped: num("sales_out_restamped"),
        periodDraftSalesRestamped: num("period_draft_sales_restamped"),
        lockedOrFinalSalesSkipped: num("locked_or_final_sales_skipped"),
        salesInvoicesGlSynced: num("sales_invoices_gl_synced"),
        productionBatchesRecosted: num("production_batches_recosted"),
        productionJournalsVoided: num("production_journals_voided"),
        productionGlSynced: num("production_gl_synced"),
    };
}

function normalizePurchaseInvoicePayloadAmounts(doc: PurchaseInvoicePayload): PurchaseInvoicePayload {
    const items = doc.items.map((line) => {
        const rateStatus = line.rateStatus ?? "fixed";
        const netWeight = Number(line.netWeight ?? line.qty ?? 0);
        const rate = Number(line.rate ?? 0);
        return {
            ...line,
            amount: rateStatus === "pending" ? 0 : netWeight * rate,
        };
    });
    const subtotal = items.reduce(
        (sum, line) => (line.rateStatus === "pending" ? sum : sum + Number(line.amount ?? 0)),
        0,
    );
    const laborCost = Number(doc.totals?.laborCost ?? 0);
    const additionalCosts = Number(doc.totals?.additionalCosts ?? 0);
    return {
        ...doc,
        items,
        totals: {
            ...(doc.totals ?? {}),
            subtotal,
            laborCost,
            additionalCosts,
            netPayable: subtotal + laborCost + additionalCosts,
        },
    };
}

export async function createPurchaseInvoiceDocument(payload: unknown): Promise<Result<{ id: string }>> {
    const validated = validateDocumentPayload(purchaseInvoicePayloadSchema, payload);
    if (!validated.ok) return validated;
    const doc = normalizePurchaseInvoicePayloadAmounts(validated.data);
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const context = await resolvePostingContext();
    if (!context) return { ok: false, error: "No posting access found for your user. Verify your role access." };
    const canonicalWire8Code = await resolveCanonicalWire8CodeForPosting();
    const lineItemCodes = collectPurchaseLineItemCodes(doc.items, canonicalWire8Code);
    const [partyId, itemMap, warehouseId, purchaseOrderLineByItemId] = await Promise.all([
        getPartyIdByCode(doc.header.supplier),
        getItemIdsByCode(lineItemCodes),
        getWarehouseIdByType(doc.header.warehouse ?? "raw_material"),
        getPurchaseOrderLineLookup(doc.header?.linkedPOId),
    ]);
    if (!partyId) return { ok: false, error: "Supplier not found in ERP parties." };
    if (!warehouseId) return { ok: false, error: "Selected warehouse not found." };
    const wire8Check = await assertActiveWire8PostingTarget(itemMap, canonicalWire8Code, doc.items);
    if (!wire8Check.ok) return wire8Check;

    const { data: header, error: headerError } = await supabase
        .schema("erp")
        .from("purchase_invoices")
        .insert({
            invoice_no: doc.header.invoiceId,
            invoice_date: toDocDateISO(doc.header.date),
            party_id: partyId,
            currency_code: "PKR",
            purchase_mode: doc.header.purchaseMode ?? "cash",
            settlement_mode: doc.header.settlementMode || null,
            warehouse_id: warehouseId,
            subtotal_amount: Number(doc.totals?.subtotal ?? 0),
            additional_charges: Number(doc.totals?.additionalCosts ?? 0) + Number(doc.totals?.laborCost ?? 0),
            grand_total: Number(doc.totals?.netPayable ?? 0),
            remarks: doc.header.remarks || null,
        })
        .select("id")
        .single();

    if (headerError || !header) {
        if (headerError?.code === "23505" && doc.header?.invoiceId) {
            const existingId = await findDraftDocumentId("purchase_invoices", doc.header.invoiceId);
            if (existingId) return updatePurchaseInvoiceDocument(existingId, doc);
        }
        return { ok: false, error: formatDbError(headerError, "Failed to create purchase invoice.") };
    }

    const lines = doc.items
        .filter((l) => (l.itemCode ?? l.item) && Number(l.netWeight) > 0)
        .map((line, idx) =>
            buildPurchaseInvoiceLineRow(
                line,
                idx,
                header.id,
                itemMap,
                warehouseId,
                purchaseOrderLineByItemId,
                canonicalWire8Code,
            ),
        )
        .filter((line) => Boolean(line.item_id));

    const lineValidation = validatePurchaseInvoiceLinesPersisted(doc.items, lines, canonicalWire8Code);
    if (!lineValidation.ok) return lineValidation;

    if (lines.length) {
        const { error: lineError } = await supabase.schema("erp").from("purchase_invoice_lines").insert(lines);
        if (lineError) return { ok: false, error: formatDbError(lineError, "Failed to create purchase invoice lines.") };
    }
    return { ok: true, data: { id: header.id } };
}

export async function fetchPurchaseInvoicesDocsPage(
    options: DocListPageOpts = {},
): Promise<Result<PaginatedRows<PurchaseInvoiceListRow>>> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: true, data: { rows: [], total: 0, hasMore: false } };
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? ERP_DOC_LIST_PAGE_SIZE;
    const term = options.search?.trim();
    const select = "id,invoice_no,invoice_date,grand_total,posting_status,financial_status,parties(code,name)";
    if (term) {
        return fetchInvoiceListSearchPage<PurchaseInvoiceListRow>({
            table: "purchase_invoices",
            term,
            select,
            errorLabel: "Failed to search purchase invoices.",
        });
    }
    let query = supabase
        .schema("erp")
        .from("purchase_invoices")
        .select(select, { count: "exact" })
        .order("created_at", { ascending: false });
    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return { ok: false, error: formatDbError(error, "Failed to load purchase invoices.") };
    const total = count ?? 0;
    return {
        ok: true,
        data: {
            rows: asRows<PurchaseInvoiceListRow>(data),
            total,
            hasMore: offset + (data?.length ?? 0) < total,
        },
    };
}


export async function fetchPurchaseInvoicesDocsResult(): Promise<Result<PurchaseInvoiceListRow[]>> {
    const page = await fetchPurchaseInvoicesDocsPage({ offset: 0, limit: 100 });
    if (!page.ok) return page;
    return { ok: true, data: page.data.rows };
}


export async function fetchPurchaseInvoicesDocs(): Promise<PurchaseInvoiceListRow[]> {
    const result = await fetchPurchaseInvoicesDocsResult();
    return result.ok ? result.data : [];
}


export async function savePremiumScrapForInvoice(
    purchaseInvoiceId: string,
    premiumAllocation: { segments: Array<{
        lineKey: string;
        scrapLotId: string;
        allocatedKg: number;
        scrapRate: number;
        wattaRate: number;
        derivedUnitRate: number;
        isMazdooriPending?: boolean;
    }> } | null | undefined,
): Promise<Result<true>> {
    if (!premiumAllocation?.segments?.length) {
        return savePremiumScrapAllocations(purchaseInvoiceId, []);
    }
    const allocLines: ScrapAllocationLine[] = premiumAllocation.segments.map((s, idx) => ({
        purchaseInvoiceLineId: s.lineKey,
        lineSeq: idx + 1,
        scrapLotId: s.scrapLotId,
        allocatedKg: s.allocatedKg,
        scrapRate: s.scrapRate,
        wattaRate: s.wattaRate,
        derivedUnitRate: s.derivedUnitRate,
        isMazdooriPending: s.isMazdooriPending ?? false,
    }));
    return savePremiumScrapAllocations(purchaseInvoiceId, allocLines);
}


export async function fetchPurchaseOrders(): Promise<PurchaseOrderRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data } = await supabase
        .schema("erp")
        .from("purchase_orders")
        .select(
            "id,order_no,order_date,expected_date,status,total_ordered_qty,total_received_qty,parties(code,name),purchase_order_lines(id,line_no,qty_ordered,qty_received,unit_price,items(code,name))"
        )
        .order("created_at", { ascending: false })
        .limit(100);
    return asRows<PurchaseOrderRow>(data);
}

export async function createPurchaseOrderDocument(payload: {
    orderNo: string;
    partyCode: string;
    expectedDate?: string;
    warehouseType?: string;
    lines: Array<{ itemCode: string; qty: number; unitPrice?: number }>;
    remarks?: string;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const partyId = await getPartyIdByCode(payload.partyCode);
    if (!partyId) return { ok: false, error: "Supplier not found." };
    const itemMap = await getItemIdsByCode(payload.lines.map((l) => l.itemCode));
    const warehouseId = await getWarehouseIdByType(payload.warehouseType ?? "raw_material");
    const totalQty = payload.lines.reduce((s, l) => s + l.qty, 0);

    const { data: header, error } = await supabase
        .schema("erp")
        .from("purchase_orders")
        .insert({
            order_no: payload.orderNo,
            party_id: partyId,
            expected_date: payload.expectedDate ?? null,
            warehouse_id: warehouseId,
            total_ordered_qty: totalQty,
            remarks: payload.remarks ?? null,
        })
        .select("id")
        .single();
    if (error || !header) return { ok: false, error: formatDbError(error, "Failed to create purchase order.") };

    const lines = payload.lines
        .filter((l) => itemMap[l.itemCode])
        .map((l, idx) => ({
            purchase_order_id: header.id,
            line_no: idx + 1,
            item_id: itemMap[l.itemCode],
            qty_ordered: l.qty,
            unit_price: l.unitPrice ?? null,
        }));
    if (lines.length) {
        const { error: lineErr } = await supabase.schema("erp").from("purchase_order_lines").insert(lines);
        if (lineErr) return { ok: false, error: formatDbError(lineErr, "Failed to create PO lines.") };
    }
    return { ok: true, data: { id: header.id } };
}


export async function closePurchaseOrder(orderId: string): Promise<void> {
    if (!isSupabaseConfigured() || !hasErpContext()) return;
    await supabase.schema("erp").from("purchase_orders").update({ status: "closed" }).eq("id", orderId);
}


export async function cancelPurchaseOrder(orderId: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("purchase_orders")
        .select("id,status,total_received_qty")
        .eq("id", orderId)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Purchase order not found.") };
    if (existing.status === "closed" || existing.status === "cancelled") {
        return { ok: false, error: "Order is already closed or cancelled." };
    }
    const { error } = await supabase.schema("erp").from("purchase_orders").update({ status: "cancelled" }).eq("id", orderId);
    if (error) return { ok: false, error: formatDbError(error, "Failed to cancel purchase order.") };
    return { ok: true, data: { id: orderId } };
}


export async function deletePurchaseOrderDocument(orderId: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("purchase_orders")
        .select("id,total_received_qty")
        .eq("id", orderId)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Purchase order not found.") };
    if (Number(existing.total_received_qty ?? 0) > 0) {
        return { ok: false, error: "Cannot delete an order with received quantity. Cancel it instead." };
    }
    const { error: deleteErr } = await supabase.schema("erp").from("purchase_orders").delete().eq("id", orderId);
    if (deleteErr) return { ok: false, error: formatDbError(deleteErr, "Failed to delete purchase order.") };
    return { ok: true, data: { id: orderId } };
}


export async function fetchPurchaseOrderById(orderId: string): Promise<any | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data } = await supabase
        .schema("erp")
        .from("purchase_orders")
        .select(
            "id,order_no,order_date,expected_date,status,total_ordered_qty,total_received_qty,remarks,parties(code,name),purchase_order_lines(id,line_no,qty_ordered,qty_received,unit_price,items(code,name))"
        )
        .eq("id", orderId)
        .maybeSingle();
    return data;
}


export async function updatePurchaseOrderDocument(
    orderId: string,
    payload: {
        expectedDate?: string;
        remarks?: string;
        lines: Array<{ lineId?: string; itemCode: string; qty: number; unitPrice?: number }>;
    }
): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("purchase_orders")
        .select("id,status,purchase_order_lines(id,item_id,qty_ordered,qty_received,items(code))")
        .eq("id", orderId)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Purchase order not found.") };
    if (existing.status === "closed" || existing.status === "cancelled") {
        return { ok: false, error: "Cannot edit a closed or cancelled purchase order." };
    }

    const itemMap = await getItemIdsByCode(payload.lines.map((l) => l.itemCode));
    const existingById = new Map(
        asRows<{ id: string; qty_received?: number; items?: { code: string } | null }>(existing.purchase_order_lines).map((l) => [l.id, l]),
    );
    const keptLineIds = new Set<string>();

    for (const line of payload.lines) {
        if (!itemMap[line.itemCode]) continue;
        if (line.lineId && existingById.has(line.lineId)) {
            const prev = existingById.get(line.lineId)!;
            const received = Number(prev.qty_received ?? 0);
            if (prev.items?.code && prev.items.code !== line.itemCode) {
                return { ok: false, error: `Cannot change item on line already received (${prev.items.code}).` };
            }
            if (line.qty < received) {
                return {
                    ok: false,
                    error: `Qty for ${line.itemCode} cannot be below received qty (${received}).`,
                };
            }
            const { error } = await supabase
                .schema("erp")
                .from("purchase_order_lines")
                .update({ qty_ordered: line.qty, unit_price: line.unitPrice ?? null })
                .eq("id", line.lineId);
            if (error) return { ok: false, error: formatDbError(error, "Failed to update PO line.") };
            keptLineIds.add(line.lineId);
        } else {
            const { error } = await supabase.schema("erp").from("purchase_order_lines").insert({
                purchase_order_id: orderId,
                line_no: payload.lines.indexOf(line) + 1,
                item_id: itemMap[line.itemCode],
                qty_ordered: line.qty,
                unit_price: line.unitPrice ?? null,
            });
            if (error) return { ok: false, error: formatDbError(error, "Failed to add PO line.") };
        }
    }

    for (const [lineId, prev] of existingById) {
        if (keptLineIds.has(lineId)) continue;
        if (Number(prev.qty_received ?? 0) > 0) {
            return { ok: false, error: "Cannot remove a PO line that has been received." };
        }
        await supabase.schema("erp").from("purchase_order_lines").delete().eq("id", lineId);
    }

    const totalQty = payload.lines.reduce((s, l) => s + l.qty, 0);
    const { error: hdrErr } = await supabase
        .schema("erp")
        .from("purchase_orders")
        .update({
            expected_date: payload.expectedDate ?? null,
            remarks: payload.remarks ?? null,
            total_ordered_qty: totalQty,
        })
        .eq("id", orderId);
    if (hdrErr) return { ok: false, error: formatDbError(hdrErr, "Failed to update purchase order.") };
    return { ok: true, data: { id: orderId } };
}


export async function fetchPurchaseInvoiceDocument(id: string): Promise<PurchaseInvoiceDocumentRow | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data } = await supabase
        .schema("erp")
        .from("purchase_invoices")
        .select(
            "id,invoice_no,invoice_date,purchase_mode,settlement_mode,warehouse_id,subtotal_amount,additional_charges,grand_total,remarks,posting_status,financial_status,parties(code,name),warehouses(wh_type),purchase_invoice_lines(id,line_no,gross_weight,tare_weight,net_weight,unit_count,unit_price,line_amount,rate_status,wire8_grade,purchase_order_line_id,items(code,name),purchase_order_lines(qty_ordered,qty_received,unit_price,purchase_orders(order_no)))"
        )
        .eq("id", id)
        .maybeSingle();
    return asRowOrNull<PurchaseInvoiceDocumentRow>(data);
}

async function replacePurchaseInvoiceLines(
    invoiceId: string,
    payload: PurchaseInvoicePayload,
    itemMap: Record<string, string>,
    warehouseId: string,
    purchaseOrderLineByItemId: Map<string, string>,
    canonicalWire8Code: string,
): Promise<Result<true>> {
    await supabase.schema("erp").from("purchase_invoice_lines").delete().eq("purchase_invoice_id", invoiceId);

    const lines = payload.items
        .filter((l) => (l.itemCode ?? l.item) && Number(l.netWeight) > 0)
        .map((line, idx) =>
            buildPurchaseInvoiceLineRow(
                line,
                idx,
                invoiceId,
                itemMap,
                warehouseId,
                purchaseOrderLineByItemId,
                canonicalWire8Code,
            ),
        )
        .filter((line) => Boolean(line.item_id));

    const lineValidation = validatePurchaseInvoiceLinesPersisted(payload.items, lines, canonicalWire8Code);
    if (!lineValidation.ok) return lineValidation;

    if (lines.length) {
        const { error: lineError } = await supabase.schema("erp").from("purchase_invoice_lines").insert(lines);
        if (lineError) return { ok: false, error: formatDbError(lineError, "Failed to save purchase invoice lines.") };
    }
    return { ok: true, data: true };
}

async function syncPostedPurchaseInvoiceDates(invoiceId: string, invoiceDate: string): Promise<Result<true>> {
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: true, data: true };
    const { data, error } = await supabase.schema("erp").rpc("sync_posted_purchase_invoice_dates", {
        p_invoice_id: invoiceId,
        p_invoice_date: invoiceDate,
    });
    if (error) return { ok: false, error: formatDbError(error, "Failed to sync posted purchase invoice dates.") };
    const payload = data as { ok?: boolean; error?: string } | null;
    if (payload?.ok === false) {
        return { ok: false, error: payload.error ?? "Failed to sync posted purchase invoice dates." };
    }
    return { ok: true, data: true };
}

export async function updatePurchaseInvoiceDocument(
    id: string,
    payload: unknown,
): Promise<Result<{ id: string; cogsCascade?: PurchaseCogsCascadeSummary }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const validated = validateDocumentPayload(purchaseInvoicePayloadSchema, payload);
    if (!validated.ok) return validated;
    const doc = normalizePurchaseInvoicePayloadAmounts(validated.data);

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("purchase_invoices")
        .select("id,posting_status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Purchase invoice not found.") };
    // Posted invoices are updated in place, then inventory/GL are replayed via
    // erp.repost_purchase_invoice so material + financial ledgers stay aligned.

    const canonicalWire8Code = await resolveCanonicalWire8CodeForPosting();
    const lineItemCodes = collectPurchaseLineItemCodes(doc.items, canonicalWire8Code);
    const [partyId, itemMap, warehouseId, purchaseOrderLineByItemId] = await Promise.all([
        getPartyIdByCode(doc.header.supplier),
        getItemIdsByCode(lineItemCodes),
        getWarehouseIdByType(doc.header.warehouse ?? "raw_material"),
        getPurchaseOrderLineLookup(doc.header.linkedPOId),
    ]);
    if (!partyId) return { ok: false, error: "Supplier not found in ERP parties." };
    if (!warehouseId) return { ok: false, error: "Selected warehouse not found." };
    const wire8Check = await assertActiveWire8PostingTarget(itemMap, canonicalWire8Code, doc.items);
    if (!wire8Check.ok) return wire8Check;

    const invoiceDate = toDocDateISO(doc.header.date);

    const { error: headerError } = await supabase
        .schema("erp")
        .from("purchase_invoices")
        .update({
            invoice_date: invoiceDate,
            party_id: partyId,
            purchase_mode: doc.header.purchaseMode ?? "cash",
            settlement_mode: doc.header.settlementMode || null,
            warehouse_id: warehouseId,
            subtotal_amount: Number(doc.totals?.subtotal ?? 0),
            additional_charges: Number(doc.totals?.additionalCosts ?? 0) + Number(doc.totals?.laborCost ?? 0),
            grand_total: Number(doc.totals?.netPayable ?? 0),
            remarks: doc.header.remarks || null,
        })
        .eq("id", id);
    if (headerError) return { ok: false, error: formatDbError(headerError, "Failed to update purchase invoice.") };

    if (existing.posting_status === "posted") {
        const syncResult = await syncPostedPurchaseInvoiceDates(id, invoiceDate);
        if (!syncResult.ok) return syncResult;
    }

    const lineResult = await replacePurchaseInvoiceLines(
        id,
        doc,
        itemMap,
        warehouseId,
        purchaseOrderLineByItemId,
        canonicalWire8Code,
    );
    if (!lineResult.ok) return lineResult;

    if (existing.posting_status === "posted") {
        const repost = await runErpRpc<unknown>("repost purchase invoice", "repost_purchase_invoice", {
            p_doc_id: id,
        });
        if (!repost.ok) return { ok: false, error: repost.error };
        const parsed = parseRpcJsonResult(repost.data);
        if (!parsed.ok) {
            return { ok: false, error: parsed.error ?? "Failed to repost purchase invoice after edit." };
        }
        return { ok: true, data: { id, cogsCascade: parsePurchaseCogsCascade(repost.data) } };
    }

    return { ok: true, data: { id } };
}


export async function deletePurchaseInvoiceDocument(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("purchase_invoices")
        .select("id,posting_status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Purchase invoice not found.") };
    if (existing.posting_status === "posted") {
        return { ok: false, error: "Posted purchase invoices cannot be deleted." };
    }

    // Prefer guarded RPC so premium scrap allocations are reverted and lot balances
    // are recalculated when deleting draft premium invoices.
    const rpc = await tryInvoiceDeleteRpc("delete_purchase_invoice", id);
    if (rpc.ok) {
        const parsed = parseRpcJsonResult(rpc.data);
        if (!parsed.ok) return { ok: false, error: parsed.error ?? "Failed to delete purchase invoice." };
        return { ok: true, data: { id } };
    }

    const { error: deleteErr } = await supabase.schema("erp").from("purchase_invoices").delete().eq("id", id);
    if (deleteErr) return { ok: false, error: formatDbError(deleteErr, "Failed to delete purchase invoice.") };
    return { ok: true, data: { id } };
}


export async function adminHardDeletePurchaseInvoiceDocument(id: string): Promise<HardDeleteInvoiceResult> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: false, error: "ERP is not configured." };
    if (!id) return { ok: false, error: "Missing invoice id." };
    return rpcHardDeleteInvoice("hard_delete_purchase_invoice", "purchase_invoices", id, "hard delete purchase invoice");
}


export async function resolveCanonicalWire8ItemCode(): Promise<string> {
    return resolveCanonicalWire8CodeForPosting();
}
