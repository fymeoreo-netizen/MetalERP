export type RateStatus = "fixed" | "pending";

export type PendingReason = "rate" | "tare" | "rate_and_tare";

export type FinancialStatus = "complete" | "partial" | "pending";

export type PendingRateItemRow = {
    id: string;
    sourceDocType: string;
    sourceDocId: string;
    sourceLineId: string | null;
    sourceDocNo: string;
    lineSeq: number;
    partyCode: string;
    partyName: string;
    itemCode: string | null;
    itemName: string | null;
    qty: number;
    originalPostingDate: string;
    daysPending: number;
    status: string;
    pendingReason: PendingReason;
};

export type RateFixLineInput = {
    pendingItemId: string;
    unitRate: number;
};

export function isRatePending(status?: string | null): boolean {
    return status === "pending";
}

export function lineRateFields(line: { rateStatus?: RateStatus; rate?: number; amount?: number }) {
    const pending = isRatePending(line.rateStatus);
    return {
        rate_status: pending ? "pending" : "fixed",
        unit_price: pending ? 0 : Number(line.rate ?? 0),
        line_amount: pending ? 0 : Number(line.amount ?? 0),
    };
}

export function financialStatusLabel(status?: string | null): string {
    if (status === "pending") return "Pending Rate";
    if (status === "partial") return "Partial Rate";
    return "Completed";
}

export function pendingReasonLabel(reason?: string | null): string {
    if (reason === "tare") return "Tare pending";
    if (reason === "rate_and_tare") return "Rate & tare pending";
    return "Rate pending";
}

export function mapPendingRateRegisterRow(row: Record<string, unknown>): PendingRateItemRow {
    const rawReason = String(row.pending_reason ?? "rate");
    const pendingReason: PendingReason =
        rawReason === "tare" || rawReason === "rate_and_tare" ? rawReason : "rate";
    return {
        id: String(row.id),
        sourceDocType: String(row.source_doc_type ?? ""),
        sourceDocId: String(row.source_doc_id ?? ""),
        sourceLineId: row.source_line_id ? String(row.source_line_id) : null,
        sourceDocNo: String(row.source_doc_no ?? ""),
        lineSeq: Number(row.line_seq ?? 1),
        partyCode: String(row.party_code ?? ""),
        partyName: String(row.party_name ?? ""),
        itemCode: row.item_code ? String(row.item_code) : null,
        itemName: row.item_name ? String(row.item_name) : null,
        qty: Number(row.qty ?? 0),
        originalPostingDate: String(row.original_posting_date ?? ""),
        daysPending: Number(row.days_pending ?? 0),
        status: String(row.status ?? "open"),
        pendingReason,
    };
}

export function sumFixedLineAmounts<T extends { rateStatus?: RateStatus; amount?: number }>(lines: T[]): number {
    return lines.reduce((s, l) => (isRatePending(l.rateStatus) ? s : s + Number(l.amount ?? 0)), 0);
}

/** Map DB `rate_status` column to UI `RateStatus`. */
export function mapLineRateStatus(dbStatus?: string | null): RateStatus {
    return dbStatus === "pending" ? "pending" : "fixed";
}

/** Human-readable label for pending-rate register source doc types. */
export function docTypeLabel(docType: string): string {
    return docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Prefer header grand_total; fall back to line amounts when header stayed 0 after rate fix. */
export function salesInvoiceDisplayTotal(row: {
    grand_total?: number | null;
    subtotal_amount?: number | null;
    discount_amount?: number | null;
    tax_amount?: number | null;
    sales_invoice_lines?: Array<{ line_amount?: number | null; rate_status?: string | null }> | null;
}): number {
    const header = Number(row.grand_total ?? 0);
    if (header > 0) return header;

    const lines = row.sales_invoice_lines ?? [];
    const lineSubtotal = lines.reduce((s, l) => s + Number(l.line_amount ?? 0), 0);
    if (lineSubtotal > 0) {
        const discount = Number(row.discount_amount ?? 0);
        const subtotal = Number(row.subtotal_amount ?? 0);
        const tax = Number(row.tax_amount ?? 0);
        if (subtotal > 0 && tax > 0) {
            return Math.max(0, lineSubtotal - discount) + roundAmount(lineSubtotal * tax / subtotal);
        }
        return Math.max(0, lineSubtotal - discount);
    }
    return 0;
}

function roundAmount(n: number): number {
    return Math.round(n * 1000) / 1000;
}

export type DbInvoiceLineRateFields = {
    rate_status?: string | null;
    unit_price?: number | null;
    line_amount?: number | null;
};

/** Map a DB invoice/return line row to rate-pending UI fields. */
export function mapLineFromDb<T extends DbInvoiceLineRateFields>(
    row: T,
): { rate: number; amount: number; rateStatus: RateStatus } {
    const rateStatus = mapLineRateStatus(row.rate_status);
    return {
        rateStatus,
        rate: Number(row.unit_price ?? 0),
        amount: rateStatus === "pending" ? 0 : Number(row.line_amount ?? 0),
    };
}
