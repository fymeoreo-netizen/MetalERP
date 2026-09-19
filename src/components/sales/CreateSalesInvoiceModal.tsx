import { DialogFooter } from "@/components/ui/dialog";
import { InvoiceModalShell, thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";
import { ModalErrorBoundary } from "@/components/error/ModalErrorBoundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { AlertCircle, ArrowDownToLine, X, Save, Send, Trash2, Truck, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useInventory } from "@/contexts/InventoryContext";
import {
    getCatalogItem,
    getManagedCategoryForItem,
    getSalesInvoiceItemGroupLabel,
    getSalesInvoiceItemOptions,
    itemTracksUnitCount,
} from "@/lib/itemCatalog";
import { ItemCombobox } from "@/components/invoices/ItemCombobox";
import { InvoiceDateInput } from "@/components/invoices/InvoiceDateInput";
import { formatItemLabel } from "@/lib/inventoryStore";
import { getCustomers, initPartyCatalog, isPartyCatalogHydrated, parseDocDate, resolvePartyName, subscribeParties } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { allocateNextSalesInvoiceNo } from "@/lib/documentNumbers";
import { fetchSalesInvoiceDocument } from "@/lib/api/salesInvoices";
import type { DocActionResult } from "@/lib/api/types";
import { sumFixedLineAmounts, mapLineFromDb, type RateStatus } from "@/lib/ratePending";
import { useRatePendingLines } from "@/hooks/useRatePendingLines";
import { RateStatusCell } from "@/components/shared/RateStatusCell";
import { validateLinkedInvoiceLines } from "@/lib/orderLinkValidation";
import { collectInvoiceFormIssues, collectPremiumSalesInvoiceErrors } from "@/lib/invoiceFormValidation";
import { issuesForAction } from "@/lib/formValidation";
import { isErpLiveMode } from "@/lib/backendFlags";
import { fetchMarketErpContext } from "@/lib/repositories/marketRepo";
import { usePremiumWattaResolver } from "@/lib/usePremiumWattaResolver";
import { parseSwgFromText } from "@/lib/wattaMatrixValidation";
import { FormValidationPanel } from "@/components/invoices/InvoiceFormValidationAlerts";
import { useFormValidationGate } from "@/hooks/useFormValidationGate";
import { ConfirmInvoiceDeleteDialog } from "@/components/invoices/ConfirmInvoiceDeleteDialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    InvoiceSplitLayout,
    InvoiceFormScroll,
    InvoiceLinesColumn,
    FormBlock,
    FieldGroup,
    ModeToggle,
    LineItemsPanel,
    SalesInvoiceTotals,
    AlertBanner,
    AddLineBar,
    formatInvoicePhysicalSummary,
    invoiceInputClass,
    sumInvoicePhysicalTotals,
} from "@/components/invoices/InvoiceFormLayout";
import { useToast } from "@/components/ui/use-toast";
import { runInvoiceDocAction } from "@/lib/docActionRunner";
import { agentDebugLog } from "@/lib/agentDebugLog";
import { SalesDispatchChallanSheet } from "@/components/sales/SalesDispatchChallanSheet";
import { mapInvoiceFormToDispatchChallan } from "@/lib/salesDispatchChallan";
import {
    aggregateOutboundDemand,
    formatOutboundStockErrors,
    validateOutboundStock,
    type OutboundStockLine,
} from "@/lib/outboundStockValidation";

interface PendingOrder {
    id: string;
    customer: string;
    customerId: string;
    total_ordered_qty: number;
    total_fulfilled_qty: number;
    items: {
        lineId?: string;
        itemCode?: string;
        item: string;
        gauge?: string;
        qty: number;
        qtyRemaining?: number;
        rate: number;
        wattaRate?: number;
    }[];
}

interface CreateSalesInvoiceModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaveDraft: (data: any) => DocActionResult | Promise<DocActionResult>;
    onPost: (data: any) => DocActionResult | Promise<DocActionResult>;
    onDelete?: (id: string, isPosted?: boolean) => boolean | void | Promise<boolean | void>;
    pendingOrders?: PendingOrder[];
    editInvoiceDbId?: string | null;
}

const CUSTOMER_CREDIT: Record<string, { creditLimit: number; currentBalance: number }> = {};

function buildPayload(
    invoiceId: string,
    dbId: string | null,
    date: Date | undefined,
    customerId: string,
    saleMode: string,
    vehicleNo: string,
    driverName: string,
    refScrapRate: string,
    remarks: string,
    linkedOrderId: string | null,
    lines: any[],
    totals: { totalNetWeight: number; subtotal: number; numDiscount: number; numTaxRate: number; taxAmount: number; finalTotal: number },
    postingStatus: "posted" | "draft" = "draft",
) {
    return {
        dbId,
        header: {
            invoiceId,
            date,
            customerId,
            saleMode,
            vehicleNo,
            driverName,
            refScrapRate: saleMode === "premium" ? refScrapRate : null,
            remarks,
            linkedOrderId,
            postingStatus,
        },
        items: lines,
        totals: {
            totalNetWeight: totals.totalNetWeight,
            subtotal: totals.subtotal,
            discount: totals.numDiscount,
            taxRate: totals.numTaxRate,
            taxAmount: totals.taxAmount,
            finalTotal: totals.finalTotal,
        },
    };
}

export function CreateSalesInvoiceModal({
    open,
    onOpenChange,
    onSaveDraft,
    onPost,
    onDelete,
    pendingOrders = [],
    editInvoiceDbId = null,
}: CreateSalesInvoiceModalProps) {
    const { toast } = useToast();
    const { getBalance, getUnitBalance, catalog } = useInventory();
    const catalogItems = useMemo(() => getSalesInvoiceItemOptions(), [catalog]);
    const catalogItemGroups = useMemo(() => {
        const groups = new Map<string, ReturnType<typeof getSalesInvoiceItemOptions>>();
        for (const item of catalogItems) {
            const label = getSalesInvoiceItemGroupLabel(item);
            const list = groups.get(label) ?? [];
            list.push(item);
            groups.set(label, list);
        }
        return groups;
    }, [catalogItems]);
    const [, forcePartyRefresh] = useState(0);
    const customers = getCustomers();
    const customerOptions = useMemo(() => toPartyComboboxOptions(customers), [customers]);

    const [invoiceId, setInvoiceId] = useState("");
    const [dbId, setDbId] = useState<string | null>(null);
    const [readOnly, setReadOnly] = useState(false);
    const [isPosted, setIsPosted] = useState(false);
    const [justPosted, setJustPosted] = useState(false);
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [customerId, setCustomerId] = useState("");
    const [saleMode, setSaleMode] = useState<"direct" | "premium">("direct");
    const [vehicleNo, setVehicleNo] = useState("");
    const [driverName, setDriverName] = useState("");
    const [refScrapRate, setRefScrapRate] = useState("");
    const [marketScrapHint, setMarketScrapHint] = useState<{ low: number; high: number; implied: number } | null>(null);
    const [remarks, setRemarks] = useState("");
    const [linkedOrderId, setLinkedOrderId] = useState<string | null>(null);
    const [showPullModal, setShowPullModal] = useState(false);
    const [lines, setLines] = useState<any[]>([]);
    const [baselineOutboundLines, setBaselineOutboundLines] = useState<OutboundStockLine[]>([]);
    const { fixedTotal, mapLineRateStatus } = useRatePendingLines();
    const [loading, setLoading] = useState(false);
    const itemSelectRef = useRef<HTMLButtonElement>(null);
    const quantityRef = useRef<HTMLInputElement>(null);
    const weightRef = useRef<HTMLInputElement>(null);
    const grossRef = useRef<HTMLInputElement>(null);
    const tareRef = useRef<HTMLInputElement>(null);
    const rateRef = useRef<HTMLInputElement>(null);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const invoiceNoPromiseRef = useRef<Promise<string> | null>(null);
    /** Focus target after item select — applied once Units/Gross fields have mounted. */
    const pendingLineFocusRef = useRef<"units" | "gross" | "weight" | null>(null);

    const [currentItem, setCurrentItem] = useState("");
    const [currentBatch, setCurrentBatch] = useState("");
    const [currentGross, setCurrentGross] = useState("");
    const [currentTare, setCurrentTare] = useState("");
    const [currentWeight, setCurrentWeight] = useState("");
    const [currentGauge, setCurrentGauge] = useState("");
    const [currentWattaRate, setCurrentWattaRate] = useState("");
    const [wattaManualOverride, setWattaManualOverride] = useState(false);
    const [currentQuantity, setCurrentQuantity] = useState("");
    const [currentRate, setCurrentRate] = useState("");
    const [currentRateStatus, setCurrentRateStatus] = useState<RateStatus>("fixed");
    const [editingLineId, setEditingLineId] = useState<string | null>(null);
    const [discount, setDiscount] = useState("");
    const [taxRate, setTaxRate] = useState("");
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [rateWarningOpen, setRateWarningOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<"draft" | "post" | null>(null);
    const { attemptedAction, markAttempted, resetValidation, showValidation } = useFormValidationGate();
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [challanOpen, setChallanOpen] = useState(false);

    useEffect(() => {
        if (saleMode !== "premium") {
            setMarketScrapHint(null);
            return;
        }
        let cancelled = false;
        void fetchMarketErpContext(7)
            .then((ctx) => {
                if (cancelled) return;
                if (ctx.suggested_ref_scrap_low > 0 || ctx.implied_pkr_per_kg > 0) {
                    setMarketScrapHint({
                        low: ctx.suggested_ref_scrap_low,
                        high: ctx.suggested_ref_scrap_high,
                        implied: ctx.implied_pkr_per_kg,
                    });
                }
            })
            .catch(() => {
                if (!cancelled) setMarketScrapHint(null);
            });
        return () => {
            cancelled = true;
        };
    }, [saleMode]);

    const resetForm = useCallback(() => {
        setDbId(null);
        setReadOnly(false);
        setIsPosted(false);
        setJustPosted(false);
        setInvoiceId("");
        invoiceNoPromiseRef.current = null;
        setDate(new Date());
        setCustomerId("");
        setSaleMode("direct");
        setVehicleNo("");
        setDriverName("");
        setRefScrapRate("");
        setRemarks("");
        setLinkedOrderId(null);
        setLines([]);
        setBaselineOutboundLines([]);
        setDiscount("");
        setTaxRate("");
        setCurrentItem("");
        setCurrentBatch("");
        setCurrentGross("");
        setCurrentTare("");
        setCurrentWeight("");
        setCurrentGauge("");
        setCurrentWattaRate("");
        setCurrentQuantity("");
        setCurrentRate("");
        setCurrentRateStatus("fixed");
        setEditingLineId(null);
        resetValidation();
    }, [resetValidation]);

    /** Clear form and allocate the next invoice number (modal stays open). */
    const startNewInvoice = useCallback(() => {
        resetForm();
        const numberPromise = allocateNextSalesInvoiceNo();
        invoiceNoPromiseRef.current = numberPromise;
        void numberPromise.then(setInvoiceId);
    }, [resetForm]);

    const loadEditInvoice = useCallback(async (id: string) => {
        setLoading(true);
        try {
            const doc = await fetchSalesInvoiceDocument(id);
            if (!doc) return;
            setReadOnly(false);
            setIsPosted(doc.posting_status === "posted");
            setDbId(doc.id);
        setInvoiceId(doc.invoice_no);
            setDate(parseDocDate(doc.invoice_date));
        setCustomerId(doc.parties?.code ?? "");
        setSaleMode(doc.sale_mode === "premium" ? "premium" : "direct");
        setRefScrapRate(doc.ref_scrap_rate != null ? String(doc.ref_scrap_rate) : "");
        setVehicleNo(doc.vehicle_no ?? "");
        setDriverName(doc.driver_name ?? "");
        setRemarks(doc.remarks ?? "");
        setDiscount(String(doc.discount_amount ?? 0));

        const invLines = doc.sales_invoice_lines ?? [];
        setTaxRate(String(invLines[0]?.tax_rate ?? 0));
        let linked: string | null = null;
        const mapped = invLines.map((l: any) => {
            const soLine = l.sales_order_lines;
            const orderNo = soLine?.sales_orders?.order_no ?? null;
            if (orderNo) linked = orderNo;
            const itemCode = l.items?.code ?? "";
            const qtyOrdered = Number(soLine?.qty_ordered ?? 0);
            const qtyFulfilled = Number(soLine?.qty_fulfilled ?? 0);
            return {
                id: l.id,
                itemCode,
                itemName: l.items?.name ?? itemCode,
                batchNo: "",
                gross: Number(l.gross_weight ?? 0),
                tare: Number(l.tare_weight ?? 0),
                netWeight: Number(l.net_weight ?? 0),
                quantity: Number(l.unit_count ?? 0),
                gauge: "",
                wattaRate: Number(l.watta_rate ?? 0),
                ...mapLineFromDb(l),
                salesOrderLineId: l.sales_order_line_id ?? undefined,
                orderItemCode: itemCode,
                orderRate: Number(soLine?.unit_price ?? l.unit_price ?? 0),
                orderedQty: soLine ? Math.max(0, qtyOrdered - qtyFulfilled) : undefined,
            };
        });
        setLinkedOrderId(linked);
        setLines(mapped);
        setBaselineOutboundLines(
            doc.posting_status === "posted"
                ? mapped
                      .filter((line: any) => line.itemCode && Number(line.netWeight ?? 0) > 0)
                      .map((line: any) => {
                          const item =
                              catalogItems.find((candidate) => candidate.code === line.itemCode) ??
                              getCatalogItem(line.itemCode);
                          return {
                              itemCode: line.itemCode,
                              netWeight: Number(line.netWeight ?? 0),
                              quantity: Number(line.quantity ?? 0),
                              unitCount: Number(line.quantity ?? 0),
                              tracksUnits: item ? itemTracksUnitCount(item) : false,
                          };
                      })
                : [],
        );
        } finally {
            setLoading(false);
        }
    }, [catalogItems]);

    useEffect(() => {
        if (!open) return;
        if (!isPartyCatalogHydrated()) {
            void initPartyCatalog().then(() => forcePartyRefresh((t) => t + 1));
        } else {
            forcePartyRefresh((t) => t + 1);
        }
        const unsub = subscribeParties(() => forcePartyRefresh((t) => t + 1));
        if (editInvoiceDbId) {
            void loadEditInvoice(editInvoiceDbId);
        } else {
            startNewInvoice();
        }
        return () => unsub();
    }, [open, editInvoiceDbId, loadEditInvoice, startNewInvoice]);

    const currentItemRecord = useMemo(
        () => catalogItems.find((i) => i.code === currentItem) ?? getCatalogItem(currentItem) ?? null,
        [catalogItems, currentItem],
    );
    const showUnitField = currentItemRecord ? itemTracksUnitCount(currentItemRecord) : false;
    const isStripItem = useMemo(() => {
        if (!currentItemRecord) return false;
        return (
            getManagedCategoryForItem(currentItemRecord) === "Strip" || currentItemRecord.itemType === "Strip"
        );
    }, [currentItemRecord]);
    const stockHint = currentItem
        ? (() => {
              const kg = getBalance(currentItem).toLocaleString();
              const units = getUnitBalance(currentItem);
              return units > 0 ? `${kg} kg · ${units.toLocaleString()} units available` : `${kg} kg available`;
          })()
        : undefined;

    const currentNet = isStripItem
        ? Math.max(0, Number(currentGross) - Number(currentTare))
        : Math.max(0, Number(currentWeight));
    const effectiveRate =
        saleMode === "premium" ? Number(refScrapRate) + Number(currentWattaRate) : Number(currentRate);
    const currentAmount = currentRateStatus === "pending" ? 0 : currentNet * effectiveRate;

    const focusEl = <T extends HTMLElement>(ref: React.RefObject<T | null>) => {
        setTimeout(() => ref.current?.focus(), 0);
    };
    const handleEnter = (next: () => void) => (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            next();
        }
    };
    const focusAfterWeight = () => {
        if (saleMode === "direct") focusEl(rateRef);
        else focusEl(addButtonRef);
    };

    // Apply deferred focus after item select so Units/Gross inputs exist in the DOM
    useEffect(() => {
        const target = pendingLineFocusRef.current;
        if (!target || !currentItem) return;
        pendingLineFocusRef.current = null;
        if (target === "units") focusEl(quantityRef);
        else if (target === "gross") focusEl(grossRef);
        else focusEl(weightRef);
    }, [currentItem, showUnitField, isStripItem]);

    const physicalTotals = useMemo(
        () =>
            sumInvoicePhysicalTotals(lines, (line) => {
                const item =
                    catalogItems.find((candidate) => candidate.code === line.itemCode) ??
                    getCatalogItem(line.itemCode);
                return item ? itemTracksUnitCount(item) : false;
            }),
        [lines, catalogItems],
    );
    const totalNetWeight = physicalTotals.totalNetKg;
    const subtotal = fixedTotal(lines);
    const numDiscount = parseFloat(discount) || 0;
    const numTaxRate = parseFloat(taxRate) || 0;
    const taxAmount = (subtotal - numDiscount) * (numTaxRate / 100);
    const finalTotal = subtotal - numDiscount + taxAmount;

    const dispatchChallanData = useMemo(() => {
        if (lines.length === 0) return null;
        return mapInvoiceFormToDispatchChallan({
            invoiceId,
            date,
            customerName: resolvePartyName(customerId),
            vehicleNo,
            driverName,
            remarks,
            lines: lines.map((l) => ({
                itemName: l.itemName || l.itemCode,
                netWeight: l.netWeight,
                rate: l.rate,
                amount: l.amount,
                gauge: l.gauge,
            })),
            totalAmount: finalTotal,
        });
    }, [invoiceId, date, customerId, vehicleNo, driverName, remarks, lines, finalTotal]);

    const customerCredit = customerId ? CUSTOMER_CREDIT[customerId] : undefined;
    const isOverLimit = customerCredit
        ? customerCredit.currentBalance + finalTotal > customerCredit.creditLimit
        : false;

    const invoiceAsOf = date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const { resolveForItemDebounced, resolveMany, clearCache } = usePremiumWattaResolver({
        partyCode: customerId,
        asOf: invoiceAsOf,
        direction: "sales",
        onError: (msg) => toast({ title: "Watta lookup failed", description: msg, variant: "destructive" }),
    });

    const swgForCurrentItem = useMemo(() => {
        const fromGauge = parseSwgFromText(currentGauge);
        if (fromGauge != null) return fromGauge;
        const item = catalogItems.find((i) => i.code === currentItem) ?? getCatalogItem(currentItem);
        return parseSwgFromText(item?.sizeSpec);
    }, [currentGauge, currentItem, catalogItems]);

    const refreshPremiumLineRates = useCallback(
        async (lineList: typeof lines, scrapRate: string) => {
            if (!isErpLiveMode() || readOnly || saleMode !== "premium") return lineList;
            const scrap = Number(scrapRate) || 0;
            const toResolve = lineList
                .filter((l) => l.itemCode && Number(l.netWeight) > 0)
                .map((l) => {
                    const item = getCatalogItem(l.itemCode);
                    return {
                        itemCode: l.itemCode,
                        swgOverride: parseSwgFromText(l.gauge) ?? parseSwgFromText(item?.sizeSpec),
                    };
                });
            if (!toResolve.length) return lineList;
            const wattaMap = await resolveMany(toResolve);
            return lineList.map((l) => {
                if (!l.itemCode || Number(l.netWeight) <= 0) return l;
                const item = getCatalogItem(l.itemCode);
                const swg = parseSwgFromText(l.gauge) ?? parseSwgFromText(item?.sizeSpec);
                const key = `${l.itemCode}|${swg ?? ""}`;
                const watta = wattaMap[key] ?? l.wattaRate ?? 0;
                const rate = scrap + watta;
                return {
                    ...l,
                    wattaRate: watta,
                    rate,
                    amount: Number(l.netWeight) * rate,
                };
            });
        },
        [readOnly, saleMode, resolveMany],
    );

    const customerPendingOrders = pendingOrders.filter((o) => o.customerId === customerId);
    const linkedOrder = pendingOrders.find((o) => o.id === linkedOrderId);

    const handlePullOrder = (orderId: string) => {
        const order = pendingOrders.find((o) => o.id === orderId);
        if (!order) return;
        setLinkedOrderId(orderId);
        setSaleMode("premium");
        setLines(
            order.items
                .filter((item) => (item.qtyRemaining ?? item.qty) > 0)
                .map((item) => ({
            id: Math.random().toString(36).substr(2, 9),
                    itemCode: item.itemCode ?? "",
            itemName: item.item,
            batchNo: "",
            gross: 0,
            tare: 0,
            netWeight: 0,
                    quantity: 0,
            gauge: item.gauge || "",
            wattaRate: item.wattaRate || 0,
            rate: item.rate,
            amount: 0,
                    orderedQty: item.qtyRemaining ?? item.qty,
                    salesOrderLineId: item.lineId,
                    orderItemCode: item.itemCode ?? "",
                    orderRate: item.rate,
                }))
        );
        const firstOpen = order.items.find((item) => (item.qtyRemaining ?? item.qty) > 0);
        if (firstOpen) {
            setCurrentItem(firstOpen.itemCode ?? "");
            if (saleMode === "direct") setCurrentRate(String(firstOpen.rate ?? ""));
            setCurrentGross("");
            setCurrentTare("");
        }
        setShowPullModal(false);
    };

    useEffect(() => {
        if (!currentItem || saleMode !== "premium" || wattaManualOverride) return;
        if (!isErpLiveMode()) {
            setCurrentWattaRate("513");
            return;
        }
        resolveForItemDebounced(currentItem, swgForCurrentItem, (w) => {
            if (w > 0) setCurrentWattaRate(String(w));
        });
    }, [currentItem, saleMode, customerId, swgForCurrentItem, wattaManualOverride, resolveForItemDebounced]);

    useEffect(() => {
        if (saleMode !== "premium" || readOnly) return;
        clearCache();
        setWattaManualOverride(false);
        if (!customerId || lines.length === 0) return;
        void refreshPremiumLineRates(lines, refScrapRate).then((next) => {
            setLines(next);
        });
    }, [customerId, saleMode, invoiceAsOf, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps -- batch refresh on party/date/mode

    useEffect(() => {
        if (saleMode !== "premium" || !refScrapRate) return;
        const scrap = Number(refScrapRate);
        if (!scrap) return;
        setLines((prev) =>
            prev.map((l) => {
                if (Number(l.netWeight) <= 0) return l;
                const rate = scrap + Number(l.wattaRate ?? 0);
                return { ...l, rate, amount: Number(l.netWeight) * rate };
            }),
        );
    }, [refScrapRate, saleMode]);

    const focusLinkedLine = (line: (typeof lines)[number]) => {
        if (readOnly) return;
        setCurrentItem(line.itemCode);
        setWattaManualOverride(false);
        if (saleMode === "direct") setCurrentRate(String(line.rate ?? line.orderRate ?? ""));
                if (saleMode === "premium") {
            setCurrentWattaRate(String(line.wattaRate ?? ""));
            const item = getCatalogItem(line.itemCode);
            setCurrentGauge(line.gauge || item?.sizeSpec || "");
        }
        setCurrentGross("");
        setCurrentTare("");
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const onItemSelect = (code: string) => {
        setCurrentItem(code);
        setWattaManualOverride(false);
        const item = catalogItems.find((i) => i.code === code) ?? getCatalogItem(code);
        if (item?.sizeSpec) {
            const swg = parseSwgFromText(item.sizeSpec);
            setCurrentGauge(swg != null ? String(swg) : item.sizeSpec);
        }
        // Derive from the selected item — showUnitField/isStripItem are still stale until re-render
        const tracksUnits = item ? itemTracksUnitCount(item) : false;
        const strip =
            !!item &&
            (getManagedCategoryForItem(item) === "Strip" || item.itemType === "Strip");
        pendingLineFocusRef.current = strip ? "gross" : tracksUnits ? "units" : "weight";
    };

    const toOutboundLine = useCallback(
        (line: { itemCode?: string; netWeight?: number; quantity?: number }): OutboundStockLine => {
            const code = line.itemCode ?? "";
            const item =
                catalogItems.find((candidate) => candidate.code === code) ?? getCatalogItem(code);
            return {
                itemCode: code,
                netWeight: Number(line.netWeight ?? 0),
                quantity: Number(line.quantity ?? 0),
                unitCount: Number(line.quantity ?? 0),
                tracksUnits: item ? itemTracksUnitCount(item) : false,
            };
        },
        [catalogItems],
    );

    const stockAvailability = useMemo(() => {
        if (!isPosted || !editInvoiceDbId || baselineOutboundLines.length === 0) {
            return {
                getKg: getBalance,
                getUnits: getUnitBalance,
            };
        }
        const baseline = aggregateOutboundDemand(baselineOutboundLines);
        return {
            getKg: (itemCode: string) => getBalance(itemCode) + (baseline.kgByItem[itemCode] ?? 0),
            getUnits: (itemCode: string) => getUnitBalance(itemCode) + (baseline.unitsByItem[itemCode] ?? 0),
        };
    }, [baselineOutboundLines, editInvoiceDbId, getBalance, getUnitBalance, isPosted]);

    const stockPostIssues = useMemo(() => {
        if (saleMode === "premium") return [];
        const billable = lines
            .filter((l) => l.itemCode && Number(l.netWeight ?? 0) > 0)
            .map((l) => toOutboundLine(l));
        const check = validateOutboundStock({ lines: billable, availability: stockAvailability });
        return check.ok ? [] : check.errors;
    }, [lines, saleMode, stockAvailability, toOutboundLine]);

    const handleAddLine = () => {
        if (!currentItem) return;
        if (isStripItem ? !currentGross : !currentWeight) return;
        const tare = isStripItem ? Number(currentTare) || 0 : 0;
        const gross = isStripItem ? Number(currentGross) : 0;

        const updatedLine = {
            id: editingLineId ?? Math.random().toString(36).substr(2, 9),
            itemCode: currentItem,
            itemName: catalogItems.find((i) => i.code === currentItem)
                ? formatItemLabel(catalogItems.find((i) => i.code === currentItem)!)
                : "Unknown",
            batchNo: currentBatch,
            gross,
            tare,
            netWeight: currentNet,
            quantity: Number(currentQuantity) || 0,
            gauge: currentGauge,
            wattaRate: saleMode === "premium" ? Number(currentWattaRate) : 0,
            rate: effectiveRate,
            amount: currentAmount,
            rateStatus: currentRateStatus,
        };

        if (editingLineId) {
            if (linkedOrderId) {
                const validation = validateLinkedInvoiceLines([updatedLine], linkedOrderId);
                if (!validation.ok) {
                    toast({ title: "Cannot update line", description: validation.errors[0], variant: "destructive" });
                    return;
                }
            }
            if (saleMode !== "premium") {
                const projected = lines.map((l) => (l.id === editingLineId ? toOutboundLine(updatedLine) : toOutboundLine(l)));
                const stockCheck = validateOutboundStock({ lines: projected, availability: stockAvailability });
                if (!stockCheck.ok) {
                    toast({
                        title: "Insufficient stock",
                        description: formatOutboundStockErrors(stockCheck.errors),
                        variant: "destructive",
                    });
                    return;
                }
            }
            setLines((prev) => prev.map((l) => (l.id === editingLineId ? updatedLine : l)));
            setEditingLineId(null);
        } else {
        const existingIdx = lines.findIndex(
            (l) =>
                l.salesOrderLineId &&
                l.itemCode === currentItem &&
                Number(l.netWeight) === 0
        );
        if (existingIdx >= 0) {
            const candidate = {
                ...lines[existingIdx],
                gross,
                tare,
                netWeight: currentNet,
                quantity: Number(currentQuantity) || 0,
                amount: currentAmount,
                rateStatus: currentRateStatus,
            };
            const validation = validateLinkedInvoiceLines([candidate], linkedOrderId);
            if (!validation.ok) {
                toast({ title: "Cannot add line", description: validation.errors[0], variant: "destructive" });
            return;
        }
            if (saleMode !== "premium") {
                const projected = lines.map((l, i) =>
                    i === existingIdx ? toOutboundLine(candidate) : toOutboundLine(l),
                );
                const stockCheck = validateOutboundStock({
                    lines: projected,
                    availability: stockAvailability,
                });
                if (!stockCheck.ok) {
                    toast({
                        title: "Insufficient stock",
                        description: formatOutboundStockErrors(stockCheck.errors),
                        variant: "destructive",
                    });
                    return;
                }
            }
            const updated = [...lines];
            updated[existingIdx] = candidate;
            setLines(updated);
        } else {
        const newLine = updatedLine;
            if (linkedOrderId) {
                const validation = validateLinkedInvoiceLines([newLine], linkedOrderId);
                if (!validation.ok) {
                    toast({ title: "Cannot add line", description: validation.errors[0], variant: "destructive" });
                    return;
                }
            }
            if (saleMode !== "premium") {
                const projected = [...lines.map((l) => toOutboundLine(l)), toOutboundLine(newLine)];
                const stockCheck = validateOutboundStock({
                    lines: projected,
                    availability: stockAvailability,
                });
                if (!stockCheck.ok) {
                    toast({
                        title: "Insufficient stock",
                        description: formatOutboundStockErrors(stockCheck.errors),
                        variant: "destructive",
                    });
                    return;
                }
            }
        setLines([...lines, newLine]);
        }
        }
        setCurrentGross("");
        setCurrentTare("");
        setCurrentWeight("");
        setCurrentQuantity("");
        setCurrentRate("");
        setEditingLineId(null);
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const handleEditLine = (id: string) => {
        const line = lines.find((l) => l.id === id);
        if (!line) return;
        const lineRecord = catalogItems.find((i) => i.code === line.itemCode) ?? getCatalogItem(line.itemCode);
        const lineIsStrip =
            !!lineRecord &&
            (getManagedCategoryForItem(lineRecord) === "Strip" || lineRecord.itemType === "Strip");
        setCurrentItem(line.itemCode);
        setCurrentBatch(line.batchNo ?? "");
        if (lineIsStrip) {
            setCurrentGross(line.gross != null ? String(line.gross) : "");
            setCurrentTare(line.tare != null ? String(line.tare) : "");
            setCurrentWeight("");
        } else {
            setCurrentWeight(line.netWeight != null ? String(line.netWeight) : "");
            setCurrentGross("");
            setCurrentTare("");
        }
        setCurrentQuantity(line.quantity ? String(line.quantity) : "");
        setCurrentGauge(line.gauge ?? "");
        if (saleMode === "premium") {
            setCurrentWattaRate(line.wattaRate != null ? String(line.wattaRate) : "");
        } else {
            setCurrentRate(line.rate != null ? String(line.rate) : "");
        }
        setCurrentRateStatus(mapLineRateStatus(line.rateStatus));
        setEditingLineId(id);
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const getPayload = (overrideInvoiceNo?: string) =>
        buildPayload(
                overrideInvoiceNo ?? invoiceId,
            dbId,
                date,
                customerId,
                saleMode,
                vehicleNo,
                driverName,
            refScrapRate,
                remarks,
                linkedOrderId,
            lines,
            { totalNetWeight, subtotal, numDiscount, numTaxRate, taxAmount, finalTotal },
            isPosted ? "posted" : "draft",
        );

    /** Resolve the (possibly still-loading) invoice number without blocking the form. */
    const ensureInvoiceNo = async (): Promise<string> => {
        if (invoiceId.trim()) return invoiceId;
        if (invoiceNoPromiseRef.current) {
            const resolved = (await invoiceNoPromiseRef.current) ?? "";
            if (resolved) {
                setInvoiceId(resolved);
                return resolved;
            }
        }
        return "";
    };

    const runAction = async (action: "draft" | "post") => {
        const resolvedInvoiceNo = await ensureInvoiceNo();
        if (!resolvedInvoiceNo.trim()) {
            toast({
                title: "Invoice number unavailable",
                description: "Could not allocate an invoice number. Please try again.",
                variant: "destructive",
            });
            return;
        }
        const payload = getPayload(resolvedInvoiceNo);
        await runInvoiceDocAction({
            action,
            location: "CreateSalesInvoiceModal",
            toast,
            run: () => (action === "draft" ? onSaveDraft(payload) : onPost(payload)),
            onDbId: setDbId,
            onSuccess: () => {
                if (action === "post") {
                    startNewInvoice();
                } else {
        onOpenChange(false);
                    resetForm();
                }
            },
        });
    };

    const draftIssues = useMemo(
        () =>
            collectInvoiceFormIssues({
                partyId: customerId,
                partyLabel: "Customer",
                lines,
                linkedOrderId,
                forPost: false,
            }),
        [customerId, lines, linkedOrderId],
    );

    const postIssues = useMemo(
        () =>
            collectInvoiceFormIssues({
                partyId: customerId,
                partyLabel: "Customer",
                lines,
                linkedOrderId,
                forPost: true,
            }),
        [customerId, lines, linkedOrderId],
    );

    const displayIssues = useMemo(() => {
        if (!showValidation || !attemptedAction) {
            return { errors: [] as string[], warnings: [] as string[] };
        }
        const base = issuesForAction(attemptedAction, draftIssues, postIssues);
        if (attemptedAction !== "post") return base;

        const premiumErrors = collectPremiumSalesInvoiceErrors({
            saleMode,
            refScrapRate,
            totalNetWeight,
            lines,
            liveMode: isErpLiveMode(),
        });
        return {
            errors: [
                ...base.errors,
                ...stockPostIssues.filter((e) => !base.errors.includes(e)),
                ...premiumErrors.filter((e) => !base.errors.includes(e)),
            ],
            warnings: base.warnings,
        };
    }, [
        showValidation,
        attemptedAction,
        draftIssues,
        postIssues,
        stockPostIssues,
        saleMode,
        refScrapRate,
        totalNetWeight,
        lines,
    ]);

    const activeIssues = pendingAction === "post" ? postIssues : draftIssues;
    const entryHint =
        currentGross && !currentItem
            ? "Select an item before adding weight to a line."
            : currentItem && !currentGross
              ? "Enter gross weight for the selected item."
              : null;

    const handleAction = (action: "draft" | "post") => {
        markAttempted(action);

        const issues = issuesForAction(action, draftIssues, postIssues);
        const premiumErrors =
            action === "post"
                ? collectPremiumSalesInvoiceErrors({
                      saleMode,
                      refScrapRate,
                      totalNetWeight,
                      lines,
                      liveMode: isErpLiveMode(),
                  })
                : [];
        const allErrors = [...issues.errors, ...premiumErrors.filter((e) => !issues.errors.includes(e))];
        if (action === "post" && stockPostIssues.length > 0) {
            allErrors.push(...stockPostIssues);
        }

        if (allErrors.length > 0) {
            agentDebugLog("CreateSalesInvoiceModal:handleAction", "validation blocked", {
                action,
                errorCount: allErrors.length,
            });
            if (action === "post" && stockPostIssues.length > 0) {
                toast({
                    title: "Cannot post — insufficient stock",
                    description: formatOutboundStockErrors(stockPostIssues),
                    variant: "destructive",
                });
            }
            return;
        }
        if (action === "post" && issues.warnings.length > 0) {
            agentDebugLog("CreateSalesInvoiceModal:handleAction", "rate warning dialog", {
                warningCount: issues.warnings.length,
            });
            setPendingAction(action);
            setRateWarningOpen(true);
            toast({
                title: "Confirm rates to post",
                description: "Invoice rate differs from the linked order — confirm in the dialog.",
            });
            return;
        }
        void runAction(action);
    };

    const confirmDelete = async () => {
        if (!dbId || !onDelete) return;
        setDeleteLoading(true);
        try {
            const result = await onDelete(dbId, isPosted);
            if (result === false) return;
        onOpenChange(false);
            resetForm();
        } finally {
            setDeleteLoading(false);
        }
    };

    const modalTitle = readOnly
        ? "View sales invoice"
        : editInvoiceDbId
          ? "Edit sales invoice"
          : "Direct invoice";

    return (
        <ModalErrorBoundary onClose={() => onOpenChange(false)}>
        <>
        <InvoiceModalShell
                open={open}
                onOpenChange={onOpenChange}
                title={modalTitle}
                subtitle={
                    loading
                        ? "Loading…"
                        : readOnly
                          ? "Posted — read only"
                          : isPosted
                            ? "Posted — edit header/lines then Save changes"
                            : "Finished goods dispatch"
                }
                headerEnd={
                    <span className="font-mono text-xs text-zinc-400 tabular-nums">{invoiceId}</span>
                }
                footer={
                    <DialogFooter className="shrink-0 px-6 py-3.5 border-t border-zinc-200/60 bg-white gap-2 sm:justify-end rounded-none">
                        {justPosted ? (
                            <>
                                <span className="mr-auto text-sm font-medium text-emerald-700 inline-flex items-center gap-1.5">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Invoice {invoiceId} posted · Stock updated
                                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        startNewInvoice();
                                    }}
                                >
                                    New invoice
                                            </Button>
                                <Button
                                    size="sm"
                                    className="bg-zinc-900 hover:bg-zinc-800"
                                    onClick={() => {
                                        onOpenChange(false);
                                        resetForm();
                                    }}
                                >
                                    Close
                                </Button>
                            </>
                        ) : lines.length > 0 ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mr-auto text-blue-700 border-blue-200 hover:bg-blue-50"
                                onClick={() => setChallanOpen(true)}
                                disabled={loading}
                            >
                                <Truck className="h-3.5 w-3.5 mr-1.5" />
                                Dispatch challan
                            </Button>
                        ) : null}
                        {readOnly ? (
                            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                                Close
                            </Button>
                        ) : (
                            <>
                                {dbId && onDelete ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="mr-auto text-rose-600 border-rose-200 hover:bg-rose-50"
                                        onClick={() => setConfirmDeleteOpen(true)}
                                        disabled={loading}
                                    >
                                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                                        Delete
                                    </Button>
                                ) : null}
                                <Button variant="ghost" size="sm" className="text-zinc-600" onClick={() => onOpenChange(false)}>
                                    Cancel
                                </Button>
                                {isPosted ? (
                                    <Button
                                        size="sm"
                                        onClick={() => handleAction("draft")}
                                        disabled={lines.length === 0 || loading || !customerId}
                                        className="min-w-[128px] rounded-lg bg-zinc-900 hover:bg-zinc-800"
                                    >
                                        <Save className="h-3.5 w-3.5 mr-1.5" />
                                        Save changes
                                    </Button>
                                ) : (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleAction("draft")}
                                            disabled={lines.length === 0 || loading || !customerId}
                                        >
                                            <Save className="h-3.5 w-3.5 mr-1.5" />
                                            Save draft
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => handleAction("post")}
                                            disabled={lines.length === 0 || loading || !customerId}
                                            className={cn(
                                                "min-w-[128px] rounded-lg",
                                                isOverLimit ? "bg-rose-600 hover:bg-rose-700" : "bg-zinc-900 hover:bg-zinc-800"
                                            )}
                                        >
                                            {isOverLimit ? (
                                                <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                                            ) : (
                                                <Send className="h-3.5 w-3.5 mr-1.5" />
                                            )}
                                            {isOverLimit ? "Request approval" : "Post invoice"}
                                        </Button>
                                    </>
                                )}
                            </>
                        )}
                    </DialogFooter>
                }
            >
                <InvoiceSplitLayout
                    form={
                        <InvoiceFormScroll className={cn(readOnly && "pointer-events-none opacity-80")}>
                            {isOverLimit && (
                                <AlertBanner variant="warning">Credit limit exceeded</AlertBanner>
                            )}
                            {!readOnly && (
                                <FormValidationPanel
                                    visible={showValidation}
                                    issues={displayIssues}
                                    title={
                                        attemptedAction === "post"
                                            ? "Complete these fields before posting"
                                            : "Complete these fields before saving"
                                    }
                                />
                            )}
                            {!readOnly && entryHint && (
                                <AlertBanner variant="warning">{entryHint}</AlertBanner>
                            )}
                            {!readOnly && showValidation && attemptedAction === "post" && postIssues.warnings.length > 0 && (
                                <AlertBanner variant="warning">
                                    Rate differs from order — press Post invoice and confirm in the dialog to continue.
                                </AlertBanner>
                            )}

                            <FormBlock label="Party">
                                <div className="grid grid-cols-2 gap-3">
                                    <FieldGroup label="Customer" className="col-span-2">
                                        <PartyCombobox
                                            value={customerId}
                                            onValueChange={setCustomerId}
                                            options={customerOptions}
                                            placeholder="Search customer…"
                                            triggerClassName={cn(
                                                invoiceInputClass,
                                                isOverLimit && "ring-rose-300/80",
                                            )}
                                            highlightWhenEmpty
                                            disabled={readOnly}
                                        />
                                    </FieldGroup>
                                    <FieldGroup label="Date">
                                        <InvoiceDateInput
                                            value={date}
                                            onChange={setDate}
                                            disabled={readOnly}
                                            className={invoiceInputClass}
                                            ariaLabel="Sales invoice date"
                                        />
                                    </FieldGroup>
                                    <FieldGroup label="Mode">
                                        <ModeToggle
                                            value={saleMode}
                                            onChange={setSaleMode}
                                            options={[
                                                { value: "direct", label: "Direct" },
                                                { value: "premium", label: "Premium" },
                                            ]}
                                        />
                                    </FieldGroup>
                                    {saleMode === "premium" && (
                                        <FieldGroup label="Scrap ref. rate" className="col-span-2">
                                            <Input
                                                type="number"
                                                className={invoiceInputClass}
                                                value={refScrapRate}
                                                onChange={(e) => setRefScrapRate(e.target.value)}
                                            />
                                            {marketScrapHint && (
                                                <p className="text-[10px] text-slate-500 mt-1">
                                                    Market implied ₨ {marketScrapHint.implied.toLocaleString()}/kg — suggested ref scrap{" "}
                                                    {marketScrapHint.low.toLocaleString()}–{marketScrapHint.high.toLocaleString()} (7d ERP)
                                                </p>
                                            )}
                                        </FieldGroup>
                                    )}
                                    <FieldGroup label="Vehicle">
                                        <Input
                                            className={cn(invoiceInputClass, "uppercase")}
                                            value={vehicleNo}
                                            onChange={(e) => setVehicleNo(e.target.value)}
                                            placeholder="—"
                                        />
                                    </FieldGroup>
                                    <FieldGroup label="Driver">
                                        <Input
                                            className={invoiceInputClass}
                                            value={driverName}
                                            onChange={(e) => setDriverName(e.target.value)}
                                            placeholder="—"
                                        />
                                    </FieldGroup>
                                </div>

                                {customerId && customerPendingOrders.length > 0 && !linkedOrderId && (
                                    <AlertBanner
                                        variant="info"
                                        action={
                                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setShowPullModal(true)}>
                                                <ArrowDownToLine className="h-3 w-3 mr-1" />
                                                Pull
                                            </Button>
                                        }
                                    >
                                        {customerPendingOrders.length} open order(s)
                                    </AlertBanner>
                                )}
                                {linkedOrderId && (
                                    <AlertBanner
                                        variant="success"
                                        action={
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-6 px-2 text-[10px]"
                                                onClick={() => {
                                                    setLinkedOrderId(null);
                                                    setLines([]);
                                                }}
                                            >
                                                Unlink
                                            </Button>
                                        }
                                    >
                                        {linkedOrderId}
                                        {linkedOrder &&
                                            ` · ${(linkedOrder.total_ordered_qty - linkedOrder.total_fulfilled_qty).toLocaleString()} kg open`}
                                    </AlertBanner>
                                )}
                            </FormBlock>

                            <FormBlock label={linkedOrderId ? "Add weight from order" : "New line"}>
                                <div className="space-y-3">
                                    {linkedOrderId && currentItem && lines.some((l) => l.salesOrderLineId && l.itemCode === currentItem && Number(l.netWeight) === 0) && (
                                        <AlertBanner variant="info">
                                            Enter gross/tare below, then Add line to fulfill the selected order item.
                                        </AlertBanner>
                                    )}
                                    <FieldGroup
                                        label="Item"
                                        hint={stockHint}
                                    >
                                        <ItemCombobox
                                            ref={itemSelectRef}
                                            value={currentItem}
                                            onSelect={onItemSelect}
                                            groups={Array.from(catalogItemGroups.entries()).map(([label, items]) => ({
                                                label,
                                                items: items.map((i) => ({ code: i.code, name: i.name, sizeSpec: i.sizeSpec })),
                                            }))}
                                        />
                                    </FieldGroup>
                                    {showUnitField ? (
                                        <FieldGroup label="Units">
                                    <Input
                                                ref={quantityRef}
                                        type="number"
                                                min={0}
                                                className={invoiceInputClass}
                                                value={currentQuantity}
                                                onChange={(e) => setCurrentQuantity(e.target.value)}
                                                onKeyDown={handleEnter(() => focusEl(isStripItem ? grossRef : weightRef))}
                                                placeholder="0"
                                            />
                                        </FieldGroup>
                                    ) : null}
                                    {isStripItem ? (
                                        <div className="grid grid-cols-2 gap-2">
                                            <FieldGroup label="Gross (kg)">
                                        <Input
                                                    ref={grossRef}
                                            type="number"
                                                    className={invoiceInputClass}
                                            value={currentGross}
                                            onChange={(e) => setCurrentGross(e.target.value)}
                                                    onKeyDown={handleEnter(() => focusEl(tareRef))}
                                                />
                                            </FieldGroup>
                                            <FieldGroup label="Tare (kg)">
                                    <Input
                                                    ref={tareRef}
                                        type="number"
                                                    className={invoiceInputClass}
                                        value={currentTare}
                                        onChange={(e) => setCurrentTare(e.target.value)}
                                                    onKeyDown={handleEnter(focusAfterWeight)}
                                    />
                                            </FieldGroup>
                                </div>
                                    ) : (
                                        <FieldGroup label="Weight (kg)">
                                    <Input
                                                ref={weightRef}
                                        type="number"
                                                className={invoiceInputClass}
                                                value={currentWeight}
                                                onChange={(e) => setCurrentWeight(e.target.value)}
                                                onKeyDown={handleEnter(focusAfterWeight)}
                                            />
                                        </FieldGroup>
                                    )}
                                    {saleMode === "direct" ? (
                                        <FieldGroup label="Rate">
                                            <Input
                                                ref={rateRef}
                                                type="number"
                                                className={invoiceInputClass}
                                                value={currentRate}
                                                onChange={(e) => setCurrentRate(e.target.value)}
                                                onKeyDown={handleEnter(() => focusEl(addButtonRef))}
                                            />
                                        </FieldGroup>
                                    ) : (
                                        <FieldGroup
                                            label="Watta (PKR/kg)"
                                            hint={wattaManualOverride ? "Manual override" : "From watta matrix (party + SWG)"}
                                        >
                                            <Input
                                                type="number"
                                                className={invoiceInputClass}
                                                value={currentWattaRate}
                                                onChange={(e) => {
                                                    setWattaManualOverride(true);
                                                    setCurrentWattaRate(e.target.value);
                                                }}
                                                disabled={!refScrapRate}
                                            />
                                        </FieldGroup>
                                    )}
                                    <RateStatusCell value={currentRateStatus} onChange={setCurrentRateStatus} />
                                    <AddLineBar
                                        netLabel={`${currentNet.toFixed(2)} kg`}
                                        amountLabel={currentRateStatus === "pending" ? "—" : `₨ ${currentAmount.toLocaleString()}`}
                                        onAdd={handleAddLine}
                                        disabled={!currentItem || (isStripItem ? !currentGross : !currentWeight)}
                                        buttonRef={addButtonRef}
                                        buttonLabel={editingLineId ? "Update" : "Add"}
                                    />
                                </div>
                            </FormBlock>

                            <FormBlock label="Notes">
                                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional remarks" className="min-h-[72px] resize-none border-0 bg-zinc-100/80 ring-1 ring-zinc-200/70 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-zinc-400/40" />
                            </FormBlock>
                        </InvoiceFormScroll>
                    }
                    lines={
                        <InvoiceLinesColumn
                            title="Invoice lines"
                            subtitle={
                                lines.length > 0
                                    ? `${lines.length} item${lines.length !== 1 ? "s" : ""} · ${formatInvoicePhysicalSummary(physicalTotals)}`
                                    : "Items appear here as you add them"
                            }
                            badge={
                                lines.length > 0 ? (
                                    <span className="text-[11px] font-medium tabular-nums text-zinc-500 bg-white px-2 py-1 rounded-md ring-1 ring-zinc-200/60">{lines.length}</span>
                                ) : undefined
                            }
                            footer={
                                <>
                                {saleMode === "premium" && totalNetWeight > 0 && Number(refScrapRate) > 0 && (
                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                                        <p className="font-semibold">Scrap expectation on post</p>
                                        <p>
                                            Customer will owe{" "}
                                            <strong>{totalNetWeight.toLocaleString()} kg</strong> scrap at ref rate{" "}
                                            <strong>₨ {Number(refScrapRate).toLocaleString()}/kg</strong> (invoice{" "}
                                            {invoiceId}).
                                        </p>
                                </div>
                                )}
                                <SalesInvoiceTotals
                                    subtotal={subtotal}
                                    discount={discount}
                                    onDiscountChange={setDiscount}
                                    taxRate={taxRate}
                                    onTaxRateChange={setTaxRate}
                                    taxAmount={taxAmount}
                                    total={finalTotal}
                                    physicalTotals={physicalTotals}
                                    accentClass={isOverLimit ? "text-rose-600" : "text-zinc-900"}
                                    readOnly={readOnly}
                                />
                                </>
                            }
                        >
                            <LineItemsPanel
                                lines={lines}
                                emptyMessage="Add lines from the form on the left"
                                onRemove={
                                    readOnly
                                        ? undefined
                                        : (id) => {
                                              setLines(lines.filter((l) => l.id !== id));
                                              if (editingLineId === id) setEditingLineId(null);
                                          }
                                }
                                onEdit={readOnly ? undefined : handleEditLine}
                                renderLine={(line: (typeof lines)[number]) => (
                                    <div className="flex justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium text-zinc-900 text-[13px] leading-snug truncate">{line.itemName}</p>
                                            {line.salesOrderLineId && line.orderedQty != null && (
                                                <p className="text-[10px] text-blue-600 mt-0.5">Open on order: {line.orderedQty.toLocaleString()} kg</p>
                                            )}
                                            {line.salesOrderLineId && Number(line.netWeight) === 0 && !readOnly ? (
                                                <button
                                                    type="button"
                                                    onClick={() => focusLinkedLine(line)}
                                                    className={cn(
                                                        "text-[10px] mt-0.5 text-left hover:underline",
                                                        currentItem === line.itemCode ? "text-amber-700 font-medium" : "text-amber-600"
                                                    )}
                                                >
                                                    {currentItem === line.itemCode ? "Selected — enter weight on the left" : "Pending — click to select"}
                                                </button>
                                            ) : (
                                                <p className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                                                    {line.quantity > 0 ? `${line.quantity} units · ` : ""}
                                                    {line.gross} − {line.tare} → <span className="text-zinc-700">{line.netWeight} kg</span>
                                                    {line.rateStatus === "pending" ? " · Rate pending" : ` · Rate ₨ ${Number(line.rate ?? 0).toLocaleString()}/kg`}
                                                    {line.gauge ? ` · SWG ${line.gauge}` : ""}
                                                </p>
                            )}
                        </div>
                                        <div className="shrink-0 flex flex-col items-end gap-1">
                                            {!readOnly && (
                                                <RateStatusCell
                                                    compact
                                                    value={(line.rateStatus ?? "fixed") as RateStatus}
                                                    onChange={(status) =>
                                                        setLines((prev) =>
                                                            prev.map((l) =>
                                                                l.id === line.id
                                                                    ? {
                                                                          ...l,
                                                                          rateStatus: status,
                                                                          amount:
                                                                              status === "pending"
                                                                                  ? 0
                                                                                  : Number(l.netWeight) * Number(l.rate),
                                                                      }
                                                                    : l,
                                                            ),
                                                        )
                                                    }
                                                />
                                            )}
                                            <p className="text-[13px] font-semibold tabular-nums text-zinc-900">
                                                {line.rateStatus === "pending" ? "—" : `₨ ${line.amount.toLocaleString()}`}
                                            </p>
                                </div>
                                    </div>
                                )}
                            />
                        </InvoiceLinesColumn>
                    }
                />

                {showPullModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4" onClick={() => setShowPullModal(false)}>
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden ring-1 ring-zinc-200/80" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100">
                                <h3 className="text-sm font-medium text-zinc-900">Pull from order</h3>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowPullModal(false)}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                                    </div>
                            <div className={cn("p-3 space-y-1.5 max-h-[50vh] overflow-y-auto", thinScrollbarClass)}>
                                {customerPendingOrders.map((o) => (
                                    <button key={o.id} type="button" className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-zinc-50 transition-colors" onClick={() => handlePullOrder(o.id)}>
                                        <div className="flex justify-between text-xs">
                                            <span className="font-mono font-medium text-zinc-800">{o.id}</span>
                                            <span className="text-zinc-500 tabular-nums">{(o.total_ordered_qty - o.total_fulfilled_qty).toLocaleString()} kg</span>
                                </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </InvoiceModalShell>

            <ConfirmInvoiceDeleteDialog
                open={confirmDeleteOpen}
                onOpenChange={setConfirmDeleteOpen}
                variant={isPosted ? "posted" : "draft"}
                docLabel={invoiceId}
                loading={deleteLoading}
                onConfirm={confirmDelete}
            />

            <AlertDialog open={rateWarningOpen} onOpenChange={setRateWarningOpen}>
                <AlertDialogContent className="z-[10050]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Rate differs from order</AlertDialogTitle>
                        <AlertDialogDescription className="text-left whitespace-pre-line">
                            {activeIssues.warnings.join("\n\n")}
                            {"\n\n"}Post this invoice anyway?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setPendingAction(null)}>Go back</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                const action = pendingAction ?? "post";
                                setRateWarningOpen(false);
                                setPendingAction(null);
                                void runAction(action);
                            }}
                        >
                            Post anyway
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <SalesDispatchChallanSheet
                open={challanOpen}
                onOpenChange={setChallanOpen}
                data={dispatchChallanData}
            />
        </>
        </ModalErrorBoundary>
    );
}
