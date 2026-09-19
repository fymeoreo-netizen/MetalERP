import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plus, Search, FileText, ArrowUpRight, ArrowDownLeft, ShoppingCart, Printer, Lock, Package, Truck, Pencil, Trash2, Eye, RefreshCw, Ban } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";

const PurchaseInvoiceModal = lazy(() =>
    import("@/components/procurement/PurchaseInvoiceModal").then((m) => ({ default: m.PurchaseInvoiceModal })),
);
const PurchaseReturnModal = lazy(() =>
    import("@/components/procurement/PurchaseReturnModal").then((m) => ({ default: m.PurchaseReturnModal })),
);
const CreatePOModal = lazy(() =>
    import("@/components/procurement/CreatePOModal").then((m) => ({ default: m.CreatePOModal })),
);
import type { PurchaseOrderEditData } from "@/components/procurement/CreatePOModal";
import { PrintPOSheet } from "@/components/procurement/PrintPOSheet";
import { useToast } from "@/components/ui/use-toast";
import { Progress } from "@/components/ui/progress";
import { useInventoryActions, useInventoryPeriodTotals } from "@/contexts/InventoryContext";
import { useTransactionDocsPage } from "@/hooks/useTransactionDocsPage";
import { InsufficientStockError } from "@/lib/inventoryStore";
import { resolvePartyName, toDocDateISO } from "@/lib/partyCatalog";
import { isWire8ItemCode } from "@/lib/productionWire8Settings";
import { resolveCanonicalWire8ItemCode, type PurchaseCogsCascadeSummary } from "@/lib/api/purchaseInvoices";
import { upsertInvoiceListRow } from "@/lib/invoiceListPatch";
import { formatQty } from "@/lib/partyMovementReport";
import { PurchaseSupplierReceipt } from "@/components/procurement/PurchaseSupplierReceipt";
import { ConfirmInvoiceDeleteDialog } from "@/components/invoices/ConfirmInvoiceDeleteDialog";
import { InvoiceModalSkeleton } from "@/components/invoices/InvoiceModalSkeleton";
import { prefetchModalsForRoute } from "@/lib/modalPrefetch";
import { TabsScroller } from "@/components/ui/responsive-primitives";
import {
    createPurchaseInvoiceDocument,
    updatePurchaseInvoiceDocument,
    deletePurchaseInvoiceDocument,
    createPurchaseReturnDocument,
    updatePurchaseReturnDocument,
    deletePurchaseReturnDocument,
    hardDeletePurchaseReturnDocument,
    createPurchaseOrderDocument,
    updatePurchaseOrderDocument,
    allocateNextPurchaseOrderNo,
    closePurchaseOrder,
    cancelPurchaseOrder,
    deletePurchaseOrderDocument,
    fetchInventoryMovementTotals,
    fetchPurchaseInvoicesDocsPage,
    fetchPurchaseReturnsDocsPage,
    ERP_DOC_LIST_PAGE_SIZE,
    postDocument,
    savePremiumScrapForInvoice,
    adminHardDeletePurchaseInvoiceDocument,
    probeInvoiceHardDeleteAvailable,
} from "@/lib/repositories/purchaseRepo";
import { financialStatusLabel } from "@/lib/ratePending";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { StaggerGrid, MotionCard, MotionKpiCard } from "@/components/motion/MotionPrimitives";
import { DataTable } from "@/components/data-table/DataTable";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkDraftPostingToolbar } from "@/components/invoices/BulkDraftPostingToolbar";
import type { ColumnDef } from "@tanstack/react-table";
import { usePurchaseOrders } from "@/hooks/useErpQueries";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAfterInvoiceDocumentChange, queryKeys } from "@/lib/queryClient";
import type { DocActionResult, Result } from "@/lib/api/types";
import { postDraftInvoicesSequentially } from "@/lib/bulkInvoicePosting";

type PurchaseInvoiceListRow = {
    id: string;
    dbId?: string;
    date: string;
    supplier: string;
    amount: number;
    status: string;
    weight: string;
    linkedPOId?: string | null;
};

const STATUS_BADGE: Record<string, string> = {
    "Pending": "bg-slate-100 text-slate-600 border-slate-300",
    "Partially Fulfilled": "bg-blue-50 text-blue-700 border-blue-300",
    "Closed": "bg-emerald-50 text-emerald-700 border-emerald-300",
    "Completed": "bg-emerald-50 text-emerald-700 border-emerald-300",
    "Pending Rate": "bg-amber-50 text-amber-700 border-amber-300",
    "Draft": "bg-blue-50 text-blue-700 border-blue-300",
    "Canceled": "bg-rose-50 text-rose-700 border-rose-300",
};

function matchesInvoiceSearch(inv: { id?: string; supplier?: string; status?: string; date?: string; amount?: string | number; weight?: string }, query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [inv.id, inv.supplier, inv.status, inv.date, inv.amount, inv.weight]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
}

function matchesReturnSearch(ret: { id?: string; supplier?: string; reason?: string; status?: string; date?: string; amount?: string | number }, query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [ret.id, ret.supplier, ret.reason, ret.status, ret.date, ret.amount]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
}

function KpiCard({ label, value, sub, icon: Icon }: { label: string; value: string; sub: string; icon: any; accent?: string }) {
    return (
        <MotionKpiCard>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
                <Icon className="h-4 w-4 text-black" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                <p className="text-xs text-slate-500">{sub}</p>
            </CardContent>
        </MotionKpiCard>
    );
}

export default function Purchase() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { applyStockMovement, checkStockAvailable, refresh: refreshInventory, refreshBalances } = useInventoryActions();
    const periodTotals = useInventoryPeriodTotals();

    const localMonthRmReceived = useMemo(
        () => periodTotals.scrapReceived + periodTotals.wire8Received + periodTotals.rodReceived,
        [periodTotals],
    );
    const [liveMonthRmReceived, setLiveMonthRmReceived] = useState(0);
    const [activeTab, setActiveTab] = useState("orders");
    const [invoiceOpen, setInvoiceOpen] = useState(false);
    const [returnOpen, setReturnOpen] = useState(false);
    const [editReturnDbId, setEditReturnDbId] = useState<string | null>(null);
    const [poOpen, setPoOpen] = useState(false);
    const [editOrder, setEditOrder] = useState<PurchaseOrderEditData | null>(null);
    const [editInvoiceDbId, setEditInvoiceDbId] = useState<string | null>(null);
    const [printOpen, setPrintOpen] = useState(false);
    const [selectedPrintOrder, setSelectedPrintOrder] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [bulkSelectedInvoices, setBulkSelectedInvoices] = useState<Record<string, PurchaseInvoiceListRow>>({});
    const [bulkPosting, setBulkPosting] = useState(false);
    const [bulkPostProgress, setBulkPostProgress] = useState({ completed: 0, total: 0 });

    const TOLERANCE = 0.02;

    const liveMode = useBackendLiveMode();
    const location = useLocation();
    const { data: purchaseOrderRows, refetch: refetchPurchaseOrders } = usePurchaseOrders();

    const [orders, setOrders] = useState<any[]>([]);
    const [invoiceDeleteAvailable, setInvoiceDeleteAvailable] = useState(true);
    const [pendingInvoiceDelete, setPendingInvoiceDelete] = useState<{
        id: string;
        variant: "draft" | "posted";
        label: string;
    } | null>(null);
    const [invoiceDeleteLoading, setInvoiceDeleteLoading] = useState(false);
    const invoiceSearchActive = liveMode && activeTab === "invoices" && searchQuery.trim().length > 0;

    const mapPoStatus = (s: string) => {
        if (s === "closed") return "Closed";
        if (s === "partial") return "Partially Fulfilled";
        if (s === "cancelled") return "Canceled";
        return "Pending";
    };

    const refreshLiveOrders = async () => {
        await refetchPurchaseOrders();
    };

    const mapOrderRows = (rows: any[]) =>
        rows.map((r: any) => ({
            id: r.order_no,
            dbId: r.id,
            date: r.order_date,
            expectedDate: r.expected_date ?? r.order_date,
            supplier: r.parties?.name ?? "Unknown",
            supplierId: r.parties?.code ?? "",
            status: mapPoStatus(r.status),
            total_ordered_qty: Number(r.total_ordered_qty ?? 0),
            total_fulfilled_qty: Number(r.total_received_qty ?? 0),
            items: (r.purchase_order_lines ?? []).map((l: any) => ({
                lineId: l.id,
                itemCode: l.items?.code ?? "",
                item: l.items?.name ?? l.items?.code ?? "",
                qty: Number(l.qty_ordered ?? 0),
                qtyFulfilled: Number(l.qty_received ?? 0),
                qtyRemaining: Math.max(0, Number(l.qty_ordered ?? 0) - Number(l.qty_received ?? 0)),
                rate: Number(l.unit_price ?? 0),
            })),
            amount: 0,
        }));

    useEffect(() => {
        if (purchaseOrderRows) setOrders(mapOrderRows(purchaseOrderRows));
    }, [purchaseOrderRows]);

    const mapInvoiceRows = useCallback(
        (rows: any[]) =>
            rows.map((r: any) => ({
                id: r.invoice_no,
                dbId: r.id,
                date: r.invoice_date,
                supplier: r.parties?.name ?? "Unknown",
                amount: Number(r.grand_total ?? 0),
                status:
                    r.posting_status !== "posted"
                        ? "Draft"
                        : r.financial_status === "pending" || r.financial_status === "partial"
                          ? financialStatusLabel(r.financial_status)
                          : "Completed",
                weight: "—",
                linkedPOId: null,
            })),
        [],
    );

    const mapReturnRows = useCallback(
        (rows: any[]) =>
            rows.map((r: any) => ({
                id: r.return_no,
                dbId: r.id,
                date: r.return_date,
                supplier: r.parties?.name ?? "Unknown",
                amount: Number(r.grand_total ?? 0),
                reason: r.remarks || (r.return_action === "financial_only" ? "Financial Only" : "Stock Return"),
                type: r.return_action || "stock",
                status: r.posting_status === "posted" ? "Posted" : "Draft",
            })),
        [],
    );

    const {
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
        refreshLiveInvoices,
        refreshLiveReturns,
        refreshLiveDocs,
        loadMoreLiveDocs,
    } = useTransactionDocsPage<any, any, any, any>({
        liveMode,
        activeTab,
        routePath: "/purchase",
        toast,
        queryKeys: {
            invoices: queryKeys.purchaseInvoices,
            returns: queryKeys.purchaseReturns,
        },
        invoiceSearch: activeTab === "invoices" ? searchQuery : "",
        fetchInvoicesPage: fetchPurchaseInvoicesDocsPage,
        fetchReturnsPage: fetchPurchaseReturnsDocsPage,
        mapInvoiceRows,
        mapReturnRows,
    });

    const refreshLiveKpis = async () => {
        const from = new Date();
        from.setDate(1);
        const fromIso = from.toISOString().slice(0, 10);
        const toIso = new Date().toISOString().slice(0, 10);
        const t = await fetchInventoryMovementTotals(fromIso, toIso);
        setLiveMonthRmReceived(t.purchaseInQty);
    };

    const refreshAllLive = async () => {
        await Promise.all([
            invalidateAfterInvoiceDocumentChange(),
            refreshLiveDocs(true),
            refreshBalances(),
            refreshInventory(),
            refreshLiveKpis(),
        ]);
    };

    useEffect(() => {
        if (!liveMode) return;
        void refreshLiveKpis();
        void probeInvoiceHardDeleteAvailable().then(setInvoiceDeleteAvailable);
    }, [liveMode]);

    useEffect(() => {
        const warm = () => prefetchModalsForRoute("/purchase");
        if (typeof requestIdleCallback === "function") {
            const id = requestIdleCallback(warm, { timeout: 2000 });
            return () => cancelIdleCallback(id);
        }
        const t = setTimeout(warm, 600);
        return () => clearTimeout(t);
    }, []);

    const nextLocalPurchaseOrderNo = () => {
        const year = new Date().getFullYear();
        const prefix = `PO-${year}-`;
        const maxSeq = orders.reduce((max, o) => {
            const m = String(o.id ?? "").match(new RegExp(`^PO-${year}-(\\d+)$`, "i"));
            return m ? Math.max(max, Number(m[1])) : max;
        }, 0);
        return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
    };

    const handleCreateOrder = async (data: any) => {
        const totalQty = data.lines?.reduce((s: number, l: any) => s + (l.qty || l.netWeight || 0), 0) || 0;

        if (liveMode) {
            if (data.dbId) {
                const orderNo = data.orderNo ?? data.id;
                const result = await updatePurchaseOrderDocument(data.dbId, {
                    expectedDate: data.date,
                    lines: (data.lines ?? []).map((l: any) => ({
                        lineId: l.lineId,
                        itemCode: l.itemCode || l.item || l.code,
                        qty: Number(l.qty || l.netWeight || 0),
                        unitPrice: l.rate,
                    })),
                });
                if (!result.ok) {
                    toast({ title: "PO update failed", description: result.error, variant: "destructive" });
                    return;
                }
                await refreshLiveOrders();
                toast({ title: "Purchase Order Updated", description: `Order ${orderNo} saved.` });
                setEditOrder(null);
                return;
            }
            const orderNo = data.orderNo ?? (await allocateNextPurchaseOrderNo());
            const result = await createPurchaseOrderDocument({
                orderNo,
                partyCode: data.vendorId || data.vendor || "",
                expectedDate: data.date,
                warehouseType: data.warehouse ?? "raw_material",
                lines: (data.lines ?? []).map((l: any) => ({
                    itemCode: l.itemCode || l.item || l.code,
                    qty: Number(l.qty || l.netWeight || 0),
                    unitPrice: l.rate,
                })),
            });
            if (!result.ok) {
                toast({ title: "PO save failed", description: result.error, variant: "destructive" });
                return;
            }
            await refreshLiveOrders();
            toast({ title: "Purchase Order Created", description: `Order ${orderNo} saved to ERP.` });
            return;
        }

        const orderNo = data.orderNo ?? nextLocalPurchaseOrderNo();
        const newOrder = {
            id: orderNo,
            date: data.date || new Date().toISOString().split("T")[0],
            supplier: resolvePartyName(data.vendor, data.vendor),
            supplierId: data.vendor,
            items: data.lines,
            amount: data.lines.reduce((sum: number, line: any) => sum + (line.amount || 0), 0),
            status: "Pending",
            total_ordered_qty: totalQty,
            total_fulfilled_qty: 0,
        };
        setOrders([newOrder, ...orders]);
        toast({ title: "Purchase Order Created", description: `Order ${newOrder.id} successfully created.` });
    };

    const recalcPOStatus = (poId: string, invoiceNetWt: number) => {
        setOrders(prev => prev.map(o => {
            if (o.id !== poId) return o;
            const newFulfilled = o.total_fulfilled_qty + invoiceNetWt;
            let newStatus = newFulfilled <= 0 ? "Pending"
                : newFulfilled >= o.total_ordered_qty * (1 - TOLERANCE) ? "Closed"
                    : "Partially Fulfilled";
            return { ...o, total_fulfilled_qty: newFulfilled, status: newStatus };
        }));
    };

    const handleForceClose = async (poId: string) => {
        if (liveMode) {
            const order = orders.find((o) => o.id === poId);
            if (order?.dbId) await closePurchaseOrder(order.dbId);
            await refreshLiveOrders();
        } else {
            setOrders((prev) => prev.map((o) => (o.id === poId ? { ...o, status: "Closed" } : o)));
        }
        toast({ title: "PO Force Closed", description: `${poId} has been manually closed.` });
    };

    const handleCancelOrder = async (order: { id: string; dbId?: string }) => {
        if (!window.confirm(`Cancel PO ${order.id}?`)) return;
        if (liveMode && order.dbId) {
            const result = await cancelPurchaseOrder(order.dbId);
            if (!result.ok) {
                toast({ title: "Cancel failed", description: result.error, variant: "destructive" });
                return;
            }
            await refreshLiveOrders();
        } else {
            setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: "Canceled" } : o)));
        }
        toast({ title: "PO cancelled", description: order.id });
    };

    const handleDeleteOrder = async (order: { id: string; dbId?: string; total_fulfilled_qty?: number }) => {
        if ((order.total_fulfilled_qty ?? 0) > 0) {
            toast({ title: "Delete blocked", description: "Cancel the PO instead — it has received quantity.", variant: "destructive" });
            return;
        }
        if (!window.confirm(`Delete PO ${order.id}? This cannot be undone.`)) return;
        if (liveMode && order.dbId) {
            const result = await deletePurchaseOrderDocument(order.dbId);
            if (!result.ok) {
                toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                return;
            }
            await refreshLiveOrders();
        } else {
            setOrders((prev) => prev.filter((o) => o.id !== order.id));
        }
        toast({ title: "PO deleted", description: order.id });
    };

    const openEditOrder = (order: any) => {
        setEditOrder({
            dbId: order.dbId,
            orderNo: order.id,
            vendorId: order.supplierId,
            date: order.expectedDate ?? order.date,
            items: (order.items ?? []).map((i: any) => ({
                lineId: i.lineId,
                itemCode: i.itemCode ?? i.item,
                qty: i.qty,
                rate: i.rate ?? 0,
                qtyReceived: i.qtyFulfilled ?? 0,
            })),
        });
        setPoOpen(true);
    };

    const persistInvoice = async (data: any): Promise<Result<{ id: string; cogsCascade?: PurchaseCogsCascadeSummary }>> => {
        if (data.dbId) return updatePurchaseInvoiceDocument(data.dbId, data);
        return createPurchaseInvoiceDocument(data);
    };

    const handleSaveInvoiceDraft = async (data: any): Promise<DocActionResult> => {
        if (!liveMode) {
            const invoiceId = data.header?.invoiceId ?? `PI-${1000 + invoices.length + 1}`;
            const draft = {
                id: invoiceId,
                date: data.header?.date ? data.header.date.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
                supplier: resolvePartyName(data.header?.supplier, "New Supplier"),
                amount: Number(data.totals?.netPayable ?? 0),
                status: "Draft",
                weight: `${(data.items ?? []).reduce((s: number, i: any) => s + (i.netWeight || 0), 0).toLocaleString()} kg`,
                linkedPOId: data.header?.linkedPOId || null,
            };
            setInvoices((prev) => [draft, ...prev.filter((i) => i.id !== invoiceId)]);
            toast({ title: "Draft saved", description: `Invoice ${invoiceId} saved locally.` });
            setEditInvoiceDbId(null);
            return { ok: true };
        }
        const persist = await persistInvoice(data);
        if (!persist.ok) {
            toast({ title: "Invoice save failed", description: persist.error, variant: "destructive" });
            return { ok: false, error: persist.error };
        }
        if (data.header?.purchaseMode === "premium") {
            const allocResult = await savePremiumScrapForInvoice(persist.data.id, data.premiumAllocation);
            if (!allocResult.ok) {
                toast({ title: "Premium scrap save failed", description: allocResult.error, variant: "destructive" });
                return { ok: false, dbId: persist.data.id, error: allocResult.error };
            }
        }
        const cogs = persist.data.cogsCascade;
        const cogsTouched =
            Number(cogs?.salesInvoicesGlSynced ?? 0) > 0 ||
            Number(cogs?.productionBatchesRecosted ?? 0) > 0 ||
            Number(cogs?.productionGlSynced ?? 0) > 0;
        const postedUpdateDescription = cogs
            ? cogsTouched
                ? `Invoice ${data.header.invoiceId} changes saved. COGS cascade: ${cogs.productionBatchesRecosted} production, ${cogs.salesInvoicesGlSynced} sales GL.`
                : Number(cogs.lockedOrFinalSalesSkipped ?? 0) > 0
                  ? `Invoice ${data.header.invoiceId} changes saved. COGS unchanged: ${cogs.lockedOrFinalSalesSkipped} sales rows are locked/final.`
                  : `Invoice ${data.header.invoiceId} changes saved. No downstream COGS rows were affected.`
            : `Invoice ${data.header.invoiceId} changes saved.`;
        toast({
            title: data.header?.postingStatus === "posted" ? "Invoice updated" : "Draft saved",
            description:
                data.header?.postingStatus === "posted"
                    ? postedUpdateDescription
                    : `Invoice ${data.header.invoiceId} saved as draft.`,
        });
        setEditInvoiceDbId(null);
        if (liveMode) {
            const weightKg = (data.items ?? []).reduce((s: number, i: any) => s + (i.netWeight || 0), 0);
            setInvoices((prev) =>
                upsertInvoiceListRow(prev, {
            id: data.header.invoiceId,
                    dbId: persist.data.id,
                    supplier: resolvePartyName(data.header?.supplier, "New Supplier"),
                    date: toDocDateISO(data.header?.date),
                    amount: Number(data.totals?.netPayable ?? 0),
                    status: data.header?.postingStatus === "posted" ? "Completed" : "Draft",
                    linkedPOId: data.header?.linkedPOId || null,
                    weight: `${weightKg.toLocaleString()} kg`,
                }),
            );
            void Promise.all([
                invalidateAfterInvoiceDocumentChange(),
                refreshLiveDocs(true),
                refreshLiveKpis(),
                data.header?.postingStatus === "posted" ? refreshBalances() : Promise.resolve(),
            ]);
        }
        return { ok: true, dbId: persist.data.id };
    };

    const handlePostInvoice = async (data: any): Promise<DocActionResult> => {
        const invoiceId = data.header.invoiceId;
        const purchaseMode = data.header.purchaseMode as "cash" | "premium" | undefined;
        const supplierId = data.header?.supplier || "";
        const docDate = toDocDateISO(data.header?.date);

        if (!liveMode) {
            try {
                for (const line of data.items ?? []) {
                    const code = line.itemCode ?? line.item;
                    const qty = line.netWeight ?? 0;
                    if (!code || qty <= 0) continue;
                    applyStockMovement({
                        type: "PURCHASE_INVOICE",
                        itemCode: code,
                        qty,
                        refDocId: invoiceId,
                        refDocType: "PURCHASE_INVOICE",
                        partyId: supplierId || undefined,
                        partyName: resolvePartyName(supplierId, "Unknown Supplier"),
                        partyRole: "supplier",
                        docDate,
                        purchaseMode,
                        amount: line.amount,
                        rate: line.rate,
                    });
                }
            } catch (e) {
                toast({
                    title: "Stock update failed",
                    description: e instanceof Error ? e.message : "Could not post invoice.",
                    variant: "destructive",
                });
                return { ok: false, error: e instanceof Error ? e.message : "Could not post invoice locally." };
            }

            setInvoices([{
                id: invoiceId,
            date: data.header.date ? data.header.date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                supplier: resolvePartyName(supplierId, "New Supplier"),
            amount: data.totals.netPayable,
                status: "Completed",
                weight: `${data.items.reduce((s: number, i: any) => s + (i.netWeight || 0), 0).toLocaleString()} kg`,
            linkedPOId: data.header.linkedPOId || null,
        }, ...invoices]);
            if (data.header.linkedPOId) recalcPOStatus(data.header.linkedPOId, data.items.reduce((s: number, i: any) => s + (i.netWeight || 0), 0));
            toast({ title: "Invoice Posted", description: `Invoice ${invoiceId} posted. Stock increased.` });
            setEditInvoiceDbId(null);
            return { ok: true };
        }

        const persist = await persistInvoice(data);
        if (!persist.ok) {
            toast({ title: "Invoice DB save failed", description: persist.error, variant: "destructive" });
            return { ok: false, error: persist.error };
        }

        try {
            if (purchaseMode === "premium") {
                const allocResult = await savePremiumScrapForInvoice(persist.data.id, data.premiumAllocation);
                if (!allocResult.ok) {
                    toast({
                        title: "Premium scrap save failed",
                        description: allocResult.error,
                        variant: "destructive",
                    });
                    return { ok: false, dbId: persist.data.id, error: allocResult.error };
                }
            }
            await postDocument("post_purchase_invoice", persist.data.id);
        } catch (e) {
            toast({
                title: "Invoice posting failed",
                description: e instanceof Error ? e.message : "Could not post purchase invoice to ledger.",
                variant: "destructive",
            });
            const postErr = e instanceof Error ? e.message : "Could not post purchase invoice to ledger.";
            return { ok: false, dbId: persist.data.id, error: postErr };
        }

        if (liveMode) {
            const weightKg = (data.items ?? []).reduce((s: number, i: any) => s + (i.netWeight || 0), 0);
            const linkedPOId = data.header?.linkedPOId || null;
            const canonicalWire8 = await resolveCanonicalWire8ItemCode();
            for (const line of data.items ?? []) {
                let code = line.itemCode ?? line.item;
                const qty = line.netWeight ?? 0;
                if (!code || qty <= 0) continue;
                if (isWire8ItemCode(code)) code = canonicalWire8;
                try {
                    applyStockMovement({
                        type: "PURCHASE_INVOICE",
                        itemCode: code,
                        qty,
                        refDocId: invoiceId,
                        refDocType: "PURCHASE_INVOICE",
                        partyId: supplierId || undefined,
                        partyName: resolvePartyName(supplierId, "Unknown Supplier"),
                        partyRole: "supplier",
                        docDate,
                        purchaseMode,
                        amount: line.amount,
                        rate: line.rate,
                    });
                } catch {
                    /* background refresh reconciles live balances */
                }
            }
            if (linkedPOId) recalcPOStatus(linkedPOId, weightKg);
            setInvoices((prev) =>
                upsertInvoiceListRow(prev, {
                    id: data.header.invoiceId,
                    dbId: persist.data.id,
                    supplier: resolvePartyName(supplierId, "New Supplier"),
                    date: toDocDateISO(data.header?.date),
                    amount: Number(data.totals?.netPayable ?? 0),
                    status: "Completed",
                    linkedPOId,
                    weight: `${weightKg.toLocaleString()} kg`,
                }),
            );
            void Promise.all([
                invalidateAfterInvoiceDocumentChange(),
                refreshLiveDocs(true),
                refreshBalances(),
                refreshLiveKpis(),
                linkedPOId ? refreshLiveOrders() : Promise.resolve(),
            ]);
        }
        toast({ title: "Invoice Posted", description: `Invoice ${invoiceId} posted. Stock increased.` });
        setEditInvoiceDbId(null);
        return { ok: true, dbId: persist.data.id };
    };

    const handleDeleteInvoice = async (id: string): Promise<boolean> => {
        if (liveMode) {
            const result = await deletePurchaseInvoiceDocument(id);
            if (!result.ok) {
                toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                return false;
            }
            await Promise.all([invalidateAfterInvoiceDocumentChange(), refreshLiveDocs(true), refreshLiveOrders()]);
        } else {
            setInvoices((prev) => prev.filter((i) => i.dbId !== id && i.id !== id));
        }
        toast({ title: "Invoice deleted", description: "Draft invoice removed." });
        return true;
    };

    const handleAdminHardDeleteInvoice = async (id: string): Promise<boolean> => {
        const result = await adminHardDeletePurchaseInvoiceDocument(id);
        if (!result.ok) {
            toast({ title: "Hard delete failed", description: result.error, variant: "destructive" });
            return false;
        }
        await Promise.all([
            invalidateAfterInvoiceDocumentChange(),
            refreshLiveDocs(true),
            refreshLiveOrders(),
            refreshBalances(),
        ]);
        setInvoices((prev) => prev.filter((i) => i.dbId !== id));
        toast({ title: "Invoice deleted", description: "Posted invoice removed and linked PO rolled back." });
        return true;
    };

    const confirmPendingInvoiceDelete = async () => {
        if (!pendingInvoiceDelete) return;
        setInvoiceDeleteLoading(true);
        try {
            const { id, variant } = pendingInvoiceDelete;
            const ok =
                variant === "posted"
                    ? await handleAdminHardDeleteInvoice(id)
                    : await handleDeleteInvoice(id);
            if (ok !== false) {
                setPendingInvoiceDelete(null);
                if (editInvoiceDbId === id) {
                    setInvoiceOpen(false);
                    setEditInvoiceDbId(null);
                }
            }
        } finally {
            setInvoiceDeleteLoading(false);
        }
    };

    const openInvoice = (inv: { dbId?: string }) => {
        if (liveMode && !inv.dbId) {
            toast({ title: "Cannot open invoice", description: "This invoice is not stored in the database.", variant: "destructive" });
            return;
        }
        setEditInvoiceDbId(inv.dbId ?? null);
        setInvoiceOpen(true);
    };

    const persistReturn = async (data: any) => {
        if (data.dbId) return updatePurchaseReturnDocument(data.dbId, data);
        return createPurchaseReturnDocument(data);
    };

    const handleSaveReturnDraft = async (data: any): Promise<boolean> => {
        if (!liveMode) {
            const returnId = data.header?.returnId ?? `PR-${returns.length + 1}`;
            const draft = {
                id: returnId,
                date: data.header?.date ? data.header.date.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
                supplier: resolvePartyName(data.header?.supplierId, "New Supplier"),
                amount: Number(data.totalDebit ?? 0),
                reason: data.header?.remarks || "N/A",
                type: data.header?.returnAction === "stock" ? "Stock Return" : "Financial Only",
                status: "Draft",
            };
            setReturns((prev) => [draft, ...prev.filter((r) => r.id !== returnId)]);
            toast({ title: "Draft saved", description: `Debit note ${returnId} saved locally.` });
            setEditReturnDbId(null);
            return true;
        }
        const persist = await persistReturn(data);
        if (!persist.ok) {
            toast({ title: "Debit note save failed", description: persist.error, variant: "destructive" });
            return false;
        }
        toast({ title: "Draft saved", description: `Debit note ${data.header.returnId} saved as draft.` });
        setEditReturnDbId(null);
        if (liveMode) {
            await invalidateAfterInvoiceDocumentChange();
            await refreshLiveDocs(true);
        }
        return true;
    };

    const handlePostReturn = async (data: any): Promise<boolean> => {
        const returnId = data.header.returnId;
        const isStock = data.header.returnAction === "stock";

        if (isStock && !liveMode) {
            const stockLines = (data.items ?? [])
                .map((l: any) => ({
                    itemCode: l.itemCode ?? l.item,
                    qty: l.netWeight ?? l.weight ?? 0,
                }))
                .filter((l: { itemCode: string; qty: number }) => l.itemCode && l.qty > 0);

            const check = checkStockAvailable(stockLines);
            if (!check.ok) {
                const f = check.failures[0];
                toast({
                    title: "Insufficient stock",
                    description: `${f.itemCode}: need ${f.requested.toLocaleString()}, have ${f.available.toLocaleString()}`,
                    variant: "destructive",
                });
                return false;
            }
        }

        if (isStock && !liveMode) {
            const supplierId = data.header?.supplierId || "";
            const docDate = toDocDateISO(data.header?.date);
            try {
                for (const line of data.items ?? []) {
                    const code = line.itemCode ?? line.item;
                    const qty = line.netWeight ?? line.weight ?? 0;
                    if (!code || qty <= 0) continue;
                    applyStockMovement({
                        type: "PURCHASE_RETURN",
                        itemCode: code,
                        qty,
                        refDocId: returnId,
                        refDocType: "PURCHASE_RETURN",
                        partyId: supplierId || undefined,
                        partyName: resolvePartyName(supplierId, "Unknown Supplier"),
                        partyRole: "supplier",
                        docDate,
                        amount: line.amount,
                        rate: line.rate,
                    });
                }
            } catch (e) {
                toast({
                    title: "Stock update failed",
                    description: e instanceof InsufficientStockError ? e.message : "Could not post return.",
                    variant: "destructive",
                });
                return false;
            }
        }

        if (!liveMode) {
        setReturns([{
                id: returnId,
                date: data.header.date ? data.header.date.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
                supplier: resolvePartyName(data.header?.supplierId, "New Supplier"),
            amount: data.totalDebit,
            reason: data.header.remarks || "N/A",
                type: isStock ? "Stock Return" : "Financial Only",
                status: "Posted",
        }, ...returns]);
            toast({
                title: "Debit Note Posted",
                description: isStock ? `${returnId} — stock reduced.` : `${returnId} — financial only.`,
            });
            setEditReturnDbId(null);
            return true;
        }

        const persist = await persistReturn(data);
        if (!persist.ok) {
            toast({ title: "Return DB save failed", description: persist.error, variant: "destructive" });
            return false;
        }

        try {
            await postDocument("post_purchase_return", persist.data.id);
        } catch (e) {
            toast({
                title: "Return posting failed",
                description: e instanceof Error ? e.message : "Could not post purchase return to ledger.",
                variant: "destructive",
            });
            return false;
        }

        toast({
            title: "Debit Note Posted",
            description: isStock ? `${returnId} — stock reduced.` : `${returnId} — financial only.`,
        });
        setEditReturnDbId(null);
        if (liveMode) void refreshAllLive();
        return true;
    };

    const handleDeleteReturn = async (id: string, posted = false): Promise<boolean> => {
        const msg = posted
            ? "Delete this posted debit note and reverse its ledger/stock effects?"
            : "Delete this draft debit note? This cannot be undone.";
        if (!window.confirm(msg)) return false;
        if (liveMode) {
            const result = posted
                ? await hardDeletePurchaseReturnDocument(id)
                : await deletePurchaseReturnDocument(id);
            if (!result.ok) {
                toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                return false;
            }
            await Promise.all([invalidateAfterInvoiceDocumentChange(), refreshLiveDocs(true)]);
        } else {
            setReturns((prev) => prev.filter((r) => r.dbId !== id && r.id !== id));
        }
        toast({ title: "Debit note deleted" });
        return true;
    };

    const openReturn = (ret: { dbId?: string }) => {
        if (liveMode && !ret.dbId) {
            toast({ title: "Cannot open debit note", description: "This note is not stored in the database.", variant: "destructive" });
            return;
        }
        setEditReturnDbId(ret.dbId ?? null);
        setReturnOpen(true);
    };

    const filteredOrders = orders.filter(o =>
        !searchQuery || o.id.toLowerCase().includes(searchQuery.toLowerCase()) || o.supplier.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const filteredInvoices = useMemo(
        () => (invoiceSearchActive ? invoices : invoices.filter((i) => matchesInvoiceSearch(i, searchQuery))),
        [invoices, invoiceSearchActive, searchQuery],
    );
    const shownDraftInvoices = useMemo(
        () => filteredInvoices.filter((invoice): invoice is PurchaseInvoiceListRow & { dbId: string } =>
            invoice.status === "Draft" && Boolean(invoice.dbId),
        ),
        [filteredInvoices],
    );
    const selectedDraftInvoices = useMemo(() => Object.values(bulkSelectedInvoices), [bulkSelectedInvoices]);

    const setInvoiceBulkSelected = useCallback((invoice: PurchaseInvoiceListRow, selected: boolean) => {
        if (!invoice.dbId) return;
        setBulkSelectedInvoices((current) => {
            const next = { ...current };
            if (selected) next[invoice.dbId!] = invoice;
            else delete next[invoice.dbId!];
            return next;
        });
    }, []);

    const selectShownDraftInvoices = useCallback(() => {
        setBulkSelectedInvoices((current) => {
            const next = { ...current };
            for (const invoice of shownDraftInvoices) next[invoice.dbId] = invoice;
            return next;
        });
    }, [shownDraftInvoices]);

    const handleBulkPostInvoices = useCallback(async () => {
        if (!liveMode || bulkPosting || selectedDraftInvoices.length === 0) return;
        setBulkPosting(true);
        setBulkPostProgress({ completed: 0, total: selectedDraftInvoices.length });
        try {
            const result = await postDraftInvoicesSequentially(
            selectedDraftInvoices,
            async (invoice) => {
                if (!invoice.dbId) throw new Error("Invoice is missing its database ID.");
                await postDocument("post_purchase_invoice", invoice.dbId);
            },
            (completed, total) => setBulkPostProgress({ completed, total }),
        );

        const succeededIds = new Set(result.succeeded.map((invoice) => invoice.dbId).filter(Boolean));
        setBulkSelectedInvoices((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => !succeededIds.has(id))),
        );
        await refreshAllLive();

        if (result.failures.length === 0) {
            toast({
                title: `${result.succeeded.length} purchase invoices posted`,
                description: "Stock and accounting balances were refreshed.",
            });
        } else {
            const first = result.failures[0];
            toast({
                title: `${result.succeeded.length} posted, ${result.failures.length} failed`,
                description: `${first.invoice.id}: ${first.error}`,
                variant: "destructive",
            });
        }
        } finally {
            setBulkPosting(false);
        }
    }, [bulkPosting, liveMode, refreshAllLive, selectedDraftInvoices, toast]);
    const filteredReturns = returns.filter((r) => matchesReturnSearch(r, searchQuery));

    const requestInvoiceDelete = useCallback(
        (inv: PurchaseInvoiceListRow, variant: "posted" | "draft") => {
            setPendingInvoiceDelete({
                id: variant === "posted" ? inv.dbId! : inv.dbId ?? inv.id,
                variant,
                label: inv.id,
            });
        },
        [],
    );

    const invoiceColumns = useMemo<ColumnDef<PurchaseInvoiceListRow, unknown>[]>(
        () => [
            {
                id: "select",
                header: () => {
                    const selectedShown = shownDraftInvoices.filter((invoice) => bulkSelectedInvoices[invoice.dbId]).length;
                    const checked = shownDraftInvoices.length > 0 && selectedShown === shownDraftInvoices.length;
                    return (
                        <Checkbox
                            checked={checked ? true : selectedShown > 0 ? "indeterminate" : false}
                            disabled={bulkPosting || shownDraftInvoices.length === 0}
                            onCheckedChange={(value) => {
                                if (value) selectShownDraftInvoices();
                                else {
                                    setBulkSelectedInvoices((current) => {
                                        const next = { ...current };
                                        for (const invoice of shownDraftInvoices) delete next[invoice.dbId];
                                        return next;
                                    });
                                }
                            }}
                            aria-label="Select shown draft purchase invoices"
                        />
                    );
                },
                enableSorting: false,
                cell: ({ row }) => {
                    const invoice = row.original;
                    const selectable = invoice.status === "Draft" && Boolean(invoice.dbId);
                    return (
                        <span onClick={(event) => event.stopPropagation()}>
                            <Checkbox
                                checked={Boolean(invoice.dbId && bulkSelectedInvoices[invoice.dbId])}
                                disabled={bulkPosting || !selectable}
                                onCheckedChange={(value) => setInvoiceBulkSelected(invoice, Boolean(value))}
                                aria-label={`Select ${invoice.id}`}
                            />
                        </span>
                    );
                },
            },
            {
                accessorKey: "id",
                header: "Invoice #",
                cell: ({ row }) => (
                    <span className="font-mono text-xs font-semibold text-slate-800">{row.original.id}</span>
                ),
            },
            {
                accessorKey: "date",
                header: "Date",
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-slate-500 tabular-nums">{row.original.date}</span>
                ),
            },
            {
                accessorKey: "supplier",
                header: "Supplier",
                cell: ({ row }) => (
                    <span className="max-w-[220px] truncate font-medium text-slate-900">{row.original.supplier}</span>
                ),
            },
            {
                accessorKey: "weight",
                header: "Weight",
                cell: ({ row }) => <span className="text-xs text-slate-500">{row.original.weight}</span>,
            },
            {
                accessorKey: "amount",
                header: "Amount",
                meta: { align: "right" },
                cell: ({ row }) => (
                    <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {row.original.amount === 0 ? "—" : `₨ ${row.original.amount.toLocaleString()}`}
                    </span>
                ),
            },
            {
                accessorKey: "status",
                header: "Status",
                cell: ({ row }) => (
                    <Badge className={`text-xs border ${STATUS_BADGE[row.original.status] || "bg-slate-100 text-slate-600 border-slate-300"}`}>
                        {row.original.status}
                    </Badge>
                ),
            },
            {
                id: "actions",
                header: () => <span className="sr-only">Actions</span>,
                enableSorting: false,
                meta: { align: "right" },
                cell: ({ row }) => {
                    const inv = row.original;
                    return (
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-blue-600"
                                onClick={() => openInvoice(inv)}
                            >
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                Edit
                            </Button>
                            {liveMode && inv.status === "Completed" && inv.dbId ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs text-rose-700"
                                    onClick={() => requestInvoiceDelete(inv, "posted")}
                                >
                                    Delete
                                </Button>
                            ) : null}
                            {inv.status === "Draft" && (inv.dbId || !liveMode) ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs text-rose-600"
                                    onClick={() => requestInvoiceDelete(inv, "draft")}
                                >
                                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                                    Delete
                                </Button>
                            ) : null}
                        </div>
                    );
                },
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            bulkPosting,
            bulkSelectedInvoices,
            liveMode,
            requestInvoiceDelete,
            selectShownDraftInvoices,
            setInvoiceBulkSelected,
            shownDraftInvoices,
        ],
    );

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* ── HEADER ── */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Procurement</h1>
                        <p className="text-slate-500">Manage Purchase Orders, Invoices, and Supplier Returns</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {activeTab === 'orders' && (
                            <Button className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto" onClick={() => { setEditOrder(null); setPoOpen(true); }}>
                                <Plus className="h-4 w-4 mr-2" /> New Order
                            </Button>
                        )}
                        {activeTab === 'invoices' && (
                            <Button className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto" onClick={() => { setEditInvoiceDbId(null); setInvoiceOpen(true); }}>
                                <Plus className="h-4 w-4 mr-2" /> New Invoice
                            </Button>
                        )}
                        {activeTab === 'returns' && (
                            <Button className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto" onClick={() => { setEditReturnDbId(null); setReturnOpen(true); }}>
                                <Plus className="h-4 w-4 mr-2" /> New Return
                            </Button>
                        )}
                    </div>
                </div>

                {/* ── KPI ROW ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <KpiCard label="Open Orders" value={`${orders.filter(o => o.status !== 'Closed').length} Orders`} sub="Awaiting fulfillment" icon={ShoppingCart} accent="blue" />
                    <KpiCard label="Pending Invoices" value={`${invoices.filter(i => i.status === 'Pending Rate').length} Invoices`} sub="Rate not yet fixed" icon={FileText} accent="amber" />
                    <KpiCard
                        label="RM Received (Month)"
                        value={formatQty(liveMode ? liveMonthRmReceived : localMonthRmReceived)}
                        sub="Scrap + wire 8 + rod"
                        icon={Truck}
                        accent="emerald"
                    />
                    <KpiCard label="Debit Notes" value={`${returns.length} Returns`} sub="Stock/financial adjustments" icon={ArrowUpRight} accent="rose" />
                </div>

                {/* ── MODALS ── */}
                {poOpen ? (
                    <Suspense fallback={null}>
                        <CreatePOModal
                            open={poOpen}
                            onOpenChange={(open) => { setPoOpen(open); if (!open) setEditOrder(null); }}
                            onSubmit={handleCreateOrder}
                            editOrder={editOrder}
                        />
                    </Suspense>
                ) : null}
                {invoiceOpen ? (
                    <Suspense fallback={<InvoiceModalSkeleton title="Purchase invoice" />}>
                        <PurchaseInvoiceModal
                            open={invoiceOpen}
                            onOpenChange={(open) => { setInvoiceOpen(open); if (!open) setEditInvoiceDbId(null); }}
                            onSaveDraft={handleSaveInvoiceDraft}
                            onPost={handlePostInvoice}
                            onDelete={handleDeleteInvoice}
                            pendingPOs={orders.filter(o => o.status === 'Pending' || o.status === 'Partially Fulfilled')}
                            editInvoiceDbId={editInvoiceDbId}
                        />
                    </Suspense>
                ) : null}
                {returnOpen ? (
                    <Suspense fallback={<InvoiceModalSkeleton title="Debit note" />}>
                        <PurchaseReturnModal
                            open={returnOpen}
                            onOpenChange={(open) => { setReturnOpen(open); if (!open) setEditReturnDbId(null); }}
                            onSaveDraft={handleSaveReturnDraft}
                            onPost={handlePostReturn}
                            onDelete={handleDeleteReturn}
                            editReturnDbId={editReturnDbId}
                        />
                    </Suspense>
                ) : null}
                <PrintPOSheet open={printOpen} onOpenChange={setPrintOpen} order={selectedPrintOrder} />

                {/* ── TABS ── */}
                <Tabs value={activeTab} onValueChange={(v) => {
                    setActiveTab(v);
                    setSearchQuery("");
                    if (v === "invoices" && liveMode) void refreshLiveInvoices(true);
                    if (v === "returns" && liveMode) void refreshLiveReturns(true);
                }} className="space-y-4">
                    <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
                        <TabsScroller className="sm:flex-1">
                        <TabsList className="bg-slate-100 p-1">
                            <TabsTrigger value="orders" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                                <ShoppingCart className="h-4 w-4 mr-2" /> Purchase Orders
                            </TabsTrigger>
                            <TabsTrigger value="invoices" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                                <ArrowDownLeft className="h-4 w-4 mr-2" /> Inward Supply
                            </TabsTrigger>
                            <TabsTrigger value="returns" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                                <ArrowUpRight className="h-4 w-4 mr-2" /> Debit Notes
                            </TabsTrigger>
                                <TabsTrigger value="receipts" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                                    <ArrowDownLeft className="h-4 w-4 mr-2" /> RM from Suppliers
                            </TabsTrigger>
                        </TabsList>
                        </TabsScroller>

                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <div className="relative flex-1 sm:flex-none sm:min-w-[250px]">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                    className="pl-9 w-full sm:w-[250px]"
                                    placeholder={
                                        activeTab === "invoices"
                                            ? "Search invoice no., supplier, date..."
                                            : activeTab === "returns"
                                              ? "Search debit note, supplier, status..."
                                              : "Search ID, supplier..."
                                    } />
                            </div>
                            {activeTab === "invoices" && liveMode ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    disabled={refreshingDocs}
                                    onClick={() => void refreshLiveDocs(true)}
                                    title="Refresh invoices from database"
                                >
                                    <RefreshCw className={`h-4 w-4 ${refreshingDocs ? "animate-spin" : ""}`} />
                                </Button>
                            ) : null}
                        </div>
                    </div>

                    {/* ── ORDERS TAB ── */}
                    <TabsContent value="orders">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Active Purchase Orders</CardTitle>
                                <CardDescription>{filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''} found</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {filteredOrders.map((po, index) => (
                                        <MotionCard key={po.id} index={index}>
                                        <Card className="shadow-soft border-slate-100 bg-white overflow-hidden flex flex-col h-full transition-colors duration-200">
                                            <div className={`h-1 w-full ${po.status === 'Closed' ? 'bg-emerald-500' : po.status === 'Partially Fulfilled' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                                            <CardHeader className="p-4 pb-2 border-b border-slate-50">
                                                <div className="flex justify-between items-start">
                                                    <div className="font-mono font-bold text-sm">{po.id}</div>
                                                    <Badge variant="outline" className={`text-xs ${STATUS_BADGE[po.status] || ''}`}>{po.status}</Badge>
                                                </div>
                                                <CardTitle className="text-base mt-2">{po.supplier}</CardTitle>
                                                <CardDescription className="font-mono text-xs">{po.date}</CardDescription>
                                            </CardHeader>

                                            <CardContent className="p-4 flex-1 space-y-4">
                                                <div>
                                                    <div className="flex justify-between text-xs mb-1.5">
                                                        <span className="text-slate-500">Fulfillment</span>
                                                        <span className="font-medium text-slate-700">{Math.min(100, Math.round((po.total_fulfilled_qty / po.total_ordered_qty) * 100))}%</span>
                                                    </div>
                                                    <Progress value={Math.min(100, (po.total_fulfilled_qty / po.total_ordered_qty) * 100)} className="h-2" />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 text-sm">
                                                    <div>
                                                        <div className="text-xs text-slate-500">Ordered</div>
                                                        <div className="font-medium">{po.total_ordered_qty.toLocaleString()} kg</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-slate-500">Value</div>
                                                        <div className="font-medium">₨ {(po.amount / 1000000).toFixed(1)}M</div>
                                                    </div>
                                                </div>
                                            </CardContent>

                                            <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                                                {po.status !== "Closed" && po.status !== "Canceled" ? (
                                                    <div className="flex gap-1">
                                                        {po.dbId && (
                                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600" onClick={() => openEditOrder(po)} title="Edit PO">
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-600" onClick={() => void handleCancelOrder(po)} title="Cancel PO">
                                                            <Ban className="h-4 w-4" />
                                                        </Button>
                                                        {po.total_fulfilled_qty <= 0 && po.dbId ? (
                                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => void handleDeleteOrder(po)} title="Delete PO">
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        ) : null}
                                                    <Button size="sm" variant="outline" className="text-xs"
                                                        onClick={() => handleForceClose(po.id)}>
                                                        <Lock className="h-3 w-3 mr-2" /> Close
                                                    </Button>
                                                    </div>
                                                ) : <div />}
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500"
                                                    onClick={() => { setSelectedPrintOrder(po); setPrintOpen(true); }}>
                                                    <Printer className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </Card>
                                        </MotionCard>
                                    ))}
                                </StaggerGrid>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ── INVOICES TAB ── */}
                    <TabsContent value="invoices">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Inward Supply — Invoices</CardTitle>
                                <CardDescription>
                                    {liveMode
                                        ? `Showing ${filteredInvoices.length} of ${invoiceTotal} invoice${invoiceTotal !== 1 ? "s" : ""}${invoiceSearchActive ? " (search)" : ""}`
                                        : `${filteredInvoices.length} invoice${filteredInvoices.length !== 1 ? "s" : ""} found`}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {liveMode ? (
                                    <BulkDraftPostingToolbar
                                        documentLabel="purchase"
                                        shownDraftCount={shownDraftInvoices.length}
                                        selectedCount={selectedDraftInvoices.length}
                                        posting={bulkPosting}
                                        completed={bulkPostProgress.completed}
                                        total={bulkPostProgress.total}
                                        onSelectShown={selectShownDraftInvoices}
                                        onClear={() => setBulkSelectedInvoices({})}
                                        onPost={handleBulkPostInvoices}
                                    />
                                ) : null}
                                {liveMode && !invoiceDeleteAvailable ? (
                                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                        Invoice delete is unavailable. Run migration 31 in Supabase SQL Editor, then hard-refresh this page.
                                                </div>
                                ) : null}
                                {docsFetchError ? (
                                    <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                                        Could not load latest invoices: {docsFetchError}
                                            </div>
                                ) : null}
                                {filteredInvoices.length === 0 ? (
                                    <div className="py-16 text-center text-slate-500">
                                        {searchQuery ? "No invoices match your search." : "No invoices yet. Create one from the button above."}
                                </div>
                                ) : (
                                <>
                                <DataTable
                                    columns={invoiceColumns}
                                    data={filteredInvoices}
                                    getRowId={(inv) => inv.dbId ?? inv.id}
                                    onRowClick={(inv) => openInvoice(inv)}
                                    hideSearch
                                    pageSize={0}
                                    emptyMessage="No invoices match your search."
                                />
                                {liveMode && invoiceHasMore && !invoiceSearchActive ? (
                                    <div className="mt-4 flex justify-center">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={loadingMoreDocs}
                                            onClick={() => void loadMoreLiveDocs()}
                                        >
                                            {loadingMoreDocs
                                                ? "Loading…"
                                                : `Load more invoices (${invoices.length} of ${invoiceTotal})`}
                                        </Button>
                                    </div>
                                ) : null}
                                </>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ── RM FROM SUPPLIERS TAB ── */}
                    <TabsContent value="receipts">
                        <PurchaseSupplierReceipt />
                    </TabsContent>

                    {/* ── RETURNS TAB ── */}
                    <TabsContent value="returns">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Debit Notes</CardTitle>
                                <CardDescription>
                                    {liveMode
                                        ? `Showing ${filteredReturns.length} of ${returnTotal} debit note${returnTotal !== 1 ? "s" : ""}${searchQuery ? " (filtered)" : ""}`
                                        : "Stock returns and financial adjustments"}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {refreshingReturns && liveMode ? (
                                    <div className="py-16 text-center text-slate-500">Loading debit notes…</div>
                                ) : filteredReturns.length === 0 ? (
                                    <div className="py-16 text-center text-slate-500">
                                        {searchQuery ? "No debit notes match your search." : "No debit notes recorded yet."}
                                    </div>
                                ) : (
                                    <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {filteredReturns.map((ret, index) => (
                                            <MotionCard key={ret.id} index={index}>
                                            <Card className="shadow-soft border-slate-100 bg-white overflow-hidden flex flex-col h-full transition-colors duration-200">
                                                <div className={`h-1 w-full ${ret.status === "Posted" ? "bg-emerald-500" : "bg-rose-400"}`} />
                                                <CardHeader className="p-4 pb-2 border-b border-slate-50">
                                                    <div className="flex justify-between items-start gap-2">
                                                    <div className="font-mono font-bold text-sm">{ret.id}</div>
                                                        <Badge variant="outline" className={`text-xs shrink-0 ${ret.status === "Posted" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}>
                                                            {ret.status ?? ret.type}
                                                        </Badge>
                                                    </div>
                                                    <CardTitle className="text-base mt-2">{ret.supplier}</CardTitle>
                                                    <CardDescription className="font-mono text-xs">{ret.date}</CardDescription>
                                                    <Badge variant="outline" className="mt-2 w-fit bg-slate-50 text-slate-700">{ret.reason}</Badge>
                                                </CardHeader>
                                                <CardContent className="p-4 flex-1 flex flex-col items-center justify-center py-6">
                                                    <div className="text-xs text-slate-500 mb-1">Debit Amount</div>
                                                    <div className="font-bold text-2xl">₨ {ret.amount.toLocaleString()}</div>
                                                </CardContent>
                                                <div className="p-3 bg-slate-50 border-t border-slate-100 flex gap-1">
                                                    <Button size="sm" variant="ghost" className="text-xs text-blue-600" onClick={() => openReturn(ret)}>
                                                        <Eye className="h-4 w-4 mr-1.5" />
                                                        Edit
                                                    </Button>
                                                    {ret.dbId ? (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="text-xs text-rose-600"
                                                            onClick={() => void handleDeleteReturn(ret.dbId!, ret.status === "Posted").then((ok) => {
                                                                if (ok === false) return;
                                                                if (editReturnDbId === ret.dbId) {
                                                                    setReturnOpen(false);
                                                                    setEditReturnDbId(null);
                                                                }
                                                            })}
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </Card>
                                            </MotionCard>
                                        ))}
                                    </StaggerGrid>
                                )}
                                {liveMode && returnHasMore && filteredReturns.length > 0 ? (
                                    <div className="mt-4 flex justify-center">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={loadingMoreDocs}
                                            onClick={() => void loadMoreLiveDocs()}
                                        >
                                            {loadingMoreDocs
                                                ? "Loading…"
                                                : `Load more debit notes (${returns.length} of ${returnTotal})`}
                                        </Button>
                                    </div>
                                ) : null}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                <ConfirmInvoiceDeleteDialog
                    open={pendingInvoiceDelete !== null}
                    onOpenChange={(open) => {
                        if (!open) setPendingInvoiceDelete(null);
                    }}
                    variant={pendingInvoiceDelete?.variant ?? "draft"}
                    docLabel={pendingInvoiceDelete?.label}
                    loading={invoiceDeleteLoading}
                    onConfirm={confirmPendingInvoiceDelete}
                />
            </div>
        </DashboardLayout>
    );
}
