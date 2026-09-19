/** Labels that carry no business detail on party / cash ledgers. */
const GENERIC_PARTICULARS = new Set([
    "Settle receivable",
    "Settle payable",
    "Receipt",
    "Payment",
    "Opening Balance",
    "Opening balance",
    "Balance brought forward",
]);

const GENERIC_NARRATIONS = new Set([
    "Payment posted",
    "Sales invoice posted",
    "Purchase invoice posted",
    "Sales return posted",
    "Purchase return posted",
    "Parchi issued",
]);

function norm(s: unknown): string {
    if (s == null) return "";
    if (typeof s === "number" && Number.isFinite(s)) return String(s);
    if (typeof s === "string") return s.trim();
    return String(s).trim();
}

function cleanRateFixLabel(s: string): string {
    return s
        .replace(/\s*\(rate fix\)\s*/gi, " ")
        .replace(/^rate fixed for\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isGenericGlLabel(s: string): boolean {
    const clean = cleanRateFixLabel(s);
    if (!clean) return true;
    if (GENERIC_PARTICULARS.has(clean)) return true;
    return /^(ar|ap|accounts receivable|accounts payable)$/i.test(clean);
}

function includesInsensitive(haystack: string, needle: string): boolean {
    if (!needle) return true;
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Particulars column: line items, party, size, and document remarks. */
export function formatLedgerParticulars(row: Record<string, unknown>): string {
    const particulars = cleanRateFixLabel(norm(row.particulars));
    const sizeSpec = norm(row.size_spec);
    const partyName = norm(row.party_name);
    const narration = cleanRateFixLabel(norm(row.narration));

    const parts: string[] = [];

    if (particulars && !isGenericGlLabel(particulars)) {
        parts.push(particulars);
    } else if (narration && !GENERIC_NARRATIONS.has(narration) && !isGenericGlLabel(narration)) {
        parts.push(narration);
    }

    if (sizeSpec && !includesInsensitive(parts.join(" "), sizeSpec)) {
        parts.push(sizeSpec);
    }

    if (partyName && !includesInsensitive(parts.join(" "), partyName)) {
        parts.push(partyName);
    }

    if (
        narration &&
        !GENERIC_NARRATIONS.has(narration) &&
        narration !== particulars &&
        !/rate fixed for/i.test(narration) &&
        !includesInsensitive(parts.join(" "), narration)
    ) {
        parts.push(narration);
    }

    return parts.length ? parts.join(" · ") : "—";
}

/** Description column: human-readable voucher type, not raw GL line text. */
export function formatLedgerDescription(row: Record<string, unknown>): string {
    const sourceDoc = norm(row.source_doc_type);
    const txDesc = norm(row.transaction_description);
    const lineDesc = norm(row.line_description);
    const voucherType = norm(row.voucher_type);
    const debit = Number(row.debit_amount ?? 0);
    const credit = Number(row.credit_amount ?? 0);

    if (sourceDoc === "payment") {
        if (credit > 0) return "Cash received";
        if (debit > 0) return "Cash paid";
        return txDesc || "Payment";
    }

    if (sourceDoc === "sales_invoice" || voucherType === "SALES_INVOICE") {
        return txDesc || "Sales invoice";
    }
    if (sourceDoc === "purchase_invoice" || voucherType === "PURCHASE_INVOICE") {
        return txDesc || "Purchase invoice";
    }
    if (sourceDoc === "sales_return" || voucherType === "SALES_RETURN") {
        return txDesc || "Sales return";
    }
    if (sourceDoc === "purchase_return" || voucherType === "PURCHASE_RETURN") {
        return txDesc || "Purchase return";
    }
    if (sourceDoc === "parchi_instrument") return txDesc || "Parchi";
    if (sourceDoc === "scrap_trade") return txDesc || "Scrap trade";
    if (sourceDoc === "scrap_receipt") return txDesc || "Scrap receipt";
    if (sourceDoc === "opening") return txDesc || "Opening Balance";
    if (sourceDoc === "carry_forward") return txDesc || "Balance brought forward";

    // Rate-fixed financial postings use the same voucher type as the source document.
    if (voucherType === "RATE_FIX") {
        if (sourceDoc === "sales_invoice") return txDesc || "Sales invoice";
        if (sourceDoc === "purchase_invoice") return txDesc || "Purchase invoice";
        if (sourceDoc === "sales_return") return txDesc || "Sales return";
        if (sourceDoc === "purchase_return") return txDesc || "Purchase return";
        if (sourceDoc === "scrap_trade") return txDesc || "Scrap trade";
    }

    if (txDesc && /rate pending/i.test(txDesc)) return txDesc;
    if (norm(row.particulars).toLowerCase().startsWith("rate pending")) {
        if (sourceDoc === "purchase_invoice" || voucherType === "PURCHASE_INVOICE") return "Purchase invoice (rate pending)";
        if (sourceDoc === "sales_invoice" || voucherType === "SALES_INVOICE") return "Sales invoice (rate pending)";
        if (sourceDoc === "sales_return" || voucherType === "SALES_RETURN") return "Sales return (rate pending)";
        if (sourceDoc === "purchase_return" || voucherType === "PURCHASE_RETURN") return "Purchase return (rate pending)";
        if (sourceDoc === "scrap_trade" || voucherType === "SCRAP_TRADE") return "Scrap trade (rate pending)";
        return "Rate pending";
    }
    if (lineDesc && !isGenericGlLabel(lineDesc)) return cleanRateFixLabel(lineDesc);
    if (voucherType) return voucherType.replace(/_/g, " ");
    return "—";
}

export function formatLedgerRef(row: Record<string, unknown>): string {
    // Cashbook payments: ref is cashbook page (p.N) — never fall back to payment/voucher no.
    if (norm(row.source_doc_type) === "payment") {
        const page = norm(row.ref_no);
        if (!page || page === "—" || page === "?") return "—";
        if (/^p\./i.test(page)) return page;
        return `p.${page}`;
    }
    return norm(row.ref_no) || norm(row.source_doc_no) || norm(row.voucher_no) || "—";
}
