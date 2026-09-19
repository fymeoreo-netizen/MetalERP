import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { supabase } from "@/lib/supabase";
import { isMissingRpc } from "@/lib/api/core";

/** Extract trailing numeric sequence after a fixed prefix (e.g. PI-2026-003 → 3). */
export function parseDocumentSequence(code: string, prefix: string): number {
    if (!code?.trim()) return 0;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(code).trim().match(new RegExp(`^${escaped}(\\d+)$`, "i"));
    if (!match) return 0;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : 0;
}

const demoCounters: Record<string, number> = {};

function nextDemoNumber(key: string, prefix: string, padLength: number): string {
    demoCounters[key] = (demoCounters[key] ?? 0) + 1;
    return `${prefix}${String(demoCounters[key]).padStart(padLength, "0")}`;
}

export type AllocateDocumentNoParams = {
    table: string;
    column: string;
    prefix: string;
    padLength?: number;
    demoKey?: string;
};

/** Skip repeat 404s when fn_next_document_no (migration 167) is not on the remote DB. */
let docNoRpcAvailable: boolean | null = null;

/** Next document number = max existing sequence for prefix + 1 (starts at 1). */
export async function allocateNextDocumentNo({
    table,
    column,
    prefix,
    padLength = 3,
    demoKey,
}: AllocateDocumentNoParams): Promise<string> {
    const key = demoKey ?? `${table}.${column}.${prefix}`;
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return nextDemoNumber(key, prefix, padLength);
    }

    // Fast path: server-side aggregate (migration 167) — one round-trip, no row transfer.
    if (docNoRpcAvailable !== false) {
        const { data, error } = await supabase.schema("erp").rpc("fn_next_document_no", {
            p_table: table,
            p_column: column,
            p_prefix: prefix,
            p_pad: padLength,
        });
        if (!error && typeof data === "string" && data.trim()) {
            docNoRpcAvailable = true;
            return data;
        }
        if (error && isMissingRpc(error)) docNoRpcAvailable = false;
        else if (error) {
            // Unexpected RPC error — fall through to the scan path below.
        }
    }

    // Fallback: prefix scan + client-side max (works before migration 167).
    const { data, error } = await supabase
        .schema("erp")
        .from(table)
        .select(column)
        .ilike(column, `${prefix}%`);

    if (error) {
        return nextDemoNumber(key, prefix, padLength);
    }

    const maxSeq = (data ?? []).reduce((max, row) => {
        const val = (row as unknown as Record<string, unknown>)[column];
        return Math.max(max, parseDocumentSequence(String(val ?? ""), prefix));
    }, 0);

    return `${prefix}${String(maxSeq + 1).padStart(padLength, "0")}`;
}

export function yearPrefix(base: string): string {
    return `${base}${new Date().getFullYear()}-`;
}

export async function allocateNextSalesInvoiceNo(): Promise<string> {
    return allocateNextDocumentNo({
        table: "sales_invoices",
        column: "invoice_no",
        prefix: yearPrefix("INV-"),
    });
}

export async function allocateNextPurchaseInvoiceNo(): Promise<string> {
    return allocateNextDocumentNo({
        table: "purchase_invoices",
        column: "invoice_no",
        prefix: yearPrefix("PI-"),
    });
}

export async function allocateNextSalesOrderNo(): Promise<string> {
    return allocateNextDocumentNo({
        table: "sales_orders",
        column: "order_no",
        prefix: "SO-",
        padLength: 1,
    });
}

export async function allocateNextPurchaseOrderNo(): Promise<string> {
    return allocateNextDocumentNo({
        table: "purchase_orders",
        column: "order_no",
        prefix: yearPrefix("PO-"),
    });
}

export async function allocateNextSalesReturnNo(): Promise<string> {
    return allocateNextDocumentNo({
        table: "sales_returns",
        column: "return_no",
        prefix: yearPrefix("CN-"),
    });
}

export async function allocateNextPurchaseReturnNo(): Promise<string> {
    return allocateNextDocumentNo({
        table: "purchase_returns",
        column: "return_no",
        prefix: yearPrefix("DN-"),
    });
}

export async function allocateNextPaymentNo(): Promise<string> {
    return allocateNextDocumentNo({
        table: "payments",
        column: "payment_no",
        prefix: "V-",
        padLength: 4,
    });
}

export async function allocateNextParchiNo(): Promise<string> {
    const yy = String(new Date().getFullYear()).slice(-2);
    return allocateNextDocumentNo({
        table: "parchi_instruments",
        column: "parchi_no",
        prefix: `PAR-${yy}-`,
    });
}
