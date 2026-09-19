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
import { postDocument } from "./posting";
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

export async function repairOrphanScrapPayableLotsForTrade(
    tradeId: string,
    tradeNo?: string,
): Promise<number> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return 0;

    // Prefer server-side purge when migration 165+ is applied.
    const repairResult = await runErpRpcVoid("repair orphan scrap payable lots", "repair_orphan_scrap_payable_lots", {});
    if (repairResult.ok) return 1;

    let no = tradeNo?.trim();
    if (!no) {
        const { data } = await supabase
            .schema("erp")
            .from("scrap_trades")
            .select("trade_no")
            .eq("id", tradeId)
            .maybeSingle();
        no = data?.trade_no ?? undefined;
    }
    if (!no) return 0;

    const lotNo = `SPL-${no}`;
    const { data: blocking, error: fetchErr } = await supabase
        .schema("erp")
        .from("scrap_payable_lots")
        .select("id, source_doc_id")
        .eq("source_doc_type", "scrap_trade")
        .eq("lot_no", lotNo);

    if (fetchErr) {
        console.warn("[ERP] repairOrphanScrapPayableLotsForTrade", fetchErr);
        return 0;
    }

    const orphanIds = (blocking ?? [])
        .filter((row) => String(row.source_doc_id) !== String(tradeId))
        .map((row) => String(row.id));

    if (!orphanIds.length) return 0;

    await supabase.schema("erp").from("scrap_allocations").delete().in("scrap_lot_id", orphanIds);
    const { error: delErr } = await supabase
        .schema("erp")
        .from("scrap_payable_lots")
        .delete()
        .in("id", orphanIds);

    if (delErr) {
        throw new Error(
            formatDbError(
                delErr,
                `Stale scrap payable lot ${lotNo} blocks posting. Run migration 165 in Supabase SQL Editor.`,
            ),
        );
    }
    return orphanIds.length;
}

function isScrapPayableLotDuplicateError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return msg.includes("23505") || msg.includes("scrap_payable_lots_lot_no_key");
}

/** Scrap trade post; optional obligation clears premium scrap in the same RPC (migration 85). */

export async function postScrapTrade(
    docId: string,
    obligationId?: string,
    linkedReceiptId?: string,
): Promise<void> {
    const attemptPost = async () => {
        if (!obligationId) {
            const result = await runThrowingMutation("post scrap trade", () => postDocument("post_scrap_trade", docId));
            if (!result.ok) throw new Error(result.error);
            return;
        }
        // Do not fall back to posting without p_obligation_id â€” that left trades
        // posted with premium uncleared when the overload was missing.
        const first = await runThrowingMutation("post scrap trade", () =>
            postDocument("post_scrap_trade", docId, { p_obligation_id: obligationId }),
        );
        if (first.ok) {
            if (linkedReceiptId) {
                const receipt = await runThrowingMutation("post scrap receipt", () =>
                    postDocument("post_scrap_receipt", linkedReceiptId),
                );
                if (!receipt.ok) throw new Error(receipt.error);
            }
            return;
        }
        throw new Error(first.error);
    };

    // Post first; only run the orphan-lot repair (an extra round-trip) if the
    // server actually rejects with a duplicate lot_no. Migration 165+ purges
    // orphans server-side, so the happy path needs no pre-post repair.
    try {
        await attemptPost();
    } catch (err) {
        if (!isScrapPayableLotDuplicateError(err)) throw err;
        await repairOrphanScrapPayableLotsForTrade(docId);
        await attemptPost();
    }
}


export type ScrapTradeAllocationPostRow = {
    obligationId: string;
    allocatedKg: number;
    receiptId?: string;
    lineSeq?: number;
};


export type ScrapTradeCreditAllocationPostRow = {
    scrapCreditId: string;
    allocatedKg: number;
    obligationId?: string;
};

/** Batch premium scrap allocation on toll-drop (migration 137). */

export async function postScrapTradeWithAllocations(
    docId: string,
    allocations: ScrapTradeAllocationPostRow[],
    creditAllocations?: ScrapTradeCreditAllocationPostRow[],
): Promise<void> {
    const enabled = ensureEnabled();
    if (!enabled.ok) throw new Error(enabled.error);
    const postingCtx = await resolvePostingContext();
    if (!postingCtx) {
        throw new Error(
            "No active sign-in session for posting. Sign out and sign in again, then retry.",
        );
    }
    const payload = allocations.map((a, i) => ({
        obligation_id: a.obligationId,
        allocated_kg: a.allocatedKg,
        receipt_id: a.receiptId ?? null,
        line_seq: a.lineSeq ?? i + 1,
    }));
    const creditPayload =
        creditAllocations?.map((c) => ({
            scrap_credit_id: c.scrapCreditId,
            allocated_kg: c.allocatedKg,
            obligation_id: c.obligationId ?? null,
        })) ?? null;
    const rpcArgs = {
        doc_id: docId,
        p_allocations: payload.length ? payload : null,
        p_credit_allocations: creditPayload,
    };
    const result = await runMutation("post scrap trade with allocations", async () => {
        let { error } = await supabase.schema("erp").rpc("post_scrap_trade", rpcArgs);
        if (!error) return { ok: true, data: true };

        if (isScrapPayableLotDuplicateError(error)) {
            await repairOrphanScrapPayableLotsForTrade(docId);
            ({ error } = await supabase.schema("erp").rpc("post_scrap_trade", rpcArgs));
            if (!error) return { ok: true, data: true };
        }

        const rpcMissing =
            isMissingSchemaColumn(error, "p_allocations") ||
            (error.code === "PGRST202") ||
            (error.message ?? "").toLowerCase().includes("post_scrap_trade");

        if (rpcMissing && allocations.length === 1) {
            const line = allocations[0];
            await postScrapTrade(docId, line.obligationId, line.receiptId);
            return { ok: true, data: true };
        }

        if (error) {
            return {
                ok: false,
                error: formatDbError(
                    error,
                    allocations.length > 1
                        ? "Failed to post scrap trade with allocations. Apply migration 137 in Supabase."
                        : "Failed to post scrap trade with allocations.",
                ),
            };
        }
        return { ok: true, data: true };
    }, "Failed to post scrap trade with allocations.");
    if (!result.ok) throw new Error(result.error);
}


export type ScrapPostingHealth = {
    ok: boolean;
    scrap_receipts_table: boolean;
    scrap_obligations_table: boolean;
    post_scrap_trade: boolean;
    post_scrap_receipt: boolean;
    hint: string | null;
};


export async function fetchScrapPostingHealth(): Promise<Result<ScrapPostingHealth>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const { data, error } = await supabase.schema("erp").rpc("fn_scrap_posting_health");
    if (error) {
        return {
            ok: false,
            error: formatDbError(error, "Scrap posting health check unavailable. Apply migration 81."),
        };
    }
    const row = (data ?? {}) as Record<string, unknown>;
    return {
        ok: true,
        data: {
            ok: Boolean(row.ok),
            scrap_receipts_table: Boolean(row.scrap_receipts_table),
            scrap_obligations_table: Boolean(row.scrap_obligations_table),
            post_scrap_trade: Boolean(row.post_scrap_trade),
            post_scrap_receipt: Boolean(row.post_scrap_receipt),
            hint: row.hint != null ? String(row.hint) : null,
        },
    };
}


export async function postPendingScrapReceipts(): Promise<Result<{ posted: number; errors: unknown[] }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("post pending scrap receipts", "post_pending_scrap_receipts", {}, (data) => {
        const row = (data ?? {}) as { posted?: number; errors?: unknown[] };
        return { ok: true, data: { posted: Number(row.posted ?? 0), errors: row.errors ?? [] } };
    }, "Failed to post pending scrap receipts.");
}


export type DraftScrapReceiptRow = {
    id: string;
    receipt_no: string;
    net_weight: number;
    sales_invoice_no: string | null;
};


export async function fetchDraftScrapReceipts(): Promise<Result<DraftScrapReceiptRow[]>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const { data, error } = await supabase
        .schema("erp")
        .from("scrap_receipts")
        .select("id,receipt_no,net_weight,scrap_receivable_obligations(sales_invoice_no)")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(50);
    if (error) return { ok: false, error: formatDbError(error, "Failed to load draft scrap receipts.") };
    const rows = (data ?? []).map((r: Record<string, unknown>) => {
        const obl = r.scrap_receivable_obligations as { sales_invoice_no?: string } | null;
        return {
            id: String(r.id),
            receipt_no: String(r.receipt_no),
            net_weight: Number(r.net_weight ?? 0),
            sales_invoice_no: obl?.sales_invoice_no ?? null,
        };
    });
    return { ok: true, data: rows };
}


export async function fetchScrapWastage(from?: string, to?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_scrap_wastage", {
        p_from: from ?? null,
        p_to: to ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchScrapWastage", error);
        throw new Error(error.message || "Failed to load scrap wastage report.");
    }
    return data ?? [];
}


export async function fetchScrapTradeRegister(from?: string, to?: string): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_scrap_trade_register", {
        p_from: from ?? null,
        p_to: to ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchScrapTradeRegister", error);
        throw new Error(error.message || "Failed to load scrap trade register.");
    }
    return data ?? [];
}


export async function fetchScrapTollDropPartySummary(
    from?: string,
    to?: string,
): Promise<ScrapTollDropPartyRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_scrap_toll_drop_party_summary", {
        p_from: from ?? null,
        p_to: to ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchScrapTollDropPartySummary", error);
        throw new Error(error.message || "Failed to load scrap party summary.");
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        party_code: String(r.party_code ?? ""),
        party_name: String(r.party_name ?? ""),
        party_role: r.party_role === "destination" ? "destination" : "source",
        scrap_kg: Number(r.scrap_kg ?? 0),
        avg_rate: Number(r.avg_rate ?? 0),
        scrap_amount: Number(r.scrap_amount ?? 0),
        trade_count: Number(r.trade_count ?? 0),
    }));
}


export async function fetchScrapPartySummary(from?: string, to?: string): Promise<ScrapPartySummaryRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_scrap_party_summary", {
        p_from: from ?? null,
        p_to: to ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchScrapPartySummary", error);
        throw new Error(error.message || "Failed to load scrap party summary.");
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        party_code: String(r.party_code ?? ""),
        party_name: String(r.party_name ?? ""),
        direction: r.direction === "received" ? "received" : "sent",
        scrap_kg: Number(r.scrap_kg ?? 0),
        scrap_amount: Number(r.scrap_amount ?? 0),
        trade_count: Number(r.trade_count ?? 0),
    }));
}


export async function fetchNextScrapTradeNo(): Promise<string | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data, error } = await supabase.schema("erp").rpc("next_scrap_trade_no");
    if (error) {
        console.warn("[ERP] fetchNextScrapTradeNo", error);
        return null;
    }
    return typeof data === "string" ? data : null;
}


export async function fetchScrapObligationsForParty(
    partyCode: string,
    openOnly = true,
): Promise<ScrapObligationRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_scrap_obligations_for_party", {
        p_party_code: partyCode,
        p_open_only: openOnly,
    });
    if (error) throw new Error(error.message || "Failed to load scrap obligations.");
    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
        obligation_id: String(r.obligation_id ?? ""),
        obligation_no: String(r.obligation_no ?? ""),
        sales_invoice_id: String(r.sales_invoice_id ?? ""),
        sales_invoice_no: String(r.sales_invoice_no ?? ""),
        invoice_date: String(r.invoice_date ?? ""),
        ref_scrap_rate: Number(r.ref_scrap_rate ?? 0),
        expected_kg: Number(r.expected_kg ?? 0),
        received_kg: Number(r.received_kg ?? 0),
        open_kg: Number(r.open_kg ?? 0),
        status: String(r.status ?? ""),
    }));
    return sortObligationsFifo(rows);
}


export async function fetchPartyScrapExpectations(
    partyCode?: string,
    from?: string,
    to?: string,
    openOnly = true,
): Promise<PartyScrapExpectationRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_party_scrap_expectations", {
        p_party_code: partyCode ?? null,
        p_from: from ?? null,
        p_to: to ?? null,
        p_open_only: openOnly,
    });
    if (error) throw new Error(error.message || "Failed to load party scrap expectations.");
    return (data ?? []).map((r: Record<string, unknown>) => ({
        party_code: String(r.party_code ?? ""),
        party_name: String(r.party_name ?? ""),
        obligation_no: String(r.obligation_no ?? ""),
        sales_invoice_no: String(r.sales_invoice_no ?? ""),
        invoice_date: String(r.invoice_date ?? ""),
        ref_scrap_rate: Number(r.ref_scrap_rate ?? 0),
        expected_kg: Number(r.expected_kg ?? 0),
        received_kg: Number(r.received_kg ?? 0),
        open_kg: Number(r.open_kg ?? 0),
        status: String(r.status ?? ""),
        obligation_source: r.obligation_source ? String(r.obligation_source) : undefined,
    }));
}


export async function fetchPartyScrapCredits(
    partyCode: string,
    openOnly = true,
): Promise<import("@/lib/scrapObligationTypes").PartyScrapCreditRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_party_scrap_credits_for_party", {
        p_party_code: partyCode,
        p_open_only: openOnly,
    });
    if (error) throw new Error(error.message || "Failed to load party scrap credits.");
    return (data ?? []).map((r: Record<string, unknown>) => ({
        credit_id: String(r.credit_id ?? ""),
        trade_no: String(r.trade_no ?? ""),
        trade_date: String(r.trade_date ?? ""),
        credit_kg: Number(r.credit_kg ?? 0),
        consumed_kg: Number(r.consumed_kg ?? 0),
        open_kg: Number(r.open_kg ?? 0),
        pending_reason: String(r.pending_reason ?? "rate"),
        status: String(r.status ?? ""),
        ref_scrap_rate: r.ref_scrap_rate != null ? Number(r.ref_scrap_rate) : null,
        source_doc_id: String(r.source_doc_id ?? ""),
    }));
}


export async function fetchNextScrapReceiptNo(): Promise<string | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data, error } = await supabase.schema("erp").rpc("next_scrap_receipt_no");
    if (error) return null;
    return typeof data === "string" ? data : null;
}


export async function createScrapReceiptDocument(payload: {
    receiptNo: string;
    receiptDate: string;
    partyCode: string;
    obligationId: string;
    itemCode?: string;
    grossWeight: number;
    tareWeight: number;
    netWeight: number;
    unitRate: number;
    biltyNo?: string;
    vehicleNo?: string;
    remarks?: string;
    /** When false, posting only clears premium obligation (scrap trade already moved metal). */
    recordMetalMovement?: boolean;
    scrapTradeId?: string;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const partyId = await getPartyIdByCode(payload.partyCode);
    if (!partyId) return { ok: false, error: "Party not found." };
    const itemCode = normalizeScrapItemCode(payload.itemCode ?? "RM-SCP-001");
    const itemMap = await getItemIdsByCode([itemCode]);
    const itemId = itemMap[itemCode];
    const amount = round3(payload.netWeight * payload.unitRate);

    const row: Record<string, unknown> = {
        receipt_no: payload.receiptNo,
        receipt_date: payload.receiptDate,
        party_id: partyId,
        obligation_id: payload.obligationId,
        item_id: itemId ?? null,
        gross_weight: payload.grossWeight,
        tare_weight: payload.tareWeight,
        net_weight: payload.netWeight,
        unit_rate: payload.unitRate,
        amount,
        bilty_no: payload.biltyNo ?? null,
        vehicle_no: payload.vehicleNo ?? null,
        remarks: payload.remarks ?? null,
        record_metal_movement: payload.recordMetalMovement !== false,
    };
    if (payload.scrapTradeId) {
        row.scrap_trade_id = payload.scrapTradeId;
    }

    let { data, error } = await supabase.schema("erp").from("scrap_receipts").insert(row).select("id").single();
    if (error && payload.scrapTradeId && isMissingSchemaColumn(error, "scrap_trade_id")) {
        delete row.scrap_trade_id;
        ({ data, error } = await supabase.schema("erp").from("scrap_receipts").insert(row).select("id").single());
    }
    if (error || !data) return { ok: false, error: formatDbError(error, "Failed to create scrap receipt.") };
    return { ok: true, data: { id: data.id } };
}


export async function fetchScrapPayableLots(partyCode: string, openOnly = true): Promise<ScrapPayableLotRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    void runErpRpcVoid("repair orphan scrap payable lots", "repair_orphan_scrap_payable_lots", {});
    const { data, error } = await supabase.schema("erp").rpc("fn_scrap_payable_lots_for_party", {
        p_party_code: partyCode,
        p_open_only: openOnly,
    });
    if (error) throw new Error(error.message || "Failed to load scrap payable lots.");
    return (data ?? []).map((r: Record<string, unknown>) => ({
        lot_id: String(r.lot_id ?? ""),
        lot_no: String(r.lot_no ?? ""),
        source_doc_type: r.source_doc_type != null ? String(r.source_doc_type) : undefined,
        source_doc_no: String(r.source_doc_no ?? ""),
        lot_date: String(r.lot_date ?? ""),
        unit_rate: Number(r.unit_rate ?? 0),
        original_kg: Number(r.original_kg ?? 0),
        allocated_kg: Number(r.allocated_kg ?? 0),
        open_kg: Number(r.open_kg ?? 0),
        status: String(r.status ?? ""),
    }));
}


// Watta matrix API moved verbatim to scrap/wattaMatrixApi.ts (roadmap CSERP-RRM-2026-08-25 §4.2-E).
export {
    applyWattaMatrixRecalc,
    deleteWattaMatrix,
    fetchWattaMatrix,
    resolveWatta,
    resolveWattaDetailed,
    upsertWattaMatrix,
    type WattaRecalcBatchResult,
} from "./scrap/wattaMatrixApi";


export async function savePremiumScrapAllocations(
    purchaseInvoiceId: string,
    segments: ScrapAllocationLine[],
): Promise<Result<true>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    await supabase.schema("erp").from("scrap_allocations").delete().eq("purchase_invoice_id", purchaseInvoiceId);
    if (!segments.length) return { ok: true, data: true };
    const rows = segments.map((s) => ({
        purchase_invoice_id: purchaseInvoiceId,
        purchase_invoice_line_id: s.purchaseInvoiceLineId ?? null,
        scrap_lot_id: s.scrapLotId,
        allocated_kg: s.allocatedKg,
        scrap_rate: s.scrapRate,
        watta_rate: s.wattaRate,
        derived_unit_rate: s.derivedUnitRate,
        line_seq: s.lineSeq,
        is_mazdoori_pending: s.isMazdooriPending,
    }));
    const { error } = await supabase.schema("erp").from("scrap_allocations").insert(rows);
    if (error) return { ok: false, error: formatDbError(error, "Failed to save scrap allocations.") };
    const lotIds = [...new Set(segments.map((s) => s.scrapLotId))];
    const refreshResult = await runErpRpcVoid("refresh scrap lot allocations", "fn_refresh_scrap_lot_allocations", {
        p_lot_ids: lotIds,
    }, "Failed to refresh scrap lot allocations.");
    if (!refreshResult.ok) return refreshResult;
    return { ok: true, data: true };
}

/** Persist premium scrap segments; lineKey must match purchase_invoice_lines.id (UUID). */

export async function createScrapTradeDocument(payload: {
    tradeNo: string;
    tradeDate: string;
    sourcePartyCode: string;
    destPartyCode: string;
    itemCode: string;
    warehouseType?: string;
    biltyNo?: string;
    vehicleNo?: string;
    grossWeight: number;
    tareWeight: number;
    netWeight: number;
    unitRate: number;
    amount: number;
    remarks?: string;
    rateStatus?: "fixed" | "pending";
    pendingReason?: "rate" | "tare" | "rate_and_tare";
    settlementMode?: "triangle" | "cash";
    bankAccountCode?: string;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const itemCode = normalizeScrapItemCode(payload.itemCode);
    const sourceId = await getPartyIdByCode(payload.sourcePartyCode);
    const destId = await getPartyIdByCode(payload.destPartyCode);
    const itemMap = await getItemIdsByCode([itemCode, payload.itemCode].filter(Boolean));
    const itemId = itemMap[itemCode] ?? itemMap[payload.itemCode];
    const warehouseId =
        (await getWarehouseIdByType(payload.warehouseType ?? "triangle_transit")) ??
        (await getWarehouseIdByType("raw_material"));
    if (!sourceId || !destId) return { ok: false, error: "Party not found." };
    if (!itemId) return { ok: false, error: "Item not found." };

    const { data, error } = await supabase
        .schema("erp")
        .from("scrap_trades")
        .insert({
            trade_no: payload.tradeNo,
            trade_date: payload.tradeDate,
            source_party_id: sourceId,
            dest_party_id: destId,
            item_id: itemId,
            warehouse_id: warehouseId,
            bilty_no: payload.biltyNo ?? null,
            vehicle_no: payload.vehicleNo ?? null,
            gross_weight: payload.grossWeight,
            tare_weight: payload.tareWeight,
            net_weight: payload.netWeight,
            unit_rate: payload.rateStatus === "pending" ? 0 : payload.unitRate,
            amount: payload.rateStatus === "pending" ? 0 : payload.amount,
            rate_status: payload.rateStatus ?? "fixed",
            pending_reason: payload.pendingReason ?? null,
            settlement_mode: payload.settlementMode ?? "triangle",
            bank_account_code: payload.bankAccountCode ?? null,
            remarks: payload.remarks ?? null,
        })
        .select("id")
        .single();
    if (error || !data) return { ok: false, error: formatDbError(error, "Failed to create scrap trade.") };
    return { ok: true, data: { id: data.id } };
}


export async function updateScrapTradeDocument(
    id: string,
    payload: {
        tradeDate: string;
        sourcePartyCode: string;
        destPartyCode: string;
        itemCode: string;
        warehouseType?: string;
        biltyNo?: string;
        vehicleNo?: string;
        grossWeight: number;
        tareWeight: number;
        netWeight: number;
        unitRate: number;
        amount: number;
        remarks?: string;
        settlementMode?: "triangle" | "cash";
    },
): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("scrap_trades")
        .select("id,status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Scrap trade not found.") };
    // Posted trades are updated in place, then inventory/ledger replayed via repost_scrap_trade.

    const itemCode = normalizeScrapItemCode(payload.itemCode);
    const sourceId = await getPartyIdByCode(payload.sourcePartyCode);
    const destId = await getPartyIdByCode(payload.destPartyCode);
    const itemMap = await getItemIdsByCode([itemCode, payload.itemCode].filter(Boolean));
    const itemId = itemMap[itemCode] ?? itemMap[payload.itemCode];
    if (!sourceId || !destId) return { ok: false, error: "Party not found." };
    if (!itemId) return { ok: false, error: "Item not found." };

    const { error } = await supabase
        .schema("erp")
        .from("scrap_trades")
        .update({
            trade_date: payload.tradeDate,
            source_party_id: sourceId,
            dest_party_id: destId,
            item_id: itemId,
            bilty_no: payload.biltyNo ?? null,
            vehicle_no: payload.vehicleNo ?? null,
            gross_weight: payload.grossWeight,
            tare_weight: payload.tareWeight,
            net_weight: payload.netWeight,
            unit_rate: payload.unitRate,
            amount: payload.amount,
            settlement_mode: payload.settlementMode ?? undefined,
            remarks: payload.remarks ?? null,
        })
        .eq("id", id);
    if (error) return { ok: false, error: formatDbError(error, "Failed to update scrap trade.") };

    if (existing.status === "posted") {
        const repost = await runErpRpc<unknown>("repost scrap trade", "repost_scrap_trade", {
            p_doc_id: id,
        });
        if (!repost.ok) return { ok: false, error: repost.error };
        const parsed = parseRpcJsonResult(repost.data);
        if (!parsed.ok) {
            return { ok: false, error: parsed.error ?? "Failed to repost scrap trade after edit." };
        }
    }

    return { ok: true, data: { id } };
}

// ---------- Factory scrap dispatch ----------


export type FactoryScrapDispatchLinePayload = {
    machineId: string;
    department: "drawing" | "enamel" | "workshop";
    itemCode: string;
    grossWeight?: number;
    tareWeight?: number;
    netWeight: number;
};


export type FactoryScrapDispatchRow = {
    id: string;
    dispatch_no: string;
    dispatch_date: string;
    mode: "toll" | "sale";
    dest_party_id: string;
    dest_party_code?: string;
    dest_party_name?: string;
    item_id?: string | null;
    item_code?: string | null;
    expected_return_item_id?: string | null;
    expected_return_item_code?: string | null;
    expected_return_kg: number;
    gross_weight: number;
    tare_weight: number;
    net_weight: number;
    unit_rate: number;
    amount: number;
    bilty_no?: string | null;
    vehicle_no?: string | null;
    remarks?: string | null;
    status: string;
    lines?: FactoryScrapDispatchLineRow[];
    obligation?: ScrapConversionObligationRow | null;
};


export type FactoryScrapDispatchLineRow = {
    id: string;
    line_no: number;
    machine_id: string;
    machine_code?: string;
    machine_name?: string;
    department: string;
    item_id: string;
    item_code?: string;
    gross_weight: number;
    tare_weight: number;
    net_weight: number;
};


export type ScrapConversionObligationRow = {
    id: string;
    obligation_no: string;
    expected_item_code?: string;
    expected_kg: number;
    returned_kg: number;
    status: string;
};


export type MachineScrapLedgerRow = {
    machine_id: string;
    machine_code: string;
    machine_name: string;
    department: string;
    scrap_item_code: string;
    generated_kg: number;
    dispatched_kg: number;
    scrap_pct: number;
    standard_pct: number;
    over_limit: boolean;
};


export type FactoryScrapDispatchRegisterRow = {
    dispatch_id: string;
    dispatch_no: string;
    dispatch_date: string;
    mode: string;
    vendor_code: string;
    vendor_name: string;
    net_weight: number;
    unit_rate: number;
    amount: number;
    status: string;
    machines: string;
    departments: string;
    expected_item_code: string | null;
    expected_kg: number;
    returned_kg: number;
    obligation_status: string | null;
};


export async function fetchNextFactoryScrapDispatchNo(): Promise<string | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data, error } = await supabase.schema("erp").rpc("next_factory_scrap_dispatch_no");
    if (error) {
        console.warn("[ERP] fetchNextFactoryScrapDispatchNo", error);
        return null;
    }
    return data != null ? String(data) : null;
}


export async function fetchNextScrapConversionReturnNo(): Promise<string | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    const { data, error } = await supabase.schema("erp").rpc("next_scrap_conversion_return_no");
    if (error) {
        console.warn("[ERP] fetchNextScrapConversionReturnNo", error);
        return null;
    }
    return data != null ? String(data) : null;
}


export async function createFactoryScrapDispatch(payload: {
    dispatchNo: string;
    dispatchDate: string;
    destPartyCode: string;
    mode: "toll" | "sale";
    itemCode?: string;
    expectedReturnItemCode?: string;
    expectedReturnKg?: number;
    grossWeight: number;
    tareWeight: number;
    netWeight: number;
    unitRate: number;
    amount: number;
    biltyNo?: string;
    vehicleNo?: string;
    remarks?: string;
    lines: FactoryScrapDispatchLinePayload[];
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const destId = await getPartyIdByCode(payload.destPartyCode);
    if (!destId) return { ok: false, error: "Vendor party not found." };
    if (!payload.lines.length) return { ok: false, error: "Add at least one machine line." };

    const itemCodes = [
        ...payload.lines.map((l) => l.itemCode),
        payload.itemCode,
        payload.expectedReturnItemCode,
    ].filter(Boolean) as string[];
    const itemMap = await getItemIdsByCode(itemCodes);
    const headerItemId = payload.itemCode ? itemMap[payload.itemCode] : itemMap[payload.lines[0]?.itemCode];
    const expectedReturnItemId = payload.expectedReturnItemCode
        ? itemMap[payload.expectedReturnItemCode]
        : null;

    const { data: header, error } = await supabase
        .schema("erp")
        .from("factory_scrap_dispatches")
        .insert({
            dispatch_no: payload.dispatchNo,
            dispatch_date: payload.dispatchDate,
            dest_party_id: destId,
            mode: payload.mode,
            item_id: headerItemId ?? null,
            expected_return_item_id: expectedReturnItemId,
            expected_return_kg: payload.expectedReturnKg ?? payload.netWeight,
            gross_weight: payload.grossWeight,
            tare_weight: payload.tareWeight,
            net_weight: payload.netWeight,
            unit_rate: payload.unitRate,
            amount: payload.amount,
            bilty_no: payload.biltyNo ?? null,
            vehicle_no: payload.vehicleNo ?? null,
            remarks: payload.remarks ?? null,
        })
        .select("id")
        .single();
    if (error || !header) {
        return { ok: false, error: formatDbError(error, "Failed to create factory scrap dispatch.") };
    }

    const lineRows: {
        dispatch_id: string;
        line_no: number;
        machine_id: string;
        department: string;
        item_id: string;
        gross_weight: number;
        tare_weight: number;
        net_weight: number;
    }[] = [];
    for (let idx = 0; idx < payload.lines.length; idx++) {
        const line = payload.lines[idx];
        const itemId = itemMap[line.itemCode];
        if (!itemId) return { ok: false, error: `Item not found: ${line.itemCode}` };
        const net = line.netWeight;
        const tare = Number(line.tareWeight) || 0;
        const gross = Number(line.grossWeight) || net + tare;
        lineRows.push({
            dispatch_id: header.id,
            line_no: idx + 1,
            machine_id: line.machineId,
            department: line.department,
            item_id: itemId,
            gross_weight: gross,
            tare_weight: tare,
            net_weight: net,
        });
    }

    const { error: lineErr } = await supabase.schema("erp").from("factory_scrap_dispatch_lines").insert(lineRows);
    if (lineErr) {
        await supabase.schema("erp").from("factory_scrap_dispatches").delete().eq("id", header.id);
        return { ok: false, error: formatDbError(lineErr, "Failed to save dispatch lines.") };
    }

    return { ok: true, data: { id: header.id } };
}


export async function unpostFactoryScrapDispatch(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc("unpost factory scrap dispatch", "unpost_factory_scrap_dispatch", { p_doc_id: id }, (data) => {
        const row = (data ?? {}) as { ok?: boolean; error?: string };
        if (row.ok === false) {
            return { ok: false, error: row.error ?? "Failed to unpost factory scrap dispatch." };
        }
        return { ok: true, data: { id } };
    }, "Failed to unpost factory scrap dispatch.");
}


export async function deleteFactoryScrapDispatch(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    return runErpRpc("delete factory scrap dispatch", "hard_delete_factory_scrap_dispatch", { p_doc_id: id }, (data) => {
        const row = (data ?? {}) as { ok?: boolean; error?: string };
        if (row.ok === false) {
            return { ok: false, error: row.error ?? "Failed to delete factory scrap dispatch." };
        }
        return { ok: true, data: { id } };
    }, "Failed to delete factory scrap dispatch.");
}


export async function updateFactoryScrapDispatch(
    id: string,
    payload: {
        dispatchDate: string;
        destPartyCode: string;
        mode: "toll" | "sale";
        itemCode?: string;
        expectedReturnItemCode?: string;
        expectedReturnKg?: number;
        grossWeight: number;
        tareWeight: number;
        netWeight: number;
        unitRate: number;
        amount: number;
        biltyNo?: string;
        vehicleNo?: string;
        remarks?: string;
        lines: FactoryScrapDispatchLinePayload[];
    },
    post = false,
): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc(
        "replace factory scrap dispatch",
        "replace_factory_scrap_dispatch",
        { p_doc_id: id, p_payload: payload, p_post: post },
        (data) => {
            const row = (data ?? {}) as { ok?: boolean; error?: string; dispatch_id?: string };
            if (row.ok === false) {
                return { ok: false, error: row.error ?? "Failed to update factory scrap dispatch." };
            }
            return { ok: true, data: { id: String(row.dispatch_id ?? id) } };
        },
        "Failed to update factory scrap dispatch.",
    );
}


export async function postFactoryScrapDispatch(id: string): Promise<Result<void>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const result = await runErpRpcVoid("post factory scrap dispatch", "post_factory_scrap_dispatch", { doc_id: id }, "Failed to post factory scrap dispatch.");
    return result.ok ? { ok: true, data: undefined } : result;
}


export async function fetchFactoryScrapDispatches(): Promise<FactoryScrapDispatchRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase
        .schema("erp")
        .from("factory_scrap_dispatches")
        .select(
            "id,dispatch_no,dispatch_date,mode,dest_party_id,item_id,expected_return_item_id,expected_return_kg,gross_weight,tare_weight,net_weight,unit_rate,amount,bilty_no,vehicle_no,remarks,status",
        )
        .order("dispatch_date", { ascending: false })
        .limit(200);
    if (error) {
        console.warn("[ERP] fetchFactoryScrapDispatches", error);
        return [];
    }
    if (!data?.length) return [];

    const partyIds = Array.from(new Set(data.map((r) => r.dest_party_id).filter(Boolean)));

    const [{ data: parties }, { data: lines }, { data: obligations }] = await Promise.all([
        supabase.schema("erp").from("parties").select("id,code,name").in("id", partyIds),
        supabase
            .schema("erp")
            .from("factory_scrap_dispatch_lines")
            .select("id,dispatch_id,line_no,machine_id,department,item_id,gross_weight,tare_weight,net_weight")
            .in(
                "dispatch_id",
                data.map((d) => d.id),
            ),
        supabase
            .schema("erp")
            .from("scrap_conversion_obligations")
            .select("id,obligation_no,dispatch_id,expected_item_id,expected_kg,returned_kg,status")
            .in(
                "dispatch_id",
                data.map((d) => d.id),
            ),
    ]);

    const itemIds = Array.from(
        new Set(
            [
                ...data.flatMap((r) => [r.item_id, r.expected_return_item_id].filter(Boolean)),
                ...(lines ?? []).map((l) => l.item_id).filter(Boolean),
                ...(obligations ?? []).map((o) => o.expected_item_id).filter(Boolean),
            ],
        ),
    ) as string[];

    const { data: items } = itemIds.length
        ? await supabase.schema("erp").from("items").select("id,code,name").in("id", itemIds)
        : { data: [] as { id: string; code: string; name: string }[] };

    const partyMap = Object.fromEntries((parties ?? []).map((p) => [p.id, p]));
    const itemMap = Object.fromEntries((items ?? []).map((i) => [i.id, i]));
    const machineIds = Array.from(new Set((lines ?? []).map((l) => l.machine_id).filter(Boolean)));
    const { data: machines } = machineIds.length
        ? await supabase
              .schema("erp")
              .from("production_machines")
              .select("id,machine_code,name")
              .in("id", machineIds)
        : { data: [] as { id: string; machine_code: string; name: string }[] };
    const machineMap = Object.fromEntries((machines ?? []).map((m) => [m.id, m]));

    const oblByDispatch = Object.fromEntries((obligations ?? []).map((o) => [o.dispatch_id, o]));
    const linesByDispatch: Record<string, FactoryScrapDispatchLineRow[]> = {};
    for (const l of lines ?? []) {
        const m = machineMap[l.machine_id];
        const item = itemMap[l.item_id];
        const row: FactoryScrapDispatchLineRow = {
            id: l.id,
            line_no: l.line_no,
            machine_id: l.machine_id,
            machine_code: m?.machine_code,
            machine_name: m?.name,
            department: l.department,
            item_id: l.item_id,
            item_code: item?.code,
            gross_weight: Number(l.gross_weight ?? 0),
            tare_weight: Number(l.tare_weight ?? 0),
            net_weight: Number(l.net_weight),
        };
        (linesByDispatch[l.dispatch_id] ??= []).push(row);
    }

    return data.map((r) => {
        const party = partyMap[r.dest_party_id];
        const item = r.item_id ? itemMap[r.item_id] : undefined;
        const expItem = r.expected_return_item_id ? itemMap[r.expected_return_item_id] : undefined;
        const obl = oblByDispatch[r.id];
        return {
            id: r.id,
            dispatch_no: r.dispatch_no,
            dispatch_date: r.dispatch_date,
            mode: r.mode as "toll" | "sale",
            dest_party_id: r.dest_party_id,
            dest_party_code: party?.code,
            dest_party_name: party?.name,
            item_id: r.item_id,
            item_code: item?.code ?? null,
            expected_return_item_id: r.expected_return_item_id,
            expected_return_item_code: expItem?.code ?? null,
            expected_return_kg: Number(r.expected_return_kg ?? 0),
            gross_weight: Number(r.gross_weight),
            tare_weight: Number(r.tare_weight),
            net_weight: Number(r.net_weight),
            unit_rate: Number(r.unit_rate),
            amount: Number(r.amount),
            bilty_no: r.bilty_no,
            vehicle_no: r.vehicle_no,
            remarks: r.remarks,
            status: r.status,
            lines: linesByDispatch[r.id] ?? [],
            obligation: obl
                ? {
                      id: obl.id,
                      obligation_no: obl.obligation_no,
                      expected_item_code: obl.expected_item_id ? itemMap[obl.expected_item_id]?.code : undefined,
                      expected_kg: Number(obl.expected_kg),
                      returned_kg: Number(obl.returned_kg),
                      status: obl.status,
                  }
                : null,
        };
    });
}


export async function createScrapConversionReturn(payload: {
    returnNo: string;
    obligationId: string;
    returnDate: string;
    itemCode: string;
    grossWeight: number;
    tareWeight: number;
    netWeight: number;
    unitRate?: number;
    amount?: number;
    biltyNo?: string;
    vehicleNo?: string;
    remarks?: string;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const itemMap = await getItemIdsByCode([payload.itemCode]);
    const itemId = itemMap[payload.itemCode];
    if (!itemId) return { ok: false, error: "Return item not found." };

    const { data, error } = await supabase
        .schema("erp")
        .from("scrap_conversion_returns")
        .insert({
            return_no: payload.returnNo,
            obligation_id: payload.obligationId,
            return_date: payload.returnDate,
            item_id: itemId,
            gross_weight: payload.grossWeight,
            tare_weight: payload.tareWeight,
            net_weight: payload.netWeight,
            unit_rate: payload.unitRate ?? 0,
            amount: payload.amount ?? 0,
            bilty_no: payload.biltyNo ?? null,
            vehicle_no: payload.vehicleNo ?? null,
            remarks: payload.remarks ?? null,
        })
        .select("id")
        .single();
    if (error || !data) {
        return { ok: false, error: formatDbError(error, "Failed to create conversion return.") };
    }
    return { ok: true, data: { id: data.id } };
}


export async function postScrapConversionReturn(id: string): Promise<Result<void>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const result = await runErpRpcVoid("post conversion return", "post_scrap_conversion_return", { doc_id: id }, "Failed to post conversion return.");
    return result.ok ? { ok: true, data: undefined } : result;
}


export async function fetchMachineScrapLedger(params?: {
    from?: string;
    to?: string;
    department?: string;
    machineId?: string;
}): Promise<MachineScrapLedgerRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_machine_scrap_ledger", {
        p_from: params?.from ?? null,
        p_to: params?.to ?? null,
        p_department: params?.department ?? null,
        p_machine_id: params?.machineId ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchMachineScrapLedger", error);
        throw new Error(error.message || "Failed to load machine scrap ledger.");
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        machine_id: String(r.machine_id),
        machine_code: String(r.machine_code ?? ""),
        machine_name: String(r.machine_name ?? ""),
        department: String(r.department ?? ""),
        scrap_item_code: String(r.scrap_item_code ?? ""),
        generated_kg: Number(r.generated_kg ?? 0),
        dispatched_kg: Number(r.dispatched_kg ?? 0),
        scrap_pct: Number(r.scrap_pct ?? 0),
        standard_pct: Number(r.standard_pct ?? 0),
        over_limit: Boolean(r.over_limit),
    }));
}


export async function fetchFactoryScrapDispatchRegister(
    from?: string,
    to?: string,
): Promise<FactoryScrapDispatchRegisterRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_factory_scrap_dispatch_register", {
        p_from: from ?? null,
        p_to: to ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchFactoryScrapDispatchRegister", error);
        throw new Error(error.message || "Failed to load dispatch register.");
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        dispatch_id: String(r.dispatch_id),
        dispatch_no: String(r.dispatch_no ?? ""),
        dispatch_date: String(r.dispatch_date ?? ""),
        mode: String(r.mode ?? ""),
        vendor_code: String(r.vendor_code ?? ""),
        vendor_name: String(r.vendor_name ?? ""),
        net_weight: Number(r.net_weight ?? 0),
        unit_rate: Number(r.unit_rate ?? 0),
        amount: Number(r.amount ?? 0),
        status: String(r.status ?? ""),
        machines: String(r.machines ?? ""),
        departments: String(r.departments ?? ""),
        expected_item_code: r.expected_item_code != null ? String(r.expected_item_code) : null,
        expected_kg: Number(r.expected_kg ?? 0),
        returned_kg: Number(r.returned_kg ?? 0),
        obligation_status: r.obligation_status != null ? String(r.obligation_status) : null,
    }));
}

/** Canonical scrap item code used across the app. */
export const SCRAP_ITEM_CODE = "RM-SCP-001";

const SCRAP_ITEM_CODE_ALIASES: Record<string, string> = {
    "RM-SCRAP-001": SCRAP_ITEM_CODE,
};


export function normalizeScrapItemCode(code: string): string {
    const trimmed = code.trim();
    return SCRAP_ITEM_CODE_ALIASES[trimmed] ?? trimmed;
}


export async function fetchScrapTrades(): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];

    const baseSelect =
        "id,trade_no,trade_date,gross_weight,tare_weight,net_weight,unit_rate,amount,status,rate_status,financial_status,settlement_mode,bank_account_code,bilty_no,vehicle_no,source_party_id,dest_party_id,item_id";

    let { data, error } = await supabase
        .schema("erp")
        .from("scrap_trades")
        .select(baseSelect)
        .order("trade_date", { ascending: false })
        .limit(100);

    if (error) {
        console.warn("[ERP] fetchScrapTrades", error);
        throw new Error(formatDbError(error, "Failed to load scrap trades."));
    }
    if (!data?.length) return [];

    const partyIds = Array.from(new Set(data.flatMap((r) => [r.source_party_id, r.dest_party_id].filter(Boolean))));
    const itemIds = Array.from(new Set(data.map((r) => r.item_id).filter(Boolean)));

    const [{ data: parties }, { data: items }] = await Promise.all([
        partyIds.length
            ? supabase.schema("erp").from("parties").select("id,code,name").in("id", partyIds)
            : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
        itemIds.length
            ? supabase.schema("erp").from("items").select("id,code,name").in("id", itemIds)
            : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
    ]);

    const partyMap = Object.fromEntries((parties ?? []).map((p) => [p.id, p]));
    const itemMap = Object.fromEntries((items ?? []).map((i) => [i.id, i]));

    return data.map((r) => ({
        ...r,
        source: partyMap[r.source_party_id] ?? null,
        dest: partyMap[r.dest_party_id] ?? null,
        item: r.item_id ? (itemMap[r.item_id] ?? null) : null,
    }));
}

/** Skip repeat 404s when fn_scrap_page_load (migration 166) is not on the remote DB. */
let scrapPageLoadRpcAvailable: boolean | null = null;

/**
 * One round-trip scrap page load (migration 166). Returns trade rows in the same
 * shape as fetchScrapTrades plus a premium-line map, or null when the RPC is
 * absent / errors so the caller can fall back to the multi-query path.
 */

export async function fetchScrapPageViaRpc(): Promise<{
    rows: any[];
    premiumMap: Map<string, ScrapTradePremiumLine[]>;
} | null> {
    if (!isSupabaseConfigured() || !hasErpContext()) return null;
    if (scrapPageLoadRpcAvailable === false) return null;

    const { data, error } = await supabase.schema("erp").rpc("fn_scrap_page_load", { p_limit: 100 });
    if (error) {
        if (isMissingRpc(error)) scrapPageLoadRpcAvailable = false;
        else console.warn("[ERP] fn_scrap_page_load", error);
        return null;
    }
    scrapPageLoadRpcAvailable = true;

    const payload = (data ?? {}) as { trades?: any[] };
    const trades = Array.isArray(payload.trades) ? payload.trades : [];
    const premiumMap = new Map<string, ScrapTradePremiumLine[]>();
    const rows = trades.map((t) => {
        const lines = Array.isArray(t?.premium_lines) ? t.premium_lines : [];
        if (lines.length) {
            premiumMap.set(
                String(t.id),
                lines.map((l: any) => ({
                    salesInvoiceNo: String(l?.sales_invoice_no ?? "Invoice"),
                    allocatedKg: Number(l?.allocated_kg ?? 0),
                    refScrapRate: Number(l?.ref_scrap_rate ?? 0),
                    lineSeq: Number(l?.line_seq ?? 0),
                })),
            );
        }
        const { premium_lines: _ignored, ...rest } = t ?? {};
        return rest;
    });
    return { rows, premiumMap };
}

async function loadObligationMeta(
    obligationIds: string[],
): Promise<Map<string, { sales_invoice_no: string; ref_scrap_rate: number }>> {
    const map = new Map<string, { sales_invoice_no: string; ref_scrap_rate: number }>();
    if (!obligationIds.length) return map;
    const { data } = await supabase
        .schema("erp")
        .from("scrap_receivable_obligations")
        .select("id, sales_invoice_no, ref_scrap_rate")
        .in("id", obligationIds);
    for (const row of data ?? []) {
        map.set(String(row.id), {
            sales_invoice_no: String(row.sales_invoice_no ?? ""),
            ref_scrap_rate: Number(row.ref_scrap_rate ?? 0),
        });
    }
    return map;
}

function pushPremiumLine(
    map: Map<string, ScrapTradePremiumLine[]>,
    tradeId: string,
    line: ScrapTradePremiumLine,
): void {
    const list = map.get(tradeId) ?? [];
    list.push(line);
    map.set(tradeId, list);
}

/** Per-invoice premium scrap lines linked to toll-drop trades (allocations or receipts). */

export async function fetchScrapTradePremiumLines(
    trades: Array<{ id: string; trade_date: string; source_party_id: string | null }>,
): Promise<Map<string, ScrapTradePremiumLine[]>> {
    const map = new Map<string, ScrapTradePremiumLine[]>();
    if (!isSupabaseConfigured() || !hasErpContext() || !trades.length) return map;

    const tradeIds = trades.map((t) => t.id);
    const tradeById = Object.fromEntries(trades.map((t) => [t.id, t]));

    // Request-scoped obligation-meta cache so each obligation id is fetched at most
    // once across the three lookup stages (avoids 2-3 redundant round-trips).
    const oblCache = new Map<string, { sales_invoice_no: string; ref_scrap_rate: number }>();
    const resolveObligations = async (ids: string[]) => {
        const need = Array.from(new Set(ids.map(String))).filter((id) => id && !oblCache.has(id));
        if (need.length) {
            const fetched = await loadObligationMeta(need);
            fetched.forEach((value, key) => oblCache.set(key, value));
        }
        return oblCache;
    };

    const { data: allocs, error: allocErr } = await supabase
        .schema("erp")
        .from("scrap_obligation_allocations")
        .select("scrap_trade_id, allocated_kg, line_seq, obligation_id")
        .in("scrap_trade_id", tradeIds);

    if (!allocErr && allocs?.length) {
        const oblMap = await resolveObligations(allocs.map((a) => String(a.obligation_id)));
        for (const row of allocs) {
            const obl = oblMap.get(String(row.obligation_id));
            if (!obl) continue;
            pushPremiumLine(map, String(row.scrap_trade_id), {
                salesInvoiceNo: obl.sales_invoice_no,
                allocatedKg: Number(row.allocated_kg ?? 0),
                refScrapRate: Number(obl.ref_scrap_rate),
                lineSeq: Number(row.line_seq ?? 0),
            });
        }
    }

    const missingIds = tradeIds.filter((id) => !map.has(id) || map.get(id)!.length === 0);
    if (!missingIds.length) return map;

    const { data: linkedReceipts, error: linkedErr } = await supabase
        .schema("erp")
        .from("scrap_receipts")
        .select("scrap_trade_id, net_weight, unit_rate, obligation_id")
        .in("scrap_trade_id", missingIds)
        .eq("record_metal_movement", false);

    if (!linkedErr && linkedReceipts?.length) {
        const oblMap = await resolveObligations(linkedReceipts.map((r) => String(r.obligation_id)));
        for (let i = 0; i < linkedReceipts.length; i++) {
            const row = linkedReceipts[i];
            const tradeId = String(row.scrap_trade_id ?? "");
            if (!tradeId) continue;
            const obl = oblMap.get(String(row.obligation_id));
            pushPremiumLine(map, tradeId, {
                salesInvoiceNo: obl?.sales_invoice_no ?? "Invoice",
                allocatedKg: Number(row.net_weight ?? 0),
                refScrapRate: Number(obl?.ref_scrap_rate ?? row.unit_rate ?? 0),
                lineSeq: i + 1,
            });
        }
    }

    const stillMissing = missingIds.filter((id) => !map.has(id) || map.get(id)!.length === 0);
    if (stillMissing.length) {
        const partyIds = Array.from(
            new Set(
                stillMissing
                    .map((id) => tradeById[id]?.source_party_id)
                    .filter((pid): pid is string => Boolean(pid)),
            ),
        );
        const receiptDates = Array.from(
            new Set(
                stillMissing
                    .map((id) => tradeById[id]?.trade_date)
                    .filter((d): d is string => Boolean(d)),
            ),
        );
        if (partyIds.length && receiptDates.length) {
            const { data: rcpts } = await supabase
                .schema("erp")
                .from("scrap_receipts")
                .select("net_weight, unit_rate, obligation_id, party_id, receipt_date")
                .in("party_id", partyIds)
                .in("receipt_date", receiptDates)
                .eq("record_metal_movement", false);
            if (rcpts?.length) {
                const oblMap = await resolveObligations(rcpts.map((r) => String(r.obligation_id)));
                for (const tradeId of stillMissing) {
                    const trade = tradeById[tradeId];
                    if (!trade?.source_party_id) continue;
                    const matched = rcpts.filter(
                        (r) =>
                            String(r.party_id) === String(trade.source_party_id) &&
                            String(r.receipt_date) === String(trade.trade_date),
                    );
                    matched.forEach((row, idx) => {
                        const obl = oblMap.get(String(row.obligation_id));
                        pushPremiumLine(map, tradeId, {
                            salesInvoiceNo: obl?.sales_invoice_no ?? "Invoice",
                            allocatedKg: Number(row.net_weight ?? 0),
                            refScrapRate: Number(obl?.ref_scrap_rate ?? row.unit_rate ?? 0),
                            lineSeq: idx + 1,
                        });
                    });
                }
            }
        }
    }

    return map;
}


export async function deleteScrapTradeDocument(id: string): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;

    const { data: existing, error: fetchErr } = await supabase
        .schema("erp")
        .from("scrap_trades")
        .select("id,status")
        .eq("id", id)
        .single();
    if (fetchErr || !existing) return { ok: false, error: formatDbError(fetchErr, "Scrap trade not found.") };

    return runErpRpc("delete scrap trade", "hard_delete_scrap_trade", { p_doc_id: id }, (data) => {
        const row = (data ?? {}) as { ok?: boolean; error?: string };
        if (row.ok === false) {
            return { ok: false, error: row.error ?? "Failed to delete scrap trade." };
        }
        return { ok: true, data: { id } };
    }, "Failed to delete scrap trade. Ensure hard_delete_scrap_trade exists in Supabase (migration 73+).");
}

