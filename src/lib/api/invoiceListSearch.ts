import { supabase } from "@/lib/supabase";
import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { asRows } from "./contracts/shared";
import { escapeLikePattern, formatDbError } from "./core";
import type { PaginatedRows, Result } from "./types";

const INVOICE_SEARCH_PAGE_SIZE = 1000;
const PARTY_SEARCH_LIMIT = 5000;

type InvoiceTable = "sales_invoices" | "purchase_invoices";
type InvoiceListSearchOptions = {
    table: InvoiceTable;
    term: string;
    select: string;
    errorLabel: string;
};

type InvoiceSearchRow = {
    id: string;
    invoice_no?: string | null;
    invoice_date?: string | null;
};

const MONTHS: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
};

function isoDate(year: number, month: number, day: number) {
    if (year < 100) year += 2000;
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseInvoiceSearchDate(input: string): string | null {
    const term = input.trim().replace(/,/g, " ").replace(/\s+/g, " ");
    if (!term) return null;

    let m = term.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));

    m = term.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (m) return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));

    m = term.match(/^(\d{1,2})[\s-]+([a-zA-Z]+)(?:[\s-]+(\d{2,4}))?$/);
    if (m) {
        const month = MONTHS[m[2].toLowerCase()];
        if (month) return isoDate(Number(m[3] ?? new Date().getFullYear()), month, Number(m[1]));
    }

    m = term.match(/^([a-zA-Z]+)[\s-]+(\d{1,2})(?:[\s-]+(\d{2,4}))?$/);
    if (m) {
        const month = MONTHS[m[1].toLowerCase()];
        if (month) return isoDate(Number(m[3] ?? new Date().getFullYear()), month, Number(m[2]));
    }

    return null;
}

async function fetchMatchingPartyIds(term: string): Promise<Result<string[]>> {
    const pattern = `%${escapeLikePattern(term)}%`;
    const [byName, byCode] = await Promise.all([
        supabase.schema("erp").from("parties").select("id").ilike("name", pattern).limit(PARTY_SEARCH_LIMIT),
        supabase.schema("erp").from("parties").select("id").ilike("code", pattern).limit(PARTY_SEARCH_LIMIT),
    ]);
    const error = byName.error ?? byCode.error;
    if (error) return { ok: false, error: formatDbError(error, "Failed to search parties.") };

    const ids = new Set<string>();
    for (const row of [...asRows<{ id: string }>(byName.data), ...asRows<{ id: string }>(byCode.data)]) {
        if (row.id) ids.add(row.id);
    }
    return { ok: true, data: Array.from(ids) };
}

function compareInvoiceRows(a: InvoiceSearchRow, b: InvoiceSearchRow) {
    const dateCompare = String(b.invoice_date ?? "").localeCompare(String(a.invoice_date ?? ""));
    if (dateCompare !== 0) return dateCompare;
    return String(b.invoice_no ?? "").localeCompare(String(a.invoice_no ?? ""), undefined, {
        numeric: true,
        sensitivity: "base",
    });
}

function statusFilters(term: string) {
    const q = term.trim().toLowerCase();
    const filters: Array<{ column: "posting_status" | "financial_status"; value: string }> = [];
    if ("draft".includes(q) || q.includes("draft")) filters.push({ column: "posting_status", value: "draft" });
    if ("posted".includes(q) || q.includes("posted") || "completed".includes(q) || q.includes("completed")) {
        filters.push({ column: "posting_status", value: "posted" });
    }
    if ("pending".includes(q) || q.includes("pending")) filters.push({ column: "financial_status", value: "pending" });
    if ("partial".includes(q) || q.includes("partial")) filters.push({ column: "financial_status", value: "partial" });
    return filters;
}

async function fetchAllInvoiceRows<T>(
    makeQuery: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ rows: T[]; error: unknown }> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += INVOICE_SEARCH_PAGE_SIZE) {
        const { data, error } = await makeQuery(offset, offset + INVOICE_SEARCH_PAGE_SIZE - 1);
        if (error) return { rows, error };
        const pageRows = asRows<T>(data);
        rows.push(...pageRows);
        if (pageRows.length < INVOICE_SEARCH_PAGE_SIZE) return { rows, error: null };
    }
}

export async function fetchInvoiceListSearchPage<T extends InvoiceSearchRow>(
    options: InvoiceListSearchOptions,
): Promise<Result<PaginatedRows<T>>> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: true, data: { rows: [], total: 0, hasMore: false } };
    }

    const term = options.term.trim();
    if (!term) return { ok: true, data: { rows: [], total: 0, hasMore: false } };

    const pattern = `%${escapeLikePattern(term)}%`;
    const date = parseInvoiceSearchDate(term);
    const partyIds = await fetchMatchingPartyIds(term);
    if (!partyIds.ok) return partyIds;

    const queries: Array<(from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>> = [
        (from, to) =>
            supabase
                .schema("erp")
                .from(options.table)
                .select(options.select)
                .ilike("invoice_no", pattern)
                .order("invoice_date", { ascending: false })
                .order("created_at", { ascending: false })
                .range(from, to),
    ];

    if (date) {
        queries.push(
            (from, to) =>
                supabase
                    .schema("erp")
                    .from(options.table)
                    .select(options.select)
                    .eq("invoice_date", date)
                    .order("invoice_date", { ascending: false })
                    .order("created_at", { ascending: false })
                    .range(from, to),
        );
    }

    if (partyIds.data.length > 0) {
        queries.push(
            (from, to) =>
                supabase
                    .schema("erp")
                    .from(options.table)
                    .select(options.select)
                    .in("party_id", partyIds.data)
                    .order("invoice_date", { ascending: false })
                    .order("created_at", { ascending: false })
                    .range(from, to),
        );
    }

    for (const filter of statusFilters(term)) {
        queries.push(
            (from, to) =>
                supabase
                    .schema("erp")
                    .from(options.table)
                    .select(options.select)
                    .eq(filter.column, filter.value)
                    .order("invoice_date", { ascending: false })
                    .order("created_at", { ascending: false })
                    .range(from, to),
        );
    }

    const results = await Promise.all(queries.map((query) => fetchAllInvoiceRows<T>(query)));
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) return { ok: false, error: formatDbError(firstError, options.errorLabel) };

    const byId = new Map<string, T>();
    for (const result of results) {
        for (const row of result.rows) {
            if (row.id) byId.set(row.id, row);
        }
    }

    const rows = Array.from(byId.values()).sort(compareInvoiceRows);
    return {
        ok: true,
        data: {
            rows,
            total: rows.length,
            hasMore: false,
        },
    };
}
