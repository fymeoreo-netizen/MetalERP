import { agentDebugLog } from "@/lib/agentDebugLog";
import { getAppSession, hasErpContext, isSupabaseConfigured, persistSessionPatch } from "@/lib/appSession";
import { isErpLiveMode } from "@/lib/backendFlags";
import { filterCoaForContext, type CoaSelectContext } from "@/lib/coaSelectors";
import {
    allocateNextDocumentNo,
    parseDocumentSequence as parseDocSequence,
} from "@/lib/documentNumbers";
import { fetchTransactionHistory } from "@/lib/repositories/auditRepo";
import { getSuppliesRestockMovements, updateDemoSuppliesRestock } from "@/lib/suppliesRestockHistory";
import type { SuppliesRestockKind } from "@/lib/suppliesRestock";
import { supabase } from "@/lib/supabase";
import type { ScrapPartySummaryRow, ScrapTollDropPartyRow, ScrapTradePremiumLine } from "@/lib/scrapTradeTypes";
import type {
    PartyScrapExpectationRow,
    ScrapObligationRow,
    ScrapPayableLotRow,
    ScrapAllocationLine,
    WattaMatrixRow,
} from "@/lib/scrapObligationTypes";
import { lineRateFields } from "@/lib/ratePending";
import {
    DEFAULT_WIRE8_ITEM_CODE,
    isWire8ItemCode,
    parseWire8Grade,
    resolveWire8ItemCode,
    type Wire8Grade,
} from "@/lib/productionWire8Settings";
import {
    purchaseInvoicePayloadSchema,
    purchaseReturnPayloadSchema,
    salesReturnPayloadSchema,
    validateDocumentPayload,
    salesInvoicePayloadSchema,
    type SalesInvoicePayload,
    type InvoiceLinePayload,
} from "@/lib/domain/invoice/documentPayloads";
import {
    ensureEnabled,
    ensureConfigured,
    escapeLikePattern,
    fetchReportRpc,
    findDraftDocumentId,
    formatDbError,
    getItemIdsByCode,
    getPartyIdByCode,
    getWarehouseIdByType,
    isMissingRpc,
    isMissingSchemaColumn,
    mapDbMovementType,
    resolvePartyId,
    resolvePostingContext,
    resolveWarehousesForItemCodes,
    resolveWarehousesForItemIds,
    round3,
} from "./core";
import { parseRpcJsonResult, tryInvoiceDeleteRpc, type InvoiceDeleteFn } from "./documentRpc";
import { runErpRpc, runErpRpcVoid, runMutation, runRpcMutation, runThrowingMutation } from "./mutations";
import {
    ERP_DOC_LIST_PAGE_SIZE,
    type DocActionResult,
    type DocListPageOpts,
    type InventoryBalancesSnapshot,
    type InventorySnapshot,
    type PaginatedRows,
    type PostingDiagnosticRow,
    type PostingDiagnostics,
    type Result,
    type StockCheckFailure,
} from "./types";
import { sortObligationsFifo } from "@/lib/scrapReceivableAllocation";
import type {
    MarketBrief,
    MarketErpContext,
    MarketHistoryPoint,
    MarketQuoteRow,
    MarketSettings,
} from "@/lib/marketTypes";

export async function fetchInventoryBalancesByCode(
    codes: string[],
): Promise<Record<string, number>> {
    const uniq = Array.from(new Set(codes.filter(Boolean)));
    if (!uniq.length || !isSupabaseConfigured() || !hasErpContext()) return {};

    const { data: items } = await supabase
        .schema("erp")
        .from("items")
        .select("id,code")
        .in("code", uniq);
    const itemIds = (items ?? []).map((r) => r.id).filter(Boolean);
    if (!itemIds.length) return {};

    const codeById: Record<string, string> = {};
    (items ?? []).forEach((r) => {
        codeById[r.id] = r.code;
    });

    const { data: balances } = await supabase
        .schema("erp")
        .from("inventory_balances")
        .select("item_id,on_hand_qty,warehouses(wh_type)")
        .in("item_id", itemIds);

    const balancesByCode: Record<string, number> = {};
    (balances ?? []).forEach((row) => {
        const wh = row.warehouses as { wh_type?: string } | { wh_type?: string }[] | null | undefined;
        const whType = Array.isArray(wh) ? wh[0]?.wh_type : wh?.wh_type;
        if (whType === "triangle_transit") return;
        const code = row.item_id ? codeById[row.item_id] : undefined;
        if (!code) return;
        balancesByCode[code] = (balancesByCode[code] ?? 0) + Number(row.on_hand_qty ?? 0);
    });
    return balancesByCode;
}

type InventoryBalanceRow = {
    on_hand_qty?: number | null;
    on_hand_units?: number | null;
    stock_value?: number | null;
    items?: { code?: string } | { code?: string }[] | null;
    warehouses?: { wh_type?: string } | { wh_type?: string }[] | null;
};

function aggregateInventoryBalanceRows(rows: InventoryBalanceRow[]): InventoryBalancesSnapshot {
    const agg: Record<string, { qty: number; units: number; stockValue: number }> = {};
    for (const row of rows) {
        const wh = row.warehouses;
        const whType = Array.isArray(wh) ? wh[0]?.wh_type : wh?.wh_type;
        if (whType === "triangle_transit") continue;
        const items = row.items;
        const code = Array.isArray(items) ? items[0]?.code : items?.code;
        if (!code) continue;
        const qty = Number(row.on_hand_qty ?? 0);
        const units = Number(row.on_hand_units ?? 0);
        const stockValue = Number(row.stock_value ?? 0);
        if (!agg[code]) agg[code] = { qty: 0, units: 0, stockValue: 0 };
        agg[code].qty += qty;
        agg[code].units += units;
        agg[code].stockValue += stockValue;
    }

    const balancesByCode: Record<string, number> = {};
    const unitsByCode: Record<string, number> = {};
    const avgUnitCostByCode: Record<string, number> = {};
    for (const [code, bucket] of Object.entries(agg)) {
        balancesByCode[code] = bucket.qty;
        unitsByCode[code] = bucket.units;
        if (bucket.qty > 0 && bucket.stockValue !== 0) {
            avgUnitCostByCode[code] = Math.round((bucket.stockValue / bucket.qty) * 1_000_000) / 1_000_000;
        }
    }
    return { balancesByCode, unitsByCode, avgUnitCostByCode };
}

/** Page size when scanning inventory_balances (no row cap — paginate until exhausted). */
export const INVENTORY_BALANCE_PAGE_SIZE = 1000;

async function fetchInventoryBalanceRowsPage(
    offset: number,
    pageSize: number,
): Promise<InventoryBalanceRow[]> {
    const { data, error } = await supabase
        .schema("erp")
        .from("inventory_balances")
        .select("on_hand_qty,on_hand_units,stock_value,items(code),warehouses(wh_type)")
        .range(offset, offset + pageSize - 1);
    if (error) {
        console.error("[erp] inventory_balances page fetch failed", error.message, { offset, pageSize });
        throw new Error(formatDbError(error, "Failed to load inventory balances."));
    }
    return (data ?? []) as InventoryBalanceRow[];
}

/** Balances only — for post-save refresh without loading movement history. Excludes triangle transit holding. */

export async function fetchInventoryBalancesSnapshot(): Promise<InventoryBalancesSnapshot> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { balancesByCode: {}, unitsByCode: {}, avgUnitCostByCode: {} };
    }
    const allRows: InventoryBalanceRow[] = [];
    let offset = 0;
    while (true) {
        const page = await fetchInventoryBalanceRowsPage(offset, INVENTORY_BALANCE_PAGE_SIZE);
        allRows.push(...page);
        if (page.length < INVENTORY_BALANCE_PAGE_SIZE) break;
        offset += INVENTORY_BALANCE_PAGE_SIZE;
    }
    return aggregateInventoryBalanceRows(allRows);
}


export function formatStockCheckFailuresMessage(failures: StockCheckFailure[]): string {
    if (!failures.length) return "";
    const f = failures[0];
    const head = `${f.itemCode}: need ${f.requested.toLocaleString()} kg, on hand ${f.available.toLocaleString()} kg.`;
    if (failures.length === 1) {
        return `${head} Post a production receipt or reduce quantity.`;
    }
    const more = failures.slice(1).map((x) => `${x.itemCode} (${x.available}/${x.requested} kg)`).join(", ");
    return `${head} Also short: ${more}.`;
}

/** Live-mode stock check for sales post (uses erp.inventory_balances, not local UI). */

export async function fetchStockAvailabilityForPost(
    lines: { itemCode: string; qty: number }[],
): Promise<{ ok: boolean; failures: StockCheckFailure[] }> {
    return checkLiveStockAvailable(lines);
}


export async function checkLiveStockAvailable(
    lines: { itemCode: string; qty: number }[]
): Promise<{ ok: boolean; failures: StockCheckFailure[] }> {
    const codes = Array.from(new Set(lines.map((l) => l.itemCode).filter(Boolean)));
    const balancesByCode = await fetchInventoryBalancesByCode(codes);
    const failures: { itemCode: string; requested: number; available: number }[] = [];
    const needed: Record<string, number> = {};
    for (const line of lines) {
        needed[line.itemCode] = (needed[line.itemCode] ?? 0) + line.qty;
    }
    for (const [itemCode, requested] of Object.entries(needed)) {
        const available = balancesByCode[itemCode] ?? 0;
        if (available < requested) {
            failures.push({ itemCode, requested, available });
        }
    }
    return { ok: failures.length === 0, failures };
}

/** Rebuild erp.inventory_balances from movements (run after production/post if stock gate shows 0). */

export async function rebuildInventoryBalances(): Promise<Result<true>> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { ok: false, error: "ERP is not configured or you are not signed in." };
    }
    return runErpRpcVoid("rebuild inventory balances", "rebuild_inventory_balances", {}, "Failed to rebuild inventory balances.");
}

/** Post production batch and refresh inventory_balances for live stock checks. */

export async function fetchInventorySnapshot(limitMovements = 300): Promise<InventorySnapshot> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { balancesByCode: {}, unitsByCode: {}, avgUnitCostByCode: {}, movements: [] };
    }
    const [balancesSnapshot, movementsRes] = await Promise.all([
        fetchInventoryBalancesSnapshot(),
        supabase
            .schema("erp")
            .from("inventory_movements")
            .select(
                "id,movement_type,qty_in,qty_out,source_doc_id,source_doc_type,posting_date,created_at,reference_no,items(code),parties(code,name)",
            )
            .order("posting_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(limitMovements),
    ]);

    const { balancesByCode, unitsByCode, avgUnitCostByCode } = balancesSnapshot;

    const movements = (movementsRes.data ?? [])
        .map((row: any) => {
            const code = row?.items?.code as string | undefined;
            if (!code) return null;
            const qtyIn = Number(row.qty_in ?? 0);
            const qtyOut = Number(row.qty_out ?? 0);
            const qty = qtyIn > 0 ? qtyIn : qtyOut;
            return {
                id: row.id,
                type: mapDbMovementType(String(row.movement_type ?? "")),
                itemCode: code,
                qty,
                unit: "kg",
                refDocId: String(row.reference_no ?? row.source_doc_id ?? ""),
                refDocType: String(row.source_doc_type ?? ""),
                partyId: row.parties?.code ?? undefined,
                partyName: row.parties?.name ?? undefined,
                at: row.created_at ?? new Date().toISOString(),
                docDate: row.posting_date ?? undefined,
            };
        })
        .filter(Boolean) as InventorySnapshot["movements"];

    return { balancesByCode, unitsByCode, avgUnitCostByCode, movements };
}


export async function fetchInventoryMovementTotals(dateFrom: string, dateTo: string): Promise<{
    salesOutQty: number;
    purchaseInQty: number;
}> {
    if (!isSupabaseConfigured() || !hasErpContext()) {
        return { salesOutQty: 0, purchaseInQty: 0 };
    }

    const { data, error } = await supabase.schema("erp").rpc("fn_inventory_movement_totals", {
        p_from: dateFrom,
        p_to: dateTo,
    });

    if (error) {
        if (isMissingRpc(error)) {
            const { data: rows } = await supabase
                .schema("erp")
                .from("inventory_movements")
                .select("movement_type,qty_in,qty_out")
                .gte("posting_date", dateFrom)
                .lte("posting_date", dateTo)
                .in("movement_type", ["sales_out", "purchase_in"]);
            let salesOutQty = 0;
            let purchaseInQty = 0;
            (rows ?? []).forEach((row: { movement_type?: string; qty_in?: number; qty_out?: number }) => {
                const mt = String(row.movement_type ?? "");
                if (mt === "sales_out") salesOutQty += Number(row.qty_out ?? 0);
                if (mt === "purchase_in") purchaseInQty += Number(row.qty_in ?? 0);
            });
            return { salesOutQty, purchaseInQty };
        }
        console.error("[erp] fn_inventory_movement_totals failed", error);
        throw new Error(formatDbError(error, "Failed to load inventory movement totals."));
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
        salesOutQty: Number((row as { sales_out_qty?: number })?.sales_out_qty ?? 0),
        purchaseInQty: Number((row as { purchase_in_qty?: number })?.purchase_in_qty ?? 0),
    };
}

// ---------------------------------------------------------------------------
// Inventory adjustments (stock corrections — shortage / gain)
// ---------------------------------------------------------------------------

export type InventoryAdjustmentDirection = "in" | "out";

export type InventoryAdjustmentPayload = {
    itemCode: string;
    warehouseType: string;
    adjustmentDate?: string;
    direction: InventoryAdjustmentDirection;
    qtyKg: number;
    unitCount?: number;
    remarks?: string;
};

export type InventoryAdjustmentRow = {
    id: string;
    adjustmentNo: string;
    postingDate: string;
    itemCode: string;
    itemName: string;
    warehouseType: string;
    direction: InventoryAdjustmentDirection;
    qtyKg: number;
    unitCount: number;
    unitCost: number;
    valueAmount: number;
    remarks: string | null;
};

type AdjustmentRpcBody = {
    ok?: boolean;
    error?: string;
    adjustment_id?: string;
    adjustment_no?: string;
    unit_cost?: number;
    value_amount?: number;
};

function parseAdjustmentRpc(data: unknown): AdjustmentRpcBody {
    if (typeof data === "string") {
        try {
            return JSON.parse(data) as AdjustmentRpcBody;
        } catch {
            return {};
        }
    }
    if (data && typeof data === "object") {
        return data as AdjustmentRpcBody;
    }
    return {};
}

export type PostedInventoryAdjustment = {
    adjustmentId: string;
    adjustmentNo: string;
    unitCost: number;
    valueAmount: number;
};

export async function postInventoryAdjustment(
    payload: InventoryAdjustmentPayload,
): Promise<Result<PostedInventoryAdjustment>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc<PostedInventoryAdjustment>(
        "post inventory adjustment",
        "post_inventory_adjustment",
        {
            p_payload: {
                item_code: payload.itemCode,
                warehouse_type: payload.warehouseType,
                adjustment_date: payload.adjustmentDate ?? null,
                direction: payload.direction,
                qty_kg: payload.qtyKg,
                unit_count: payload.unitCount ?? null,
                remarks: payload.remarks ?? null,
            },
        },
        (data) => {
            const parsed = parseAdjustmentRpc(data);
            if (parsed.ok === false) {
                return { ok: false, error: parsed.error ?? "Inventory adjustment failed." };
            }
            const adjustmentId = String(parsed.adjustment_id ?? "");
            const adjustmentNo = String(parsed.adjustment_no ?? "");
            if (!adjustmentId) {
                return { ok: false, error: "Adjustment posted but no document id returned." };
            }
            return {
                ok: true,
                data: {
                    adjustmentId,
                    adjustmentNo,
                    unitCost: Number(parsed.unit_cost ?? 0),
                    valueAmount: Number(parsed.value_amount ?? 0),
                },
            };
        },
        "Failed to post inventory adjustment.",
    );
}

export async function fetchInventoryAdjustments(limit = 100): Promise<InventoryAdjustmentRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];

    const { data, error } = await supabase
        .schema("erp")
        .from("inventory_adjustments")
        .select(
            "id,adjustment_no,posting_date,direction,qty_kg,unit_count,unit_cost,value_amount,remarks,items(code,name),warehouses(wh_type)",
        )
        .order("posting_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) {
        console.error("[erp] fetchInventoryAdjustments failed", error.message);
        throw new Error(formatDbError(error, "Failed to load stock adjustments."));
    }

    return (data ?? []).map((row: any) => {
        const item = Array.isArray(row.items) ? row.items[0] : row.items;
        const wh = Array.isArray(row.warehouses) ? row.warehouses[0] : row.warehouses;
        return {
            id: String(row.id),
            adjustmentNo: String(row.adjustment_no ?? ""),
            postingDate: String(row.posting_date ?? ""),
            itemCode: String(item?.code ?? ""),
            itemName: String(item?.name ?? ""),
            warehouseType: String(wh?.wh_type ?? ""),
            direction: (row.direction === "in" ? "in" : "out") as InventoryAdjustmentDirection,
            qtyKg: Number(row.qty_kg ?? 0),
            unitCount: Number(row.unit_count ?? 0),
            unitCost: Number(row.unit_cost ?? 0),
            valueAmount: Number(row.value_amount ?? 0),
            remarks: row.remarks ?? null,
        };
    });
}

export async function deleteInventoryAdjustment(adjustmentId: string): Promise<Result<true>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc(
        "delete inventory adjustment",
        "hard_delete_inventory_adjustment",
        { p_adjustment_id: adjustmentId },
        (data) => {
            const parsed = parseAdjustmentRpc(data);
            if (parsed.ok === false) {
                return { ok: false, error: parsed.error ?? "Failed to delete adjustment." };
            }
            return { ok: true, data: true };
        },
        "Failed to delete inventory adjustment.",
    );
}

