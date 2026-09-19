import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});

export const queryKeys = {
    coa: ["coa"] as const,
    parties: ["parties"] as const,
    items: ["items"] as const,
    erpAccess: ["erp-access"] as const,
    dashboardKpis: (from?: string, to?: string) => ["dashboard-kpis", from, to] as const,
    partyLedger: (party: string, from: string, to: string) => ["party-ledger", party, from, to] as const,
    accountLedger: (code: string, from: string, to: string) => ["account-ledger", code, from, to] as const,
    // Whole-screen payloads for the Unified Ledgers page (ledger + metal + scrap + parchi
    // + audit attribution resolved together). Nested under the same root keys above so the
    // existing invalidateAfterInvoiceDocumentChange() sweep clears them too.
    unifiedPartyLedger: (party: string, from: string, to: string, parchi: boolean, attribution: boolean) =>
        ["party-ledger", "unified", party, from, to, parchi, attribution] as const,
    unifiedAccountLedger: (code: string, from: string, to: string, attribution: boolean) =>
        ["account-ledger", "unified", code, from, to, attribution] as const,
    partyBalanceSnapshot: (asOf?: string) => ["party-balance-snapshot", asOf] as const,
    postableCoa: (context: string) => ["postable-coa", context] as const,
    salesOrders: ["sales-orders"] as const,
    salesInvoices: (offset: number) => ["sales-invoices", offset] as const,
    salesReturns: (offset: number) => ["sales-returns", offset] as const,
    purchaseOrders: ["purchase-orders"] as const,
    purchaseInvoices: (offset: number) => ["purchase-invoices", offset] as const,
    purchaseReturns: (offset: number) => ["purchase-returns", offset] as const,
    scrapTrades: ["scrap-trades"] as const,
    inventoryValuationRates: ["inventory-valuation-rates"] as const,
};

export const staleTimes = {
    coa: 10 * 60_000,
    parties: 5 * 60_000,
    items: 5 * 60_000,
    erpAccess: 2 * 60_000,
    dashboardKpis: 60_000,
    partyLedger: 30_000,
    transactions: 120_000,
    inventoryValuationRates: 120_000,
} as const;

/** After invoice/return document mutations, drop stale list + ledger + KPI caches. */
export async function invalidateAfterInvoiceDocumentChange() {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["purchase-returns"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-returns"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] }),
        queryClient.invalidateQueries({ queryKey: ["party-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["account-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["party-balance-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
    ]);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp:invoice-updated"));
    }
}

/** After fixing pending rates, invoice/return list caches must be dropped so Purchase/Sales cards refresh. */
export async function invalidateTransactionDocsAfterRateFix() {
    await invalidateAfterInvoiceDocumentChange();
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp:rate-fixed"));
    }
}

/** After production batch or factory scrap dispatch post — refresh alerts and scrap MTD panels. */
export function notifyProductionUpdated() {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp:production-updated"));
    }
}
