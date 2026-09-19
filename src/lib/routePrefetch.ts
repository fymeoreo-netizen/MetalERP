/** Prefetch lazy route chunks on nav hover so page switches feel instant. */
const ROUTE_LOADERS: Record<string, () => Promise<unknown>> = {
    "/dashboard": () => import("@/pages/dashboard/DashboardRouter"),
    "/purchase": () => import("@/pages/procurement/Purchase"),
    "/sales": () => import("@/pages/sales/Sales"),
    "/cashbook": () => import("@/pages/financials/Cashbook"),
    "/inventory": () => import("@/pages/inventory/Inventory"),
    "/production": () => import("@/pages/production/Production"),
    "/scrap": () => import("@/pages/trading/TriangleTrade"),
    "/reports": () => import("@/pages/reports/Reports"),
    "/ledgers": () => import("@/pages/reports/LedgersPage"),
    "/parchis": () => import("@/pages/financials/ParchiRegister"),
    "/rate-management": () => import("@/pages/ratemanagement/RateManagement"),
    "/market": () => import("@/pages/market/MarketIntelligence"),
    "/assistant": () => import("@/pages/assistant/ErpAssistant"),
    "/alerts": () => import("@/pages/alerts/Alerts"),
};

const prefetched = new Set<string>();

export function prefetchRoute(pathname: string): void {
    const base = pathname.split("?")[0];
    const loader = ROUTE_LOADERS[base];
    if (!loader || prefetched.has(base)) return;
    prefetched.add(base);
    void loader();
}

/** Warm common staff routes after login when the browser is idle. */
export function prefetchCommonRoutesIdle(): void {
    const warm = ["/sales", "/purchase", "/scrap", "/cashbook"];
    const run = () => warm.forEach(prefetchRoute);
    if (typeof requestIdleCallback === "function") {
        requestIdleCallback(run, { timeout: 4000 });
    } else {
        setTimeout(run, 1500);
    }
}
