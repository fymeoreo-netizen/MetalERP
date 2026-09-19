import {
    type ItemMasterRecord,
    getCatalogItem,
    seedInventoryBalances,
    getReorderLevelForItem,
} from "@/lib/itemCatalog";
import { buildItemDisplayName } from "@/lib/itemFormSchema";
import { isErpLiveMode } from "@/lib/backendFlags";

export type StockMovementType =
    | "SALES_INVOICE"
    | "SALES_RETURN"
    | "PURCHASE_INVOICE"
    | "PURCHASE_RETURN"
    | "SCRAP_OUTWARD"
    | "SCRAP_TRADE_DEST"
    | "PRODUCTION_ISSUE"
    | "PRODUCTION_RECEIPT"
    | "OPENING"
    | "ADJUSTMENT";

export type PartyRole = "customer" | "supplier" | "vendor";

export interface StockMovement {
    id: string;
    type: StockMovementType;
    itemCode: string;
    qty: number;
    unit: string;
    refDocId: string;
    refDocType: string;
    partyId?: string;
    partyName?: string;
    partyRole?: PartyRole;
    /** Business date of the source document (YYYY-MM-DD); used for period reports */
    docDate?: string;
    purchaseMode?: "cash" | "premium";
    amount?: number;
    rate?: number;
    metadata?: Record<string, unknown>;
    at: string;
}

export interface ScrapPartySummary {
    partyId: string;
    partyName: string;
    sentKg: number;
    receivedKg: number;
    sentAmount: number;
    receivedAmount: number;
    lastDate: string;
    lastRefDocId: string;
}

export interface ApplyMovementInput {
    type: StockMovementType;
    itemCode: string;
    qty: number;
    unit?: string;
    refDocId: string;
    refDocType?: string;
    partyId?: string;
    partyName?: string;
    partyRole?: PartyRole;
    docDate?: string;
    purchaseMode?: "cash" | "premium";
    amount?: number;
    rate?: number;
    metadata?: Record<string, unknown>;
}

export interface MovementFilters {
    itemCode?: string;
    type?: StockMovementType;
    types?: StockMovementType[];
    partyId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
}

/** Effective calendar date for filtering (docDate preferred over posted at) */
export function getMovementDocDate(movement: StockMovement): string {
    if (movement.docDate) return movement.docDate.slice(0, 10);
    return movement.at.slice(0, 10);
}

export class InsufficientStockError extends Error {
    constructor(
        public itemCode: string,
        public requested: number,
        public available: number
    ) {
        super(`Insufficient stock for ${itemCode}: need ${requested}, have ${available}`);
        this.name = "InsufficientStockError";
    }
}

const STORAGE_KEY = "coppersync_inventory_v1";
const SCRAP_ITEM_CODE = "RM-SCP-001";

type ScrapPartyBalanceRow = {
    partyName: string;
    sentKg: number;
    receivedKg: number;
    sentAmount: number;
    receivedAmount: number;
    lastDate: string;
    lastRefDocId: string;
};

type PersistedState = {
    balances: Record<string, number>;
    unitBalances: Record<string, number>;
    movements: StockMovement[];
    scrapPartyBalances: Record<string, ScrapPartyBalanceRow>;
};

function createEmptyPersistedState(overrides: Partial<PersistedState> = {}): PersistedState {
    return {
        balances: {},
        unitBalances: {},
        movements: [],
        scrapPartyBalances: {},
        ...overrides,
    };
}

const ADD_TYPES: StockMovementType[] = [
    "SALES_RETURN",
    "PURCHASE_INVOICE",
    "OPENING",
    "PRODUCTION_RECEIPT",
    "ADJUSTMENT",
];

const SUBTRACT_TYPES: StockMovementType[] = [
    "SALES_INVOICE",
    "PURCHASE_RETURN",
    "SCRAP_OUTWARD",
    "PRODUCTION_ISSUE",
];

/** Scrap trade — party metal only; does not change RM warehouse on-hand */
const NEUTRAL_TYPES: StockMovementType[] = ["SCRAP_OUTWARD", "SCRAP_TRADE_DEST"];

function isAddType(type: StockMovementType): boolean {
    if (ADD_TYPES.includes(type)) return true;
    if (SUBTRACT_TYPES.includes(type)) return false;
    return false;
}

function loadState(): PersistedState {
    const useLiveMode = isErpLiveMode();
    if (useLiveMode) {
        return {
            balances: {},
            unitBalances: {},
            movements: [],
            scrapPartyBalances: {},
        };
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as PersistedState;
            const rawBalances = parsed.scrapPartyBalances ?? {};
            const scrapPartyBalances: Record<string, ScrapPartyBalanceRow> = {};
            for (const [partyId, row] of Object.entries(rawBalances)) {
                const legacy = row as ScrapPartyBalanceRow & { totalKg?: number };
                scrapPartyBalances[partyId] = {
                    partyName: legacy.partyName ?? partyId,
                    sentKg: legacy.sentKg ?? legacy.totalKg ?? 0,
                    receivedKg: legacy.receivedKg ?? 0,
                    sentAmount: legacy.sentAmount ?? 0,
                    receivedAmount: legacy.receivedAmount ?? 0,
                    lastDate: legacy.lastDate ?? "",
                    lastRefDocId: legacy.lastRefDocId ?? "",
                };
            }
            return {
                balances: useLiveMode ? { ...(parsed.balances ?? {}) } : { ...seedInventoryBalances, ...parsed.balances },
                unitBalances: parsed.unitBalances ?? {},
                movements: parsed.movements ?? [],
                scrapPartyBalances,
            };
        }
    } catch {
        /* use seed */
    }
    return createEmptyPersistedState({
        balances: useLiveMode ? {} : { ...seedInventoryBalances },
    });
}

function saveState(state: PersistedState) {
    if (isErpLiveMode()) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        /* ignore quota errors */
    }
}

let state: PersistedState = loadState();
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach((fn) => fn());
}

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getBalance(itemCode: string): number {
    return state.balances[itemCode] ?? 0;
}

export function getUnitBalance(itemCode: string): number {
    return state.unitBalances[itemCode] ?? 0;
}

export function getAllUnitBalances(): Record<string, number> {
    return { ...state.unitBalances };
}

export function getAllBalances(): Record<string, number> {
    return { ...state.balances };
}

export function getReorderLevel(itemCode: string): number {
    return getReorderLevelForItem(itemCode);
}

export function getMovements(filters?: MovementFilters): StockMovement[] {
    let list = [...state.movements].sort(
        (a, b) => new Date(getMovementDocDate(b)).getTime() - new Date(getMovementDocDate(a)).getTime()
    );
    if (filters?.itemCode) list = list.filter((m) => m.itemCode === filters.itemCode);
    if (filters?.type) list = list.filter((m) => m.type === filters.type);
    if (filters?.types?.length) list = list.filter((m) => filters.types!.includes(m.type));
    if (filters?.partyId) list = list.filter((m) => m.partyId === filters.partyId);
    if (filters?.dateFrom) {
        list = list.filter((m) => getMovementDocDate(m) >= filters.dateFrom!);
    }
    if (filters?.dateTo) {
        list = list.filter((m) => getMovementDocDate(m) <= filters.dateTo!);
    }
    if (filters?.limit) list = list.slice(0, filters.limit);
    return list;
}

export function getScrapPartySummary(): ScrapPartySummary[] {
    return Object.entries(state.scrapPartyBalances)
        .map(([partyId, row]) => ({
            partyId,
            partyName: row.partyName,
            sentKg: row.sentKg,
            receivedKg: row.receivedKg,
            sentAmount: row.sentAmount,
            receivedAmount: row.receivedAmount,
            lastDate: row.lastDate,
            lastRefDocId: row.lastRefDocId,
        }))
        .sort((a, b) => b.sentKg + b.receivedKg - (a.sentKg + a.receivedKg));
}

export function removeItemFromInventoryState(itemCode: string): void {
    delete state.balances[itemCode];
    delete state.unitBalances[itemCode];
    state.movements = state.movements.filter((m) => m.itemCode !== itemCode);
    if (!isErpLiveMode()) {
        saveState(state);
    }
    notify();
}

let avgUnitCosts: Record<string, number> = {};

function round6(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000;
}

/** Demo/local WAC replay from movement history (mirrors erp.rebuild_inventory_balances_for_items). */
export function computeAvgUnitCostFromMovements(itemCode: string): number | null {
    const movements = getMovements({ itemCode })
        .slice()
        .sort((a, b) => {
            const dateCmp = getMovementDocDate(a).localeCompare(getMovementDocDate(b));
            return dateCmp !== 0 ? dateCmp : a.at.localeCompare(b.at);
        });

    let onHand = 0;
    let stockValue = 0;

    for (const movement of movements) {
        if (NEUTRAL_TYPES.includes(movement.type)) continue;

        const isAdd = isAddType(movement.type);
        const isSubtract = SUBTRACT_TYPES.includes(movement.type);
        if (!isAdd && !isSubtract) continue;

        if (isAdd) {
            const rate =
                movement.rate ??
                (movement.amount != null && movement.qty > 0 ? movement.amount / movement.qty : 0);
            const value = movement.amount ?? movement.qty * rate;
            onHand += movement.qty;
            stockValue += value;
            continue;
        }

        const avg = onHand > 0 ? stockValue / onHand : movement.rate ?? 0;
        onHand -= movement.qty;
        stockValue -= movement.qty * avg;
    }

    if (onHand <= 0 || stockValue <= 0) return null;
    return round6(stockValue / onHand);
}

export function getAvgUnitCost(itemCode: string): number | null {
    if (isErpLiveMode()) {
        const avg = avgUnitCosts[itemCode];
        return avg != null && avg > 0 ? avg : null;
    }
    return computeAvgUnitCostFromMovements(itemCode);
}

export function hydrateLiveInventorySnapshot(input: {
    balances?: Record<string, number>;
    unitBalances?: Record<string, number>;
    avgUnitCostByCode?: Record<string, number>;
    movements?: StockMovement[];
    scrapPartyBalances?: Record<
        string,
        {
            partyName: string;
            sentKg: number;
            receivedKg: number;
            sentAmount: number;
            receivedAmount: number;
            lastDate: string;
            lastRefDocId: string;
        }
    >;
}) {
    avgUnitCosts = input.avgUnitCostByCode ?? {};
    state = {
        balances: input.balances ?? {},
        unitBalances: input.unitBalances ?? {},
        movements: input.movements ?? [],
        scrapPartyBalances: input.scrapPartyBalances ?? {},
    };
    saveState(state);
    notify();
}

export function applyStockMovement(input: ApplyMovementInput): StockMovement {
    const item = getCatalogItem(input.itemCode);
    if (!item) {
        throw new Error(`Unknown item code: ${input.itemCode}`);
    }
    const qty = Math.abs(input.qty);
    if (qty <= 0) {
        throw new Error("Movement quantity must be positive");
    }

    const isNeutral = NEUTRAL_TYPES.includes(input.type);
    const current = getBalance(input.itemCode);
    if (!isNeutral) {
        const delta = isAddType(input.type) ? qty : -qty;
        const next = current + delta;
        if (next < 0) {
            throw new InsufficientStockError(input.itemCode, qty, current);
        }
    }

    const movement: StockMovement = {
        id: `MOV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: input.type,
        itemCode: input.itemCode,
        qty,
        unit: input.unit ?? item.unit,
        refDocId: input.refDocId,
        refDocType: input.refDocType ?? input.type,
        partyId: input.partyId,
        partyName: input.partyName,
        partyRole: input.partyRole,
        docDate: input.docDate,
        purchaseMode: input.purchaseMode,
        amount: input.amount,
        rate: input.rate,
        metadata: input.metadata,
        at: new Date().toISOString(),
    };

    if (!isNeutral) {
        const delta = isAddType(input.type) ? qty : -qty;
        state.balances[input.itemCode] = current + delta;
    }
    state.movements.push(movement);

    if ((input.type === "SCRAP_OUTWARD" || input.type === "SCRAP_TRADE_DEST") && input.partyId) {
        const existing = state.scrapPartyBalances[input.partyId];
        const base = {
            partyName: input.partyName ?? existing?.partyName ?? input.partyId,
            sentKg: existing?.sentKg ?? 0,
            receivedKg: existing?.receivedKg ?? 0,
            sentAmount: existing?.sentAmount ?? 0,
            receivedAmount: existing?.receivedAmount ?? 0,
            lastDate: movement.docDate ?? movement.at,
            lastRefDocId: input.refDocId,
        };
        if (input.type === "SCRAP_OUTWARD") {
            base.sentKg += qty;
            base.sentAmount += input.amount ?? 0;
        } else {
            base.receivedKg += qty;
            base.receivedAmount += input.amount ?? 0;
        }
        state.scrapPartyBalances[input.partyId] = base;
    }

    saveState(state);
    notify();
    return movement;
}

/** Demo mode: set absolute on-hand for supplies (packing / chemicals). */
export function setSuppliesStockBalance(
    itemCode: string,
    newQty: number,
    remarks?: string,
): void {
    const item = getCatalogItem(itemCode);
    if (!item) {
        throw new Error(`Unknown item code: ${itemCode}`);
    }
    if (newQty < 0) {
        throw new Error("Quantity cannot be negative");
    }

    const current = getBalance(itemCode);
    const delta = Math.round((newQty - current) * 1000) / 1000;
    if (Math.abs(delta) < 0.0005) return;

    const movement: StockMovement = {
        id: `MOV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "ADJUSTMENT",
        itemCode,
        qty: Math.abs(delta),
        unit: item.unit,
        refDocId: `STOCK-SET-${Date.now()}`,
        refDocType: "SUPPLIES_STOCK_SET",
        docDate: new Date().toISOString().slice(0, 10),
        metadata: {
            remarks: remarks ?? `Set stock ${current} → ${newQty}`,
            direction: delta > 0 ? "in" : "out",
            setTo: newQty,
        },
        at: new Date().toISOString(),
    };

    state.balances[itemCode] = newQty;
    state.movements.push(movement);
    saveState(state);
    notify();
}

export function updateSuppliesRestockMovement(
    movementId: string,
    updates: {
        itemCode?: string;
        qty?: number;
        rate?: number;
        amount?: number;
        docDate?: string;
        remarks?: string;
    },
): void {
    const idx = state.movements.findIndex((m) => m.id === movementId);
    if (idx < 0) throw new Error("Restock movement not found");
    const movement = state.movements[idx];
    if (movement.refDocType !== "SUPPLIES_RESTOCK") {
        throw new Error("Only supplies restock movements can be edited");
    }

    const oldItemCode = movement.itemCode;
    const oldQty = movement.qty;
    const newItemCode = updates.itemCode ?? oldItemCode;
    const newQty = updates.qty ?? oldQty;

    if (newItemCode !== oldItemCode) {
        const oldBalance = getBalance(oldItemCode) - oldQty;
        if (oldBalance < 0) {
            throw new InsufficientStockError(oldItemCode, oldQty, getBalance(oldItemCode));
        }
        state.balances[oldItemCode] = oldBalance;
        movement.itemCode = newItemCode;
        movement.qty = newQty;
        state.balances[newItemCode] = getBalance(newItemCode) + newQty;
    } else {
        const delta = newQty - oldQty;
        const nextBalance = getBalance(oldItemCode) + delta;
        if (nextBalance < 0) {
            throw new InsufficientStockError(oldItemCode, Math.abs(delta), getBalance(oldItemCode));
        }
        movement.qty = newQty;
        state.balances[oldItemCode] = nextBalance;
    }

    if (updates.rate != null) movement.rate = updates.rate;
    if (updates.amount != null) movement.amount = updates.amount;
    else movement.amount = Math.round(movement.qty * (movement.rate ?? 0) * 1000) / 1000;
    if (updates.docDate != null) movement.docDate = updates.docDate.slice(0, 10);
    if (updates.remarks != null) {
        movement.metadata = { ...(movement.metadata ?? {}), remarks: updates.remarks };
    }

    if (!isErpLiveMode()) saveState(state);
    notify();
}

export function applyStockMovements(
    inputs: ApplyMovementInput[],
    options?: { stopOnError?: boolean }
): { ok: StockMovement[]; errors: Error[] } {
    const ok: StockMovement[] = [];
    const errors: Error[] = [];
    for (const input of inputs) {
        try {
            ok.push(applyStockMovement(input));
        } catch (e) {
            errors.push(e instanceof Error ? e : new Error(String(e)));
            if (options?.stopOnError) break;
        }
    }
    return { ok, errors };
}

export function checkStockAvailable(
    lines: { itemCode: string; qty: number }[]
): { ok: boolean; failures: { itemCode: string; requested: number; available: number }[] } {
    const failures: { itemCode: string; requested: number; available: number }[] = [];
    const needed: Record<string, number> = {};
    for (const line of lines) {
        needed[line.itemCode] = (needed[line.itemCode] ?? 0) + line.qty;
    }
    for (const [itemCode, requested] of Object.entries(needed)) {
        const available = getBalance(itemCode);
        if (available < requested) {
            failures.push({ itemCode, requested, available });
        }
    }
    return { ok: failures.length === 0, failures };
}

export function getScrapItemCode(): string {
    return SCRAP_ITEM_CODE;
}

/** Demo scrap trade: source Wt Received (+), destination Wt Issued (-); no RM warehouse change. */
export function applyScrapTradeDemo(input: {
    itemCode: string;
    qty: number;
    refDocId: string;
    sourcePartyId: string;
    sourcePartyName: string;
    destPartyId: string;
    destPartyName: string;
    docDate: string;
    amount?: number;
    rate?: number;
}): void {
    applyStockMovement({
        type: "SCRAP_TRADE_DEST",
        itemCode: input.itemCode,
        qty: input.qty,
        refDocId: input.refDocId,
        refDocType: "SCRAP_TRADE",
        partyId: input.sourcePartyId,
        partyName: input.sourcePartyName,
        partyRole: "customer",
        docDate: input.docDate,
        amount: input.amount,
        rate: input.rate,
        metadata: { destPartyId: input.destPartyId, destPartyName: input.destPartyName },
    });
    applyStockMovement({
        type: "SCRAP_OUTWARD",
        itemCode: input.itemCode,
        qty: input.qty,
        refDocId: input.refDocId,
        refDocType: "SCRAP_TRADE",
        partyId: input.destPartyId,
        partyName: input.destPartyName,
        partyRole: "vendor",
        docDate: input.docDate,
        amount: input.amount,
        rate: input.rate,
        metadata: { sourcePartyId: input.sourcePartyId, sourcePartyName: input.sourcePartyName },
    });
}

export function resetInventoryToSeed() {
    state = createEmptyPersistedState({
        balances: { ...seedInventoryBalances },
    });
    saveState(state);
    notify();
}

export function formatItemLabel(item: ItemMasterRecord): string {
    return buildItemDisplayName(item);
}
