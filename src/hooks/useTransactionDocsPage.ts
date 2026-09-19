import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { useLocation } from "react-router-dom";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { useToast } from "@/components/ui/use-toast";
import { ERP_DOC_LIST_PAGE_SIZE, type DocListPageOpts, type PaginatedRows, type Result } from "@/lib/api/types";
import { staleTimes } from "@/lib/queryClient";

type ToastFn = ReturnType<typeof useToast>["toast"];

export type TransactionDocsPageConfig<TRawInv, TRawRet, TInv, TRet> = {
    liveMode: boolean;
    activeTab: string;
    routePath: string;
    toast: ToastFn;
    queryKeys: {
        invoices: (page: number) => readonly unknown[];
        returns: (page: number) => readonly unknown[];
    };
    invoiceSearch?: string;
    returnSearch?: string;
    fetchInvoicesPage: (opts: DocListPageOpts) => Promise<Result<PaginatedRows<TRawInv>>>;
    fetchReturnsPage: (opts: DocListPageOpts) => Promise<Result<PaginatedRows<TRawRet>>>;
    mapInvoiceRows: (rows: TRawInv[]) => TInv[];
    mapReturnRows: (rows: TRawRet[]) => TRet[];
};

function listQueryKey(
    keyFn: TransactionDocsPageConfig<unknown, unknown, unknown, unknown>["queryKeys"]["invoices"],
    search?: string,
) {
    const base = keyFn(0).slice(0, -1);
    const term = search?.trim();
    return term ? [...base, "search", term] : base;
}

export function useTransactionDocsPage<TRawInv, TRawRet, TInv, TRet>(
    config: TransactionDocsPageConfig<TRawInv, TRawRet, TInv, TRet>,
) {
    const queryClient = useQueryClient();
    const location = useLocation();
    const {
        liveMode,
        activeTab,
        routePath,
        toast,
        queryKeys,
        invoiceSearch,
        returnSearch,
        fetchInvoicesPage,
        fetchReturnsPage,
        mapInvoiceRows,
        mapReturnRows,
    } = config;

    const invoicesKeyFn = queryKeys.invoices;
    const returnsKeyFn = queryKeys.returns;
    const activeInvoiceSearch = invoiceSearch?.trim() ?? "";
    const activeReturnSearch = returnSearch?.trim() ?? "";
    const invoiceListKey = useMemo(() => listQueryKey(invoicesKeyFn, activeInvoiceSearch), [invoicesKeyFn, activeInvoiceSearch]);
    const returnListKey = useMemo(() => listQueryKey(returnsKeyFn, activeReturnSearch), [returnsKeyFn, activeReturnSearch]);

    const [invoiceOverrides, setInvoiceOverrides] = useState<TInv[] | null>(null);
    const [returnOverrides, setReturnOverrides] = useState<TRet[] | null>(null);
    const [docsFetchError, setDocsFetchError] = useState<string | null>(null);

    const focusRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const docsLoadedRef = useRef({ invoices: false, returns: false });

    const fetchInvoicesPageRef = useRef(fetchInvoicesPage);
    fetchInvoicesPageRef.current = fetchInvoicesPage;
    const fetchReturnsPageRef = useRef(fetchReturnsPage);
    fetchReturnsPageRef.current = fetchReturnsPage;

    const invoicesQuery = useInfiniteQuery({
        queryKey: invoiceListKey,
        enabled: liveMode && activeTab === "invoices",
        initialPageParam: 0,
        staleTime: staleTimes.transactions,
        queryFn: async ({ pageParam }) => {
            const r = await fetchInvoicesPageRef.current({
                offset: pageParam,
                limit: ERP_DOC_LIST_PAGE_SIZE,
                search: activeInvoiceSearch || undefined,
            });
            if (!r.ok) throw new Error(r.error);
            return r.data;
        },
        getNextPageParam: (lastPage, allPages) => {
            if (!lastPage.hasMore) return undefined;
            return allPages.reduce((sum, page) => sum + page.rows.length, 0);
        },
    });

    const returnsQuery = useInfiniteQuery({
        queryKey: returnListKey,
        enabled: liveMode && activeTab === "returns",
        initialPageParam: 0,
        staleTime: staleTimes.transactions,
        queryFn: async ({ pageParam }) => {
            const r = await fetchReturnsPageRef.current({
                offset: pageParam,
                limit: ERP_DOC_LIST_PAGE_SIZE,
                search: activeReturnSearch || undefined,
            });
            if (!r.ok) throw new Error(r.error);
            return r.data;
        },
        getNextPageParam: (lastPage, allPages) => {
            if (!lastPage.hasMore) return undefined;
            return allPages.reduce((sum, page) => sum + page.rows.length, 0);
        },
    });

    const invoicesQueryRef = useRef(invoicesQuery);
    invoicesQueryRef.current = invoicesQuery;
    const returnsQueryRef = useRef(returnsQuery);
    returnsQueryRef.current = returnsQuery;

    const invoicesFromQuery = useMemo(
        () => invoicesQuery.data?.pages.flatMap((page) => mapInvoiceRows(page.rows)) ?? [],
        [invoicesQuery.data, mapInvoiceRows],
    );
    const returnsFromQuery = useMemo(
        () => returnsQuery.data?.pages.flatMap((page) => mapReturnRows(page.rows)) ?? [],
        [returnsQuery.data, mapReturnRows],
    );

    const invoices = invoiceOverrides ?? invoicesFromQuery;
    const returns = returnOverrides ?? returnsFromQuery;

    const invoiceTotal = invoicesQuery.data?.pages[0]?.total ?? 0;
    const invoiceHasMore = invoicesQuery.hasNextPage ?? false;
    const returnTotal = returnsQuery.data?.pages[0]?.total ?? 0;
    const returnHasMore = returnsQuery.hasNextPage ?? false;

    const refreshingDocs = invoicesQuery.isFetching && !invoicesQuery.isFetchingNextPage;
    const refreshingReturns = returnsQuery.isFetching && !returnsQuery.isFetchingNextPage;
    const loadingMoreDocs = invoicesQuery.isFetchingNextPage || returnsQuery.isFetchingNextPage;

    useEffect(() => {
        setInvoiceOverrides(null);
    }, [invoiceListKey]);

    useEffect(() => {
        setReturnOverrides(null);
    }, [returnListKey]);

    useEffect(() => {
        if (invoicesQuery.isSuccess) docsLoadedRef.current.invoices = true;
    }, [invoicesQuery.isSuccess]);
    useEffect(() => {
        if (returnsQuery.isSuccess) docsLoadedRef.current.returns = true;
    }, [returnsQuery.isSuccess]);

    useEffect(() => {
        if (activeTab === "invoices") {
            if (invoicesQuery.error) {
                const err =
                    invoicesQuery.error instanceof Error
                        ? invoicesQuery.error.message
                        : "Failed to refresh invoices";
                setDocsFetchError(err);
            } else if (invoicesQuery.isSuccess) {
                setDocsFetchError(null);
            }
            return;
        }
        if (activeTab === "returns") {
            if (returnsQuery.error) {
                const err =
                    returnsQuery.error instanceof Error
                        ? returnsQuery.error.message
                        : "Failed to refresh returns";
                setDocsFetchError(err);
            } else if (returnsQuery.isSuccess) {
                setDocsFetchError(null);
            }
        }
    }, [
        activeTab,
        invoicesQuery.error,
        invoicesQuery.isSuccess,
        returnsQuery.error,
        returnsQuery.isSuccess,
    ]);

    const getInvoiceNextPageParam = useCallback((lastPage: PaginatedRows<TRawInv>, allPages: PaginatedRows<TRawInv>[]) => {
        if (!lastPage.hasMore) return undefined;
        return allPages.reduce((sum, page) => sum + page.rows.length, 0);
    }, []);

    const getReturnNextPageParam = useCallback((lastPage: PaginatedRows<TRawRet>, allPages: PaginatedRows<TRawRet>[]) => {
        if (!lastPage.hasMore) return undefined;
        return allPages.reduce((sum, page) => sum + page.rows.length, 0);
    }, []);

    const refreshLiveInvoices = useCallback(
        async (force = false) => {
            setInvoiceOverrides(null);
            try {
                if (force) {
                    await queryClient.invalidateQueries({ queryKey: invoiceListKey });
                }
                await queryClient.fetchInfiniteQuery({
                    queryKey: invoiceListKey,
                    queryFn: async ({ pageParam }) => {
                        const r = await fetchInvoicesPageRef.current({
                            offset: pageParam,
                            limit: ERP_DOC_LIST_PAGE_SIZE,
                            search: activeInvoiceSearch || undefined,
                        });
                        if (!r.ok) throw new Error(r.error);
                        return r.data;
                    },
                    initialPageParam: 0,
                    getNextPageParam: getInvoiceNextPageParam,
                    staleTime: force ? 0 : staleTimes.transactions,
                });
                if (activeTab === "invoices") setDocsFetchError(null);
                docsLoadedRef.current.invoices = true;
                return true;
            } catch (e) {
                const err = e instanceof Error ? e.message : "Failed to refresh invoices";
                if (activeTab === "invoices") {
                    setDocsFetchError(err);
                    toast({ title: "Failed to refresh invoices", description: err, variant: "destructive" });
                }
                return false;
            }
        },
        [toast, queryClient, invoiceListKey, getInvoiceNextPageParam, activeTab, activeInvoiceSearch],
    );

    const refreshLiveReturns = useCallback(
        async (force = false) => {
            setReturnOverrides(null);
            try {
                if (force) {
                    await queryClient.invalidateQueries({ queryKey: returnListKey });
                }
                await queryClient.fetchInfiniteQuery({
                    queryKey: returnListKey,
                    queryFn: async ({ pageParam }) => {
                        const r = await fetchReturnsPageRef.current({
                            offset: pageParam,
                            limit: ERP_DOC_LIST_PAGE_SIZE,
                            search: activeReturnSearch || undefined,
                        });
                        if (!r.ok) throw new Error(r.error);
                        return r.data;
                    },
                    initialPageParam: 0,
                    getNextPageParam: getReturnNextPageParam,
                    staleTime: force ? 0 : staleTimes.transactions,
                });
                if (activeTab === "returns") setDocsFetchError(null);
                docsLoadedRef.current.returns = true;
                return true;
            } catch (e) {
                const err = e instanceof Error ? e.message : "Failed to refresh returns";
                if (activeTab === "returns") {
                    setDocsFetchError(err);
                    toast({ title: "Failed to refresh returns", description: err, variant: "destructive" });
                }
                return false;
            }
        },
        [toast, queryClient, returnListKey, getReturnNextPageParam, activeTab, activeReturnSearch],
    );

    const refreshLiveDocs = useCallback(
        async (force = false) => {
            if (activeTab === "invoices") return refreshLiveInvoices(force);
            if (activeTab === "returns") return refreshLiveReturns(force);
            return true;
        },
        [activeTab, refreshLiveInvoices, refreshLiveReturns],
    );

    const loadMoreLiveDocs = useCallback(async () => {
        if (!liveMode || loadingMoreDocs) return;
        const tasks: Promise<unknown>[] = [];
        if (invoiceHasMore) tasks.push(invoicesQueryRef.current.fetchNextPage());
        if (returnHasMore) tasks.push(returnsQueryRef.current.fetchNextPage());
        if (!tasks.length) return;
        const results = await Promise.all(tasks);
        for (const result of results) {
            if (result && typeof result === "object" && "error" in result && result.error) {
                const err = result.error instanceof Error ? result.error.message : "Could not load more documents";
                toast({ title: "Could not load more documents", description: err, variant: "destructive" });
                return;
            }
        }
    }, [liveMode, loadingMoreDocs, invoiceHasMore, returnHasMore, toast]);

    const setInvoices = useCallback((updater: SetStateAction<TInv[]>) => {
        setInvoiceOverrides((prev) => {
            const base = prev ?? invoicesFromQuery;
            return typeof updater === "function" ? (updater as (value: TInv[]) => TInv[])(base) : updater;
        });
    }, [invoicesFromQuery]);

    const setReturns = useCallback((updater: SetStateAction<TRet[]>) => {
        setReturnOverrides((prev) => {
            const base = prev ?? returnsFromQuery;
            return typeof updater === "function" ? (updater as (value: TRet[]) => TRet[])(base) : updater;
        });
    }, [returnsFromQuery]);

    const refreshLiveInvoicesRef = useRef(refreshLiveInvoices);
    refreshLiveInvoicesRef.current = refreshLiveInvoices;
    const refreshLiveReturnsRef = useRef(refreshLiveReturns);
    refreshLiveReturnsRef.current = refreshLiveReturns;

    useEffect(() => {
        if (!liveMode || location.pathname !== routePath) return;
        if (activeTab === "invoices") {
            void refreshLiveInvoicesRef.current(true);
        } else if (activeTab === "returns") {
            void refreshLiveReturnsRef.current(true);
        }
    }, [location.key, liveMode, activeTab, routePath]);

    useEffect(() => {
        if (!liveMode) return;
        const onRateFixed = () => {
            if (activeTab === "invoices") void refreshLiveInvoicesRef.current(true);
            else if (activeTab === "returns") void refreshLiveReturnsRef.current(true);
        };
        window.addEventListener("erp:rate-fixed", onRateFixed);
        return () => window.removeEventListener("erp:rate-fixed", onRateFixed);
    }, [liveMode, activeTab]);

    useEffect(() => {
        if (!liveMode) return;
        const onVisibilityChange = () => {
            if (document.visibilityState !== "visible") return;
            if (focusRefreshTimer.current) clearTimeout(focusRefreshTimer.current);
            focusRefreshTimer.current = setTimeout(() => {
                if (activeTab === "invoices") void refreshLiveInvoicesRef.current(true);
                else if (activeTab === "returns") void refreshLiveReturnsRef.current(true);
            }, 2000);
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            if (focusRefreshTimer.current) clearTimeout(focusRefreshTimer.current);
        };
    }, [liveMode, activeTab]);

    return {
        invoices,
        setInvoices,
        returns,
        setReturns,
        docsFetchError,
        setDocsFetchError,
        refreshingDocs,
        refreshingReturns,
        loadingMoreDocs,
        invoiceTotal,
        invoiceHasMore,
        returnTotal,
        returnHasMore,
        docsLoadedRef,
        refreshLiveInvoices,
        refreshLiveReturns,
        refreshLiveDocs,
        loadMoreLiveDocs,
    };
}
