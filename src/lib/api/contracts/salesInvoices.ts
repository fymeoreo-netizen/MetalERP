import type { PartyCodeNameRef } from "./shared";

/**
 * Row contracts for erp.sales_invoices / erp.sales_orders selects.
 * Field lists mirror the explicit column strings in api/salesInvoices.ts.
 */

export type SalesInvoiceListRow = {
    id: string;
    invoice_no: string;
    invoice_date: string;
    grand_total: number;
    subtotal_amount: number;
    discount_amount: number;
    tax_amount: number;
    posting_status: string;
    financial_status: string | null;
    parties: PartyCodeNameRef;
};

export type SalesInvoiceDetailLineRow = {
    id: string;
    line_no: number;
    gross_weight: number | null;
    tare_weight: number | null;
    net_weight: number | null;
    unit_count: number | null;
    unit_price: number | null;
    watta_rate: number | null;
    line_amount: number | null;
    tax_rate: number | null;
    rate_status: string | null;
    sales_order_line_id: string | null;
    items: { code: string; name: string; size_spec: string | null } | null;
    /** Embedded fulfillment snapshot for lines pulled from an order. */
    sales_order_lines: {
        qty_ordered: number;
        qty_fulfilled: number;
        unit_price: number;
        sales_orders: { order_no: string } | null;
    } | null;
};

export type SalesInvoiceDocumentRow = {
    id: string;
    invoice_no: string;
    invoice_date: string;
    sale_mode: string | null;
    ref_scrap_rate: number | null;
    premium_total_kg: number | null;
    vehicle_no: string | null;
    driver_name: string | null;
    subtotal_amount: number;
    discount_amount: number;
    tax_amount: number;
    grand_total: number;
    remarks: string | null;
    posting_status: string;
    financial_status: string | null;
    parties: PartyCodeNameRef;
    sales_invoice_lines: SalesInvoiceDetailLineRow[] | null;
};

export type SalesOrderLineRow = {
    id: string;
    line_no: number;
    qty_ordered: number;
    qty_fulfilled: number;
    unit_price: number;
    items: { code: string; name: string } | null;
};

export type SalesOrderRow = {
    id: string;
    order_no: string;
    order_date: string;
    delivery_date: string | null;
    status: string;
    total_ordered_qty: number;
    total_fulfilled_qty: number;
    parties: PartyCodeNameRef;
    sales_order_lines: SalesOrderLineRow[] | null;
};

export type SalesOrderByIdRow = {
    id: string;
    order_no: string;
    order_date: string;
    delivery_date: string | null;
    status: string;
    total_ordered_qty: number;
    total_fulfilled_qty: number;
    remarks: string | null;
    parties: PartyCodeNameRef;
    sales_order_lines: SalesOrderLineRow[] | null;
};
