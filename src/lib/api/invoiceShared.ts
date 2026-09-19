import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { supabase } from "@/lib/supabase";
import { isWire8ItemCode, parseWire8Grade, resolveWire8ItemCode, DEFAULT_WIRE8_ITEM_CODE, type Wire8Grade } from "@/lib/productionWire8Settings";
import { lineRateFields } from "@/lib/ratePending";
import { formatDbError } from "./core";
import { fetchProductionStandards } from "./production";
import type { Result } from "./types";

export async function getInvoiceIdByNo(invoiceNo: string | null | undefined): Promise<string | null> {
    if (!invoiceNo?.trim()) return null;
    const { data } = await supabase
        .schema("erp")
        .from("sales_invoices")
        .select("id")
        .eq("invoice_no", invoiceNo.trim())
        .maybeSingle();
    return data?.id ?? null;
}

export async function getSalesOrderLineLookup(orderNo: string | undefined | null): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!orderNo?.trim() || !isSupabaseConfigured() || !hasErpContext()) return map;
    const { data } = await supabase
        .schema("erp")
        .from("sales_orders")
        .select("sales_order_lines(id,item_id)")
        .eq("order_no", orderNo.trim())
        .maybeSingle();
    for (const line of data?.sales_order_lines ?? []) {
        if (line.item_id && line.id) map.set(line.item_id, line.id);
    }
    return map;
}

export async function getPurchaseOrderLineLookup(orderNo: string | undefined | null): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!orderNo?.trim() || !isSupabaseConfigured() || !hasErpContext()) return map;
    const { data } = await supabase
        .schema("erp")
        .from("purchase_orders")
        .select("purchase_order_lines(id,item_id)")
        .eq("order_no", orderNo.trim())
        .maybeSingle();
    for (const line of data?.purchase_order_lines ?? []) {
        if (line.item_id && line.id) map.set(line.item_id, line.id);
    }
    return map;
}

export function collectPurchaseLineItemCodes(items: unknown[], canonicalWire8Code: string): string[] {
    const codes = new Set<string>();
    for (const raw of items ?? []) {
        const line = raw as { itemCode?: string; item?: string };
        const code = (line.itemCode ?? line.item ?? "").trim();
        if (code) codes.add(code);
    }
    if ([...codes].some(isWire8ItemCode) && !codes.has(canonicalWire8Code)) {
        codes.add(canonicalWire8Code);
    }
    return [...codes];
}

export async function resolveCanonicalWire8CodeForPosting(): Promise<string> {
    const standards = await fetchProductionStandards();
    const code = resolveWire8ItemCode(standards).trim();
    return code || DEFAULT_WIRE8_ITEM_CODE;
}

export async function assertActiveWire8PostingTarget(
    itemMap: Record<string, string>,
    canonicalCode: string,
    items: unknown[],
): Promise<Result<true>> {
    const hasWire8 = (items ?? []).some((raw) => {
        const line = raw as { itemCode?: string; item?: string; netWeight?: number };
        const code = line.itemCode ?? line.item ?? "";
        return Number(line.netWeight ?? 0) > 0 && isWire8ItemCode(code);
    });
    if (!hasWire8) return { ok: true, data: true };
    if (!itemMap[canonicalCode]) {
        return {
            ok: false,
            error: `Wire No 8 item "${canonicalCode}" is missing in Item Master. Add it or update Production Settings.`,
        };
    }
    const { data } = await supabase
        .schema("erp")
        .from("items")
        .select("is_active")
        .eq("code", canonicalCode)
        .maybeSingle();
    if (!data?.is_active) {
        return {
            ok: false,
            error: `Wire No 8 item "${canonicalCode}" is inactive and cannot receive stock. Reactivate it in Item Master or update Production Settings.`,
        };
    }
    return { ok: true, data: true };
}

export function validatePurchaseInvoiceLinesPersisted(
    items: unknown[],
    savedLines: Array<{ item_id?: string | null }>,
    canonicalWire8Code: string,
): Result<true> {
    const billable = (items ?? []).filter((raw) => {
        const line = raw as { itemCode?: string; item?: string; netWeight?: number };
        return (line.itemCode ?? line.item) && Number(line.netWeight) > 0;
    });
    if (billable.length === 0) {
        return { ok: false, error: "Add at least one line with item and net weight before saving." };
    }
    if (savedLines.length === 0) {
        return {
            ok: false,
            error: "No invoice lines could be saved. Check item codes exist in Item Master (Wire No 8 posts to "
                + `${canonicalWire8Code}).`,
        };
    }
    const wire8Billable = billable.filter((raw) => {
        const line = raw as { itemCode?: string; item?: string };
        return isWire8ItemCode(line.itemCode ?? line.item ?? "");
    });
    if (wire8Billable.length > 0 && !savedLines.some((l) => Boolean(l.item_id))) {
        return {
            ok: false,
            error: `Wire No 8 lines could not be saved. Ensure "${canonicalWire8Code}" exists and is active in Item Master.`,
        };
    }
    return { ok: true, data: true };
}

export function purchaseLineWire8Grade(line: {
    itemCode?: string;
    item?: string;
    wire8Grade?: string;
    wire8_grade?: string;
}): Wire8Grade | null {
    const itemCode = line.itemCode ?? line.item ?? "";
    if (!isWire8ItemCode(itemCode)) return null;
    return parseWire8Grade(line.wire8Grade ?? line.wire8_grade ?? "Pass");
}

export function buildPurchaseInvoiceLineRow(
    line: any,
    idx: number,
    invoiceId: string,
    itemMap: Record<string, string>,
    warehouseId: string,
    purchaseOrderLineByItemId: Map<string, string>,
    canonicalWire8Code: string,
) {
    const itemCode = line.itemCode ?? line.item;
    const isWire8 = isWire8ItemCode(itemCode);
    const canonicalItemId = itemMap[canonicalWire8Code] ?? null;
    const itemId = isWire8 && canonicalItemId ? canonicalItemId : itemMap[itemCode];
    const purchaseOrderLineId =
        line.purchaseOrderLineId ?? (itemId ? purchaseOrderLineByItemId.get(itemId) ?? null : null);
    const clientId = typeof line.id === "string" && /^[0-9a-f-]{36}$/i.test(line.id) ? line.id : undefined;
    const netWeight = Number(line.netWeight || 0);
    const rateStatus = line.rateStatus;
    const rate = Number(line.rate ?? 0);
    const amount = rateStatus === "pending" ? 0 : netWeight * rate;
    return {
        ...(clientId ? { id: clientId } : {}),
        purchase_invoice_id: invoiceId,
        line_no: idx + 1,
        item_id: itemId,
        warehouse_id: warehouseId,
        qty: netWeight,
        uom_code: "KG",
        gross_weight: Number(line.gross || 0),
        tare_weight: Number(line.tare || 0),
        net_weight: netWeight,
        unit_count: Number(line.unitCount ?? line.quantity ?? 0),
        tax_rate: 0,
        purchase_order_line_id: purchaseOrderLineId,
        wire8_grade: purchaseLineWire8Grade(line),
        ...lineRateFields({ rateStatus, rate, amount }),
    };
}

export function resolveSalesOrderLineId(
    line: { salesOrderLineId?: string | null },
    itemId: string | undefined,
    salesOrderLineByItemId: Map<string, string>,
): string | null {
    const explicit = typeof line.salesOrderLineId === "string" ? line.salesOrderLineId.trim() : "";
    if (explicit && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(explicit)) {
        return explicit;
    }
    if (itemId) {
        const mapped = salesOrderLineByItemId.get(itemId);
        if (mapped) return mapped;
    }
    return null;
}

export type HardDeleteInvoiceResult = Result<true> & { linkedOrderLines?: number };
