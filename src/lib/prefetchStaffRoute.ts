import { queryClient, queryKeys, staleTimes } from "@/lib/queryClient";
import { prefetchRoute } from "@/lib/routePrefetch";
import { prefetchModalsForRoute } from "@/lib/modalPrefetch";
import { loadScrapTradesList } from "@/hooks/useErpQueries";
import { fetchSalesOrders } from "@/lib/api/salesInvoices";
import { fetchPurchaseOrders } from "@/lib/api/purchaseInvoices";

/** Prefetch route chunk + warm list data before navigation. */
export function prefetchStaffRoute(pathname: string): void {
    prefetchRoute(pathname);
    prefetchModalsForRoute(pathname);
    if (!pathname.startsWith("/")) return;

    const base = pathname.split("?")[0];
    if (base === "/scrap") {
        void queryClient.prefetchQuery({
            queryKey: queryKeys.scrapTrades,
            queryFn: loadScrapTradesList,
            staleTime: staleTimes.transactions,
        });
    }
    if (base === "/sales") {
        void queryClient.prefetchQuery({
            queryKey: queryKeys.salesOrders,
            queryFn: () => fetchSalesOrders(),
            staleTime: staleTimes.transactions,
        });
    }
    if (base === "/purchase") {
        void queryClient.prefetchQuery({
            queryKey: queryKeys.purchaseOrders,
            queryFn: () => fetchPurchaseOrders(),
            staleTime: staleTimes.transactions,
        });
    }
}
