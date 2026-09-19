import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import { supabase } from "@/lib/supabase";

export type AuditChainEvent = {
    eventId: string;
    eventAt: string;
    action: string;
    actorUserId: string | null;
    actorDisplayName: string;
    summary: string | null;
    entityType: string;
    beforeData: unknown;
    afterData: unknown;
};

export type TransactionHistoryRow = {
    id: string;
    eventAt: string;
    action: string;
    entityType: string;
    entityId: string;
    sourceDocType: string | null;
    sourceDocId: string | null;
    sourceDocNo: string | null;
    summary: string | null;
    actorUserId: string | null;
    actorDisplayName: string;
    beforeData: unknown;
    afterData: unknown;
    metadata: Record<string, unknown>;
};

export type TransactionHistoryFilters = {
    from?: string;
    to?: string;
    entityType?: string;
    actorId?: string;
    action?: string;
    search?: string;
    limit?: number;
};

function mapChainRow(r: Record<string, unknown>): AuditChainEvent {
    return {
        eventId: String(r.event_id ?? r.id ?? ""),
        eventAt: String(r.event_at ?? ""),
        action: String(r.action ?? ""),
        actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
        actorDisplayName: String(r.actor_display_name ?? "System"),
        summary: r.summary != null ? String(r.summary) : null,
        entityType: String(r.entity_type ?? ""),
        beforeData: r.before_data,
        afterData: r.after_data,
    };
}

function mapHistoryRow(r: Record<string, unknown>): TransactionHistoryRow {
    return {
        id: String(r.id ?? ""),
        eventAt: String(r.event_at ?? ""),
        action: String(r.action ?? ""),
        entityType: String(r.entity_type ?? ""),
        entityId: String(r.entity_id ?? ""),
        sourceDocType: r.source_doc_type ? String(r.source_doc_type) : null,
        sourceDocId: r.source_doc_id ? String(r.source_doc_id) : null,
        sourceDocNo: r.source_doc_no ? String(r.source_doc_no) : null,
        summary: r.summary != null ? String(r.summary) : null,
        actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
        actorDisplayName: String(r.actor_display_name ?? "System"),
        beforeData: r.before_data,
        afterData: r.after_data,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
    };
}

const auditChainCache = new Map<string, AuditChainEvent[]>();

function auditChainCacheKey(sourceDocType: string, sourceDocId: string): string {
    return `${sourceDocType}:${sourceDocId}`;
}

export function pickPostAttribution(events: AuditChainEvent[]): {
    name: string | null;
    at: string | null;
} {
    if (events.length === 0) return { name: null, at: null };
    const post =
        [...events].reverse().find((e) => e.action === "post") ??
        [...events].reverse().find((e) => e.actorDisplayName && e.actorDisplayName !== "System") ??
        events[events.length - 1];
    return {
        name: post.actorDisplayName || null,
        at: post.eventAt || null,
    };
}

export async function fetchAuditChain(
    sourceDocType: string | null | undefined,
    sourceDocId: string | null | undefined,
): Promise<AuditChainEvent[]> {
    if (!isSupabaseConfigured() || !hasErpContext() || !sourceDocType || !sourceDocId) return [];
    const key = auditChainCacheKey(sourceDocType, sourceDocId);
    const cached = auditChainCache.get(key);
    if (cached) return cached;

    const { data, error } = await supabase.schema("erp").rpc("fn_audit_chain", {
        p_source_doc_type: sourceDocType,
        p_source_doc_id: sourceDocId,
    });
    if (error) {
        console.warn("[audit] fn_audit_chain failed", error);
        return [];
    }
    const rows = (data ?? []).map((r: Record<string, unknown>) => mapChainRow(r));
    auditChainCache.set(key, rows);
    return rows;
}

/** Fill missing posted_by_name / posted_at on ledger RPC rows from audit chain. */
export async function enrichLedgerRowsWithAttribution(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return rows;

    const docKeys = new Map<string, { type: string; id: string }>();
    for (const row of rows) {
        const hasName = row.posted_by_name != null && String(row.posted_by_name).trim() !== "";
        const hasAt = row.posted_at != null && String(row.posted_at).trim() !== "";
        if (hasName || hasAt) continue;
        const type = row.source_doc_type ? String(row.source_doc_type) : "";
        const id = row.source_doc_id ? String(row.source_doc_id) : "";
        if (!type || !id || type === "opening") continue;
        const key = auditChainCacheKey(type, id);
        if (!docKeys.has(key)) docKeys.set(key, { type, id });
    }

    if (docKeys.size === 0) return rows;

    const attributionByDoc = new Map<string, { name: string | null; at: string | null }>();

    const bulkDocs = [...docKeys.values()].map(({ type, id }) => ({
        source_doc_type: type,
        source_doc_id: id,
    }));

    const { data: bulkData, error: bulkError } = await supabase.schema("erp").rpc("fn_audit_chain_bulk", {
        p_docs: bulkDocs,
    });

    if (!bulkError && Array.isArray(bulkData)) {
        for (const entry of bulkData as Array<{ source_doc_type?: string; source_doc_id?: string; chain?: unknown[] }>) {
            const type = String(entry.source_doc_type ?? "");
            const id = String(entry.source_doc_id ?? "");
            const key = auditChainCacheKey(type, id);
            const chainRows = (entry.chain ?? []).map((r) => mapChainRow(r as Record<string, unknown>));
            auditChainCache.set(key, chainRows);
            attributionByDoc.set(key, pickPostAttribution(chainRows));
        }
    } else {
        await Promise.all(
            [...docKeys.entries()].map(async ([key, { type, id }]) => {
                const chain = await fetchAuditChain(type, id);
                attributionByDoc.set(key, pickPostAttribution(chain));
            }),
        );
    }

    return rows.map((row) => {
        const hasName = row.posted_by_name != null && String(row.posted_by_name).trim() !== "";
        const hasAt = row.posted_at != null && String(row.posted_at).trim() !== "";
        if (hasName || hasAt) return row;

        const type = row.source_doc_type ? String(row.source_doc_type) : "";
        const id = row.source_doc_id ? String(row.source_doc_id) : "";
        if (!type || !id) return row;

        const attr = attributionByDoc.get(auditChainCacheKey(type, id));
        if (!attr || (!attr.name && !attr.at)) return row;

        return {
            ...row,
            posted_by_name: attr.name,
            posted_at: attr.at,
        };
    });
}

export async function fetchTransactionHistory(
    filters: TransactionHistoryFilters = {},
): Promise<TransactionHistoryRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const params: Record<string, string | number | null> = {
        p_limit: filters.limit ?? 200,
    };
    if (filters.from) params.p_from = filters.from;
    if (filters.to) params.p_to = filters.to;
    if (filters.entityType) params.p_entity_type = filters.entityType;
    if (filters.actorId) params.p_actor_id = filters.actorId;
    if (filters.action) params.p_action = filters.action;
    if (filters.search) params.p_search = filters.search;

    const { data, error } = await supabase.schema("erp").rpc("fn_transaction_history", params);
    if (error) {
        console.warn("[audit] fn_transaction_history failed", error);
        return [];
    }
    return (data ?? []).map((r: Record<string, unknown>) => mapHistoryRow(r));
}

export async function fetchUserDisplayNames(userIds: string[]): Promise<Record<string, string>> {
    if (!isSupabaseConfigured() || !hasErpContext() || userIds.length === 0) return {};
    const unique = [...new Set(userIds.filter(Boolean))];
    const { data, error } = await supabase.schema("erp").rpc("fn_user_display_names", {
        p_user_ids: unique,
    });
    if (error) {
        console.warn("[audit] fn_user_display_names failed", error);
        return {};
    }
    const out: Record<string, string> = {};
    (data ?? []).forEach((r: { user_id: string; display_name: string }) => {
        out[String(r.user_id)] = String(r.display_name ?? "");
    });
    return out;
}

/** @deprecated use fetchTransactionHistory */
export async function fetchAuditLogs(limit = 200): Promise<TransactionHistoryRow[]> {
    return fetchTransactionHistory({ limit });
}

export const AUDIT_ENTITY_TYPES = [
    "sales_invoices",
    "purchase_invoices",
    "sales_returns",
    "purchase_returns",
    "payments",
    "parchi_instruments",
    "sales_orders",
    "purchase_orders",
    "production_batches",
    "scrap_trades",
    "drawing_weekly_wage_sheets",
    "items",
    "parties",
    "coa_accounts",
    "journal_entry",
] as const;

export const AUDIT_ACTIONS = ["insert", "update", "delete", "post", "deactivate", "reopen"] as const;

export function formatAuditAction(action: string): string {
    if (action === "insert") return "Create";
    if (action === "update") return "Update";
    if (action === "delete") return "Delete";
    if (action === "post") return "Post";
    if (action === "deactivate") return "Deactivate";
    if (action === "reopen") return "Reopen";
    return action.charAt(0).toUpperCase() + action.slice(1);
}
