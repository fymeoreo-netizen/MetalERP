/**
 * Prefetch heavy document-modal chunks so the form appears instantly on click.
 * import() is cached, so warming a chunk here makes the page's own lazy() resolve
 * synchronously from cache instead of paying a cold network download.
 */
const MODAL_LOADERS: Record<string, () => Promise<unknown>> = {
    "/sales": () => import("@/components/sales/CreateSalesInvoiceModal"),
    "/sales:credit": () => import("@/components/sales/CreateCreditNoteModal"),
    "/sales:order": () => import("@/components/sales/CreateOrderModal"),
    "/purchase": () => import("@/components/procurement/PurchaseInvoiceModal"),
    "/purchase:return": () => import("@/components/procurement/PurchaseReturnModal"),
    "/purchase:po": () => import("@/components/procurement/CreatePOModal"),
    "/scrap": () => import("@/components/sales/CreateTriangleTradeModal"),
};

const prefetched = new Set<string>();

function warm(key: string) {
    if (prefetched.has(key)) return;
    const loader = MODAL_LOADERS[key];
    if (!loader) return;
    prefetched.add(key);
    void loader();
}

/** Prefetch all modal chunks relevant to a staff route. */
export function prefetchModalsForRoute(pathname: string): void {
    const base = pathname.split("?")[0];
    if (base === "/sales") {
        warm("/sales");
        warm("/sales:credit");
        warm("/sales:order");
    } else if (base === "/purchase") {
        warm("/purchase");
        warm("/purchase:return");
        warm("/purchase:po");
    } else if (base === "/scrap") {
        warm("/scrap");
    }
}
