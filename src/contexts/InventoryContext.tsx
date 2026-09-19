import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    applyStockMovement,
    applyStockMovements,
    checkStockAvailable,
    getAllBalances,
    getAllUnitBalances,
    getBalance,
    getUnitBalance,
    getAvgUnitCost,
    getMovements,
    getReorderLevel,
    getScrapItemCode,
    getScrapPartySummary,
    subscribe,
    hydrateLiveInventorySnapshot,
    type ApplyMovementInput,
    type MovementFilters,
    type ScrapPartySummary,
    type StockMovement,
    InsufficientStockError,
} from "@/lib/inventoryStore";
import {
    getItemCatalog,
    initItemCatalog,
    subscribeCatalog,
    type ItemMasterRecord,
} from "@/lib/itemCatalog";
import { initCoaCatalog } from "@/lib/coaStore";
import { initPartyCatalog, subscribeParties } from "@/lib/partyCatalog";
import { supabase } from "@/lib/supabase";
import { fetchInventoryBalancesSnapshot, fetchInventorySnapshot } from "@/lib/api/inventory";
import { hasErpContext, isSupabaseConfigured } from "@/lib/appSession";
import {
    getDefaultMonthFilters,
    getPeriodTotals,
    type PartyMovementFilters,
    type PeriodTotals,
} from "@/lib/partyMovementReport";

/** Stable mutation/refresh actions — reference never changes across ticks. */
export interface InventoryActions {
    applyStockMovement: (input: ApplyMovementInput) => StockMovement;
    applyStockMovements: typeof applyStockMovements;
    checkStockAvailable: typeof checkStockAvailable;
    refresh: () => Promise<void>;
    refreshBalances: () => Promise<void>;
    refreshCatalogs: () => Promise<void>;
    InsufficientStockError: typeof InsufficientStockError;
}

/** Balance/catalog snapshot driven by inventory store tick. */
export interface InventoryData {
    tick: number;
    catalog: ItemMasterRecord[];
    balances: Record<string, number>;
    unitBalances: Record<string, number>;
    getBalance: (itemCode: string) => number;
    getUnitBalance: (itemCode: string) => number;
    getAvgUnitCost: (itemCode: string) => number | null;
    getReorderLevel: (itemCode: string) => number;
    scrapPartySummary: ScrapPartySummary[];
    scrapItemCode: string;
}

/** @deprecated Prefer granular hooks; movements are no longer on context. */
export interface InventoryContextValue extends InventoryData, InventoryActions {
    periodTotals: PeriodTotals;
}

const InventoryActionsContext = createContext<InventoryActions | null>(null);
const InventoryDataContext = createContext<InventoryData | null>(null);

const TICK_DEBOUNCE_MS = 100;

/** Session-level guard: inventory snapshot is fetched once, not on every route change. */
let inventoryBootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

export function InventoryProvider({ children }: { children: ReactNode }) {
    const [tick, setTick] = useState(0);
    const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const bumpTick = useCallback(() => {
        if (tickTimerRef.current) clearTimeout(tickTimerRef.current);
        tickTimerRef.current = setTimeout(() => {
            setTick((t) => t + 1);
            tickTimerRef.current = null;
        }, TICK_DEBOUNCE_MS);
    }, []);

    const refreshBalances = useCallback(async () => {
        if (isSupabaseConfigured() && hasErpContext()) {
            const snapshot = await fetchInventoryBalancesSnapshot();
            hydrateLiveInventorySnapshot({
                balances: snapshot.balancesByCode,
                unitBalances: snapshot.unitsByCode,
                avgUnitCostByCode: snapshot.avgUnitCostByCode,
                movements: getMovements({ limit: 300 }),
            });
        }
        bumpTick();
    }, [bumpTick]);

    const refreshCatalogs = useCallback(async () => {
        if (isSupabaseConfigured() && hasErpContext()) {
            await Promise.all([initItemCatalog(), initPartyCatalog(), initCoaCatalog()]);
        }
        bumpTick();
    }, [bumpTick]);

    const refresh = useCallback(async () => {
        if (isSupabaseConfigured() && hasErpContext()) {
            await Promise.all([initItemCatalog(), initPartyCatalog(), initCoaCatalog()]);
            const snapshot = await fetchInventorySnapshot();
            hydrateLiveInventorySnapshot({
                balances: snapshot.balancesByCode,
                unitBalances: snapshot.unitsByCode,
                avgUnitCostByCode: snapshot.avgUnitCostByCode,
                movements: snapshot.movements as unknown as StockMovement[],
            });
        }
        bumpTick();
    }, [bumpTick]);

    useEffect(() => {
        const syncFromStores = () => bumpTick();

        if (inventoryBootstrapped) {
            syncFromStores();
            const unsubInv = subscribe(bumpTick);
            const unsubCat = subscribeCatalog(bumpTick);
            const unsubParty = subscribeParties(bumpTick);
            return () => {
                unsubInv();
                unsubCat();
                unsubParty();
                if (tickTimerRef.current) clearTimeout(tickTimerRef.current);
            };
        }

        if (!bootstrapPromise) {
            bootstrapPromise = (async () => {
                try {
                    const { data } = await supabase.auth.getUser();
                    if (data.user?.id) {
                        await Promise.all([initItemCatalog(), initPartyCatalog(), initCoaCatalog()]);
                        if (isSupabaseConfigured() && hasErpContext()) {
                            const snapshot = await fetchInventorySnapshot();
                            hydrateLiveInventorySnapshot({
                                balances: snapshot.balancesByCode,
                                unitBalances: snapshot.unitsByCode,
                                avgUnitCostByCode: snapshot.avgUnitCostByCode,
                                movements: snapshot.movements as unknown as StockMovement[],
                            });
                        }
                    }
                } catch {
                    // no-op on unauthenticated screens
                } finally {
                    inventoryBootstrapped = true;
                }
            })();
        }

        void bootstrapPromise.then(syncFromStores);

        const unsubInv = subscribe(bumpTick);
        const unsubCat = subscribeCatalog(bumpTick);
        const unsubParty = subscribeParties(bumpTick);
        return () => {
            unsubInv();
            unsubCat();
            unsubParty();
            if (tickTimerRef.current) clearTimeout(tickTimerRef.current);
        };
    }, [bumpTick]);

    const actions = useMemo<InventoryActions>(
        () => ({
            applyStockMovement,
            applyStockMovements,
            checkStockAvailable,
            refresh,
            refreshBalances,
            refreshCatalogs,
            InsufficientStockError,
        }),
        [refresh, refreshBalances, refreshCatalogs],
    );

    const data = useMemo<InventoryData>(
        () => ({
            tick,
            catalog: getItemCatalog(),
            balances: getAllBalances(),
            unitBalances: getAllUnitBalances(),
            getBalance,
            getUnitBalance,
            getAvgUnitCost,
            getReorderLevel,
            scrapPartySummary: getScrapPartySummary(),
            scrapItemCode: getScrapItemCode(),
        }),
        [tick],
    );

    return (
        <InventoryActionsContext.Provider value={actions}>
            <InventoryDataContext.Provider value={data}>{children}</InventoryDataContext.Provider>
        </InventoryActionsContext.Provider>
    );
}

function useInventoryDataContext(): InventoryData {
    const ctx = useContext(InventoryDataContext);
    if (!ctx) {
        throw new Error("Inventory hooks must be used within InventoryProvider");
    }
    return ctx;
}

function useInventoryActionsContext(): InventoryActions {
    const ctx = useContext(InventoryActionsContext);
    if (!ctx) {
        throw new Error("Inventory hooks must be used within InventoryProvider");
    }
    return ctx;
}

/** Stable refresh/mutation actions (reference-stable across inventory ticks). */
export function useInventoryActions(): InventoryActions {
    return useInventoryActionsContext();
}

/** Balances, catalog, and balance getters — re-renders on inventory store changes. */
export function useInventoryBalances(): Pick<
    InventoryData,
    "balances" | "unitBalances" | "getBalance" | "getUnitBalance" | "getAvgUnitCost" | "getReorderLevel" | "tick"
> {
    const data = useInventoryDataContext();
    return useMemo(
        () => ({
            tick: data.tick,
            balances: data.balances,
            unitBalances: data.unitBalances,
            getBalance: data.getBalance,
            getUnitBalance: data.getUnitBalance,
            getAvgUnitCost: data.getAvgUnitCost,
            getReorderLevel: data.getReorderLevel,
        }),
        [data],
    );
}

/** Item master catalog snapshot. */
export function useInventoryCatalog(): ItemMasterRecord[] {
    const { catalog } = useInventoryDataContext();
    return catalog;
}

/** Scrap party summary and default scrap item code. */
export function useInventoryScrapSummary(): Pick<InventoryData, "scrapPartySummary" | "scrapItemCode"> {
    const data = useInventoryDataContext();
    return useMemo(
        () => ({
            scrapPartySummary: data.scrapPartySummary,
            scrapItemCode: data.scrapItemCode,
        }),
        [data.scrapPartySummary, data.scrapItemCode],
    );
}

/** Demo-mode period totals from local movement store (not a global context array). */
export function useInventoryPeriodTotals(filters?: PartyMovementFilters): PeriodTotals {
    const { tick } = useInventoryDataContext();
    return useMemo(
        () => getPeriodTotals(filters ?? getDefaultMonthFilters()),
        [tick, filters?.dateFrom, filters?.dateTo, filters?.materialGroup, filters?.partyId],
    );
}

/** On-demand movement slice — subscribe via inventory tick without bloating context. */
export function useInventoryMovements(filters?: MovementFilters): StockMovement[] {
    const { tick } = useInventoryDataContext();
    return useMemo(() => getMovements(filters), [tick, filters?.itemCode, filters?.limit, filters?.type]);
}

/** Backward-compatible aggregate hook (no global movements array). */
export function useInventory(): InventoryContextValue {
    const data = useInventoryDataContext();
    const actions = useInventoryActionsContext();
    const periodTotals = useInventoryPeriodTotals();
    return useMemo(
        () => ({
            ...data,
            ...actions,
            periodTotals,
        }),
        [data, actions, periodTotals],
    );
}
