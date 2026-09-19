import { format } from "date-fns";
import { formatLedgerDescription, formatLedgerParticulars, formatLedgerRef } from "@/lib/ledgerDisplay";
import type { FinancialLedgerDisplayRow } from "./types";

export function parseParchiParam(raw: string | null): boolean {
    if (!raw) return false;
    return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export function formatLedgerAccountLabel(
    acc: { tab: string; name: string },
    showTab: boolean,
): string {
    return showTab ? `${acc.tab} · ${acc.name}` : acc.name;
}

export function isFinancialOpeningRow(
    row: Pick<FinancialLedgerDisplayRow, "isOpening" | "sourceDocType" | "ref">,
): boolean {
    return (
        row.isOpening ||
        row.sourceDocType === "opening" ||
        String(row.ref ?? "").toUpperCase() === "B/F" ||
        String(row.ref ?? "").toUpperCase() === "OPENING"
    );
}

/** Prior closing for a B/F row (Dr/Cr are 0 — must not use debit-credit alone). */
export function openingBalanceSeed(
    row: Pick<
        FinancialLedgerDisplayRow,
        "runningBalanceFromBackend" | "startingBal" | "runningBalance" | "debit" | "credit"
    >,
): number {
    if (row.runningBalanceFromBackend != null && !Number.isNaN(row.runningBalanceFromBackend)) {
        return row.runningBalanceFromBackend;
    }
    if (row.startingBal != null && !Number.isNaN(row.startingBal)) {
        return row.startingBal;
    }
    // Mock rows stash opening on runningBalance before the running recompute.
    if (typeof row.runningBalance === "number" && row.runningBalance !== 0) {
        return row.runningBalance;
    }
    return Number(row.debit ?? 0) - Number(row.credit ?? 0);
}

export function mapFinancialLedgerRow(
    row: Record<string, unknown>,
    index: number,
): FinancialLedgerDisplayRow {
    const weight = row.weight_qty != null && row.weight_qty !== "" ? Number(row.weight_qty) : null;
    const rate = row.unit_rate != null && row.unit_rate !== "" ? Number(row.unit_rate) : null;
    const isOpening =
        String(row.voucher_no ?? "") === "OPENING" ||
        String(row.source_doc_type ?? "") === "opening" ||
        String(row.ref_no ?? "") === "B/F";
    const runningBalanceFromBackend =
        row.running_balance != null && row.running_balance !== ""
            ? Number(row.running_balance)
            : null;
    return {
        id: `${row.posting_date}-${row.source_doc_id ?? row.ref_no ?? row.voucher_no}-${row.detail_seq ?? 0}-${index}`,
        date: String(row.posting_date ?? ""),
        ref: formatLedgerRef(row),
        desc: formatLedgerDescription(row),
        particulars: formatLedgerParticulars(row),
        weight: weight != null && !Number.isNaN(weight) ? weight : null,
        rate: rate != null && !Number.isNaN(rate) ? rate : null,
        debit: Number(row.debit_amount ?? 0),
        credit: Number(row.credit_amount ?? 0),
        isOpening,
        // B/F carries prior closing only in running_balance (Dr/Cr stay 0).
        startingBal:
            isOpening && runningBalanceFromBackend != null && !Number.isNaN(runningBalanceFromBackend)
                ? runningBalanceFromBackend
                : null,
        runningBalanceFromBackend,
        sourceDocType: row.source_doc_type ? String(row.source_doc_type) : null,
        sourceDocId: row.source_doc_id ? String(row.source_doc_id) : null,
        postedByName: row.posted_by_name ? String(row.posted_by_name) : null,
        postedAt: row.posted_at ? String(row.posted_at) : null,
        sortIndex: index,
        runningBalance: 0,
    };
}

export function formatRecordedBy(name: string | null | undefined, at: string | null | undefined): string {
    if (!name && !at) return "—";
    const when = at ? format(new Date(at), "dd-MMM-yy HH:mm") : "";
    return [name, when].filter(Boolean).join(" · ");
}

/** Opening / B/F first, then chronological by posting date (not wall-clock posted_at). */
export function compareFinancialLedgerRows(
    a: Pick<FinancialLedgerDisplayRow, "isOpening" | "sourceDocType" | "date" | "postedAt" | "ref" | "sortIndex">,
    b: Pick<FinancialLedgerDisplayRow, "isOpening" | "sourceDocType" | "date" | "postedAt" | "ref" | "sortIndex">,
): number {
    const rank = (r: typeof a) => {
        if (isFinancialOpeningRow(r) || r.sourceDocType === "opening") return 0;
        if (r.sourceDocType === "carry_forward") return 1;
        return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const byDate = String(a.date ?? "").localeCompare(String(b.date ?? ""));
    if (byDate !== 0) return byDate;
    const byPosted = String(a.postedAt ?? "").localeCompare(String(b.postedAt ?? ""));
    if (byPosted !== 0) return byPosted;
    const byRef = String(a.ref ?? "").localeCompare(String(b.ref ?? ""));
    if (byRef !== 0) return byRef;
    return (a.sortIndex ?? 0) - (b.sortIndex ?? 0);
}

/** Doc types that expand to one ledger row per invoice/return line. */
export const EXPANDABLE_INVOICE_DOC_TYPES = new Set([
    "sales_invoice",
    "purchase_invoice",
    "sales_return",
    "purchase_return",
]);

export function isExpandableInvoiceDoc(sourceDocType?: string | null): boolean {
    return !!sourceDocType && EXPANDABLE_INVOICE_DOC_TYPES.has(sourceDocType);
}

export type InvoiceLineAggregate = {
    sourceDocId: string;
    sourceDocType: string;
    ref: string;
    lineCount: number;
    totalDebit: number;
    totalCredit: number;
    totalWeight: number;
    lines: Array<{
        particulars: string;
        weight: number | null;
        rate: number | null;
        debit: number;
        credit: number;
    }>;
};

/** Group expanded invoice/return lines by sourceDocId for Ref hover totals. */
export function buildInvoiceLineAggregates(
    rows: FinancialLedgerDisplayRow[],
): Map<string, InvoiceLineAggregate> {
    const map = new Map<string, InvoiceLineAggregate>();
    for (const row of rows) {
        if (!row.sourceDocId || !isExpandableInvoiceDoc(row.sourceDocType)) continue;
        if (isFinancialOpeningRow(row)) continue;

        let agg = map.get(row.sourceDocId);
        if (!agg) {
            agg = {
                sourceDocId: row.sourceDocId,
                sourceDocType: row.sourceDocType ?? "",
                ref: row.ref,
                lineCount: 0,
                totalDebit: 0,
                totalCredit: 0,
                totalWeight: 0,
                lines: [],
            };
            map.set(row.sourceDocId, agg);
        }
        agg.lineCount += 1;
        agg.totalDebit += row.debit;
        agg.totalCredit += row.credit;
        agg.totalWeight += Number(row.weight ?? 0);
        agg.lines.push({
            particulars: row.particulars || row.desc || "—",
            weight: row.weight,
            rate: row.rate,
            debit: row.debit,
            credit: row.credit,
        });
    }
    return map;
}

