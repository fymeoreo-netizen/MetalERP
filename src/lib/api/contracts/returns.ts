import type { ItemCodeNameRef, PartyCodeNameRef } from "./shared";

/**
 * Row contracts for erp.sales_returns / erp.purchase_returns selects.
 * Field lists mirror the explicit column strings in api/returns.ts.
 */

export type SalesReturnListRow = {
    id: string;
    return_no: string;
    return_date: string;
    grand_total: number;
    return_action: string;
    posting_status: string;
    ref_invoice_id: string | null;
    sales_invoices: { invoice_no: string } | null;
    parties: PartyCodeNameRef;
};

export type PurchaseReturnListRow = {
    id: string;
    return_no: string;
    return_date: string;
    grand_total: number;
    return_action: string;
    posting_status: string;
    remarks: string | null;
    parties: PartyCodeNameRef;
};

export type SalesReturnLineRow = {
    id: string;
    line_no: number;
    qty: number;
    unit_count: number | null;
    unit_price: number | null;
    line_amount: number | null;
    rate_status: string | null;
    items: ItemCodeNameRef;
};

export type PurchaseReturnLineRow = {
    id: string;
    line_no: number;
    qty: number;
    unit_count: number | null;
    unit_price: number | null;
    line_amount: number | null;
    rate_status: string | null;
    items: ItemCodeNameRef;
};

export type SalesReturnDocumentRow = {
    id: string;
    return_no: string;
    return_date: string;
    return_action: string;
    grand_total: number;
    remarks: string | null;
    posting_status: string;
    parties: PartyCodeNameRef;
    sales_invoices: { invoice_no: string } | null;
    sales_return_lines: SalesReturnLineRow[] | null;
};

export type PurchaseReturnDocumentRow = {
    id: string;
    return_no: string;
    return_date: string;
    return_action: string;
    grand_total: number;
    remarks: string | null;
    posting_status: string;
    parties: PartyCodeNameRef;
    purchase_return_lines: PurchaseReturnLineRow[] | null;
};
