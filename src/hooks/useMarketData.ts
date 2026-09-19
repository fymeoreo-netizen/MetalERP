import { useCallback, useEffect, useState } from "react";
import {
    fetchMarketLatestQuotes,
    fetchMarketQuoteHistory,
    type MarketHistoryPoint,
    type MarketQuoteRow,
} from "@/lib/repositories/marketRepo";

export function useMarketQuotes() {
    const [quotes, setQuotes] = useState<MarketQuoteRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const rows = await fetchMarketLatestQuotes();
            setQuotes(rows);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load quotes");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const byCode = (code: string) => quotes.find((q) => q.code === code);

    return { quotes, byCode, loading, error, reload };
}

export function useMarketHistory(symbol: string, days = 7) {
    const [points, setPoints] = useState<MarketHistoryPoint[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchMarketQuoteHistory(symbol, days)
            .then((rows) => {
                if (!cancelled) setPoints(rows);
            })
            .catch(() => {
                if (!cancelled) setPoints([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [symbol, days]);

    const chartData = points.map((p) => ({
        name: new Date(p.quoted_at).toLocaleDateString(undefined, { weekday: "short" }),
        price: Number(p.value),
    }));

    return { points, chartData, loading };
}

export function formatQuoteValue(q: MarketQuoteRow | undefined): string {
    if (!q || q.value == null) return "—";
    if (q.currency === "USD") return `$${Number(q.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    if (q.unit.includes("PKR/kg")) return `₨ ${Number(q.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}/kg`;
    return `₨ ${Number(q.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function formatChangePct(pct: number | null | undefined): { text: string; up: boolean | null } {
    if (pct == null || Number.isNaN(pct)) return { text: "—", up: null };
    const up = pct >= 0;
    return { text: `${up ? "+" : ""}${pct.toFixed(2)}%`, up };
}
