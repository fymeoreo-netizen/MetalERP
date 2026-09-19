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
import { rebuildInventoryBalances } from "./inventory";
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
import type {
    MarketBrief,
    MarketErpContext,
    MarketHistoryPoint,
    MarketQuoteRow,
    MarketSettings,
} from "@/lib/marketTypes";

export async function postProductionBatchDocument(batchId: string): Promise<Result<true>> {
    const postResult = await runThrowingMutation(
        "post production batch",
        () => postDocument("post_production_batch", batchId),
        "Production posting failed.",
    );
    if (!postResult.ok) return postResult;
    return rebuildInventoryBalances();
}


export async function allocateNextProductionBatchNo(prefix = "PRD-"): Promise<string> {
    if (isSupabaseConfigured() && hasErpContext()) {
        const { data, error } = await supabase.schema("erp").rpc("next_production_batch_no", { p_prefix: prefix });
        if (!error && data) return String(data);
    }
    return allocateNextDocumentNo({
        table: "production_batches",
        column: "batch_no",
        prefix,
        padLength: 4,
    });
}


export async function createProductionBatch(payload: {
    batchNo: string;
    processType: "enamel" | "drawing" | "workshop";
    batchDate: string;
    machineId?: string | null;
    inputKg?: number;
    outputKg?: number;
    scrapKg?: number;
    lines: Array<{
        lineId?: string;
        lineType: "issue" | "receipt" | "scrap";
        itemCode: string;
        warehouseType: string;
        grossWeight?: number;
        tareWeight?: number;
        netWeight: number;
        unitCount?: number;
        scrapWeight?: number;
        scrapCategory?: string;
        machineId?: string | null;
    }>;
}): Promise<Result<{ id: string; batchNo: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    if (payload.processType === "drawing") {
        return { ok: false, error: "Drawing production is disabled. Receive Wire No 8 via purchase invoice." };
    }
    const itemCodes = Array.from(new Set(payload.lines.map((l) => l.itemCode).filter(Boolean)));
    const itemMap = await getItemIdsByCode(itemCodes);
    const missing = itemCodes.filter((code) => !itemMap[code]);
    if (missing.length) {
        return { ok: false, error: `Item(s) not found in ERP: ${missing.join(", ")}` };
    }
    if (!payload.lines.length) {
        return { ok: false, error: "Add at least one production line before saving." };
    }

    const { data: header, error } = await supabase
        .schema("erp")
        .from("production_batches")
        .insert({
            batch_no: payload.batchNo,
            process_type: payload.processType,
            batch_date: payload.batchDate,
            machine_id: payload.machineId ?? null,
            input_kg: payload.inputKg ?? 0,
            output_kg: payload.outputKg ?? 0,
            scrap_kg: payload.scrapKg ?? 0,
        })
        .select("id")
        .single();
    if (error || !header) return { ok: false, error: formatDbError(error, "Failed to create production batch.") };

    const whCache: Record<string, string | null> = {};
    const lines = [];
    for (let idx = 0; idx < payload.lines.length; idx++) {
        const line = payload.lines[idx];
        const itemId = itemMap[line.itemCode];
        if (!whCache[line.warehouseType]) {
            whCache[line.warehouseType] = await getWarehouseIdByType(line.warehouseType);
        }
        const whId = whCache[line.warehouseType];
        if (!whId) {
            return {
                ok: false,
                error: `Warehouse not found for type "${line.warehouseType}" (item ${line.itemCode}).`,
            };
        }
        lines.push({
            production_batch_id: header.id,
            line_no: idx + 1,
            line_type: line.lineType,
            item_id: itemId,
            warehouse_id: whId,
            gross_weight: line.grossWeight ?? 0,
            tare_weight: line.tareWeight ?? 0,
            net_weight: line.netWeight,
            scrap_weight: line.scrapWeight ?? 0,
            unit_count: line.unitCount ?? 0,
            machine_id: line.machineId ?? payload.machineId ?? null,
            scrap_category: line.scrapCategory ?? null,
        });
    }
    const { error: lineErr } = await supabase.schema("erp").from("production_batch_lines").insert(lines);
    if (lineErr) return { ok: false, error: formatDbError(lineErr, "Failed to create production lines.") };
    return { ok: true, data: { id: header.id, batchNo: payload.batchNo } };
}


export async function fetchProductionBatches(processType?: "enamel" | "drawing" | "workshop"): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    let q = supabase
        .schema("erp")
        .from("production_batches")
        .select("id,batch_no,batch_date,process_type,status")
        .order("batch_date", { ascending: false })
        .limit(200);
    if (processType) q = q.eq("process_type", processType);
    const { data } = await q;
    return data ?? [];
}


export async function fetchProductionBatchesWithLines(
    processType?: "enamel" | "drawing" | "workshop",
): Promise<any[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    let q = supabase
        .schema("erp")
        .from("production_batches")
        .select(
            "id,batch_no,batch_date,process_type,status,machine_id,input_kg,output_kg,scrap_kg,production_machines(machine_code,name),production_batch_lines(id,line_no,line_type,machine_id,gross_weight,tare_weight,net_weight,unit_count,scrap_category,items(code,name))",
        )
        .order("batch_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
    if (processType) q = q.eq("process_type", processType);
    const { data, error } = await q;
    if (error) {
        console.warn("[ERP] fetchProductionBatchesWithLines", error);
        return fetchProductionBatches(processType);
    }
    return data ?? [];
}


export async function deleteProductionBatch(batchId: string): Promise<Result<{ batchId: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("delete production batch", "delete_production_batch", { p_batch_id: batchId }, (data) => {
        const parsed = parseRpcJsonResult(data);
        if (!parsed.ok) return { ok: false, error: parsed.error ?? "Failed to delete production batch." };
        return { ok: true, data: { batchId: String((data as { batch_id?: string })?.batch_id ?? batchId) } };
    }, "Failed to delete production batch.");
}


export async function replaceProductionBatch(payload: {
    batchId: string;
    batchDate: string;
    machineId?: string | null;
    processType?: "enamel" | "drawing" | "workshop";
    inputKg?: number;
    outputKg?: number;
    scrapKg?: number;
    post?: boolean;
    lines: Array<{
        lineId?: string;
        lineType: "issue" | "receipt" | "scrap";
        itemCode: string;
        warehouseType: string;
        grossWeight?: number;
        tareWeight?: number;
        netWeight: number;
        unitCount?: number;
        scrapWeight?: number;
        scrapCategory?: string;
        machineId?: string | null;
    }>;
}): Promise<Result<{ batchId: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    if (!payload.lines.length) {
        return { ok: false, error: "Add at least one production line before saving." };
    }
    const replaced = await runErpRpc<{ batchId: string }>(
        "replace production batch",
        "replace_production_batch",
        {
            p_batch_id: payload.batchId,
            p_batch_date: payload.batchDate,
            p_lines: payload.lines,
            p_machine_id: payload.machineId ?? null,
            p_input_kg: payload.inputKg ?? null,
            p_output_kg: payload.outputKg ?? null,
            p_scrap_kg: payload.scrapKg ?? null,
            p_post: payload.post ?? true,
        },
        (data) => ({
            ok: true,
            data: { batchId: String((data as { batch_id?: string })?.batch_id ?? payload.batchId) },
        }),
        "Failed to update production batch.",
    );
    if (!replaced.ok) return replaced;
    if (payload.processType && payload.processType !== "drawing") {
        const { error } = await supabase
            .schema("erp")
            .from("production_batches")
            .update({ process_type: payload.processType })
            .eq("id", payload.batchId);
        if (error) {
            console.warn("[ERP] replaceProductionBatch process_type", error);
        }
    }
    return replaced;
}


export type ProductionMachineRow = {
    id: string;
    machine_code: string;
    name: string;
    department: "drawing" | "enamel" | "workshop";
    scrap_item_code: string | null;
    scrap_item_name: string | null;
    is_active: boolean;
    sort_order: number;
};


export type ProductionStandardRow = {
    standard_key: string;
    numeric_value: number | null;
    text_value: string | null;
    effective_from: string;
};


export type ProductionAlertRow = {
    id: string;
    alert_type: string;
    severity: string;
    message: string;
    metric_value: number | null;
    threshold_value: number | null;
    period_start: string;
    machine_code: string | null;
    status: string;
    created_at: string;
};


export type MachineProductionSummaryRow = {
    machine_id: string;
    machine_code: string;
    machine_name: string;
    department: string;
    batch_count: number;
    input_kg: number;
    output_kg: number;
    scrap_kg: number;
    scrap_pct: number;
    standard_pct: number;
};

export type MachineProductionDailyRow = {
    prod_date: string;
    machine_id: string;
    machine_code: string;
    machine_name: string;
    department: string;
    batch_count: number;
    input_kg: number;
    output_kg: number;
    scrap_kg: number;
    scrap_pct: number;
    standard_pct: number;
};


export async function fetchProductionMachines(
    department?: "drawing" | "enamel" | "workshop",
): Promise<ProductionMachineRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_production_machines", {
        p_department: department ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchProductionMachines", error);
        return [];
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        machine_code: String(r.machine_code ?? ""),
        name: String(r.name ?? ""),
        department: (r.department as ProductionMachineRow["department"]) ?? "drawing",
        scrap_item_code: r.scrap_item_code != null ? String(r.scrap_item_code) : null,
        scrap_item_name: r.scrap_item_name != null ? String(r.scrap_item_name) : null,
        is_active: Boolean(r.is_active),
        sort_order: Number(r.sort_order ?? 0),
    }));
}


export async function upsertProductionMachine(payload: {
    id?: string | null;
    machineCode: string;
    name: string;
    department: "drawing" | "enamel" | "workshop";
    scrapItemCode?: string;
    isActive?: boolean;
    sortOrder?: number;
}): Promise<Result<{ id: string }>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("save machine", "upsert_production_machine", {
        p_id: payload.id ?? null,
        p_machine_code: payload.machineCode,
        p_name: payload.name,
        p_department: payload.department,
        p_scrap_item_code: payload.scrapItemCode ?? null,
        p_is_active: payload.isActive ?? true,
        p_sort_order: payload.sortOrder ?? 0,
    }, (data) => ({ ok: true, data: { id: String(data) } }), "Failed to save machine.");
}


export async function fetchProductionStandards(): Promise<ProductionStandardRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_production_standards");
    if (error) {
        console.warn("[ERP] fetchProductionStandards", error);
        return [];
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        standard_key: String(r.standard_key ?? ""),
        numeric_value: r.numeric_value != null ? Number(r.numeric_value) : null,
        text_value: r.text_value != null ? String(r.text_value) : null,
        effective_from: String(r.effective_from ?? ""),
    }));
}


export async function saveProductionStandard(
    key: string,
    numericValue?: number | null,
    textValue?: string | null,
): Promise<Result<void>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const result = await runErpRpcVoid("save standard", "upsert_production_standard", {
        p_key: key,
        p_numeric: numericValue ?? null,
        p_text: textValue ?? null,
        p_effective_from: new Date().toISOString().slice(0, 10),
    }, "Failed to save standard.");
    return result.ok ? { ok: true, data: undefined } : result;
}


export async function fetchProductionAlerts(status = "open"): Promise<ProductionAlertRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_production_alerts", {
        p_status: status,
    });
    if (error) {
        console.warn("[ERP] fetchProductionAlerts", error);
        return [];
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        alert_type: String(r.alert_type ?? ""),
        severity: String(r.severity ?? "warning"),
        message: String(r.message ?? ""),
        metric_value: r.metric_value != null ? Number(r.metric_value) : null,
        threshold_value: r.threshold_value != null ? Number(r.threshold_value) : null,
        period_start: String(r.period_start ?? ""),
        machine_code: r.machine_code != null ? String(r.machine_code) : null,
        status: String(r.status ?? ""),
        created_at: String(r.created_at ?? ""),
    }));
}


export async function acknowledgeProductionAlert(alertId: string): Promise<Result<void>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const result = await runErpRpcVoid("acknowledge alert", "acknowledge_production_alert", {
        p_alert_id: alertId,
    }, "Failed to acknowledge alert.");
    return result.ok ? { ok: true, data: undefined } : result;
}


export async function evaluateProductionAlerts(): Promise<Result<number>> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    return runErpRpc("evaluate alerts", "fn_evaluate_production_alerts", {
        p_as_of: new Date().toISOString().slice(0, 10),
    }, (data) => ({ ok: true, data: Number(data ?? 0) }), "Failed to evaluate alerts.");
}


export async function fetchMachineProductionReport(params: {
    from?: string;
    to?: string;
    department?: string;
    machineId?: string;
}): Promise<MachineProductionSummaryRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_machine_production_summary", {
        p_from: params.from ?? null,
        p_to: params.to ?? null,
        p_department: params.department ?? null,
        p_machine_id: params.machineId ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchMachineProductionReport", error);
        throw new Error(error.message || "Failed to load machine production report.");
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        machine_id: String(r.machine_id ?? ""),
        machine_code: String(r.machine_code ?? ""),
        machine_name: String(r.machine_name ?? ""),
        department: String(r.department ?? ""),
        batch_count: Number(r.batch_count ?? 0),
        input_kg: Number(r.input_kg ?? 0),
        output_kg: Number(r.output_kg ?? 0),
        scrap_kg: Number(r.scrap_kg ?? 0),
        scrap_pct: Number(r.scrap_pct ?? 0),
        standard_pct: Number(r.standard_pct ?? 0),
    }));
}

export async function fetchMachineProductionDaily(params: {
    from?: string;
    to?: string;
    department?: string;
    machineId?: string;
}): Promise<MachineProductionDailyRow[]> {
    if (!isSupabaseConfigured() || !hasErpContext()) return [];
    const { data, error } = await supabase.schema("erp").rpc("fn_machine_production_daily", {
        p_from: params.from ?? null,
        p_to: params.to ?? null,
        p_department: params.department ?? null,
        p_machine_id: params.machineId ?? null,
    });
    if (error) {
        console.warn("[ERP] fetchMachineProductionDaily", error);
        throw new Error(error.message || "Failed to load machine production daily report.");
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
        prod_date: String(r.prod_date ?? "").slice(0, 10),
        machine_id: String(r.machine_id ?? ""),
        machine_code: String(r.machine_code ?? ""),
        machine_name: String(r.machine_name ?? ""),
        department: String(r.department ?? ""),
        batch_count: Number(r.batch_count ?? 0),
        input_kg: Number(r.input_kg ?? 0),
        output_kg: Number(r.output_kg ?? 0),
        scrap_kg: Number(r.scrap_kg ?? 0),
        scrap_pct: Number(r.scrap_pct ?? 0),
        standard_pct: Number(r.standard_pct ?? 0),
    }));
}

function pickLatestProductionStandard(
    standards: ProductionStandardRow[],
    key: string,
): ProductionStandardRow | undefined {
    return standards
        .filter((s) => s.standard_key === key)
        .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
}


export function productionStandardNum(standards: ProductionStandardRow[], key: string, fallback: number): number {
    const row = pickLatestProductionStandard(standards, key);
    return row?.numeric_value != null ? Number(row.numeric_value) : fallback;
}


export function productionStandardText(standards: ProductionStandardRow[], key: string, fallback: string): string {
    const row = pickLatestProductionStandard(standards, key);
    return row?.text_value?.trim() || fallback;
}
