import { useQuery } from "@tanstack/react-query";
import { fetchCoaAccounts, fetchDashboardKpis, fetchMyErpAccess, fetchPostableCoaAccounts } from "@/lib/api/dashboard";
import { fetchPartyLedger, fetchAccountLedger, fetchPartyBalanceSnapshot } from "@/lib/api/reports";
import { fetchSalesOrders } from "@/lib/api/salesInvoices";
import { fetchPurchaseOrders } from "@/lib/api/purchaseInvoices";
import {
    fetchScrapTrades,
    fetchScrapTradePremiumLines,
    fetchScrapPageViaRpc,
} from "@/lib/api/scrap";
import { ERP_DOC_LIST_PAGE_SIZE } from "@/lib/api/types";
import { initPartyCatalog, getParties } from "@/lib/partyCatalog";
import { initItemCatalog, getItemCatalog } from "@/lib/itemCatalog";
import { initCoaCatalog } from "@/lib/coaStore";
import { fetchInventoryValuationRates } from "@/lib/api/inventoryValuation";
import { queryKeys, staleTimes } from "@/lib/queryClient";
import { isErpLiveMode } from "@/lib/backendFlags";
import {
    applyPremiumLinesToListItem,
    mapScrapTradeApiRow,
    type ScrapTradeListItem,
} from "@/lib/scrapTradeTypes";

export function useCoaAccounts() {
    return useQuery({
        queryKey: queryKeys.coa,
        queryFn: async () => {
            await initCoaCatalog();
            return fetchCoaAccounts();
        },
        staleTime: staleTimes.coa,
        enabled: isErpLiveMode(),
    });
}

export function usePartiesCatalog() {
    return useQuery({
        queryKey: queryKeys.parties,
        queryFn: async () => {
            await initPartyCatalog();
            return getParties();
        },
        staleTime: staleTimes.parties,
    });
}

export function useItemsCatalog() {
    return useQuery({
        queryKey: queryKeys.items,
        queryFn: async () => {
            await initItemCatalog();
            return getItemCatalog();
        },
        staleTime: staleTimes.items,
        enabled: isErpLiveMode(),
    });
}

export function useErpAccess() {
    return useQuery({
        queryKey: queryKeys.erpAccess,
        queryFn: () => fetchMyErpAccess(),
        staleTime: staleTimes.erpAccess,
        enabled: isErpLiveMode(),
    });
}

export function useDashboardKpis() {
    return useQuery({
        queryKey: queryKeys.dashboardKpis(),
        queryFn: () => fetchDashboardKpis(),
        staleTime: staleTimes.dashboardKpis,
        enabled: isErpLiveMode(),
    });
}

export function usePartyBalanceSnapshot(asOf?: string) {
    return useQuery({
        queryKey: queryKeys.partyBalanceSnapshot(asOf),
        queryFn: () => fetchPartyBalanceSnapshot(asOf),
        staleTime: staleTimes.dashboardKpis,
        enabled: isErpLiveMode(),
    });
}

import type { CoaSelectContext } from "@/lib/coaSelectors";

export function usePostableCoa(context: CoaSelectContext) {
    return useQuery({
        queryKey: queryKeys.postableCoa(context),
        queryFn: () => fetchPostableCoaAccounts(context),
        staleTime: staleTimes.coa,
        enabled: isErpLiveMode(),
    });
}

export function usePartyLedgerQuery(partyCode: string, from: string, to: string, enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.partyLedger(partyCode, from, to),
        queryFn: () => fetchPartyLedger(partyCode, from, to),
        staleTime: staleTimes.partyLedger,
        enabled: enabled && isErpLiveMode() && !!partyCode,
    });
}

export function useAccountLedgerQuery(accountCode: string, from: string, to: string, enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.accountLedger(accountCode, from, to),
        queryFn: () => fetchAccountLedger(accountCode, from, to),
        staleTime: staleTimes.partyLedger,
        enabled: enabled && isErpLiveMode() && !!accountCode,
    });
}

export async function loadScrapTradesList(): Promise<ScrapTradeListItem[]> {
    // Prefer the single round-trip RPC (migration 166); fall back to the
    // multi-query path when it is not present on the remote DB.
    const viaRpc = await fetchScrapPageViaRpc();
    const { rows, premiumMap } =
        viaRpc ??
        (await (async () => {
            const rows = await fetchScrapTrades();
            const premiumMap = await fetchScrapTradePremiumLines(
                rows.map((r) => ({
                    id: String(r.id),
                    trade_date: String(r.trade_date),
                    source_party_id: r.source_party_id ? String(r.source_party_id) : null,
                })),
            );
            return { rows, premiumMap };
        })());
    return rows.map((r) => {
        const item = mapScrapTradeApiRow(r);
        return applyPremiumLinesToListItem(item, premiumMap.get(String(r.id)));
    });
}

export function useScrapTrades() {
    return useQuery({
        queryKey: queryKeys.scrapTrades,
        queryFn: loadScrapTradesList,
        staleTime: staleTimes.transactions,
        enabled: isErpLiveMode(),
    });
}

export function useSalesOrders() {
    return useQuery({
        queryKey: queryKeys.salesOrders,
        queryFn: () => fetchSalesOrders(),
        staleTime: staleTimes.transactions,
        enabled: isErpLiveMode(),
    });
}

export function usePurchaseOrders() {
    return useQuery({
        queryKey: queryKeys.purchaseOrders,
        queryFn: () => fetchPurchaseOrders(),
        staleTime: staleTimes.transactions,
        enabled: isErpLiveMode(),
    });
}

export function useInventoryValuationRates() {
    return useQuery({
        queryKey: queryKeys.inventoryValuationRates,
        queryFn: () => fetchInventoryValuationRates(),
        staleTime: staleTimes.inventoryValuationRates,
    });
}
