import { useCallback, useRef } from "react";
import { resolveWattaDetailed } from "@/lib/repositories/wattaRepo";
import { isErpLiveMode } from "@/lib/backendFlags";

type CacheEntry = { watta: number; at: number };

const CACHE_TTL_MS = 60_000;

function cacheKey(partyCode: string, itemCode: string, asOf: string, swg: number | null) {
    return `${partyCode}|${itemCode}|${asOf}|${swg ?? ""}`;
}

export function usePremiumWattaResolver(params: {
    partyCode: string;
    asOf: string;
    direction?: "sales" | "purchase";
    onError?: (message: string) => void;
}) {
    const { partyCode, asOf, direction = "sales", onError } = params;
    const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const resolveForItem = useCallback(
        async (itemCode: string, swgOverride?: number | null): Promise<number> => {
            if (!itemCode) return 0;
            if (!isErpLiveMode()) return 0;

            const key = cacheKey(partyCode, itemCode, asOf, swgOverride ?? null);
            const cached = cacheRef.current.get(key);
            if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
                return cached.watta;
            }

            const res = await resolveWattaDetailed({
                partyCode: partyCode || null,
                itemCode,
                direction,
                asOf,
                swgOverride: swgOverride ?? null,
            });
            if (!res.ok) {
                onError?.(res.error);
                return 0;
            }
            cacheRef.current.set(key, { watta: res.data, at: Date.now() });
            return res.data;
        },
        [partyCode, asOf, direction, onError],
    );

    const resolveForItemDebounced = useCallback(
        (itemCode: string, swgOverride: number | null | undefined, onResult: (watta: number) => void) => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                void resolveForItem(itemCode, swgOverride).then(onResult);
            }, 150);
        },
        [resolveForItem],
    );

    const resolveMany = useCallback(
        async (
            lines: { itemCode: string; swgOverride?: number | null }[],
        ): Promise<Record<string, number>> => {
            const out: Record<string, number> = {};
            for (const line of lines) {
                const key = `${line.itemCode}|${line.swgOverride ?? ""}`;
                if (out[key] != null) continue;
                out[key] = await resolveForItem(line.itemCode, line.swgOverride);
            }
            return out;
        },
        [resolveForItem],
    );

    const clearCache = useCallback(() => {
        cacheRef.current.clear();
    }, []);

    return { resolveForItem, resolveForItemDebounced, resolveMany, clearCache };
}
