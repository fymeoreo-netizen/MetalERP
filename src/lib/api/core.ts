import { agentDebugLog } from "@/lib/agentDebugLog";
import { hasErpContext, isSupabaseConfigured, persistSessionPatch } from "@/lib/appSession";
import { isErpLiveMode } from "@/lib/backendFlags";
import { supabase } from "@/lib/supabase";
import type { Result } from "@/lib/api/types";

export function formatDbError(error: unknown, fallback: string): string {
    if (!error || typeof error !== "object") return fallback;
    const e = error as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
        error?: string;
    };
    const msg = e.message ?? e.error ?? "";
    let detail = e.details;
    if (typeof detail === "string" && detail.startsWith("{")) {
        try {
            const parsed = JSON.parse(detail) as { message?: string };
            if (parsed.message) detail = parsed.message;
        } catch {
            /* keep raw */
        }
    }
    const parts = [msg, detail, e.hint, e.code ? `(${e.code})` : ""].filter(Boolean);
    // Only expose raw DB error objects to the console / global in development.
    // In production this avoids leaking schema internals to the browser.
    if (typeof window !== "undefined" && import.meta.env.DEV) {
        try {
            (window as unknown as { __lastErpError?: unknown }).__lastErpError = error;
            console.warn("[ERP DB Error]", error);
        } catch {
            /* ignore */
        }
    }
    if (import.meta.env.DEV) {
        return parts.length ? parts.join(" | ") : fallback;
    }
    // Production: return a concise message; keep business-rule messages (P0001) which are
    // user-facing by design, but drop low-level details/hints/codes.
    if (e.code === "P0001" && msg) return msg;
    return msg || fallback;
}

export function isMissingSchemaColumn(error: unknown, column: string): boolean {
    if (!error || typeof error !== "object") return false;
    const e = error as { code?: string; message?: string };
    const msg = (e.message ?? "").toLowerCase();
    const col = column.toLowerCase();
    return (
        e.code === "PGRST204" ||
        (msg.includes(col) && (msg.includes("schema cache") || msg.includes("could not find")))
    );
}

/** True when PostgREST cannot find the requested RPC (not yet migrated or schema not reloaded). */
export function isMissingRpc(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const e = error as { code?: string; message?: string; status?: number };
    const msg = (e.message ?? "").toLowerCase();
    return (
        e.code === "PGRST202" ||
        e.status === 404 ||
        msg.includes("could not find the function") ||
        (msg.includes("function") && msg.includes("does not exist"))
    );
}

export async function fetchReportRpc<T>(
    label: string,
    call: () => PromiseLike<{ data: T | null; error: unknown | null }>,
    fallback: T,
): Promise<T> {
    const { data, error } = await call();
    if (error) {
        console.error(`[erp] ${label} failed`, error);
        throw new Error(formatDbError(error, `Failed to load ${label}.`));
    }
    return (data ?? fallback) as T;
}

export function mapDbMovementType(type: string): string {
    const normalized = type.toLowerCase();
    if (normalized === "sales_out") return "SALES_INVOICE";
    if (normalized === "sales_return_in") return "SALES_RETURN";
    if (normalized === "purchase_in") return "PURCHASE_INVOICE";
    if (normalized === "purchase_return_out") return "PURCHASE_RETURN";
    if (normalized === "scrap_out") return "SCRAP_OUTWARD";
    if (normalized === "production_issue") return "PRODUCTION_ISSUE";
    if (normalized === "production_receipt") return "PRODUCTION_RECEIPT";
    if (normalized === "opening") return "OPENING";
    return "ADJUSTMENT";
}

export async function resolvePostingContext(): Promise<{ ok: true } | null> {
    const { data: sessionData } = await supabase.auth.getSession();
    let sessionUserId = sessionData.session?.user?.id ?? null;
    if (!sessionUserId) {
        const { data: userData } = await supabase.auth.getUser();
        sessionUserId = userData.user?.id ?? null;
    }
    if (!sessionUserId) {
        agentDebugLog("erpApi.ts:resolvePostingContext", "no session user", { liveMode: isErpLiveMode() });
    }
    if (!sessionUserId) return null;
    persistSessionPatch({ userId: sessionUserId });
    return { ok: true };
}

export function ensureEnabled(): Result<true> {
    if (!isSupabaseConfigured()) return { ok: false, error: "Supabase is not configured." };
    if (!isErpLiveMode()) return { ok: false, error: "ERP live mode is disabled (demo mode)." };
    return { ok: true, data: true };
}

export function ensureConfigured(): Result<true> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: false, error: "ERP is not configured or you are not signed in." };
    }
    return { ok: true, data: true };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getPartyIdByCode(code: string): Promise<string | null> {
    const { data } = await supabase.schema("erp").from("parties").select("id").eq("code", code).maybeSingle();
    return data?.id ?? null;
}

export async function resolvePartyId(partyIdOrCode: string | null | undefined): Promise<string | null> {
    if (!partyIdOrCode) return null;
    if (UUID_RE.test(partyIdOrCode)) return partyIdOrCode;
    return getPartyIdByCode(partyIdOrCode);
}

export async function getItemIdsByCode(codes: string[]): Promise<Record<string, string>> {
    const uniq = Array.from(new Set(codes.filter(Boolean)));
    if (!uniq.length) return {};
    const { data } = await supabase.schema("erp").from("items").select("id,code").in("code", uniq);
    const map: Record<string, string> = {};
    (data ?? []).forEach((row) => {
        map[row.code] = row.id;
    });
    return map;
}

export async function getWarehouseIdByType(whType: string): Promise<string | null> {
    const { data } = await supabase
        .schema("erp")
        .from("warehouses")
        .select("id")
        .eq("wh_type", whType)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
    return data?.id ?? null;
}

const INVENTORY_GROUP_WAREHOUSE: Record<string, string> = {
    enameled: "finished_goods",
    strip: "finished_goods",
    copper_wire: "finished_goods",
    raw_material: "raw_material",
    packing_material: "packing_material",
    chemicals: "varnish",
};

export async function resolveWarehousesForItemIds(itemIds: string[]): Promise<Record<string, string>> {
    const uniq = Array.from(new Set(itemIds.filter(Boolean)));
    if (!uniq.length) return {};

    const { data: items } = await supabase
        .schema("erp")
        .from("items")
        .select("id,inventory_group")
        .in("id", uniq);
    if (!items?.length) return {};

    const whTypes = new Set<string>();
    const itemWhType: Record<string, string> = {};
    for (const row of items) {
        const whType = INVENTORY_GROUP_WAREHOUSE[String(row.inventory_group ?? "")] ?? "raw_material";
        itemWhType[row.id] = whType;
        whTypes.add(whType);
    }

    const { data: warehouses } = await supabase
        .schema("erp")
        .from("warehouses")
        .select("id,wh_type")
        .in("wh_type", Array.from(whTypes))
        .eq("is_active", true);

    const whByType: Record<string, string> = {};
    for (const wh of warehouses ?? []) {
        if (!whByType[wh.wh_type]) whByType[wh.wh_type] = wh.id;
    }

    const result: Record<string, string> = {};
    for (const id of uniq) {
        const whType = itemWhType[id];
        const whId = whByType[whType];
        if (whId) result[id] = whId;
    }
    return result;
}

export async function resolveWarehousesForItemCodes(
    itemMap: Record<string, string>,
    codes: string[],
): Promise<Result<Record<string, string>>> {
    const itemIds = codes.map((c) => itemMap[c]).filter(Boolean);
    const byItemId = await resolveWarehousesForItemIds(itemIds);
    const warehouseByItem: Record<string, string> = {};
    for (const code of codes) {
        const itemId = itemMap[code];
        if (!itemId) continue;
        const whId = byItemId[itemId];
        if (!whId) return { ok: false, error: `Warehouse not found for item ${code}.` };
        warehouseByItem[code] = whId;
    }
    return { ok: true, data: warehouseByItem };
}

export async function findDraftDocumentId(
    table: "sales_invoices" | "purchase_invoices",
    invoiceNo: string,
): Promise<string | null> {
    const trimmed = invoiceNo?.trim();
    if (!trimmed) return null;
    const { data } = await supabase
        .schema("erp")
        .from(table)
        .select("id,posting_status")
        .eq("invoice_no", trimmed)
        .maybeSingle();
    if (!data || data.posting_status === "posted") return null;
    return data.id;
}

export function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}

/**
 * Escape SQL LIKE/ILIKE wildcards (% _ \) so a free-text search term is matched
 * literally. Prevents users from injecting wildcards to broaden/abuse searches.
 */
export function escapeLikePattern(term: string): string {
    return term.replace(/([\\%_])/g, "\\$1");
}
