import type { ItemCodeNameRef, PartyCodeNameRef } from "./shared";

/**
 * Row contracts for erp.purchase_invoices / erp.purchase_orders selects.
 * Field lists mirror the explicit column strings in api/purchaseInvoices.ts.
 */

export type PurchaseInvoiceListRow = {
    id: string;
    invoice_no: string;
    invoice_date: string;
    grand_total: number;
    posting_status: string;
    financial_status: string | null;
    parties: PartyCodeNameRef;
};

export type PurchaseInvoiceDetailLineRow = {
    id: string;
    line_no: number;
    gross_weight: number | null;
    tare_weight: number | null;
    net_weight: number | null;
    unit_count: number | null;
    unit_price: number | null;
    line_amount: number | null;
    rate_status: string | null;
    wire8_grade: string | null;
    purchase_order_line_id: string | null;
    items: ItemCodeNameRef;
    purchase_order_lines: {
        qty_ordered: number;
        qty_received: number;
        unit_price: number;
        purchase_orders: { order_no: string } | null;
    } | null;
};

export type PurchaseInvoiceDocumentRow = {
    id: string;
    invoice_no: string;
    invoice_date: string;
    purchase_mode: string | null;
    settlement_mode: string | null;
    warehouse_id: string | null;
    subtotal_amount: number;
    additional_charges: number;
    grand_total: number;
    remarks: string | null;
    posting_status: string;
    financial_status: string | null;
    parties: PartyCodeNameRef;
    warehouses: { wh_type: string } | null;
    purchase_invoice_lines: PurchaseInvoiceDetailLineRow[] | null;
};

export type PurchaseOrderLineRow = {
    id: string;
    line_no: number;
    qty_ordered: number;
    qty_received: number;
    unit_price: number;
    items: ItemCodeNameRef;
};

export type PurchaseOrderRow = {
    id: string;
    order_no: string;
    order_date: string;
    expected_date: string | null;
    status: string;
    total_ordered_qty: number;
    total_received_qty: number;
    parties: PartyCodeNameRef;
    purchase_order_lines: PurchaseOrderLineRow[] | null;
};
