import { supabase } from "@/lib/supabase";
import { formatDbError } from "./core";
import type { Result } from "./types";

/** Standardized wrapper for async mutations returning Result<T>. */
export async function runMutation<T>(
    label: string,
    fn: () => Promise<Result<T>>,
    fallback = "Operation failed.",
): Promise<Result<T>> {
    try {
        return await fn();
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : fallback || `${label} failed.` };
    }
}

/** Standardized wrapper for Supabase RPC mutations. */
export async function runRpcMutation<T>(
    label: string,
    call: () => PromiseLike<{ data: T | null; error: unknown | null }>,
    mapData: (data: T | null) => Result<T>,
    fallback?: string,
): Promise<Result<T>> {
    return runMutation(label, async () => {
        const { data, error } = await call();
        if (error) return { ok: false, error: formatDbError(error, fallback ?? `Failed to ${label}.`) };
        return mapData(data);
    }, fallback);
}

/** ERP schema RPC helper — most mutation call sites should use this. */
export async function runErpRpc<T>(
    label: string,
    rpcName: string,
    args: Record<string, unknown>,
    mapData?: (data: T | null) => Result<T>,
    fallback?: string,
): Promise<Result<T>> {
    return runRpcMutation(
        label,
        () => supabase.schema("erp").rpc(rpcName, args),
        mapData ?? ((data) => ({ ok: true, data: data as T })),
        fallback ?? `Failed to ${label}.`,
    );
}

/** ERP RPC that returns void on success. */
export async function runErpRpcVoid(
    label: string,
    rpcName: string,
    args: Record<string, unknown>,
    fallback?: string,
): Promise<Result<true>> {
    return runErpRpc(label, rpcName, args, () => ({ ok: true, data: true }), fallback);
}

/** For mutations that throw on failure (e.g. postDocument). */
export async function runThrowingMutation(
    label: string,
    fn: () => Promise<void>,
    fallback = "Operation failed.",
): Promise<Result<true>> {
    return runMutation(label, async () => {
        await fn();
        return { ok: true, data: true };
    }, fallback);
}
