import { supabase } from "@/lib/supabase";
import { formatDbError } from "./core";
import { parseRpcJsonResult, tryInvoiceDeleteRpc, type InvoiceDeleteFn } from "./documentRpc";
import { runErpRpc, runErpRpcVoid, runMutation } from "./mutations";
import type { Result } from "./types";

export type HardDeleteRpcResult = {
    ok: boolean;
    error?: string;
    step?: string;
    linkedOrderLines?: number;
    /** True when the server executed the RPC and explicitly refused (e.g. payment
     *  allocations, admin required). Distinct from "RPC missing/unavailable". */
    refused?: boolean;
};

/** Void a posted invoice via canonical void_* RPC. */
export async function voidDocumentRpc(
    rpcName: "void_sales_invoice" | "void_purchase_invoice",
    docId: string,
    reason?: string,
    label = "void document",
): Promise<Result<{ returnId: string }>> {
    return runErpRpc(label, rpcName, { doc_id: docId, p_reason: reason ?? null }, (data) => ({
        ok: true,
        data: { returnId: String(data) },
    }));
}

/** Hard-delete via a single ERP RPC returning jsonb { ok, error?, step? }. */
export async function hardDeleteDocumentRpc(
    rpcName: string,
    docId: string,
    label: string,
): Promise<HardDeleteRpcResult> {
    const result = await runErpRpc<unknown>(label, rpcName, { p_doc_id: docId });
    if (!result.ok) return { ok: false, error: result.error };
    const parsed = parseRpcJsonResult(result.data);
    if (!parsed.ok) {
        const stepSuffix = parsed.step ? ` (step: ${parsed.step})` : "";
        return { ok: false, error: `${parsed.error ?? "Delete failed."}${stepSuffix}`, step: parsed.step, refused: true };
    }
    return { ok: true, linkedOrderLines: parsed.linkedOrderLines };
}

/** Invoice hard-delete with admin fallback RPC names. */
export async function hardDeleteInvoiceRpc(
    primaryFn: "hard_delete_sales_invoice" | "hard_delete_purchase_invoice",
    docId: string,
    label: string,
): Promise<HardDeleteRpcResult> {
    const fallbackFn: InvoiceDeleteFn =
        primaryFn === "hard_delete_sales_invoice"
            ? "admin_hard_delete_sales_invoice"
            : "admin_hard_delete_purchase_invoice";
    const attempts: InvoiceDeleteFn[] = [primaryFn, fallbackFn];
    let rpcData: unknown = null;
    let rpcSucceeded = false;
    let rpcErrorMsg: string | null = null;

    for (const candidate of attempts) {
        const result = await tryInvoiceDeleteRpc(candidate, docId);
        if (result.ok) {
            rpcData = result.data;
            rpcSucceeded = true;
            break;
        }
        if (!result.missing && !rpcErrorMsg) {
            rpcErrorMsg = result.error ?? null;
        }
    }

    if (!rpcSucceeded) {
        return { ok: false, error: rpcErrorMsg ?? `Failed to ${label}.` };
    }

    const parsed = parseRpcJsonResult(rpcData);
    if (!parsed.ok && parsed.error) {
        const stepSuffix = parsed.step ? ` (step: ${parsed.step})` : "";
        return { ok: false, error: `${parsed.error}${stepSuffix}`, step: parsed.step, refused: true };
    }
    return { ok: true, linkedOrderLines: parsed.linkedOrderLines };
}

/** Scoped inventory rebuild for affected items only (no full-table rebuild). */
export async function rebuildInventoryForItems(itemIds: string[]): Promise<Result<true>> {
    const unique = Array.from(new Set(itemIds.filter(Boolean)));
    if (unique.length === 0) return { ok: true, data: true };
    return runErpRpcVoid("rebuild inventory balances", "rebuild_inventory_balances_for_items", {
        p_item_ids: unique,
    });
}

/** Collect distinct item ids from inventory_movements for a source document. */
export async function collectItemIdsForDocument(
    sourceDocType: string,
    sourceDocId: string,
): Promise<string[]> {
    const { data, error } = await supabase
        .schema("erp")
        .from("inventory_movements")
        .select("item_id")
        .eq("source_doc_type", sourceDocType)
        .eq("source_doc_id", sourceDocId);
    if (error) {
        console.warn("[ERP] collectItemIdsForDocument failed", error);
        return [];
    }
    return Array.from(
        new Set(
            (data ?? [])
                .map((row) => (row as { item_id?: string | null }).item_id)
                .filter((id): id is string => Boolean(id)),
        ),
    );
}

/** Merge item id lists used by client-side cascade delete fallback. */
export function mergeItemIdLists(...lists: string[][]): string[] {
    return Array.from(new Set(lists.flat().filter(Boolean)));
}

/** Run a client-side cascade delete and scoped rebuild only. */
export async function runClientDeleteWithScopedRebuild<T extends Result<unknown>>(
    label: string,
    itemIds: string[],
    deleteFn: () => Promise<T>,
): Promise<T> {
    const result = await runMutation(label, deleteFn);
    if (!result.ok) return result as T;
    const rebuild = await rebuildInventoryForItems(itemIds);
    if (!rebuild.ok) {
        console.warn(`[ERP] ${label}: scoped inventory rebuild failed`, rebuild.error);
    }
    return result as T;
}
