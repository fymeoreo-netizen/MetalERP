import { differenceInCalendarDays, format, parseISO } from "date-fns";

export type ParchiInstrumentRow = {
    parchi_no: string;
    parchi_type?: string;
    direction?: string;
    issue_date?: string;
    due_date?: string | null;
    total_amount?: number;
    cleared_amount?: number;
    open_amount?: number;
    status?: string;
};

export type LedgerSaleRow = {
    invoiceNo: string;
    saleDate: string;
    amount: number;
    sourceDocId?: string | null;
};

export type LedgerPaymentRow = {
    paymentNo: string;
    paymentDate: string;
    amount: number;
};

export type SaleMissingParchiRow = {
    invoiceNo: string;
    saleDate: string;
    amount: number;
    daysSinceSale: number;
};

export type OverdueParchiRow = {
    parchiNo: string;
    dueDate: string;
    openAmount: number;
    daysLate: number;
    issueDate?: string;
};

export type ParchiReconciliationResult = {
    salesMissingParchi: SaleMissingParchiRow[];
    overdueParchis: OverdueParchiRow[];
    totalOpenParchi: number;
    matchedSalesCount: number;
    unmatchedSalesTotal: number;
};

const AMOUNT_TOLERANCE = 0.02;

function roundMoney(n: number): number {
    return Math.round(n * 100) / 100;
}

function amountsMatch(a: number, b: number): boolean {
    return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

/** Group party-ledger rows into one row per posted sales invoice (debit side). */
export function extractSalesFromPartyLedger(rows: Record<string, unknown>[]): LedgerSaleRow[] {
    const byDoc = new Map<string, LedgerSaleRow>();

    for (const row of rows) {
        if (String(row.source_doc_type ?? "") !== "sales_invoice") continue;
        const docId = String(row.source_doc_id ?? row.ref_no ?? row.voucher_no ?? "");
        if (!docId) continue;

        const debit = Number(row.debit_amount ?? 0);
        if (debit <= 0) continue;

        const existing = byDoc.get(docId);
        const ref = String(row.ref_no ?? row.source_doc_no ?? row.voucher_no ?? docId);
        const date = String(row.posting_date ?? "");

        if (!existing) {
            byDoc.set(docId, {
                invoiceNo: ref,
                saleDate: date,
                amount: debit,
                sourceDocId: row.source_doc_id ? String(row.source_doc_id) : null,
            });
        } else {
            existing.amount = roundMoney(existing.amount + debit);
        }
    }

    return Array.from(byDoc.values()).sort(
        (a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime(),
    );
}

/** Recent cash receipts from party ledger (payment credits). */
export function extractPaymentsFromPartyLedger(
    rows: Record<string, unknown>[],
    limit = 5,
): LedgerPaymentRow[] {
    const payments: LedgerPaymentRow[] = [];

    for (const row of rows) {
        if (String(row.source_doc_type ?? "") !== "payment") continue;
        const credit = Number(row.credit_amount ?? 0);
        if (credit <= 0) continue;
        payments.push({
            paymentNo: String(row.ref_no ?? row.source_doc_no ?? row.voucher_no ?? "—"),
            paymentDate: String(row.posting_date ?? ""),
            amount: credit,
        });
    }

    return payments
        .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())
        .slice(0, limit);
}

/**
 * Match received parchis to sales (FIFO by date, exact amount per instrument).
 * Returns sales that still have no received parchi covering them.
 */
export function reconcilePartyParchis(
    sales: LedgerSaleRow[],
    parchis: ParchiInstrumentRow[],
    asOf: Date = new Date(),
): ParchiReconciliationResult {
    const received = parchis
        .filter((p) => String(p.direction ?? "").toLowerCase() === "received")
        .filter((p) => String(p.status ?? "") !== "void")
        .map((p) => ({
            parchiNo: p.parchi_no,
            issueDate: p.issue_date ?? "",
            dueDate: p.due_date ?? null,
            totalAmount: Number(p.total_amount ?? 0),
            openAmount: Number(p.open_amount ?? 0),
            remaining: Number(p.total_amount ?? 0),
        }))
        .filter((p) => p.totalAmount > 0)
        .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

    const unmatchedSales: SaleMissingParchiRow[] = [];
    let matchedSalesCount = 0;

    for (const sale of sales) {
        const matchIdx = received.findIndex(
            (p) => p.remaining > AMOUNT_TOLERANCE && amountsMatch(p.totalAmount, sale.amount),
        );
        if (matchIdx >= 0) {
            received[matchIdx].remaining = 0;
            matchedSalesCount += 1;
        } else {
            const saleDate = sale.saleDate ? parseISO(sale.saleDate) : asOf;
            unmatchedSales.push({
                invoiceNo: sale.invoiceNo,
                saleDate: sale.saleDate,
                amount: sale.amount,
                daysSinceSale: Math.max(0, differenceInCalendarDays(asOf, saleDate)),
            });
        }
    }

    const overdueParchis: OverdueParchiRow[] = parchis
        .filter((p) => String(p.direction ?? "").toLowerCase() === "received")
        .filter((p) => String(p.status ?? "") !== "void" && String(p.status ?? "") !== "cleared")
        .filter((p) => Number(p.open_amount ?? 0) > AMOUNT_TOLERANCE)
        .filter((p) => p.due_date && parseISO(p.due_date) < asOf)
        .map((p) => ({
            parchiNo: p.parchi_no,
            dueDate: String(p.due_date),
            openAmount: Number(p.open_amount ?? 0),
            daysLate: differenceInCalendarDays(asOf, parseISO(String(p.due_date))),
            issueDate: p.issue_date,
        }))
        .sort((a, b) => b.daysLate - a.daysLate);

    const totalOpenParchi = roundMoney(
        parchis
            .filter((p) => String(p.status ?? "") !== "void")
            .reduce((s, p) => s + Number(p.open_amount ?? 0), 0),
    );

    return {
        salesMissingParchi: unmatchedSales,
        overdueParchis,
        totalOpenParchi,
        matchedSalesCount,
        unmatchedSalesTotal: roundMoney(unmatchedSales.reduce((s, r) => s + r.amount, 0)),
    };
}

export function computeAdjustedBalance(closingBalance: number, totalOpenParchi: number): number {
    return roundMoney(closingBalance - totalOpenParchi);
}

export function formatBalanceLabel(balance: number): string {
    const abs = Math.abs(balance).toLocaleString();
    return `₨ ${abs} ${balance >= 0 ? "Dr" : "Cr"}`;
}

/** Structured facts for the ERP assistant — not a hardcoded prose template. */
export function buildParchiSummaryFacts(opts: {
    partyCode: string;
    partyName: string;
    dateFrom: string;
    dateTo: string;
    reconciliation: ParchiReconciliationResult;
    recentPayments: LedgerPaymentRow[];
    openParchis: ParchiInstrumentRow[];
    closingBalance: number;
    asOf?: Date;
}): Record<string, unknown> {
    const { partyCode, partyName, dateFrom, dateTo, reconciliation, recentPayments, openParchis, closingBalance } =
        opts;
    const asOf = opts.asOf ?? new Date();
    const adjustedBalance = computeAdjustedBalance(closingBalance, reconciliation.totalOpenParchi);

    return {
        party_code: partyCode,
        party_name: partyName,
        as_of: format(asOf, "yyyy-MM-dd"),
        ledger_period: { from: dateFrom, to: dateTo },
        currency: "PKR",
        financial_closing_balance: closingBalance,
        financial_closing_balance_label: formatBalanceLabel(closingBalance),
        total_open_parchi: reconciliation.totalOpenParchi,
        balance_after_parchi_adjustment: adjustedBalance,
        balance_after_parchi_adjustment_label: formatBalanceLabel(adjustedBalance),
        recent_payments: recentPayments.map((p) => ({
            payment_no: p.paymentNo,
            payment_date: p.paymentDate,
            amount: p.amount,
        })),
        overdue_parchis: reconciliation.overdueParchis.map((p) => ({
            parchi_no: p.parchiNo,
            issue_date: p.issueDate ?? null,
            due_date: p.dueDate,
            open_amount: p.openAmount,
            days_late: p.daysLate,
        })),
        sales_without_received_parchi: reconciliation.salesMissingParchi.map((s) => ({
            invoice_no: s.invoiceNo,
            sale_date: s.saleDate,
            amount: s.amount,
            days_since_sale: s.daysSinceSale,
        })),
        sales_awaiting_parchi_total: reconciliation.unmatchedSalesTotal,
        sales_awaiting_parchi_count: reconciliation.salesMissingParchi.length,
        open_parchis: openParchis.map((p) => ({
            parchi_no: p.parchi_no,
            parchi_type: p.parchi_type ?? null,
            direction: p.direction ?? null,
            issue_date: p.issue_date ?? null,
            due_date: p.due_date ?? null,
            total_amount: Number(p.total_amount ?? 0),
            cleared_amount: Number(p.cleared_amount ?? 0),
            open_amount: Number(p.open_amount ?? 0),
            status: p.status ?? null,
        })),
    };
}

export const PARCHI_OVERDUE_SUMMARY_PROMPT =
    "Write a short, professional overdue-parchi follow-up note for this party using the authoritative ledger snapshot in context. Cover recent payments, overdue parchis (amount and days late), sales still without a received parchi, open parchi total, ledger closing balance, and balance after parchi adjustment. Be concise and factual — suitable to share with the party. Use only numbers and dates from the snapshot and any tool results; do not invent figures.";
