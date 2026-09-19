export type MarketQuoteRow = {
    code: string;
    label: string;
    unit: string;
    value: number;
    currency: string;
    source: string;
    quoted_at: string;
    change_1d_pct: number | null;
};

export type MarketHistoryPoint = {
    quoted_at: string;
    value: number;
    change_1d_pct: number | null;
};

export type MarketErpContext = {
    days: number;
    implied_pkr_per_kg: number;
    premium_ref_scrap_avg: number;
    premium_ref_scrap_min: number;
    premium_ref_scrap_max: number;
    premium_invoice_count: number;
    avg_scrap_lot_rate: number;
    spread_vs_implied: number | null;
    suggested_ref_scrap_low: number;
    suggested_ref_scrap_high: number;
};

export type MarketSettings = {
    conversion_factor: number;
    local_premium_pkr: number;
    ai_brief_enabled: boolean;
    last_sync_at: string | null;
    last_sync_status: string | null;
};

export type MarketBrief = {
    id: string;
    brief_date: string;
    content_md: string;
    signal: "buy" | "hold" | "caution" | null;
    model: string | null;
    input_snapshot: Record<string, unknown> | null;
    created_at: string;
};
