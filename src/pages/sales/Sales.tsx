import DashboardLayout from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Search, Plus, FileText, ShoppingBag, Undo2, Printer, Lock, Truck, Pencil, Trash2, Eye, RefreshCw, Ban } from "lucide-react";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";

const CreateOrderModal = lazy(() =>
    import("@/components/sales/CreateOrderModal").then((m) => ({ default: m.CreateOrderModal })),
);
import type { SalesOrderEditData } from "@/components/sales/CreateOrderModal";
import { Progress } from "@/components/ui/progress";

const CreateSalesInvoiceModal = lazy(() =>
    import("@/components/sales/CreateSalesInvoiceModal").then((m) => ({ default: m.CreateSalesInvoiceModal })),
);
const CreateCreditNoteModal = lazy(() =>
    import("@/components/sales/CreateCreditNoteModal").then((m) => ({ default: m.CreateCreditNoteModal })),
);
import { useToast } from "@/components/ui/use-toast";
import { PrintOrderSheet } from "@/components/sales/PrintOrderSheet";
import { SalesDispatchChallanSheet } from "@/components/sales/SalesDispatchChallanSheet";
import {
    mapSalesInvoiceDocToDispatchChallan,
    type SalesDispatchChallanData,
} from "@/lib/salesDispatchChallan";
import { useInventory, useInventoryActions } from "@/contexts/InventoryContext";
import { useTransactionDocsPage } from "@/hooks/useTransactionDocsPage";
import { InsufficientStockError } from "@/lib/inventoryStore";
import { resolvePartyName, toDocDateISO } from "@/lib/partyCatalog";
import { formatInvoiceDisplayDate, upsertInvoiceListRow } from "@/lib/invoiceListPatch";
import { getDefaultMonthFilters, formatQty } from "@/lib/partyMovementReport";
import { SalesCustomerDispatch } from "@/components/sales/SalesCustomerDispatch";
import { ConfirmInvoiceDeleteDialog } from "@/components/invoices/ConfirmInvoiceDeleteDialog";
import { InvoiceModalSkeleton } from "@/components/invoices/InvoiceModalSkeleton";
import { prefetchModalsForRoute } from "@/lib/modalPrefetch";
import { TabsScroller } from "@/components/ui/responsive-primitives";
import {
    createSalesInvoiceDocument,
    updateSalesInvoiceDocument,
    deleteSalesInvoiceDocument,
    createSalesReturnDocument,
    updateSalesReturnDocument,
    deleteSalesReturnDocument,
    hardDeleteSalesReturnDocument,
    createSalesOrderDocument,
    updateSalesOrderDocument,
    allocateNextSalesOrderNo,
    closeSalesOrder,
    cancelSalesOrder,
    deleteSalesOrderDocument,
    fetchInventoryMovementTotals,
    fetchSalesInvoicesDocsPage,
    fetchSalesInvoiceDocument,
    fetchSalesReturnsDocsPage,
    ERP_DOC_LIST_PAGE_SIZE,
    postDocument,
    verifySalesInvoiceReadyToPost,
    adminHardDeleteSalesInvoiceDocument,
    forceDeleteSalesInvoiceDocument,
    probeInvoiceHardDeleteAvailable,
} from "@/lib/repositories/salesRepo";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { useSalesOrders } from "@/hooks/useErpQueries";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAfterInvoiceDocumentChange, queryKeys } from "@/lib/queryClient";
import { StaggerGrid, MotionCard, MotionKpiCard } from "@/components/motion/MotionPrimitives";
import { DataTable } from "@/components/data-table/DataTable";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkDraftPostingToolbar } from "@/components/invoices/BulkDraftPostingToolbar";
import type { ColumnDef } from "@tanstack/react-table";
import type { DocActionResult } from "@/lib/api/types";
import { financialStatusLabel, salesInvoiceDisplayTotal } from "@/lib/ratePending";
import { postDraftInvoicesSequentially } from "@/lib/bulkInvoicePosting";

const STATUS_BADGE: Record<string, string> = {
    "Pending": "bg-slate-100 text-slate-600 border-slate-300",
    "Partially Fulfilled": "bg-blue-50 text-blue-700 border-blue-300",
    "Closed": "bg-emerald-50 text-emerald-700 border-emerald-300",
    "Posted": "bg-emerald-50 text-emerald-700 border-emerald-300",
    "Draft": "bg-blue-50 text-blue-700 border-blue-300",
};

type SalesInvoiceListRow = {
    id: string;
    dbId?: string | null;
    date: string;
    customer: string;
    amount: string;
    status: string;
};

function matchesInvoiceSearch(inv: { id?: string; customer?: string; supplier?: string; status?: string; date?: string; amount?: string | number }, query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [inv.id, inv.customer, inv.supplier, inv.status, inv.date, inv.amount]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
}

function matchesReturnSearch(ret: { id?: string; invoiceId?: string; reason?: string; status?: string; date?: string; amount?: string }, query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [ret.id, ret.invoiceId, ret.reason, ret.status, ret.date, ret.amount]
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

export default function Sales() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const {
        checkStockAvailable,
        applyStockMovement,
        scrapItemCode,
        periodTotals,
    } = useInventory();
    const { refresh: refreshInventory, refreshBalances } = useInventoryActions();

    const localMonthSalesTotals = useMemo(
        () => periodTotals.fgEnameledSold + periodTotals.fgStripSold,
        [periodTotals],
    );
    const [liveMonthSalesTotals, setLiveMonthSalesTotals] = useState(0);
    const [createOrderOpen, setCreateOrderOpen] = useState(false);
    const [editOrder, setEditOrder] = useState<SalesOrderEditData | null>(null);
    const [invoiceOpen, setInvoiceOpen] = useState(false);
    const [editInvoiceDbId, setEditInvoiceDbId] = useState<string | null>(null);
    const [creditNoteOpen, setCreditNoteOpen] = useState(false);
    const [editReturnDbId, setEditReturnDbId] = useState<string | null>(null);
    const [printOpen, setPrintOpen] = useState(false);
    const [selectedPrintOrder, setSelectedPrintOrder] = useState<any>(null);
    const [challanOpen, setChallanOpen] = useState(false);
    const [challanLoading, setChallanLoading] = useState(false);
    const [challanData, setChallanData] = useState<SalesDispatchChallanData | null>(null);
    const [activeTab, setActiveTab] = useState("orders");
    const [searchQuery, setSearchQuery] = useState("");
    const [bulkSelectedInvoices, setBulkSelectedInvoices] = useState<Record<string, SalesInvoiceListRow>>({});
    const [bulkPosting, setBulkPosting] = useState(false);
    const [bulkPostProgress, setBulkPostProgress] = useState({ completed: 0, total: 0 });

    const TOLERANCE = 0.02;

    const liveMode = useBackendLiveMode();
    const location = useLocation();
    const { data: salesOrderRows, refetch: refetchSalesOrders } = useSalesOrders();

    const [orders, setOrders] = useState<any[]>([]);
    const [invoiceDeleteAvailable, setInvoiceDeleteAvailable] = useState(true);
    const [pendingInvoiceDelete, setPendingInvoiceDelete] = useState<{
        id: string;
        variant: "draft" | "posted";
        label: string;
    } | null>(null);
    const [invoiceDeleteLoading, setInvoiceDeleteLoading] = useState(false);
    const invoiceSearchActive = liveMode && activeTab === "invoices" && searchQuery.trim().length > 0;

    const mapOrderStatus = (s: string) => {
        if (s === "closed") return "Closed";
        if (s === "partial") return "Partially Fulfilled";
        if (s === "cancelled") return "Canceled";
        return "Pending";
    };

    const refreshLiveOrders = async () => {
        await refetchSalesOrders();
    };

    const mapOrderRows = (rows: any[]) =>
        rows.map((r: any) => ({
            id: r.order_no,
            dbId: r.id,
            customer: r.parties?.name ?? "Unknown",
            customerId: r.parties?.code ?? "",
            date: r.order_date ? format(new Date(r.order_date), "PP") : format(new Date(), "PP"),
            deliveryDate: r.delivery_date ?? r.order_date,
            status: mapOrderStatus(r.status),
            total_ordered_qty: Number(r.total_ordered_qty ?? 0),
            total_fulfilled_qty: Number(r.total_fulfilled_qty ?? 0),
            items: (r.sales_order_lines ?? []).map((l: any) => ({
                lineId: l.id,
                itemCode: l.items?.code ?? "",
                item: l.items?.name ?? l.items?.code ?? "",
                qty: Number(l.qty_ordered ?? 0),
                qtyFulfilled: Number(l.qty_fulfilled ?? 0),
                qtyRemaining: Math.max(0, Number(l.qty_ordered ?? 0) - Number(l.qty_fulfilled ?? 0)),
                rate: Number(l.unit_price ?? 0),
            })),
        }));

    useEffect(() => {
        if (salesOrderRows) setOrders(mapOrderRows(salesOrderRows));
    }, [salesOrderRows]);

    const mapInvoiceRows = useCallback(
        (rows: any[]) =>
            rows.map((r: any) => ({
                id: r.invoice_no,
                dbId: r.id,
                customer: r.parties?.name ?? "Unknown",
                date: r.invoice_date,
                amount: `₨ ${salesInvoiceDisplayTotal(r).toLocaleString()}`,
                status:
                    r.posting_status !== "posted"
                        ? "Draft"
                        : r.financial_status === "pending" || r.financial_status === "partial"
                          ? financialStatusLabel(r.financial_status)
                          : "Posted",
            })),
        [],
    );

    const mapReturnRows = useCallback(
        (rows: any[]) =>
            rows.map((r: any) => ({
                id: r.return_no,
                dbId: r.id,
                invoiceId: r.sales_invoices?.invoice_no ?? "N/A",
                reason:
                    r.return_action === "scrap"
                        ? "Scrap"
                        : r.return_action === "restock"
                          ? "Restock"
                          : r.return_action ?? "Return",
                amount: `₨ ${Number(r.grand_total ?? 0).toLocaleString()}`,
                date: r.return_date,
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
        routePath: "/sales",
        toast,
        queryKeys: {
            invoices: queryKeys.salesInvoices,
            returns: queryKeys.salesReturns,
        },
        invoiceSearch: activeTab === "invoices" ? searchQuery : "",
        fetchInvoicesPage: fetchSalesInvoicesDocsPage,
        fetchReturnsPage: fetchSalesReturnsDocsPage,
        mapInvoiceRows,
        mapReturnRows,
    });

    useEffect(() => {
        if (!liveMode) return;
        const from = new Date();
        from.setDate(1);
        const fromIso = from.toISOString().slice(0, 10);
        const toIso = new Date().toISOString().slice(0, 10);
        void fetchInventoryMovementTotals(fromIso, toIso).then((t) => {
            setLiveMonthSalesTotals(t.salesOutQty);
        });
        void probeInvoiceHardDeleteAvailable().then(setInvoiceDeleteAvailable);
    }, [liveMode]);

    useEffect(() => {
        const warm = () => prefetchModalsForRoute("/sales");
        if (typeof requestIdleCallback === "function") {
            const id = requestIdleCallback(warm, { timeout: 2000 });
            return () => cancelIdleCallback(id);
        }
        const t = setTimeout(warm, 600);
        return () => clearTimeout(t);
    }, []);

    const nextLocalSalesOrderNo = () => {
        const prefix = "SO-";
        const maxSeq = orders.reduce((max, o) => {
            const n = Number(String(o.id ?? "").replace(/^SO-/i, ""));
            return Number.isFinite(n) ? Math.max(max, n) : max;
        }, 0);
        return `${prefix}${maxSeq + 1}`;
    };

    const handleCreateOrder = async (data: any) => {
        const totalQty = data.items?.reduce((s: number, i: any) => s + (i.qty || 0), 0) || 1000;
        const partyCode = data.customerId || data.customer || "WALK-IN";

        if (liveMode) {
            if (data.dbId) {
                const orderNo = data.orderNo ?? data.id;
                const result = await updateSalesOrderDocument(data.dbId, {
                    deliveryDate: data.deliveryDate,
                    lines: (data.items ?? []).map((i: any) => ({
                        lineId: i.lineId,
                        itemCode: i.itemCode || i.code || "FG-STR-001",
                        qty: Number(i.qty || 0),
                        unitPrice: i.rate,
                    })),
                });
                if (!result.ok) {
                    toast({ title: "Order update failed", description: result.error, variant: "destructive" });
                    return;
                }
                await refreshLiveOrders();
                toast({ title: "Order Updated", description: `Order ${orderNo} saved.` });
                setEditOrder(null);
                return;
            }
            const orderNo = data.orderNo ?? (await allocateNextSalesOrderNo());
            const result = await createSalesOrderDocument({
                orderNo,
                partyCode,
                deliveryDate: data.deliveryDate,
                lines: (data.items ?? []).map((i: any) => ({
                    itemCode: i.itemCode || i.code || "FG-STR-001",
                    qty: Number(i.qty || 0),
                    unitPrice: i.rate,
                })),
            });
            if (!result.ok) {
                toast({ title: "Order save failed", description: result.error, variant: "destructive" });
                return;
            }
            await refreshLiveOrders();
            toast({ title: "Order Created", description: `Order ${orderNo} saved to ERP.` });
            return;
        }

        const orderNo = data.orderNo ?? nextLocalSalesOrderNo();
        const newOrder = {
            id: orderNo,
            customer: resolvePartyName(partyCode, partyCode),
            customerId: partyCode,
            date: data.deliveryDate || format(new Date(), "PP"),
            status: "Pending",
            total_ordered_qty: totalQty,
            total_fulfilled_qty: 0,
            items: data.items,
        };
        setOrders([newOrder, ...orders]);
        toast({ title: "Order Created", description: `Order ${newOrder.id} successfully created.` });
    };

    const recalcOrderStatus = (orderId: string, invoiceNetWt: number) => {
        setOrders(prev => prev.map(o => {
            if (o.id !== orderId) return o;
            const newFulfilled = o.total_fulfilled_qty + invoiceNetWt;
            let newStatus = newFulfilled <= 0 ? "Pending"
                : newFulfilled >= o.total_ordered_qty * (1 - TOLERANCE) ? "Closed"
                    : "Partially Fulfilled";
            return { ...o, total_fulfilled_qty: newFulfilled, status: newStatus };
        }));
    };

    const handleForceClose = async (orderId: string) => {
        if (liveMode) {
            const order = orders.find((o) => o.id === orderId);
            if (order?.dbId) await closeSalesOrder(order.dbId);
            await refreshLiveOrders();
        } else {
            setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "Closed" } : o)));
        }
        toast({ title: "Order Force Closed", description: `${orderId} has been manually closed.` });
    };

    const handleCancelOrder = async (order: { id: string; dbId?: string }) => {
        if (!window.confirm(`Cancel order ${order.id}?`)) return;
        if (liveMode && order.dbId) {
            const result = await cancelSalesOrder(order.dbId);
            if (!result.ok) {
                toast({ title: "Cancel failed", description: result.error, variant: "destructive" });
                return;
            }
            await refreshLiveOrders();
        } else {
            setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: "Canceled" } : o)));
        }
        toast({ title: "Order cancelled", description: order.id });
    };

    const handleDeleteOrder = async (order: { id: string; dbId?: string; total_fulfilled_qty?: number }) => {
        if ((order.total_fulfilled_qty ?? 0) > 0) {
            toast({ title: "Delete blocked", description: "Cancel the order instead — it has fulfilled quantity.", variant: "destructive" });
            return;
        }
        if (!window.confirm(`Delete order ${order.id}? This cannot be undone.`)) return;
        if (liveMode && order.dbId) {
            const result = await deleteSalesOrderDocument(order.dbId);
            if (!result.ok) {
                toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                return;
            }
            await refreshLiveOrders();
        } else {
            setOrders((prev) => prev.filter((o) => o.id !== order.id));
        }
        toast({ title: "Order deleted", description: order.id });
    };

    const openEditOrder = (order: any) => {
        setEditOrder({
            dbId: order.dbId,
            orderNo: order.id,
            customerId: order.customerId,
            deliveryDate: order.deliveryDate ?? order.date,
            items: (order.items ?? []).map((i: any) => ({
                lineId: i.lineId,
                itemCode: i.itemCode ?? i.item,
                qty: i.qty,
                rate: i.rate ?? 0,
                qtyFulfilled: i.qtyFulfilled ?? 0,
            })),
        });
        setCreateOrderOpen(true);
    };

    const persistInvoice = async (data: any) => {
        if (data.dbId) return updateSalesInvoiceDocument(data.dbId, data);
        return createSalesInvoiceDocument(data);
    };

    const handleSaveInvoiceDraft = async (data: any): Promise<DocActionResult> => {
        if (!liveMode) {
            const draftId = data.header?.invoiceId ?? `INV-2026-${102 + invoices.length}`;
            const draftRow = {
                id: draftId,
                customer: resolvePartyName(data.header?.customerId || "WALK-IN", "Walk-In"),
                date: data.header?.date ? format(new Date(data.header.date), "MMM dd") : format(new Date(), "MMM dd"),
                amount: `₨ ${Number(data.totals?.finalTotal ?? 0).toLocaleString()}`,
                status: "Draft",
                linkedOrderId: data.header?.linkedOrderId || null,
            };
            setInvoices((prev) => [draftRow, ...prev.filter((i) => i.id !== draftId)]);
            toast({ title: "Draft saved", description: `Invoice ${draftId} saved locally.` });
            setEditInvoiceDbId(null);
            return { ok: true };
        }
        const persist = await persistInvoice(data);
        if (!persist.ok) {
            toast({ title: "Invoice save failed", description: persist.error, variant: "destructive" });
            return { ok: false, error: persist.error };
        }
        toast({
            title: data.header?.postingStatus === "posted" ? "Invoice updated" : "Draft saved",
            description:
                data.header?.postingStatus === "posted"
                    ? `Invoice ${data.header.invoiceId} changes saved.`
                    : `Invoice ${data.header.invoiceId} saved as draft.`,
        });
        setEditInvoiceDbId(null);
        if (liveMode) {
            setInvoices((prev) =>
                upsertInvoiceListRow(prev, {
                    id: data.header.invoiceId,
                    dbId: persist.data.id,
                    customer: resolvePartyName(data.header?.customerId || "WALK-IN", "Walk-In"),
                    date: formatInvoiceDisplayDate(data.header?.date),
                    amount: `₨ ${Number(data.totals?.finalTotal ?? 0).toLocaleString()}`,
                    status: data.header?.postingStatus === "posted" ? "Posted" : "Draft",
                    linkedOrderId: data.header?.linkedOrderId || null,
                }),
            );
            void Promise.all([
                invalidateAfterInvoiceDocumentChange(),
                refreshLiveDocs(true),
                data.header?.postingStatus === "posted" ? refreshBalances() : Promise.resolve(),
                data.header?.postingStatus === "posted" ? refreshInventory() : Promise.resolve(),
                (async () => {
                    const from = new Date();
                    from.setDate(1);
                    const fromIso = from.toISOString().slice(0, 10);
                    const toIso = new Date().toISOString().slice(0, 10);
                    const t = await fetchInventoryMovementTotals(fromIso, toIso);
                    setLiveMonthSalesTotals(t.salesOutQty);
                })(),
            ]);
        }
        return { ok: true, dbId: persist.data.id };
    };

    const handlePostInvoice = async (data: any): Promise<DocActionResult> => {
        const invoiceId = data.header?.invoiceId ?? `INV-2026-${102 + invoices.length}`;
        const lines = (data.items ?? []).filter((l: any) => l.itemCode && l.netWeight > 0);
        const isPremium = data.header?.saleMode === "premium";

        if (!isPremium) {
            if (!liveMode) {
                const stockLines = lines.map((l: any) => ({ itemCode: l.itemCode, qty: l.netWeight }));
                const check = checkStockAvailable(stockLines);
                if (!check.ok) {
                    const f = check.failures[0];
                    const msg = `${f.itemCode}: need ${f.requested.toLocaleString()} kg, have ${f.available.toLocaleString()} kg locally.`;
                    toast({
                        title: "Insufficient stock",
                        description: msg,
                        variant: "destructive",
                    });
                    return { ok: false, error: msg };
                }
            }
        }

        const customerId = data.header?.customerId || "WALK-IN";
        const docDate = toDocDateISO(data.header?.date);

        if (!liveMode) {
            try {
                for (const line of lines) {
                    applyStockMovement({
                        type: "SALES_INVOICE",
                        itemCode: line.itemCode,
                        qty: line.netWeight,
                        refDocId: invoiceId,
                        refDocType: "SALES_INVOICE",
                        partyId: customerId,
                        partyName: resolvePartyName(customerId, "Walk-In"),
                        partyRole: "customer",
                        docDate,
                        amount: line.amount,
                        rate: line.rate,
                    });
                }
            } catch (e) {
                toast({
                    title: "Stock update failed",
                    description: e instanceof InsufficientStockError ? e.message : "Could not post invoice.",
                    variant: "destructive",
                });
                return { ok: false };
            }
            const customerName = resolvePartyName(customerId, "Walk-In");
            const linkedOrderId = data.header?.linkedOrderId || null;
            setInvoices([
                {
                    id: invoiceId,
            customer: customerName,
            date: format(new Date(), "MMM dd"),
            amount: `₨ ${data.totals.finalTotal.toLocaleString()}`,
                    status: "Posted",
                    linkedOrderId,
                },
                ...invoices,
            ]);
            if (linkedOrderId) recalcOrderStatus(linkedOrderId, data.totals?.totalNetWeight || 0);
            toast({ title: "Invoice Posted", description: `Invoice ${invoiceId} posted. Stock updated.` });
            setEditInvoiceDbId(null);
            return { ok: true };
        }

        const persist = await persistInvoice(data);
        if (!persist.ok) {
            toast({ title: "Invoice DB save failed", description: persist.error, variant: "destructive" });
            return { ok: false, error: persist.error };
        }

        const ready = await verifySalesInvoiceReadyToPost(persist.data.id);
        if (!ready.ok) {
            toast({ title: "Cannot post invoice", description: ready.error, variant: "destructive" });
            return { ok: false, dbId: persist.data.id, error: ready.error };
        }

        try {
            await postDocument("post_sales_invoice", persist.data.id);
        } catch (e) {
            toast({
                title: "Invoice posting failed",
                description: e instanceof Error ? e.message : "Could not post sales invoice to ledger.",
                variant: "destructive",
            });
            const msg = e instanceof Error ? e.message : "Could not post sales invoice to ledger.";
            return { ok: false, dbId: persist.data.id, error: msg };
        }

        const linkedOrderId = data.header?.linkedOrderId || null;
        if (liveMode) {
            for (const line of lines) {
                try {
                    applyStockMovement({
                        type: "SALES_INVOICE",
                        itemCode: line.itemCode,
                        qty: line.netWeight,
                        refDocId: invoiceId,
                        refDocType: "SALES_INVOICE",
                        partyId: customerId,
                        partyName: resolvePartyName(customerId, "Walk-In"),
                        partyRole: "customer",
                        docDate,
                        amount: line.amount,
                        rate: line.rate,
                    });
                } catch {
                    /* background refresh reconciles live balances */
                }
            }
            if (linkedOrderId) recalcOrderStatus(linkedOrderId, data.totals?.totalNetWeight || 0);
            setInvoices((prev) =>
                upsertInvoiceListRow(prev, {
                    id: data.header.invoiceId,
                    dbId: persist.data.id,
                    customer: resolvePartyName(data.header?.customerId || "WALK-IN", "Walk-In"),
                    date: formatInvoiceDisplayDate(data.header?.date),
                    amount: `₨ ${Number(data.totals?.finalTotal ?? 0).toLocaleString()}`,
                    status: "Posted",
                    linkedOrderId: linkedOrderId || null,
                }),
            );
            const from = new Date();
            from.setDate(1);
            const fromIso = from.toISOString().slice(0, 10);
            const toIso = new Date().toISOString().slice(0, 10);
            void invalidateAfterInvoiceDocumentChange();
            void refreshLiveDocs(true);
            void refreshBalances();
            if (linkedOrderId) void refreshLiveOrders();
            void fetchInventoryMovementTotals(fromIso, toIso).then((t) => setLiveMonthSalesTotals(t.salesOutQty));
        }
        toast({ title: "Invoice Posted", description: `Invoice ${invoiceId} posted. Stock updated.` });
        setEditInvoiceDbId(null);
        return { ok: true, dbId: persist.data.id };
    };

    const handleDeleteInvoice = async (id: string, posted = false): Promise<boolean> => {
        if (posted) {
            return handleAdminHardDeleteInvoice(id);
        }
        if (liveMode) {
            const result = await deleteSalesInvoiceDocument(id);
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
        let result = await adminHardDeleteSalesInvoiceDocument(id);
        const needsForce =
            !result.ok &&
            (result.error?.includes("payment allocations") ||
                result.error?.includes("force_delete_sales_invoice"));
        if (needsForce) {
            result = await forceDeleteSalesInvoiceDocument(id);
        }
        if (!result.ok) {
            toast({
                title: "Delete failed",
                description: result.error ?? "Could not delete invoice.",
                variant: "destructive",
            });
            return false;
        }
        await Promise.all([
            invalidateAfterInvoiceDocumentChange(),
            refreshLiveDocs(true),
            refreshLiveOrders(),
            refreshBalances(),
        ]);
        setInvoices((prev) => prev.filter((i) => i.dbId !== id));
        const noOrderLink = result.linkedOrderLines === 0;
        toast({
            title: "Invoice deleted",
            description: noOrderLink
                ? "Invoice removed. No order line link was stored on this invoice — fulfillment may not roll back. Re-save from a pulled order next time."
                : "Posted invoice removed and linked order fulfillment rolled back.",
            variant: noOrderLink ? "destructive" : "default",
        });
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

    const openInvoice = (inv: { dbId?: string | null }) => {
        if (liveMode && !inv.dbId) {
            toast({ title: "Cannot open invoice", description: "This invoice is not stored in the database.", variant: "destructive" });
            return;
        }
        setEditInvoiceDbId(inv.dbId ?? null);
        setInvoiceOpen(true);
    };

    const persistReturn = async (data: any) => {
        if (data.dbId) return updateSalesReturnDocument(data.dbId, data);
        return createSalesReturnDocument(data);
    };

    const applyLocalReturnStock = (data: any) => {
        const returnId = data.header.returnId;
        const isRestock = data.header.returnAction === "restock";
        const customerId = data.header?.customerId || "WALK-IN";
        const docDate = toDocDateISO(data.header?.date);
        for (const line of data.items ?? []) {
            const code = isRestock ? line.itemCode : scrapItemCode;
            const qty = line.netWeight ?? line.weight ?? 0;
            if (!code || qty <= 0) continue;
            applyStockMovement({
                type: "SALES_RETURN",
                itemCode: code,
                qty,
                refDocId: returnId,
                refDocType: "SALES_RETURN",
                partyId: customerId,
                partyName: resolvePartyName(customerId, "Walk-In"),
                partyRole: "customer",
                docDate,
                amount: line.creditAmount,
                rate: line.rate,
                metadata: { returnAction: data.header.returnAction },
            });
        }
    };

    const handleSaveReturnDraft = async (data: any): Promise<boolean> => {
        if (!liveMode) {
            const returnId = data.header?.returnId ?? `SR-${returns.length + 1}`;
            const draft = {
                id: returnId,
                invoiceId: data.header?.originalInv || "N/A",
                reason: data.header?.returnAction === "restock" ? "Restock (FG)" : "Scrap",
                amount: `₨ ${Number(data.totalCreditAmount ?? 0).toLocaleString()}`,
                date: data.header?.date ? new Date(data.header.date).toLocaleDateString() : "Today",
                status: "Draft",
            };
            setReturns((prev) => [draft, ...prev.filter((r) => r.id !== returnId)]);
            toast({ title: "Draft saved", description: `Credit note ${returnId} saved locally.` });
            setEditReturnDbId(null);
            return true;
        }
        const persist = await persistReturn(data);
        if (!persist.ok) {
            toast({ title: "Credit note save failed", description: persist.error, variant: "destructive" });
            return false;
        }
        toast({ title: "Draft saved", description: `Credit note ${data.header.returnId} saved as draft.` });
        setEditReturnDbId(null);
        if (liveMode) {
            await invalidateAfterInvoiceDocumentChange();
            await refreshLiveDocs(true);
        }
        return true;
    };

    const handlePostReturn = async (data: any): Promise<boolean> => {
        const returnId = data.header.returnId;
        const isRestock = data.header.returnAction === "restock";

        if (!liveMode) {
            try {
                applyLocalReturnStock(data);
            } catch (e) {
                toast({
                    title: "Stock update failed",
                    description: e instanceof Error ? e.message : "Could not process return.",
                    variant: "destructive",
                });
                return false;
            }
            setReturns([{
                id: returnId,
            invoiceId: data.header.originalInv || "N/A",
                reason: isRestock ? "Restock (FG)" : "Scrap",
            amount: `₨ ${data.totalCreditAmount.toLocaleString()}`,
                date: data.header.date ? new Date(data.header.date).toLocaleDateString() : "Today",
                status: "Posted",
            }, ...returns]);
            toast({ title: "Credit Note Posted", description: `Return ${returnId} posted.` });
            setEditReturnDbId(null);
            return true;
        }

        const persist = await persistReturn(data);
        if (!persist.ok) {
            toast({ title: "Return DB save failed", description: persist.error, variant: "destructive" });
            return false;
        }

        try {
            await postDocument("post_sales_return", persist.data.id);
        } catch (e) {
            toast({
                title: "Return posting failed",
                description: e instanceof Error ? e.message : "Could not post sales return to ledger.",
                variant: "destructive",
            });
            return false;
        }

        toast({ title: "Credit Note Posted", description: `Return ${returnId} posted.` });
        setEditReturnDbId(null);
        if (liveMode) {
            const from = new Date();
            from.setDate(1);
            const fromIso = from.toISOString().slice(0, 10);
            const toIso = new Date().toISOString().slice(0, 10);
            await Promise.all([
                invalidateAfterInvoiceDocumentChange(),
                refreshLiveDocs(true),
                refreshBalances(),
                refreshInventory(),
                fetchInventoryMovementTotals(fromIso, toIso).then((t) => setLiveMonthSalesTotals(t.salesOutQty)),
            ]);
        }
        return true;
    };

    const handleDeleteReturn = async (id: string, posted = false): Promise<boolean> => {
        const msg = posted
            ? "Delete this posted credit note and reverse its ledger/stock effects?"
            : "Delete this draft credit note? This cannot be undone.";
        if (!window.confirm(msg)) return false;
        if (liveMode) {
            const result = posted
                ? await hardDeleteSalesReturnDocument(id)
                : await deleteSalesReturnDocument(id);
            if (!result.ok) {
                toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                return false;
            }
            await invalidateAfterInvoiceDocumentChange();
            await refreshLiveDocs(true);
        } else {
            setReturns((prev) => prev.filter((r) => r.dbId !== id && r.id !== id));
        }
        toast({ title: "Credit note deleted" });
        return true;
    };

    const openReturn = (ret: { dbId?: string }) => {
        if (liveMode && !ret.dbId) {
            toast({ title: "Cannot open credit note", description: "This note is not stored in the database.", variant: "destructive" });
            return;
        }
        setEditReturnDbId(ret.dbId ?? null);
        setCreditNoteOpen(true);
    };

    const handleOpenChallan = async (inv: { id: string; dbId?: string }) => {
        if (!liveMode) {
            toast({
                title: "Challan unavailable offline",
                description: "Open the invoice and use Dispatch challan from the form.",
                variant: "destructive",
            });
            return;
        }
        if (!inv.dbId) {
            toast({
                title: "Save invoice first",
                description: "Dispatch challan needs a saved invoice with line items.",
                variant: "destructive",
            });
            return;
        }

        setChallanOpen(true);
        setChallanLoading(true);
        setChallanData(null);
        try {
            const doc = await fetchSalesInvoiceDocument(inv.dbId);
            if (!doc) throw new Error("Invoice not found.");
            setChallanData(mapSalesInvoiceDocToDispatchChallan(doc));
        } catch (e) {
            setChallanOpen(false);
            toast({
                title: "Could not load challan",
                description: e instanceof Error ? e.message : "Failed to load invoice lines.",
                variant: "destructive",
            });
        } finally {
            setChallanLoading(false);
        }
    };

    const handlePrintOrder = (order: any) => {
        setSelectedPrintOrder(order);
        setPrintOpen(true);
    };

    const filteredOrders = useMemo(
        () =>
            orders.filter(
                (o) =>
                    !searchQuery ||
                    o.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    o.customer.toLowerCase().includes(searchQuery.toLowerCase()),
            ),
        [orders, searchQuery],
    );
    const filteredInvoices = useMemo(
        () => (invoiceSearchActive ? invoices : invoices.filter((i) => matchesInvoiceSearch(i, searchQuery))),
        [invoices, invoiceSearchActive, searchQuery],
    );
    const shownDraftInvoices = useMemo(
        () => filteredInvoices.filter((invoice): invoice is SalesInvoiceListRow & { dbId: string } =>
            invoice.status === "Draft" && Boolean(invoice.dbId),
        ),
        [filteredInvoices],
    );
    const selectedDraftInvoices = useMemo(() => Object.values(bulkSelectedInvoices), [bulkSelectedInvoices]);

    const setInvoiceBulkSelected = useCallback((invoice: SalesInvoiceListRow, selected: boolean) => {
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
                const ready = await verifySalesInvoiceReadyToPost(invoice.dbId);
                if (!ready.ok) throw new Error(ready.error);
                await postDocument("post_sales_invoice", invoice.dbId);
            },
            (completed, total) => setBulkPostProgress({ completed, total }),
        );

        const succeededIds = new Set(result.succeeded.map((invoice) => invoice.dbId).filter(Boolean));
        setBulkSelectedInvoices((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => !succeededIds.has(id))),
        );
        await Promise.all([
            invalidateAfterInvoiceDocumentChange(),
            refreshLiveInvoices(true),
            refreshBalances(),
            refreshInventory(),
        ]);
        const from = new Date();
        from.setDate(1);
        const fromIso = from.toISOString().slice(0, 10);
        const toIso = new Date().toISOString().slice(0, 10);
        const totals = await fetchInventoryMovementTotals(fromIso, toIso);
        setLiveMonthSalesTotals(totals.salesOutQty);

        if (result.failures.length === 0) {
            toast({
                title: `${result.succeeded.length} sales invoices posted`,
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
    }, [
        bulkPosting,
        liveMode,
        refreshBalances,
        refreshInventory,
        refreshLiveInvoices,
        selectedDraftInvoices,
        toast,
    ]);
    const filteredReturns = useMemo(
        () => returns.filter((r) => matchesReturnSearch(r, searchQuery)),
        [returns, searchQuery],
    );

    const invoiceColumns = useMemo<ColumnDef<SalesInvoiceListRow, unknown>[]>(
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
                            aria-label="Select shown draft sales invoices"
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
                accessorKey: "customer",
                header: "Customer",
                cell: ({ row }) => (
                    <span className="max-w-[220px] truncate font-medium text-slate-900">{row.original.customer}</span>
                ),
            },
            {
                accessorKey: "amount",
                header: "Total",
                meta: { align: "right" },
                cell: ({ row }) => (
                    <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {row.original.amount}
                    </span>
                ),
            },
            {
                accessorKey: "status",
                header: "Status",
                cell: ({ row }) => (
                    <Badge variant="outline" className={`text-xs ${STATUS_BADGE[row.original.status] || ""}`}>
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
                            {liveMode && inv.status === "Posted" && inv.dbId ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs text-rose-700"
                                    onClick={() =>
                                        setPendingInvoiceDelete({ id: inv.dbId!, variant: "posted", label: inv.id })
                                    }
                                >
                                    Delete
                                </Button>
                            ) : null}
                            {inv.status === "Draft" && (inv.dbId || !liveMode) ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs text-rose-600"
                                    onClick={() =>
                                        setPendingInvoiceDelete({
                                            id: inv.dbId ?? inv.id,
                                            variant: "draft",
                                            label: inv.id,
                                        })
                                    }
                                >
                                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                                    Delete
                                </Button>
                            ) : null}
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-blue-600"
                                onClick={() => void handleOpenChallan({ id: inv.id, dbId: inv.dbId ?? undefined })}
                            >
                                <Truck className="h-3.5 w-3.5 mr-1" />
                                Challan
                            </Button>
                        </div>
                    );
                },
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [bulkPosting, bulkSelectedInvoices, liveMode, selectShownDraftInvoices, setInvoiceBulkSelected, shownDraftInvoices],
    );

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* ── HEADER ── */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Sales</h1>
                        <p className="text-slate-500">Manage orders, invoicing (Direct/Premium), and returns.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {activeTab === 'returns' && (
                            <Button className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto" onClick={() => { setEditReturnDbId(null); setCreditNoteOpen(true); }}>
                                <Undo2 className="h-4 w-4 mr-2" /> Credit Note
                            </Button>
                        )}
                        {activeTab === 'invoices' && (
                            <Button className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto" onClick={() => { setEditInvoiceDbId(null); setInvoiceOpen(true); }}>
                                <FileText className="h-4 w-4 mr-2" /> Direct Invoice
                            </Button>
                        )}
                        {activeTab === 'orders' && (
                            <Button className="bg-blue-600 hover:bg-blue-700 shadow-soft w-full sm:w-auto" onClick={() => { setEditOrder(null); setCreateOrderOpen(true); }}>
                                <Plus className="h-4 w-4 mr-2" /> New Sales Order
                            </Button>
                        )}
                    </div>
                </div>

                {/* ── KPI ROW ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <KpiCard
                        label="Pending Orders"
                        value={`${orders.filter((o) => o.status !== "Closed").length} Orders`}
                        sub="Live from current session"
                        icon={ShoppingBag}
                        accent="blue"
                    />
                    <KpiCard
                        label="Open Invoices"
                        value={`${invoices.filter((i) => i.status !== "Posted").length} Pending`}
                        sub="Live from ERP invoices"
                        icon={FileText}
                        accent="emerald"
                    />
                    <KpiCard
                        label="FG Dispatched (Month)"
                        value={formatQty(liveMode ? liveMonthSalesTotals : localMonthSalesTotals)}
                        sub="Enameled + strip from invoices"
                        icon={Truck}
                        accent="purple"
                    />
                </div>

                {/* ── MODALS ── */}
                {createOrderOpen ? (
                    <Suspense fallback={null}>
                        <CreateOrderModal
                            open={createOrderOpen}
                            onOpenChange={(open) => { setCreateOrderOpen(open); if (!open) setEditOrder(null); }}
                            onSubmit={handleCreateOrder}
                            editOrder={editOrder}
                        />
                    </Suspense>
                ) : null}
                {invoiceOpen ? (
                    <Suspense fallback={<InvoiceModalSkeleton title="Invoice" />}>
                        <CreateSalesInvoiceModal
                            open={invoiceOpen}
                            onOpenChange={(open) => { setInvoiceOpen(open); if (!open) setEditInvoiceDbId(null); }}
                            onSaveDraft={handleSaveInvoiceDraft}
                            onPost={handlePostInvoice}
                            onDelete={handleDeleteInvoice}
                            pendingOrders={orders.filter(o => o.status === 'Pending' || o.status === 'Partially Fulfilled')}
                            editInvoiceDbId={editInvoiceDbId}
                        />
                    </Suspense>
                ) : null}
                {creditNoteOpen ? (
                    <Suspense fallback={<InvoiceModalSkeleton title="Credit note" />}>
                        <CreateCreditNoteModal
                            open={creditNoteOpen}
                            onOpenChange={(open) => { setCreditNoteOpen(open); if (!open) setEditReturnDbId(null); }}
                            onSaveDraft={handleSaveReturnDraft}
                            onPost={handlePostReturn}
                            onDelete={handleDeleteReturn}
                            editReturnDbId={editReturnDbId}
                        />
                    </Suspense>
                ) : null}
                <PrintOrderSheet open={printOpen} onOpenChange={setPrintOpen} order={selectedPrintOrder} />
                <SalesDispatchChallanSheet
                    open={challanOpen}
                    onOpenChange={setChallanOpen}
                    data={challanData}
                    loading={challanLoading}
                />

                {/* ── TABS ── */}
                <Tabs value={activeTab} onValueChange={(v) => {
                    setActiveTab(v);
                    setSearchQuery("");
                }} className="space-y-4">
                    <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
                        <TabsScroller className="sm:flex-1">
                        <TabsList className="bg-slate-100 p-1">
                            <TabsTrigger value="orders" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                                <ShoppingBag className="h-4 w-4 mr-2" /> Sales Orders
                            </TabsTrigger>
                            <TabsTrigger value="invoices" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                                <FileText className="h-4 w-4 mr-2" /> Invoices
                            </TabsTrigger>
                            <TabsTrigger value="returns" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                                <Undo2 className="h-4 w-4 mr-2" /> Returns
                            </TabsTrigger>
                                <TabsTrigger value="dispatch" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                                    <Truck className="h-4 w-4 mr-2" /> FG to Customers
                            </TabsTrigger>
                        </TabsList>
                        </TabsScroller>

                        {(activeTab === "orders" || activeTab === "invoices" || activeTab === "returns") ? (
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <div className="relative flex-1 sm:flex-none sm:min-w-[250px]">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                        className="pl-9 w-full sm:w-[250px]"
                                        placeholder={
                                            activeTab === "invoices"
                                                ? "Search invoice no., customer, date..."
                                                : activeTab === "returns"
                                                  ? "Search credit note, invoice, status..."
                                                  : "Search ID, customer..."
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
                        ) : (
                            <div className="w-full sm:w-auto text-xs text-slate-500 rounded-md border border-slate-200 bg-white px-3 py-2">
                                Dispatch tab uses operational filters inside the panel.
                            </div>
                        )}
                    </div>

                    {/* ── ORDERS TAB ── */}
                    <TabsContent value="orders" className="min-h-[420px]">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Active Sales Orders</CardTitle>
                                <CardDescription>{filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''} found</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {filteredOrders.map((order, index) => (
                                        <MotionCard key={order.id} index={index}>
                                        <Card className="shadow-soft border-slate-100 bg-white overflow-hidden flex flex-col h-full transition-colors duration-200">
                                            <div className={`h-1 w-full ${order.status === 'Closed' ? 'bg-emerald-500' : order.status === 'Partially Fulfilled' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                                            <CardHeader className="p-4 pb-2 border-b border-slate-50">
                                                <div className="flex justify-between items-start">
                                                    <div className="font-mono font-bold text-sm">{order.id}</div>
                                                    <Badge variant="outline" className={`text-xs ${STATUS_BADGE[order.status] || ''}`}>{order.status}</Badge>
                                                </div>
                                                <CardTitle className="text-base mt-2">{order.customer}</CardTitle>
                                                <CardDescription className="font-mono text-xs">{order.date}</CardDescription>
                                            </CardHeader>

                                            <CardContent className="p-4 flex-1 space-y-4">
                                                <div>
                                                    <div className="flex justify-between text-xs mb-1.5">
                                                        <span className="text-slate-500">Fulfillment</span>
                                                        <span className="font-medium text-slate-700">{Math.min(100, Math.round((order.total_fulfilled_qty / order.total_ordered_qty) * 100))}%</span>
                                                    </div>
                                                    <Progress value={Math.min(100, (order.total_fulfilled_qty / order.total_ordered_qty) * 100)} className="h-2" />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 text-sm">
                                                    <div>
                                                        <div className="text-xs text-slate-500">Ordered</div>
                                                        <div className="font-medium">{order.total_ordered_qty.toLocaleString()} kg</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-slate-500">Fulfilled</div>
                                                        <div className="font-medium text-emerald-600">{order.total_fulfilled_qty.toLocaleString()} kg</div>
                                                    </div>
                                                </div>
                                            </CardContent>

                                            <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
                                                <div className="flex gap-1">
                                                    {order.status !== "Closed" && order.status !== "Canceled" && order.dbId && (
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600" onClick={() => openEditOrder(order)} title="Edit order">
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {order.status !== "Closed" && order.status !== "Canceled" && (
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-amber-600" onClick={() => handleForceClose(order.id)} title="Force Close">
                                                            <Lock className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {order.status !== "Closed" && order.status !== "Canceled" && (
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-600" onClick={() => void handleCancelOrder(order)} title="Cancel order">
                                                            <Ban className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {order.total_fulfilled_qty <= 0 && order.dbId ? (
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => void handleDeleteOrder(order)} title="Delete order">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    ) : null}
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500" onClick={() => handlePrintOrder(order)} title="Print">
                                                        <Printer className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                        </MotionCard>
                                    ))}
                                </StaggerGrid>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ── INVOICES TAB ── */}
                    <TabsContent value="invoices" className="min-h-[420px]">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Recent Invoices</CardTitle>
                                <CardDescription>
                                    {liveMode
                                        ? `Showing ${filteredInvoices.length} of ${invoiceTotal} invoice${invoiceTotal !== 1 ? "s" : ""}${invoiceSearchActive ? " (search)" : ""}`
                                        : `${filteredInvoices.length} invoice${filteredInvoices.length !== 1 ? "s" : ""} found`}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {liveMode ? (
                                    <BulkDraftPostingToolbar
                                        documentLabel="sales"
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

                    {/* ── FG DISPATCH TAB ── */}
                    <TabsContent value="dispatch" className="min-h-[420px]">
                        <SalesCustomerDispatch />
                    </TabsContent>

                    {/* ── RETURNS TAB ── */}
                    <TabsContent value="returns" className="min-h-[420px]">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle>Sales Returns (Credit Notes)</CardTitle>
                                <CardDescription>
                                    {liveMode
                                        ? `Showing ${filteredReturns.length} of ${returnTotal} return${returnTotal !== 1 ? "s" : ""}${searchQuery ? " (filtered)" : ""}`
                                        : `${filteredReturns.length} return${filteredReturns.length !== 1 ? "s" : ""}`}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {refreshingReturns && liveMode ? (
                                    <div className="py-16 text-center text-slate-500">Loading returns…</div>
                                ) : filteredReturns.length === 0 ? (
                                    <div className="py-16 text-center text-slate-500 space-y-3">
                                        <div>{searchQuery ? "No credit notes match your search." : "No returns recorded yet."}</div>
                                        {!searchQuery && (
                                            <Button variant="outline" className="border-slate-200" onClick={() => { setEditReturnDbId(null); setCreditNoteOpen(true); }}>
                                                <Undo2 className="h-4 w-4 mr-2" /> Create First Credit Note
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {filteredReturns.map((ret, index) => (
                                            <MotionCard key={ret.id} index={index}>
                                            <Card className="shadow-soft border-slate-100 bg-white overflow-hidden flex flex-col h-full transition-colors duration-200">
                                                <div className={`h-1 w-full ${ret.status === "Posted" ? "bg-emerald-500" : "bg-rose-400"}`} />
                                                <CardHeader className="p-4 pb-2 border-b border-slate-50">
                                                    <div className="flex justify-between items-start">
                                                        <div className="font-mono font-bold text-sm text-rose-700">{ret.id}</div>
                                                        <Badge variant="outline" className={`text-xs ${ret.status === "Posted" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}>
                                                            {ret.status ?? ret.reason}
                                                        </Badge>
                                                    </div>
                                                    <div className="text-xs text-slate-500 mt-2">Original Invoice</div>
                                                    <div className="text-sm font-medium">{ret.invoiceId}</div>
                                                    <CardDescription className="font-mono text-xs mt-1">{ret.date}</CardDescription>
                                                </CardHeader>
                                                <CardContent className="p-4 flex-1 flex flex-col items-center justify-center py-6">
                                                    <div className="text-xs text-slate-500 mb-1">Credit Amount</div>
                                                    <div className="font-bold text-2xl text-rose-600">-{ret.amount}</div>
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
                                                            onClick={() => ret.dbId && void handleDeleteReturn(ret.dbId, ret.status === "Posted").then((ok) => {
                                                                if (ok === false) return;
                                                                if (editReturnDbId === ret.dbId) {
                                                                    setCreditNoteOpen(false);
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
                                                : `Load more returns (${returns.length} of ${returnTotal})`}
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
