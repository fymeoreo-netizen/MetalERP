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
} from "@/lib/domain/invoice/documentPayloads";
import { asRowOrNull, asRows } from "./contracts/shared";
import type {
    SalesInvoiceDocumentRow,
    SalesInvoiceListRow,
    SalesOrderByIdRow,
    SalesOrderRow,
} from "./contracts/salesInvoices";
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
    getSalesOrderLineLookup,
    resolveSalesOrderLineId,
    type HardDeleteInvoiceResult,
} from "./invoiceShared";
import { parseRpcJsonResult } from "./documentRpc";
import { hardDeleteInvoiceRpc, rebuildInventoryForItems, voidDocumentRpc } from "./documentLifecycle";
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

export async function createSalesInvoiceDocument(payload: unknown): Promise<Result<{ id: string }>> {
    const validated = validateDocumentPayload(salesInvoicePayloadSchema, payload);
    if (!validated.ok) return validated;
    const doc = validated.data as SalesInvoicePayload;
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const lineItemCodes = doc.items
        .map((l) => (l.itemCode ?? (l as { item?: string }).item ?? "").trim())
        .filter(Boolean);
    const [partyId, itemMap, salesOrderLineByItemId] = await Promise.all([
        getPartyIdByCode(doc.header.customerId),
        getItemIdsByCode(lineItemCodes),
        getSalesOrderLineLookup(doc.header?.linkedOrderId),
    ]);
    if (!partyId) return { ok: false, error: "Customer not found in ERP parties." };

    const linkCheck = validateLinkedOrderLineIdsForPersist(doc, itemMap, salesOrderLineByItemId);
    if (!linkCheck.ok) return linkCheck;

    const { data: header, error: headerError } = await supabase
        .schema("erp")
        .from("sales_invoices")
        .insert({
            invoice_no: doc.header.invoiceId,
            invoice_date: toDocDateISO(doc.header.date),
            party_id: partyId,
            currency_code: "PKR",
            sale_mode: doc.header.saleMode ?? "direct",
            ref_scrap_rate:
                doc.header.saleMode === "premium" && doc.header.refScrapRate != null
                    ? Number(doc.header.refScrapRate)
                    : null,
            vehicle_no: doc.header.vehicleNo || null,
            driver_name: doc.header.driverName || null,
            subtotal_amount: Number(doc.totals?.subtotal ?? 0),
            discount_amount: Number(doc.totals?.discount ?? 0),
            tax_amount: Number(doc.totals?.taxAmount ?? 0),
            grand_total: Number(doc.totals?.finalTotal ?? 0),
            remarks: doc.header.remarks || null,
        })
        .select("id")
        .maybeSingle();

    if (headerError) {
        if (headerError.code === "23505" && doc.header?.invoiceId) {
            const existingId = await findDraftDocumentId("sales_invoices", doc.header.invoiceId);
            if (existingId) return updateSalesInvoiceDocument(existingId, doc);
        }
        return { ok: false, error: formatDbError(headerError, "Failed to create sales invoice.") };
    }
    if (!header) {
        if (doc.header?.invoiceId) {
            const existingId = await findDraftDocumentId("sales_invoices", doc.header.invoiceId);
            if (existingId) return updateSalesInvoiceDocument(existingId, doc);
        }
        return { ok: false, error: "Sales invoice was saved but could not be read back. Sign out and sign in again." };
    }

    const whResult = await resolveWarehousesForItemCodes(itemMap, lineItemCodes);
    if (!whResult.ok) return whResult;
    const warehouseByItem = whResult.data;

    const lines = doc.items
        .map((line) => ({
            ...line,
            itemCode: (line.itemCode ?? (line as { item?: string }).item ?? "").trim(),
        }))
        .filter((l) => l.itemCode && Number(l.netWeight ?? l.qty ?? 0) > 0 && itemMap[l.itemCode])
        .map((line, idx: number) => {
            const itemId = itemMap[line.itemCode];
            const salesOrderLineId = resolveSalesOrderLineId(line, itemId, salesOrderLineByItemId);
            const gross = (line as { gross?: number }).gross;
            const tare = (line as { tare?: number }).tare;
            const netWeight = Number(line.netWeight ?? line.qty ?? 0);
            return {
                sales_invoice_id: header.id,
                line_no: idx + 1,
                item_id: itemId,
                warehouse_id: warehouseByItem[line.itemCode],
                qty: netWeight,
                uom_code: "KG",
                gross_weight: Number(gross || 0),
                tare_weight: Number(tare || 0),
                net_weight: netWeight,
                unit_count: Number((line as { unitCount?: number; quantity?: number }).unitCount ?? (line as { quantity?: number }).quantity ?? 0),
                watta_rate: doc.header.saleMode === "premium" ? Number(line.wattaRate ?? 0) : null,
                tax_rate: Number(doc.totals?.taxRate || 0),
                sales_order_line_id: salesOrderLineId,
                ...lineRateFields({ rateStatus: line.rateStatus, rate: line.rate, amount: line.amount }),
            };
        });

    if (!lines.length) {
        await supabase.schema("erp").from("sales_invoices").delete().eq("id", header.id);
        const missing = lineItemCodes.filter((code) => !itemMap[code]);
        if (missing.length) {
            return {
                ok: false,
                error: `Item(s) not found in ERP Item Master: ${missing.join(", ")}. Add them in Masters → Items.`,
            };
        }
        return { ok: false, error: "No billable lines could be saved. Check item codes and net weight." };
    }

    const { error: lineError } = await supabase.schema("erp").from("sales_invoice_lines").insert(lines);
    if (lineError) {
        await supabase.schema("erp").from("sales_invoices").delete().eq("id", header.id);
        return { ok: false, error: formatDbError(lineError, "Failed to create sales invoice lines.") };
    }

    if (doc.header.saleMode === "premium") {
        const kg = lines.reduce((s: number, l: { net_weight?: number }) => s + Number(l.net_weight ?? 0), 0);
        await supabase.schema("erp").from("sales_invoices").update({ premium_total_kg: kg }).eq("id", header.id);
    }

    return { ok: true, data: { id: header.id } };
}


export type OrderFulfillmentReconcileResult = {
    salesLinesAdjusted: number;
    salesLinesZeroed: number;
    purchaseLinesAdjusted: number;
    purchaseLinesZeroed: number;
    salesOrdersRecalced: number;
    purchaseOrdersRecalced: number;
    headerDriftsBefore: number;
};

/** Admin-only: recompute SO/PO line fulfillment from surviving posted invoices. */

export async function reconcileOrderFulfillment(): Promise<Result<OrderFulfillmentReconcileResult>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: false, error: "ERP is not configured." };
    }
    return runErpRpc("reconcile order fulfillment", "fn_reconcile_order_fulfillment", {}, (data) => {
        const row = (data ?? {}) as Record<string, unknown>;
        return {
            ok: true,
            data: {
                salesLinesAdjusted: Number(row.sales_lines_adjusted ?? 0),
                salesLinesZeroed: Number(row.sales_lines_zeroed ?? 0),
                purchaseLinesAdjusted: Number(row.purchase_lines_adjusted ?? 0),
                purchaseLinesZeroed: Number(row.purchase_lines_zeroed ?? 0),
                salesOrdersRecalced: Number(row.sales_orders_recalced ?? 0),
                purchaseOrdersRecalced: Number(row.purchase_orders_recalced ?? 0),
                headerDriftsBefore: Number(row.header_drifts_before ?? 0),
            },
        };
    }, "Failed to reconcile order fulfillment.");
}


export async function fetchSalesInvoicesDocsPage(
    options: DocListPageOpts = {},
): Promise<Result<PaginatedRows<SalesInvoiceListRow>>> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: true, data: { rows: [], total: 0, hasMore: false } };
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? ERP_DOC_LIST_PAGE_SIZE;
    const term = options.search?.trim();
    const select =
        "id,invoice_no,invoice_date,grand_total,subtotal_amount,discount_amount,tax_amount,posting_status,financial_status,parties(code,name)";
    if (term) {
        return fetchInvoiceListSearchPage<SalesInvoiceListRow>({
            table: "sales_invoices",
            term,
            select,
            errorLabel: "Failed to search sales invoices.",
        });
    }
    let query = supabase
        .schema("erp")
        .from("sales_invoices")
        .select(select, { count: "exact" })
        .order("created_at", { ascending: false });
    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return { ok: false, error: formatDbError(error, "Failed to load sales invoices.") };
    const total = count ?? 0;
    return {
        ok: true,
        data: {
            rows: asRows<SalesInvoiceListRow>(data),
            total,
            hasMore: offset + (data?.length ?? 0) < total,
        },
    };
}

/** First page (100 rows) — for legacy callers. Prefer `fetchSalesInvoicesDocsPage`. */

export async function fetchSalesInvoicesDocsResult(): Promise<Result<SalesInvoiceListRow[]>> {
    const page = await fetchSalesInvoicesDocsPage({ offset: 0, limit: 100 });
    if (!page.ok) return page;
    return { ok: true, data: page.data.rows };
}


export async function fetchSalesInvoicesDocs(): Promise<SalesInvoiceListRow[]> {
    const result = await fetchSalesInvoicesDocsResult();
    return result.ok ? result.data : [];
}


export async function fetchSalesOrders(): Promise<SalesOrderRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data } = await supabase
        .schema("erp")
        .from("sales_orders")
        .select(
            "id,order_no,order_date,delivery_date,status,total_ordered_qty,total_fulfilled_qty,parties(code,name),sales_order_lines(id,line_no,qty_ordered,qty_fulfilled,unit_price,items(code,name))"
        )
        .order("created_at", { ascending: false })
        .limit(100);
    return asRows<SalesOrderRow>(data);
}


export async function createSalesOrderDocument(payload: {
    orderNo: string;
    partyCode: string;
    deliveryDate?: string;
    lines: Array<{ itemCode: string; qty: number; unitPrice?: number }>;
    remarks?: string;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const partyId = await getPartyIdByCode(payload.partyCode);
    if (!partyId) return { ok: false, error: "Customer not found." };
    const itemMap = await getItemIdsByCode(payload.lines.map((l) => l.itemCode));
    const warehouseId = await getWarehouseIdByType("finished_goods");
    const totalQty = payload.lines.reduce((s, l) => s + l.qty, 0);

    const { data: header, error } = await supabase
        .schema("erp")
        .from("sales_orders")
        .insert({
            order_no: payload.orderNo,
            party_id: partyId,
            delivery_date: payload.deliveryDate ?? null,
            total_ordered_qty: totalQty,
            remarks: payload.remarks ?? null,
        })
        .select("id")
        .single();
    if (error || !header) return { ok: false, error: formatDbError(error, "Failed to create sales order.") };

    const lines = payload.lines
        .filter((l) => itemMap[l.itemCode])
        .map((l, idx) => ({
            sales_order_id: header.id,
            line_no: idx + 1,
            item_id: itemMap[l.itemCode],
            warehouse_id: warehouseId,
            qty_ordered: l.qty,
            unit_price: l.unitPrice ?? null,
        }));
    if (lines.length) {
        const { error: lineErr } = await supabase.schema("erp").from("sales_order_lines").insert(lines);
        if (lineErr) return { ok: false, error: formatDbError(lineErr, "Failed to create sales order lines.") };
    }
    return { ok: true, data: { id: header.id } };
}


export async function closeSalesOrder(orderId: string): Promise<void> {
    if (!isSupabaseConfigured() || !hasErpContext()) return;
    await supabase.schema("erp").from("sales_orders").update({ status: "closed" }).eq("id", orderId);
}


export async function cancelSalesOrder(orderId: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("sales_orders")
        .select("id,status,total_fulfilled_qty")
        .eq("id", orderId)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Sales order not found.") };
    if (existing.status === "closed" || existing.status === "cancelled") {
        return { ok: false, error: "Order is already closed or cancelled." };
    }
    const { error } = await supabase.schema("erp").from("sales_orders").update({ status: "cancelled" }).eq("id", orderId);
    if (error) return { ok: false, error: formatDbError(error, "Failed to cancel sales order.") };
    return { ok: true, data: { id: orderId } };
}


export async function deleteSalesOrderDocument(orderId: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("sales_orders")
        .select("id,total_fulfilled_qty")
        .eq("id", orderId)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Sales order not found.") };
    if (Number(existing.total_fulfilled_qty ?? 0) > 0) {
        return { ok: false, error: "Cannot delete an order with fulfilled quantity. Cancel it instead." };
    }
    const { error: deleteErr } = await supabase.schema("erp").from("sales_orders").delete().eq("id", orderId);
    if (deleteErr) return { ok: false, error: formatDbError(deleteErr, "Failed to delete sales order.") };
    return { ok: true, data: { id: orderId } };
}


export async function fetchSalesOrderById(orderId: string): Promise<SalesOrderByIdRow | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data } = await supabase
        .schema("erp")
        .from("sales_orders")
        .select(
            "id,order_no,order_date,delivery_date,status,total_ordered_qty,total_fulfilled_qty,remarks,parties(code,name),sales_order_lines(id,line_no,qty_ordered,qty_fulfilled,unit_price,items(code,name))"
        )
        .eq("id", orderId)
        .maybeSingle();
    return asRowOrNull<SalesOrderByIdRow>(data);
}


export async function updateSalesOrderDocument(
    orderId: string,
    payload: {
        deliveryDate?: string;
        remarks?: string;
        lines: Array<{ lineId?: string; itemCode: string; qty: number; unitPrice?: number }>;
    }
): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("sales_orders")
        .select("id,status,sales_order_lines(id,item_id,qty_ordered,qty_fulfilled,items(code))")
        .eq("id", orderId)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Sales order not found.") };
    if (existing.status === "closed" || existing.status === "cancelled") {
        return { ok: false, error: "Cannot edit a closed or cancelled sales order." };
    }

    const itemMap = await getItemIdsByCode(payload.lines.map((l) => l.itemCode));
    const warehouseId = await getWarehouseIdByType("finished_goods");
    const existingById = new Map(
        asRows<{ id: string; qty_fulfilled?: number; items?: { code: string } | null }>(existing.sales_order_lines).map((l) => [l.id, l]),
    );
    const keptLineIds = new Set<string>();

    for (const line of payload.lines) {
        if (!itemMap[line.itemCode]) continue;
        if (line.lineId && existingById.has(line.lineId)) {
            const prev = existingById.get(line.lineId)!;
            const fulfilled = Number(prev.qty_fulfilled ?? 0);
            if (prev.items?.code && prev.items.code !== line.itemCode) {
                return { ok: false, error: `Cannot change item on line already fulfilled (${prev.items.code}).` };
            }
            if (line.qty < fulfilled) {
                return {
                    ok: false,
                    error: `Qty for ${line.itemCode} cannot be below fulfilled qty (${fulfilled}).`,
                };
            }
            const { error } = await supabase
                .schema("erp")
                .from("sales_order_lines")
                .update({ qty_ordered: line.qty, unit_price: line.unitPrice ?? null })
                .eq("id", line.lineId);
            if (error) return { ok: false, error: formatDbError(error, "Failed to update sales order line.") };
            keptLineIds.add(line.lineId);
        } else {
            const { error } = await supabase.schema("erp").from("sales_order_lines").insert({
                sales_order_id: orderId,
                line_no: payload.lines.indexOf(line) + 1,
                item_id: itemMap[line.itemCode],
                warehouse_id: warehouseId,
                qty_ordered: line.qty,
                unit_price: line.unitPrice ?? null,
            });
            if (error) return { ok: false, error: formatDbError(error, "Failed to add sales order line.") };
        }
    }

    for (const [lineId, prev] of existingById) {
        if (keptLineIds.has(lineId)) continue;
        if (Number(prev.qty_fulfilled ?? 0) > 0) {
            return { ok: false, error: "Cannot remove a sales order line that has been fulfilled." };
        }
        await supabase.schema("erp").from("sales_order_lines").delete().eq("id", lineId);
    }

    const totalQty = payload.lines.reduce((s, l) => s + l.qty, 0);
    const { error: hdrErr } = await supabase
        .schema("erp")
        .from("sales_orders")
        .update({
            delivery_date: payload.deliveryDate ?? null,
            remarks: payload.remarks ?? null,
            total_ordered_qty: totalQty,
        })
        .eq("id", orderId);
    if (hdrErr) return { ok: false, error: formatDbError(hdrErr, "Failed to update sales order.") };
    return { ok: true, data: { id: orderId } };
}


export async function fetchSalesInvoiceDocument(id: string): Promise<SalesInvoiceDocumentRow | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data } = await supabase
        .schema("erp")
        .from("sales_invoices")
        .select(
            "id,invoice_no,invoice_date,sale_mode,ref_scrap_rate,premium_total_kg,vehicle_no,driver_name,subtotal_amount,discount_amount,tax_amount,grand_total,remarks,posting_status,financial_status,parties(code,name),sales_invoice_lines(id,line_no,gross_weight,tare_weight,net_weight,unit_count,unit_price,watta_rate,line_amount,tax_rate,rate_status,sales_order_line_id,items(code,name,size_spec),sales_order_lines(qty_ordered,qty_fulfilled,unit_price,sales_orders(order_no)))"
        )
        .eq("id", id)
        .maybeSingle();
    return asRowOrNull<SalesInvoiceDocumentRow>(data);
}

async function replaceSalesInvoiceLines(
    invoiceId: string,
    payload: SalesInvoicePayload,
    itemMap: Record<string, string>,
    warehouseByItem: Record<string, string>,
    salesOrderLineByItemId: Map<string, string>
): Promise<Result<true>> {
    const normalized = (payload.items ?? []).map((line) => ({
        ...line,
        itemCode: (line.itemCode ?? line.item ?? "").trim(),
    }));
    const lines = normalized
        .filter((l) =>
            l.itemCode && Number(l.netWeight ?? l.qty ?? 0) > 0 && itemMap[l.itemCode],
        )
        .map((line, idx) => {
            const itemCode = line.itemCode ?? "";
            const itemId = itemMap[itemCode];
            const salesOrderLineId = resolveSalesOrderLineId(line, itemId, salesOrderLineByItemId);
            const netWeight = Number(line.netWeight ?? line.qty ?? 0);
            const lineExtra = line as Record<string, unknown>;
            return {
                sales_invoice_id: invoiceId,
                line_no: idx + 1,
                item_id: itemId,
                warehouse_id: warehouseByItem[itemCode],
                qty: netWeight,
                uom_code: "KG",
                gross_weight: Number(line.gross || 0),
                tare_weight: Number(line.tare || 0),
                net_weight: netWeight,
                unit_count: Number(lineExtra.unitCount ?? lineExtra.quantity ?? 0),
                watta_rate: payload.header.saleMode === "premium" ? Number(line.wattaRate ?? 0) : null,
                tax_rate: Number(payload.totals?.taxRate || 0),
                sales_order_line_id: salesOrderLineId,
                ...lineRateFields({ rateStatus: line.rateStatus, rate: line.rate, amount: line.amount }),
            };
        });

    if (!lines.length) {
        const missing = normalized
            .map((l) => l.itemCode)
            .filter((code) => code && !itemMap[code]);
        if (missing.length) {
            return {
                ok: false,
                error: `Item(s) not found in ERP Item Master: ${missing.join(", ")}. Add them in Masters → Items.`,
            };
        }
        return { ok: false, error: "No billable lines could be saved. Check item codes and net weight." };
    }

    await supabase.schema("erp").from("sales_invoice_lines").delete().eq("sales_invoice_id", invoiceId);

    const { error: lineError } = await supabase.schema("erp").from("sales_invoice_lines").insert(lines);
    if (lineError) return { ok: false, error: formatDbError(lineError, "Failed to save sales invoice lines.") };
    return { ok: true, data: true };
}

async function syncPostedSalesInvoiceDates(invoiceId: string, invoiceDate: string): Promise<Result<true>> {
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: true, data: true };
    const { data, error } = await supabase.schema("erp").rpc("sync_posted_sales_invoice_dates", {
        p_invoice_id: invoiceId,
        p_invoice_date: invoiceDate,
    });
    if (error) return { ok: false, error: formatDbError(error, "Failed to sync posted sales invoice dates.") };
    const payload = data as { ok?: boolean; error?: string } | null;
    if (payload?.ok === false) {
        return { ok: false, error: payload.error ?? "Failed to sync posted sales invoice dates." };
    }
    return { ok: true, data: true };
}

export async function updateSalesInvoiceDocument(id: string, payload: unknown): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const validated = validateDocumentPayload(salesInvoicePayloadSchema, payload);
    if (!validated.ok) return validated;
    const doc = validated.data;

    const lineItemCodes = doc.items
        .map((l) => (l.itemCode ?? l.item ?? "").trim())
        .filter(Boolean);
    const [partyId, itemMap, salesOrderLineByItemId] = await Promise.all([
        getPartyIdByCode(doc.header.customerId),
        getItemIdsByCode(lineItemCodes),
        getSalesOrderLineLookup(doc.header.linkedOrderId),
    ]);

    const linkCheck = validateLinkedOrderLineIdsForPersist(doc, itemMap, salesOrderLineByItemId);
    if (!linkCheck.ok) return linkCheck;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("sales_invoices")
        .select("id,posting_status")
        .eq("id", id)
        .maybeSingle();
    if (fetchErr) return { ok: false, error: formatDbError(fetchErr, "Sales invoice not found.") };
    if (!existing) return { ok: false, error: "Sales invoice not found." };
    // Posted invoices are updated in place, then inventory/GL are replayed via
    // erp.repost_sales_invoice so material + financial ledgers stay aligned.

    if (!partyId) return { ok: false, error: "Customer not found in ERP parties." };
    const whResult = await resolveWarehousesForItemCodes(itemMap, lineItemCodes);
    if (!whResult.ok) return whResult;
    const warehouseByItem = whResult.data;

    const invoiceDate = toDocDateISO(doc.header.date);

    const { error: headerError } = await supabase
        .schema("erp")
        .from("sales_invoices")
        .update({
            invoice_date: invoiceDate,
            party_id: partyId,
            sale_mode: doc.header.saleMode ?? "direct",
            ref_scrap_rate:
                doc.header.saleMode === "premium" && doc.header.refScrapRate != null
                    ? Number(doc.header.refScrapRate)
                    : null,
            vehicle_no: doc.header.vehicleNo || null,
            driver_name: doc.header.driverName || null,
            subtotal_amount: Number(doc.totals?.subtotal ?? 0),
            discount_amount: Number(doc.totals?.discount ?? 0),
            tax_amount: Number(doc.totals?.taxAmount ?? 0),
            grand_total: Number(doc.totals?.finalTotal ?? 0),
            remarks: doc.header.remarks || null,
        })
        .eq("id", id);
    if (headerError) return { ok: false, error: formatDbError(headerError, "Failed to update sales invoice.") };

    if (existing.posting_status === "posted") {
        const syncResult = await syncPostedSalesInvoiceDates(id, invoiceDate);
        if (!syncResult.ok) return syncResult;
    }

    const lineResult = await replaceSalesInvoiceLines(id, doc, itemMap, warehouseByItem, salesOrderLineByItemId);
    if (!lineResult.ok) return lineResult;
    if (doc.header.saleMode === "premium") {
        const kg = doc.items.reduce((s: number, l: { netWeight?: number }) => s + Number(l.netWeight ?? 0), 0);
        await supabase.schema("erp").from("sales_invoices").update({ premium_total_kg: kg }).eq("id", id);
    }

    if (existing.posting_status === "posted") {
        const repost = await runErpRpc<unknown>("repost sales invoice", "repost_sales_invoice", {
            p_doc_id: id,
        });
        if (!repost.ok) return { ok: false, error: repost.error };
        const parsed = parseRpcJsonResult(repost.data);
        if (!parsed.ok) {
            return { ok: false, error: parsed.error ?? "Failed to repost sales invoice after edit." };
        }
    }

    return { ok: true, data: { id } };
}

export async function deleteSalesInvoiceDocument(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("sales_invoices")
        .select("id,posting_status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Sales invoice not found.") };
    if (existing.posting_status === "posted") {
        return { ok: false, error: "Posted sales invoices cannot be deleted." };
    }

    const { error: deleteErr } = await supabase.schema("erp").from("sales_invoices").delete().eq("id", id);
    if (deleteErr) return { ok: false, error: formatDbError(deleteErr, "Failed to delete sales invoice.") };
    return { ok: true, data: { id } };
}


export async function voidSalesInvoiceDocument(id: string, reason?: string): Promise<Result<{ returnId: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: false, error: "ERP is not configured." };
    return voidDocumentRpc("void_sales_invoice", id, reason, "void sales invoice");
}

function validateLinkedOrderLineIdsForPersist(
    payload: SalesInvoicePayload | null | undefined,
    itemMap: Record<string, string> = {},
    salesOrderLineByItemId: Map<string, string> = new Map(),
): Result<true> {
    const linkedOrderId = payload?.header?.linkedOrderId;
    if (!linkedOrderId) return { ok: true, data: true };
    const billable = (payload.items ?? []).filter((l: { itemCode?: string; item?: string; netWeight?: number; qty?: number }) => {
        const code = (l.itemCode ?? l.item ?? "").trim();
        return code && Number(l.netWeight ?? l.qty ?? 0) > 0;
    });
    for (const line of billable) {
        const code = (line.itemCode ?? line.item ?? "Line").trim();
        const itemId = itemMap[code];
        const orderLineId =
            resolveSalesOrderLineId(line, itemId, salesOrderLineByItemId);
        if (!orderLineId) {
            return {
                ok: false,
                error: `${code}: not linked to order ${linkedOrderId}. Use "Pull from order" and save before posting.`,
            };
        }
    }
    return { ok: true, data: true };
}

/** Block post when invoice lines reference an SO in the join but lack sales_order_line_id FK. */

export async function validateSalesInvoiceOrderLinksBeforePost(invoiceId: string): Promise<Result<true>> {
    const doc = await fetchSalesInvoiceDocument(invoiceId);
    if (!doc) return { ok: false, error: "Sales invoice not found." };
    const lines = (doc.sales_invoice_lines ?? []) as Array<{
        net_weight?: number;
        sales_order_line_id?: string | null;
        items?: { code?: string };
        sales_order_lines?: { sales_orders?: { order_no?: string } };
    }>;
    const billable = lines.filter((l) => Number(l.net_weight ?? 0) > 0);
    const orderNo = billable.find((l) => l.sales_order_lines?.sales_orders?.order_no)?.sales_order_lines
        ?.sales_orders?.order_no;
    if (!orderNo) return { ok: true, data: true };
    for (const line of billable) {
        if (!line.sales_order_line_id) {
            const code = line.items?.code ?? "Line";
            return {
                ok: false,
                error: `${code}: missing order line link for ${orderNo}. Re-open the invoice, use Pull from order, save, then post.`,
            };
        }
    }
    return { ok: true, data: true };
}

/** Ensure draft invoice has billable stock lines in DB before calling post_sales_invoice. */

export async function verifySalesInvoiceReadyToPost(invoiceId: string): Promise<Result<true>> {
    const linkCheck = await validateSalesInvoiceOrderLinksBeforePost(invoiceId);
    if (!linkCheck.ok) return linkCheck;

    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: true, data: true };
    }

    const { data, error } = await supabase
        .schema("erp")
        .from("sales_invoice_lines")
        .select("item_id, net_weight, qty, warehouse_id")
        .eq("sales_invoice_id", invoiceId);

    if (error) {
        return { ok: false, error: formatDbError(error, "Could not verify invoice lines before posting.") };
    }

    const stockLines = (data ?? []).filter(
        (row) => row.item_id && Number(row.net_weight ?? row.qty ?? 0) > 0,
    );
    if (stockLines.length === 0) {
        return {
            ok: false,
            error:
                "Sales invoice has no stock lines saved in the database. Add items with net weight, save the draft, then post again.",
        };
    }

    const missingWarehouse = stockLines.filter((row) => !row.warehouse_id);
    if (missingWarehouse.length > 0) {
        return {
            ok: false,
            error:
                "One or more lines are missing a warehouse. Re-save the invoice — if this persists, check Item Master warehouse mapping.",
        };
    }

    return { ok: true, data: true };
}

function coalesceSaleMode(mode: string | null | undefined): string {
    return mode?.trim() || "direct";
}


export async function probeInvoiceHardDeleteAvailable(): Promise<boolean> {
    // Always true now: client has a guaranteed cascade-delete fallback that uses RLS.
    return isSupabaseConfigured() && hasErpContext();
}

async function verifyInvoiceRemoved(
    table: "sales_invoices" | "purchase_invoices",
    id: string,
): Promise<Result<true>> {
    const { count, error } = await supabase
        .schema("erp")
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("id", id);
    if (error) return { ok: false, error: formatDbError(error, "Failed to verify invoice deletion.") };
    if ((count ?? 0) > 0) {
        return { ok: false, error: "Delete reported success but invoice still exists in database." };
    }
    return { ok: true, data: true };
}

async function clientCascadeDeleteInvoice(
    table: "sales_invoices" | "purchase_invoices",
    id: string,
): Promise<Result<true>> {
    const isSales = table === "sales_invoices";
    const docType = isSales ? "sales_invoice" : "purchase_invoice";
    const returnTable = isSales ? "sales_returns" : "purchase_returns";
    const returnDocType = isSales ? "sales_return" : "purchase_return";
    const ledgerTable = isSales ? "ar_documents" : "ap_documents";
    const allocationField = isSales ? "ar_document_id" : "ap_document_id";

    // 1) Block delete if invoice has payment allocations.
    const { data: paidDocs, error: paidErr } = await supabase
        .schema("erp")
        .from(ledgerTable)
        .select("id")
        .eq("source_doc_type", docType)
        .eq("source_doc_id", id);
    if (paidErr) return { ok: false, error: formatDbError(paidErr, "Failed to check invoice payments.") };
    const ledgerDocIds = asRows<{ id: string }>(paidDocs).map((r) => r.id);
    if (ledgerDocIds.length > 0) {
        const { count: allocCount } = await supabase
            .schema("erp")
            .from("payment_allocations")
            .select("id", { count: "exact", head: true })
            .in(allocationField, ledgerDocIds);
        if ((allocCount ?? 0) > 0) {
            return { ok: false, error: "Cannot delete: invoice has payment allocations." };
        }
    }

    // Capture affected item_ids from inventory_movements BEFORE deletion so we can
    // do a targeted inventory rebuild even if the global RPC fails.
    const affectedItemIds = new Set<string>();
    const collectAffectedItems = async (docTypeFilter: string, docIdFilter: string) => {
        const { data: rows } = await supabase
            .schema("erp")
            .from("inventory_movements")
            .select("item_id")
            .eq("source_doc_type", docTypeFilter)
            .eq("source_doc_id", docIdFilter);
        for (const r of asRows<{ item_id?: string | number }>(rows)) {
            if (r.item_id) affectedItemIds.add(String(r.item_id));
        }
    };
    await collectAffectedItems(docType, id);

    // 2) Find linked returns and clean each (returns first to avoid FK).
    const { data: linkedReturns } = await supabase
        .schema("erp")
        .from(returnTable)
        .select("id")
        .eq("ref_invoice_id", id);
    for (const ret of asRows<{ id: string }>(linkedReturns)) {
        const rid = ret.id;
        await collectAffectedItems(returnDocType, rid);
        const { data: retLedger } = await supabase
            .schema("erp")
            .from(ledgerTable)
            .select("id")
            .eq("source_doc_type", returnDocType)
            .eq("source_doc_id", rid);
        const retLedgerIds = asRows<{ id: string }>(retLedger).map((r) => r.id);
        if (retLedgerIds.length > 0) {
            const { count: allocCount } = await supabase
                .schema("erp")
                .from("payment_allocations")
                .select("id", { count: "exact", head: true })
                .in(allocationField, retLedgerIds);
            if ((allocCount ?? 0) > 0) {
                return { ok: false, error: "Cannot delete: linked return has payment allocations." };
            }
        }
        await supabase
            .schema("erp")
            .from("inventory_movements")
            .delete()
            .eq("source_doc_type", returnDocType)
            .eq("source_doc_id", rid);
        await supabase
            .schema("erp")
            .from(ledgerTable)
            .delete()
            .eq("source_doc_type", returnDocType)
            .eq("source_doc_id", rid);
        const { data: retJEs } = await supabase
            .schema("erp")
            .from("journal_entries")
            .select("id")
            .eq("source_doc_type", returnDocType)
            .eq("source_doc_id", rid);
        const retJeIds = asRows<{ id: string }>(retJEs).map((r) => r.id);
        if (retJeIds.length > 0) {
            await supabase.schema("erp").from("journal_lines").delete().in("journal_entry_id", retJeIds);
            await supabase.schema("erp").from("journal_entries").delete().in("id", retJeIds);
        }
        const { error: retDelErr } = await supabase.schema("erp").from(returnTable).delete().eq("id", rid);
        if (retDelErr) return { ok: false, error: formatDbError(retDelErr, "Failed to delete linked return.") };
    }

    // 3) Revert order fulfillment / receiving on the linked SO / PO.
    const lineTable = isSales ? "sales_invoice_lines" : "purchase_invoice_lines";
    const lineFk = isSales ? "sales_invoice_id" : "purchase_invoice_id";
    const orderLineFk = isSales ? "sales_order_line_id" : "purchase_order_line_id";
    const orderLineTable = isSales ? "sales_order_lines" : "purchase_order_lines";
    const orderLineQtyCol = isSales ? "qty_fulfilled" : "qty_received";
    const orderTable = isSales ? "sales_orders" : "purchase_orders";
    const orderFk = isSales ? "sales_order_id" : "purchase_order_id";
    const orderTotalCol = isSales ? "total_fulfilled_qty" : "total_received_qty";

    const { data: invLines } = await supabase
        .schema("erp")
        .from(lineTable)
        .select(`${orderLineFk},qty,net_weight`)
        .eq(lineFk, id);

    const orderLineDeltas = new Map<string, number>();
    for (const ln of asRows<Record<string, unknown>>(invLines)) {
        const lineOrderId = (ln[orderLineFk] as string | null | undefined) ?? null;
        if (!lineOrderId) continue;
        const qty = Number(ln.net_weight ?? ln.qty ?? 0);
        orderLineDeltas.set(lineOrderId, (orderLineDeltas.get(lineOrderId) ?? 0) + qty);
    }

    const affectedOrderIds = new Set<string>();
    if (orderLineDeltas.size > 0) {
        const orderLineIds = Array.from(orderLineDeltas.keys());
        const { data: orderLines } = await supabase
            .schema("erp")
            .from(orderLineTable)
            .select(`id,${orderFk},${orderLineQtyCol}`)
            .in("id", orderLineIds);

        for (const ol of asRows<Record<string, unknown>>(orderLines)) {
            const delta = orderLineDeltas.get(String(ol.id)) ?? 0;
            if (delta <= 0) continue;
            const current = Number(ol[orderLineQtyCol] ?? 0);
            const next = Math.max(0, current - delta);
            const { error: olErr } = await supabase
                .schema("erp")
                .from(orderLineTable)
                .update({ [orderLineQtyCol]: next })
                .eq("id", ol.id);
            if (olErr) {
                return { ok: false, error: formatDbError(olErr, "Failed to revert order line fulfillment.") };
            }
            if (ol[orderFk]) affectedOrderIds.add(String(ol[orderFk]));
        }
    }

    // 3b) Premium sales: scrap obligation blocks invoice delete (FK ON DELETE RESTRICT).
    if (isSales) {
        const { data: invHeader } = await supabase
            .schema("erp")
            .from("sales_invoices")
            .select("invoice_no")
            .eq("id", id)
            .maybeSingle();
        const invoiceNo = invHeader?.invoice_no ?? null;
        // Use separate equality queries (not a PostgREST .or() string) so the
        // invoice number can never inject extra filter clauses.
        const obligationIds = new Set<string>();
        const { data: byId } = await supabase
            .schema("erp")
            .from("scrap_receivable_obligations")
            .select("id")
            .eq("sales_invoice_id", id);
        for (const row of byId ?? []) obligationIds.add(String((row as { id: string }).id));
        if (invoiceNo) {
            const { data: byNo } = await supabase
                .schema("erp")
                .from("scrap_receivable_obligations")
                .select("id")
                .eq("sales_invoice_no", invoiceNo);
            for (const row of byNo ?? []) obligationIds.add(String((row as { id: string }).id));
        }
        const obligations = Array.from(obligationIds, (oid) => ({ id: oid }));
        for (const obl of obligations ?? []) {
            const obligationId = (obl as { id: string }).id;
            const { data: receipts } = await supabase
                .schema("erp")
                .from("scrap_receipts")
                .select("id")
                .eq("obligation_id", obligationId);
            for (const receipt of receipts ?? []) {
                const receiptId = (receipt as { id: string }).id;
                const hdResult = await runErpRpc<unknown>(
                    "delete premium scrap receipt",
                    "hard_delete_scrap_receipt",
                    { p_doc_id: receiptId },
                    undefined,
                    "Failed to delete premium scrap receipt linked to this invoice.",
                );
                if (!hdResult.ok) {
                    return { ok: false, error: hdResult.error };
                }
                const hdOk =
                    hdResult.data &&
                    typeof hdResult.data === "object" &&
                    (hdResult.data as { ok?: boolean }).ok === true;
                if (!hdOk) {
                    const { error: forceErr } = await supabase
                        .schema("erp")
                        .from("scrap_receipts")
                        .delete()
                        .eq("id", receiptId);
                    if (forceErr) {
                        return {
                            ok: false,
                            error:
                                "Premium scrap receipt could not be removed. Run migration 105 in Supabase, or delete scrap receipts for this invoice in SQL.",
                        };
                    }
                }
            }
            const { error: oblDelErr } = await supabase
                .schema("erp")
                .from("scrap_receivable_obligations")
                .delete()
                .eq("id", obligationId);
            if (oblDelErr) {
                return {
                    ok: false,
                    error: formatDbError(
                        oblDelErr,
                        "Failed to delete premium scrap obligation for this invoice.",
                    ),
                };
            }
        }
    }

    // 4) Clear invoice side-effects.
    await supabase
        .schema("erp")
        .from("inventory_movements")
        .delete()
        .eq("source_doc_type", docType)
        .eq("source_doc_id", id);
    await supabase
        .schema("erp")
        .from(ledgerTable)
        .delete()
        .eq("source_doc_type", docType)
        .eq("source_doc_id", id);
    const { data: invJEs } = await supabase
        .schema("erp")
        .from("journal_entries")
        .select("id")
        .eq("source_doc_type", docType)
        .eq("source_doc_id", id);
    const invJeIds = asRows<{ id: string }>(invJEs).map((r) => r.id);
    if (invJeIds.length > 0) {
        await supabase.schema("erp").from("journal_lines").delete().in("journal_entry_id", invJeIds);
        await supabase.schema("erp").from("journal_entries").delete().in("id", invJeIds);
    }

    // 5) Delete invoice header (lines cascade via FK).
    const { error: headerErr } = await supabase.schema("erp").from(table).delete().eq("id", id);
    if (headerErr) return { ok: false, error: formatDbError(headerErr, "Failed to delete invoice header.") };

    // 6) Recompute parent order totals + status based on remaining lines.
    for (const orderId of affectedOrderIds) {
        const { data: remainingLines } = await supabase
            .schema("erp")
            .from(orderLineTable)
            .select(`qty_ordered,${orderLineQtyCol}`)
            .eq(orderFk, orderId);
        const remainingRows = asRows<Record<string, unknown>>(remainingLines);
        const totalOrdered = remainingRows.reduce(
            (s, l) => s + Number(l.qty_ordered ?? 0),
            0,
        );
        const totalDone = remainingRows.reduce(
            (s, l) => s + Number(l[orderLineQtyCol] ?? 0),
            0,
        );
        const { data: currentOrder } = await supabase
            .schema("erp")
            .from(orderTable)
            .select("status")
            .eq("id", orderId)
            .maybeSingle();
        const currentStatus = String(asRowOrNull<{ status: string | null }>(currentOrder)?.status ?? "open");
        let nextStatus = currentStatus;
        if (currentStatus !== "cancelled") {
            if (totalDone <= 0) nextStatus = "open";
            else if (totalDone >= totalOrdered * 0.98) nextStatus = "closed";
            else nextStatus = "partial";
        }
        await supabase
            .schema("erp")
            .from(orderTable)
            .update({
                [orderTotalCol]: totalDone,
                total_ordered_qty: totalOrdered,
                status: nextStatus,
            })
            .eq("id", orderId);
    }

    // 7) Rebuild inventory balances for affected items only (scoped).
    const itemIds = Array.from(affectedItemIds);
    if (itemIds.length > 0) {
        const rebuild = await rebuildInventoryForItems(itemIds);
        if (!rebuild.ok) {
            console.warn("[ERP] rebuild_inventory_balances_for_items failed", rebuild.error);
        }
    }

    return verifyInvoiceRemoved(table, id);
}

export async function rpcHardDeleteInvoice(
    fn: "hard_delete_sales_invoice" | "hard_delete_purchase_invoice",
    table: "sales_invoices" | "purchase_invoices",
    id: string,
    label: string,
): Promise<HardDeleteInvoiceResult> {
    const { data: header, error: fetchErr } = await supabase
        .schema("erp")
        .from(table)
        .select("id,posting_status")
        .eq("id", id)
        .single();
    if (fetchErr || !header) {
        return { ok: false, error: formatDbError(fetchErr, "Invoice not found.") };
    }

    const rpcResult = await hardDeleteInvoiceRpc(fn, id, label);
    if (rpcResult.ok) {
        const verified = await verifyInvoiceRemoved(table, id);
        if (!verified.ok) return verified;
        await reconcileOrderFulfillment().catch((err) => {
            console.warn("[ERP] post-delete order fulfillment reconcile failed", err);
        });
        return { ...verified, linkedOrderLines: rpcResult.linkedOrderLines };
    }

    // The server executed the RPC and explicitly refused (payment allocations,
    // permission gate, step failure). Surface the real reason — never fall back
    // to the destructive client-side cascade after an explicit refusal.
    if (rpcResult.refused) {
        return { ok: false, error: rpcResult.error ?? "Delete refused by server." };
    }

    // RPC missing or unavailable — fall back to client-side cascade delete using RLS.
    const fallback = await clientCascadeDeleteInvoice(table, id);
    if (fallback.ok) {
        await reconcileOrderFulfillment().catch((err) => {
            console.warn("[ERP] post-delete order fulfillment reconcile failed (fallback path)", err);
        });
        return fallback;
    }
    const baseError = rpcResult.error ?? `Failed to ${label}.`;
    return { ok: false, error: `${baseError} | fallback: ${fallback.error}` };
}

export type { HardDeleteInvoiceResult } from "./invoiceShared";

export async function adminHardDeleteSalesInvoiceDocument(id: string): Promise<HardDeleteInvoiceResult> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: false, error: "ERP is not configured." };
    if (!id) return { ok: false, error: "Missing invoice id." };
    return rpcHardDeleteInvoice("hard_delete_sales_invoice", "sales_invoices", id, "hard delete sales invoice");
}

/** Clears cashbook AR allocations, premium scrap, then deletes (migration 106). */

export async function forceDeleteSalesInvoiceDocument(id: string): Promise<HardDeleteInvoiceResult> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    if (!isSupabaseConfigured() || !hasErpContext()) return { ok: false, error: "ERP is not configured." };
    if (!id) return { ok: false, error: "Missing invoice id." };

    const result = await runErpRpc<unknown>("force delete sales invoice", "force_delete_sales_invoice", {
        p_doc_id: id,
    });
    if (!result.ok) return { ok: false, error: result.error };
    const parsed = parseRpcJsonResult(result.data);
    if (!parsed.ok) {
        const stepSuffix = parsed.step ? ` (step: ${parsed.step})` : "";
        return { ok: false, error: `${parsed.error ?? "Force delete failed."}${stepSuffix}` };
    }
    const verified = await verifyInvoiceRemoved("sales_invoices", id);
    if (!verified.ok) return verified;
    await reconcileOrderFulfillment().catch((err) => {
        console.warn("[ERP] post-delete order fulfillment reconcile failed", err);
    });
    return { ...verified, linkedOrderLines: parsed.linkedOrderLines };
}
