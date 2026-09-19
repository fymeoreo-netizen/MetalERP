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
import { fetchInventoryBalancesByCode } from "./inventory";
import { parseRpcJsonResult, tryInvoiceDeleteRpc, type InvoiceDeleteFn } from "./documentRpc";
import { runMutation, runRpcMutation, runThrowingMutation } from "./mutations";
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

export async function fetchMyErpAccess(): Promise<Record<string, unknown> | null> {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await supabase.schema("erp").rpc("fn_my_erp_access");
    if (error) {
        console.warn("[ERP] fn_my_erp_access failed", error);
        return null;
    }
    return (data as Record<string, unknown>) ?? null;
}

const PROBE_DOC_ID = "00000000-0000-0000-0000-000000000001";

function classifyRpcProbe(error: { code?: string; message?: string } | null): { status: "OK" | "FAIL"; detail: string } {
    if (!error) return { status: "OK", detail: "RPC reachable" };
    const code = error.code ?? "";
    const msg = (error.message ?? "").toLowerCase();
    if (code === "42501" || msg.includes("permission denied") || code === "PGRST301") {
        return { status: "FAIL", detail: `Permission denied (${code}). Run migration 97_posting_rpc_grants.sql.` };
    }
    if (code === "PGRST202" || msg.includes("could not find the function")) {
        return { status: "FAIL", detail: "RPC not exposed. Run notify pgrst, 'reload schema';" };
    }
    return { status: "OK", detail: `RPC callable (${code || "business rule"}: ${(error.message ?? "").slice(0, 120)})` };
}


export async function fetchSalesInvoiceDeployCheck(): Promise<
    Result<Array<{ check_name: string; status: string; detail: string }>>
> {
    if (!isSupabaseConfigured()) return { ok: false, error: "Supabase is not configured." };
    const { data, error } = await supabase.schema("erp").rpc("fn_post_sales_invoice_deploy_check");
    if (error) return { ok: false, error: formatDbError(error, "Sales deploy check unavailable (apply migration 94).") };
    return { ok: true, data: (data ?? []) as Array<{ check_name: string; status: string; detail: string }> };
}

export async function fetchPurchaseInvoiceDeployCheck(): Promise<
    Result<Array<{ check_name: string; status: string; detail: string }>>
> {
    const enabled = ensureEnabled();
    if (!enabled.ok) return enabled;
    const { data, error } = await supabase.schema("erp").rpc("fn_post_purchase_invoice_deploy_check");
    if (error) return { ok: false, error: formatDbError(error, "Deploy check unavailable (apply migration 88).") };
    return { ok: true, data: (data ?? []) as Array<{ check_name: string; status: string; detail: string }> };
}


export async function fetchPostingMapHealth(): Promise<
    Result<Array<{ doc_type: string; line_role: string; account_code: string | null; status: string }>>
> {
    if (!isSupabaseConfigured()) return { ok: false, error: "Supabase is not configured." };
    const { data, error } = await supabase.schema("erp").rpc("fn_posting_map_health");
    if (error) return { ok: false, error: formatDbError(error, "Posting map health unavailable (apply migration 42).") };
    return {
        ok: true,
        data: (data ?? []) as Array<{ doc_type: string; line_role: string; account_code: string | null; status: string }>,
    };
}


export type InvoicePostingIntegrityRow = {
    check_code: string;
    check_name: string;
    issue_count: number;
    status: string;
    sample_refs: string | null;
};

/** SQL-backed invoice GL/subledger/obligation integrity (migration 122). */

export async function fetchInvoicePostingIntegrity(): Promise<Result<InvoicePostingIntegrityRow[]>> {
    if (!isSupabaseConfigured()) return { ok: false, error: "Supabase is not configured." };
    const { data, error } = await supabase.schema("erp").rpc("fn_invoice_posting_integrity");
    if (error) {
        return {
            ok: false,
            error: formatDbError(error, "Invoice integrity check unavailable (apply migration 122)."),
        };
    }
    return { ok: true, data: (data ?? []) as InvoicePostingIntegrityRow[] };
}

/** Admin/accountant checklist: auth, maps, deploy checks, RPC grants. */

export async function runPostingDiagnostics(): Promise<PostingDiagnostics> {
    const rows: PostingDiagnosticRow[] = [];
    const liveMode = isErpLiveMode();

    rows.push({
        check_name: "erp_live_mode",
        status: liveMode ? "OK" : "FAIL",
        detail: liveMode
            ? "Live mode (Supabase + signed-in user)"
            : "Demo or not signed in — posts will not hit the database",
    });

    const { data: sessionData } = await supabase.auth.getSession();
    let sessionUserId = sessionData.session?.user?.id ?? null;
    if (!sessionUserId) {
        const { data: userData } = await supabase.auth.getUser();
        sessionUserId = userData.user?.id ?? null;
    }
    rows.push({
        check_name: "auth_session",
        status: sessionUserId ? "OK" : "FAIL",
        detail: sessionUserId ? `User ${sessionUserId.slice(0, 8)}…` : "No JWT session — sign in again",
    });

    const erpAccess = await fetchMyErpAccess();
    const canPost = erpAccess?.can_post_via_role === true;
    rows.push({
        check_name: "erp_role_post",
        status: canPost ? "OK" : "FAIL",
        detail: canPost
            ? "ADMIN or ACCOUNTANT (or transactions.post)"
            : "No post role — run fix_user_erp_access.sql with your email",
    });

    if (liveMode) {
        const mapHealth = await fetchPostingMapHealth();
        if (!mapHealth.ok) {
            rows.push({ check_name: "posting_maps", status: "FAIL", detail: mapHealth.error });
        } else {
            const missing = mapHealth.data.filter((r) => r.status === "MISSING");
            rows.push({
                check_name: "posting_maps",
                status: missing.length === 0 ? "OK" : "FAIL",
                detail:
                    missing.length === 0
                        ? `${mapHealth.data.length} roles configured`
                        : `Missing: ${missing.map((m) => `${m.doc_type}/${m.line_role}`).join(", ")} — run repair_all_posting_maps.sql`,
            });
        }

        for (const [label, fetcher] of [
            ["sales_deploy", fetchSalesInvoiceDeployCheck],
            ["purchase_deploy", fetchPurchaseInvoiceDeployCheck],
        ] as const) {
            const check = await fetcher();
            if (!check.ok) {
                rows.push({ check_name: label, status: "WARN", detail: check.error });
            } else {
                const bad = check.data.filter((r) => r.status !== "OK");
                rows.push({
                    check_name: label,
                    status: bad.length === 0 ? "OK" : "FAIL",
                    detail:
                        bad.length === 0
                            ? "All checks OK"
                            : bad.map((r: { check_name: string; status: string }) => `${r.check_name}=${r.status}`).join("; "),
                });
            }
        }

        const probes = [
            ["rpc_post_sales_invoice", "post_sales_invoice"],
            ["rpc_post_production_batch", "post_production_batch"],
            ["rpc_post_purchase_invoice", "post_purchase_invoice"],
        ] as const;
        for (const [label, fn] of probes) {
            const { error } = await supabase.schema("erp").rpc(fn, { doc_id: PROBE_DOC_ID });
            const probe = classifyRpcProbe(error);
            rows.push({ check_name: label, status: probe.status, detail: probe.detail });
        }

        const sampleCodes = ["FG-ENW-001", "RM-W8-001"];
        const balances = await fetchInventoryBalancesByCode(sampleCodes);
        for (const code of sampleCodes) {
            const qty = balances[code] ?? 0;
            rows.push({
                check_name: `stock_${code}`,
                status: qty > 0 ? "OK" : "WARN",
                detail: qty > 0 ? `${qty.toLocaleString()} kg on hand` : "0 kg — post opening stock or production before sales",
            });
        }
    }

    const payload: PostingDiagnostics = {
        liveMode,
        sessionUserId,
        erpAccess,
        rows,
        rawJson: JSON.stringify({ liveMode, sessionUserId, erpAccess, rows }, null, 2),
    };
    return payload;
}

export async function fetchAuditLogs(limit = 200): Promise<any[]> {
    return fetchTransactionHistory({ limit });
}

