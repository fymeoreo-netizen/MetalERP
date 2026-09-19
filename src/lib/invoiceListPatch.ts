import { format } from "date-fns";
import { parseDocDate } from "@/lib/partyCatalog";

/** Normalize invoice header date for list cards (never pass a Date object to React). */
export function formatInvoiceDisplayDate(value: unknown): string {
    if (value == null || value === "") return format(new Date(), "MMM dd");
    const d = value instanceof Date ? value : parseDocDate(String(value));
    return format(d, "MMM dd");
}

/** Shared fields for sales/purchase invoice list cards. */
export type InvoiceListRowBase = {
    id: string;
    dbId?: string;
    date: string;
    status: string;
};

/** Sales invoice list row (customer + formatted amount). */
export type InvoiceListRow = InvoiceListRowBase & {
    customer: string;
    amount: string;
    linkedOrderId?: string | null;
};

/** Purchase invoice list row (supplier + weight). */
export type PurchaseInvoiceListRow = InvoiceListRowBase & {
    supplier: string;
    amount: number;
    weight: string;
    linkedPOId?: string | null;
};

export function upsertInvoiceListRow<T extends InvoiceListRowBase>(
    rows: T[],
    row: T,
): T[] {
    const idx = rows.findIndex((r) => r.dbId === row.dbId || r.id === row.id);
    if (idx >= 0) {
        const next = [...rows];
        next[idx] = { ...next[idx], ...row };
        return next;
    }
    return [row, ...rows];
}

export function removeInvoiceListRow<T extends InvoiceListRowBase>(rows: T[], id: string): T[] {
    return rows.filter((r) => r.dbId !== id && r.id !== id);
}
