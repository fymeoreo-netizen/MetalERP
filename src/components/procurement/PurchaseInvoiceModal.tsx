import { DialogFooter } from "@/components/ui/dialog";
import { InvoiceModalShell, thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";
import { ModalErrorBoundary } from "@/components/error/ModalErrorBoundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ArrowDownToLine, X, Save, Calculator, Send, Trash2, CheckCircle2 } from "lucide-react";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useInventory } from "@/contexts/InventoryContext";
import { getPurchaseableItems, itemTracksUnitCount } from "@/lib/itemCatalog";
import { formatItemLabel } from "@/lib/inventoryStore";
import { getSuppliers, initPartyCatalog, isPartyCatalogHydrated, parseDocDate, subscribeParties } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { ItemCombobox, type ItemComboboxGroup } from "@/components/invoices/ItemCombobox";
import { InvoiceDateInput } from "@/components/invoices/InvoiceDateInput";
import { allocateNextPurchaseInvoiceNo } from "@/lib/documentNumbers";
import { fetchPurchaseInvoiceDocument } from "@/lib/api/purchaseInvoices";
import { fetchPendingRateItemsOrEmpty, fixPendingRateItems } from "@/lib/api/ratePending";
import type { DocActionResult } from "@/lib/api/types";
import { sumFixedLineAmounts, mapLineFromDb, type PendingRateItemRow, type RateStatus } from "@/lib/ratePending";
import { useRatePendingLines } from "@/hooks/useRatePendingLines";
import { RateStatusCell } from "@/components/shared/RateStatusCell";
import { collectInvoiceFormIssues } from "@/lib/invoiceFormValidation";
import { issuesForAction } from "@/lib/formValidation";
import { FormValidationPanel } from "@/components/invoices/InvoiceFormValidationAlerts";
import { useFormValidationGate } from "@/hooks/useFormValidationGate";
import { ConfirmInvoiceDeleteDialog } from "@/components/invoices/ConfirmInvoiceDeleteDialog";
import { validateLinkedInvoiceLines } from "@/lib/orderLinkValidation";
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
import { useToast } from "@/components/ui/use-toast";
import { runInvoiceDocAction } from "@/lib/docActionRunner";
import { agentDebugLog } from "@/lib/agentDebugLog";
import {
    isWire8ItemCode,
    parseWire8Grade,
    WIRE8_GRADE_OPTIONS,
    type Wire8Grade,
} from "@/lib/productionWire8Settings";
import { PremiumScrapPurchasePanel, type PremiumAllocationPayload } from "@/components/procurement/PremiumScrapPurchasePanel";
import { resolveWatta } from "@/lib/api/scrap";
import {
    InvoiceSplitLayout,
    InvoiceFormScroll,
    InvoiceLinesColumn,
    FormBlock,
    FieldGroup,
    ModeToggle,
    LineItemsPanel,
    InvoiceTotalsPanel,
    AlertBanner,
    AddLineBar,
    formatInvoicePhysicalSummary,
    invoiceInputClass,
    sumInvoicePhysicalTotals,
} from "@/components/invoices/InvoiceFormLayout";

/** Scrap-type raw materials need gross/tare/net; wire & rod items are weighed net directly. */
function getItemKind(item?: { itemType?: string; name?: string } | null): "scrap" | "wire_rod" {
    if (!item) return "wire_rod";
    if (item.itemType === "Scrap" || item.itemType === "Scrap Feed" || /scrap/i.test(item.name ?? "")) {
        return "scrap";
    }
    return "wire_rod";
}

function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}

interface PurchaseInvoiceModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaveDraft: (data: any) => DocActionResult | Promise<DocActionResult>;
    onPost: (data: any) => DocActionResult | Promise<DocActionResult>;
    onDelete?: (id: string) => boolean | void | Promise<boolean | void>;
    pendingPOs?: any[];
    editInvoiceDbId?: string | null;
}

export function PurchaseInvoiceModal({
    open,
    onOpenChange,
    onSaveDraft,
    onPost,
    onDelete,
    pendingPOs = [],
    editInvoiceDbId = null,
}: PurchaseInvoiceModalProps) {
    const { toast } = useToast();
    const { getBalance, catalog } = useInventory();
    const catalogItems = useMemo(() => getPurchaseableItems(), [catalog]);
    const purchaseItemGroups = useMemo<ItemComboboxGroup[]>(() => {
        const groups = new Map<string, ItemComboboxGroup["items"]>();
        for (const item of catalogItems) {
            const label = item.itemType || "Items";
            const items = groups.get(label) ?? [];
            items.push(item);
            groups.set(label, items);
        }
        return Array.from(groups, ([label, items]) => ({ label, items }));
    }, [catalogItems]);
    const [, forcePartyRefresh] = useState(0);
    const suppliers = getSuppliers();
    const supplierOptions = useMemo(() => toPartyComboboxOptions(suppliers), [suppliers]);

    const [date, setDate] = useState<Date | undefined>(new Date());
    const [invoiceId, setInvoiceId] = useState("");
    const [dbId, setDbId] = useState<string | null>(null);
    const [readOnly, setReadOnly] = useState(false);
    const [isPosted, setIsPosted] = useState(false);
    const [justPosted, setJustPosted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [supplier, setSupplier] = useState("");
    const [purchaseMode, setPurchaseMode] = useState<"cash" | "premium">("cash");
    const [warehouse, setWarehouse] = useState("raw_material");
    const [settlementMode, setSettlementMode] = useState("Standard Intake");
    const [finalMarketRate, setFinalMarketRate] = useState("");
    const [selectedPendingBatchId, setSelectedPendingBatchId] = useState("");
    const [pendingBatches, setPendingBatches] = useState<PendingRateItemRow[]>([]);
    const [pendingRateConfirmOpen, setPendingRateConfirmOpen] = useState(false);
    const [linkedPOId, setLinkedPOId] = useState<string | null>(null);
    const [showPullModal, setShowPullModal] = useState(false);
    const [vehicleNo, setVehicleNo] = useState("");
    const [driverName, setDriverName] = useState("");
    const [remarks, setRemarks] = useState("");
    const [lines, setLines] = useState<any[]>([]);
    const itemSelectRef = useRef<HTMLButtonElement>(null);
    const invoiceNoPromiseRef = useRef<Promise<string> | null>(null);

    const [currentItem, setCurrentItem] = useState("");
    const [currentQuantity, setCurrentQuantity] = useState("");
    const [currentUnit, setCurrentUnit] = useState("kg");
    const [currentGross, setCurrentGross] = useState("");
    const [currentTare, setCurrentTare] = useState("");
    const [currentNetWeight, setCurrentNetWeight] = useState("");
    const [currentRate, setCurrentRate] = useState("");
    const [currentWire8Grade, setCurrentWire8Grade] = useState<Wire8Grade>("Fail");
    const [editingLineId, setEditingLineId] = useState<string | null>(null);
    const [laborCost, setLaborCost] = useState(0);
    const [additionalCosts, setAdditionalCosts] = useState(0);
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [rateWarningOpen, setRateWarningOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<"draft" | "post" | null>(null);
    const { attemptedAction, markAttempted, resetValidation, showValidation } = useFormValidationGate();
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [premiumAllocation, setPremiumAllocation] = useState<PremiumAllocationPayload | null>(null);
    const [premiumAllocError, setPremiumAllocError] = useState<string | null>(null);
    const [premiumAllocWarning, setPremiumAllocWarning] = useState<string | null>(null);
    const premiumSplitIdCacheRef = useRef(new Map<string, string>());
    // Premium auto-rate: rate = firstLotRate (cheapest selected scrap lot) + watta.
    const [firstLotRate, setFirstLotRate] = useState<number | null>(null);
    const [currentWattaRate, setCurrentWattaRate] = useState(0);
    const [rateUserEdited, setRateUserEdited] = useState(false);

    const getPremiumSplitLineId = useCallback(
        (
            sourceLineId: string,
            idx: number,
            seg: { scrapRate: number; allocatedKg: number; scrapLotId?: string },
        ) => {
            const key = `${sourceLineId}::${idx}::${seg.scrapRate}::${seg.allocatedKg}::${seg.scrapLotId ?? ""}`;
            const cached = premiumSplitIdCacheRef.current.get(key);
            if (cached) return cached;
            const id = crypto.randomUUID();
            premiumSplitIdCacheRef.current.set(key, id);
            return id;
        },
        [],
    );

    const resolveSourceLineId = useCallback((line: { id: string; premiumSourceLineId?: string }) => {
        return line.premiumSourceLineId ?? line.id;
    }, []);

    const resetForm = useCallback(() => {
        setDbId(null);
        setReadOnly(false);
        setIsPosted(false);
        setJustPosted(false);
        setInvoiceId("");
        invoiceNoPromiseRef.current = null;
        setDate(new Date());
        setSupplier("");
        setPurchaseMode("cash");
        setWarehouse("raw_material");
        setSettlementMode("Standard Intake");
        setFinalMarketRate("");
        setSelectedPendingBatchId("");
        setLinkedPOId(null);
        setVehicleNo("");
        setDriverName("");
        setRemarks("");
        setPremiumAllocation(null);
        setPremiumAllocError(null);
        setPremiumAllocWarning(null);
        premiumSplitIdCacheRef.current.clear();
        setLines([]);
        setCurrentItem("");
        setCurrentQuantity("");
        setCurrentGross("");
        setCurrentTare("");
        setCurrentNetWeight("");
        setCurrentRate("");
        setCurrentWire8Grade("Fail");
        setEditingLineId(null);
        setLaborCost(0);
        setAdditionalCosts(0);
        resetValidation();
    }, [resetValidation]);

    const startNewInvoice = useCallback(() => {
        resetForm();
        const numberPromise = allocateNextPurchaseInvoiceNo();
        invoiceNoPromiseRef.current = numberPromise;
        void numberPromise.then(setInvoiceId);
    }, [resetForm]);

    const loadEditInvoice = useCallback(async (id: string) => {
        setLoading(true);
        try {
            const doc = await fetchPurchaseInvoiceDocument(id);
            if (!doc) return;
            setReadOnly(false);
            setIsPosted(doc.posting_status === "posted");
            setDbId(doc.id);
        setInvoiceId(doc.invoice_no);
            setDate(parseDocDate(doc.invoice_date));
        setSupplier(doc.parties?.code ?? "");
        setPurchaseMode(doc.purchase_mode === "premium" ? "premium" : "cash");
        setWarehouse(doc.warehouses?.wh_type ?? "raw_material");
        setSettlementMode(doc.settlement_mode ?? "Standard Intake");
        setRemarks(doc.remarks ?? "");
        setLaborCost(0);
        setAdditionalCosts(Number(doc.additional_charges ?? 0));

        const invLines = doc.purchase_invoice_lines ?? [];
        let linked: string | null = null;
        const mapped = invLines.map((l: any) => {
            const poLine = l.purchase_order_lines;
            const orderNo = poLine?.purchase_orders?.order_no ?? null;
            if (orderNo) linked = orderNo;
            const itemCode = l.items?.code ?? "";
            const qtyOrdered = Number(poLine?.qty_ordered ?? 0);
            const qtyReceived = Number(poLine?.qty_received ?? 0);
            return {
                id: l.id,
                itemCode,
                item: itemCode,
                itemName: l.items?.name ?? itemCode,
                quantity: Number(l.unit_count ?? 0),
                unit: "kg",
                gross: Number(l.gross_weight ?? 0),
                tare: Number(l.tare_weight ?? 0),
                netWeight: Number(l.net_weight ?? 0),
                ...mapLineFromDb(l),
                purchaseOrderLineId: l.purchase_order_line_id ?? undefined,
                orderItemCode: itemCode,
                orderRate: Number(poLine?.unit_price ?? l.unit_price ?? 0),
                orderedQty: poLine ? Math.max(0, qtyOrdered - qtyReceived) : undefined,
                wire8Grade: isWire8ItemCode(itemCode)
                    ? parseWire8Grade(l.wire8_grade ?? "Fail")
                    : undefined,
            };
        });
        setLinkedPOId(linked);
        setLines(mapped);
        } finally {
            setLoading(false);
        }
    }, []);

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

    useEffect(() => {
        if (!open || settlementMode !== "Settle Advance" || !supplier) {
            setPendingBatches([]);
            return;
        }
        void fetchPendingRateItemsOrEmpty({ partyCode: supplier, openOnly: true }).then(setPendingBatches);
    }, [open, settlementMode, supplier]);

    const isSettleAdvance = settlementMode === "Settle Advance";
    const currentItemDetails = useMemo(
        () => catalogItems.find((i) => i.code === currentItem),
        [catalogItems, currentItem],
    );
    const currentItemIsScrap = getItemKind(currentItemDetails) === "scrap";
    const showUnitField = currentItemDetails ? itemTracksUnitCount(currentItemDetails) : false;
    const currentNet = currentItemIsScrap
        ? Math.max(0, Number(currentGross) - Number(currentTare))
        : Math.max(0, Number(currentNetWeight) || 0);
    const currentWeightEntered = currentItemIsScrap
        ? Number(currentGross) > 0 || Number(currentTare) > 0
        : Number(currentNetWeight) > 0;
    const currentAmount = currentNet * Number(currentRate);
    const fixedLineAmount = (line: { rateStatus?: RateStatus; netWeight?: number; rate?: number; amount?: number }) =>
        line.rateStatus === "pending" ? 0 : Number(line.netWeight ?? 0) * Number(line.rate ?? 0);

    const selectedBatch = pendingBatches.find((b) => b.id === selectedPendingBatchId);
    const subtotal = isSettleAdvance
        ? (selectedBatch?.qty || 0) * Number(finalMarketRate)
        : lines.reduce((sum, line) => sum + fixedLineAmount(line), 0);
    const netPayable = subtotal + Number(laborCost) + Number(additionalCosts);

    const supplierPOs = pendingPOs.filter((o) => o.supplierId === supplier);
    const tracksUnitsForLine = (line: { itemCode?: string; item?: string }) => {
        const itemCode = line.itemCode ?? line.item ?? "";
        const item = catalogItems.find((candidate) => candidate.code === itemCode);
        return item ? itemTracksUnitCount(item) : false;
    };
    const physicalTotals = sumInvoicePhysicalTotals(lines, tracksUnitsForLine);

    const handlePullPO = (poId: string) => {
        const order = pendingPOs.find((o) => o.id === poId);
        if (!order) return;
        setLinkedPOId(poId);
        setLines(
            (order.items ?? [])
                .filter((item: any) => (item.qtyRemaining ?? item.qty) > 0)
                .map((item: any) => ({
                    id: crypto.randomUUID(),
                    itemCode: item.itemCode ?? item.item ?? "",
                    item: item.itemCode ?? item.item ?? "",
                    itemName: item.item ?? item.itemCode ?? "",
                    quantity: 0,
                    unit: "kg",
                    gross: 0,
                    tare: 0,
                    netWeight: 0,
                    rate: item.rate ?? 0,
                    amount: 0,
                    orderedQty: item.qtyRemaining ?? item.qty,
                    purchaseOrderLineId: item.lineId,
                    orderItemCode: item.itemCode ?? item.item ?? "",
                    orderRate: item.rate ?? 0,
                }))
        );
        const firstOpen = (order.items ?? []).find((item: any) => (item.qtyRemaining ?? item.qty) > 0);
        if (firstOpen) {
            setCurrentItem(firstOpen.itemCode ?? firstOpen.item ?? "");
            setCurrentRate(String(firstOpen.rate ?? ""));
            setCurrentGross("");
            setCurrentTare("");
            setCurrentNetWeight("");
        }
        setShowPullModal(false);
    };

    const focusLinkedLine = (line: (typeof lines)[number]) => {
        if (readOnly) return;
        setCurrentItem(line.itemCode ?? line.item ?? "");
        setCurrentRate(String(line.rate ?? line.orderRate ?? ""));
        setCurrentGross("");
        setCurrentTare("");
        setCurrentNetWeight("");
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const currentItemIsWire8 = isWire8ItemCode(currentItem);

    // Premium purchase auto-rate = cheapest selected scrap lot rate + watta.
    const autoPremiumRate = round3((firstLotRate ?? 0) + currentWattaRate);
    const premiumAutoRateAvailable = purchaseMode === "premium" && !isSettleAdvance && autoPremiumRate > 0;

    // Resolve watta (PKR/kg) for the current item + purity in premium purchase mode.
    useEffect(() => {
        if (purchaseMode !== "premium" || isSettleAdvance || !supplier || !currentItem || !currentItemIsWire8) {
            setCurrentWattaRate(0);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            void resolveWatta({
                partyCode: supplier,
                itemCode: currentItem,
                direction: "purchase",
                wire8Grade: currentWire8Grade,
            }).then((watta) => {
                if (!cancelled) setCurrentWattaRate(watta ?? 0);
            });
        }, 150);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [purchaseMode, isSettleAdvance, supplier, currentItem, currentItemIsWire8, currentWire8Grade]);

    // A new line context (item / purity / mode change) should re-auto-fill the rate.
    useEffect(() => {
        setRateUserEdited(false);
    }, [currentItem, currentWire8Grade, purchaseMode]);

    // Auto-fill the rate field in premium mode unless the user edited it manually.
    useEffect(() => {
        if (purchaseMode !== "premium" || isSettleAdvance || rateUserEdited) return;
        if (!currentItem) return;
        setCurrentRate(autoPremiumRate > 0 ? String(autoPremiumRate) : "");
    }, [autoPremiumRate, purchaseMode, isSettleAdvance, rateUserEdited, currentItem]);

    /** Builds gross/tare/net for the line being entered, based on item kind (scrap vs wire/rod). */
    const buildCurrentWeightFields = () => {
        if (currentItemIsScrap) {
            const gross = Number(currentGross) || 0;
            const tare = Number(currentTare) || 0;
            return { gross, tare, netWeight: Math.max(0, gross - tare) };
        }
        const net = Math.max(0, Number(currentNetWeight) || 0);
        return { gross: net, tare: 0, netWeight: net };
    };

    const commitCurrentLine = (rateStatus: RateStatus, rateOverride?: number) => {
        if (!currentItem || currentNet <= 0) return;
        const weight = buildCurrentWeightFields();
        const itemDetails = catalogItems.find((i) => i.code === currentItem);
        const wire8Grade = currentItemIsWire8 ? currentWire8Grade : undefined;
        const rate = rateStatus === "pending" ? 0 : (rateOverride ?? Number(currentRate));
        const amount = rateStatus === "pending" ? 0 : weight.netWeight * rate;

        const updatedLine = {
            id: editingLineId ?? crypto.randomUUID(),
            itemCode: currentItem,
            item: currentItem,
            itemName: itemDetails ? formatItemLabel(itemDetails) : currentItem,
            quantity: Number(currentQuantity),
            unit: currentUnit,
            ...weight,
            rate,
            amount,
            rateStatus,
            wire8Grade,
        };

        if (editingLineId) {
            if (linkedPOId) {
                const validation = validateLinkedInvoiceLines([updatedLine], linkedPOId);
                if (!validation.ok) {
                    toast({ title: "Cannot update line", description: validation.errors[0], variant: "destructive" });
                    return;
                }
            }
            setLines((prev) => prev.map((l) => (l.id === editingLineId ? updatedLine : l)));
            setEditingLineId(null);
        } else {
        const existingIdx = lines.findIndex(
            (l) => l.purchaseOrderLineId && l.itemCode === currentItem && Number(l.netWeight) === 0
        );
        if (existingIdx >= 0) {
            const candidate = {
                ...lines[existingIdx],
                ...weight,
                quantity: Number(currentQuantity) || 0,
                rate,
                amount,
                rateStatus,
                wire8Grade,
            };
            const validation = validateLinkedInvoiceLines([candidate], linkedPOId);
            if (!validation.ok) {
                toast({ title: "Cannot add line", description: validation.errors[0], variant: "destructive" });
                return;
            }
            const updated = [...lines];
            updated[existingIdx] = candidate;
            setLines(updated);
        } else {
        const newLine = updatedLine;
            if (linkedPOId) {
                const validation = validateLinkedInvoiceLines([newLine], linkedPOId);
                if (!validation.ok) {
                    toast({ title: "Cannot add line", description: validation.errors[0], variant: "destructive" });
                    return;
                }
            }
        setLines([...lines, newLine]);
        }
        }
        setCurrentGross("");
        setCurrentQuantity("");
        setCurrentTare("");
        setCurrentNetWeight("");
        setCurrentRate("");
        setRateUserEdited(false);
        setEditingLineId(null);
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    /** Rate given → add as fixed. Premium mode auto-rates (scrap + watta) instead of pending. */
    const attemptAddLine = () => {
        if (!currentItem || currentNet <= 0) return;
        if (Number(currentRate) > 0) {
            commitCurrentLine("fixed");
            return;
        }
        if (premiumAutoRateAvailable) {
            setCurrentRate(String(autoPremiumRate));
            commitCurrentLine("fixed", autoPremiumRate);
            return;
        }
        setPendingRateConfirmOpen(true);
    };

    const handleEditLine = (id: string) => {
        const line = lines.find((l) => l.id === id);
        if (!line) return;
        setCurrentItem(line.itemCode ?? line.item ?? "");
        setCurrentQuantity(line.quantity ? String(line.quantity) : "");
        setCurrentUnit(line.unit ?? "kg");
        const itemDetails = catalogItems.find((i) => i.code === (line.itemCode ?? line.item));
        if (getItemKind(itemDetails) === "scrap") {
            setCurrentGross(line.gross != null ? String(line.gross) : "");
            setCurrentTare(line.tare != null ? String(line.tare) : "");
            setCurrentNetWeight("");
        } else {
            setCurrentNetWeight(line.netWeight != null ? String(line.netWeight) : "");
            setCurrentGross("");
            setCurrentTare("");
        }
        setCurrentRate(line.rate ? String(line.rate) : "");
        if (line.wire8Grade) setCurrentWire8Grade(parseWire8Grade(line.wire8Grade));
        setEditingLineId(id);
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const buildPremiumSplitPayload = useCallback(() => {
        if (purchaseMode !== "premium" || !premiumAllocation?.segments?.length) {
            return { items: lines, allocation: premiumAllocation };
        }

        const nextItems: any[] = [];
        const nextSegments: PremiumAllocationPayload["segments"] = [];

        for (const line of lines) {
            const itemCode = line.itemCode ?? line.item ?? "";
            const lineSegments = premiumAllocation.segments.filter((s) => s.lineKey === line.id);
            if (!isWire8ItemCode(itemCode) || lineSegments.length === 0) {
                nextItems.push(line);
                continue;
            }

            for (let idx = 0; idx < lineSegments.length; idx++) {
                const seg = lineSegments[idx];
                if (Number(seg.allocatedKg ?? 0) <= 0) continue;
                const splitId = getPremiumSplitLineId(line.id, idx, seg);
                const suffix = seg.isMazdooriPending
                    ? " (Mazdoori pending)"
                    : ` (${seg.scrapRate.toLocaleString()} + ${seg.wattaRate.toLocaleString()})`;
                nextItems.push({
                    ...line,
                    id: splitId,
                    premiumSourceLineId: line.id,
                    quantity: Number(seg.allocatedKg),
                    gross: Number(seg.allocatedKg),
                    tare: 0,
                    netWeight: Number(seg.allocatedKg),
                    rate: Number(seg.derivedUnitRate),
                    amount: Number(seg.allocatedKg) * Number(seg.derivedUnitRate),
                    rateStatus: "fixed",
                    itemName: `${line.itemName ?? line.itemCode ?? line.item}${suffix}`,
                });
                nextSegments.push({
                    ...seg,
                    lineKey: splitId,
                });
            }
        }

        return {
            items: nextItems,
            allocation: {
                ...premiumAllocation,
                segments: nextSegments,
            },
        };
    }, [purchaseMode, premiumAllocation, lines, getPremiumSplitLineId]);

    const splitPreview = useMemo(() => buildPremiumSplitPayload(), [buildPremiumSplitPayload]);

    const getPayload = (overrideInvoiceNo?: string) => {
        return {
            dbId,
            header: {
                invoiceId: overrideInvoiceNo ?? invoiceId,
                date,
                supplier,
                warehouse,
                settlementMode,
                finalMarketRate,
                selectedPendingBatchId,
                vehicleNo,
                driverName,
                remarks,
                linkedPOId,
                purchaseMode,
                postingStatus: isPosted ? "posted" : "draft",
            },
            items: splitPreview.items,
            totals: { subtotal, laborCost, additionalCosts, netPayable },
            premiumAllocation: splitPreview.allocation,
        };
    };

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
        setLoading(true);
        try {
            if (isSettleAdvance && action === "post") {
                if (!selectedPendingBatchId || !finalMarketRate) {
                    toast({ title: "Select batch and rate", variant: "destructive" });
                    return;
                }
                const result = await fixPendingRateItems([
                    { pendingItemId: selectedPendingBatchId, unitRate: Number(finalMarketRate) },
                ]);
                if (!result.ok) {
                    toast({ title: "Settlement failed", description: result.error, variant: "destructive" });
                    return;
                }
                toast({ title: "Advance settled", description: "Rate fixed and posted to ledger." });
        onOpenChange(false);
                resetForm();
                return;
            }
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
                location: "PurchaseInvoiceModal",
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
        } finally {
            setLoading(false);
        }
    };

    const draftIssues = useMemo(
        () =>
            collectInvoiceFormIssues({
                partyId: supplier,
                partyLabel: "Supplier",
                lines,
                linkedOrderId: linkedPOId,
                forPost: false,
                skipLineChecks: isSettleAdvance,
            }),
        [supplier, lines, linkedPOId, isSettleAdvance],
    );

    const postIssues = useMemo(() => {
        const base = collectInvoiceFormIssues({
            partyId: supplier,
            partyLabel: "Supplier",
            lines,
            linkedOrderId: linkedPOId,
            forPost: true,
            skipLineChecks: isSettleAdvance,
        });
        if (isSettleAdvance || purchaseMode !== "premium") return base;
        if (premiumAllocError) {
            return { ...base, errors: [...base.errors, premiumAllocError] };
        }
        const missingPurity = lines.filter(
            (l) =>
                Number(l.netWeight) > 0 &&
                isWire8ItemCode(l.itemCode ?? l.item ?? "") &&
                !l.wire8Grade,
        );
        if (missingPurity.length === 0) {
            if (premiumAllocWarning) {
                return { ...base, warnings: [...base.warnings, premiumAllocWarning] };
            }
            return base;
        }
        return {
            ...base,
            errors: [
                ...base.errors,
                "Premium wire lines require a purity tag (Fail, Pass, or Special).",
            ],
        };
    }, [supplier, lines, linkedPOId, isSettleAdvance, purchaseMode, premiumAllocError, premiumAllocWarning]);

    const displayIssues = useMemo(() => {
        if (!showValidation || !attemptedAction) {
            return { errors: [] as string[], warnings: [] as string[] };
        }
        return issuesForAction(attemptedAction, draftIssues, postIssues);
    }, [showValidation, attemptedAction, draftIssues, postIssues]);

    const activeIssues = pendingAction === "post" ? postIssues : draftIssues;

    const entryHint =
        !isSettleAdvance && currentWeightEntered && !currentItem
            ? "Select an item before entering weight."
            : !isSettleAdvance && currentItem && !currentWeightEntered
              ? currentItemIsScrap
                  ? "Enter gross and tare weight for the selected item."
                  : "Enter net weight for the selected item."
              : null;

    const handleAction = (action: "draft" | "post") => {
        if (!isSettleAdvance && lines.length === 0 && action === "draft") {
            toast({ title: "Add at least one line", description: "Cannot save a draft with no lines.", variant: "destructive" });
            return;
        }

        markAttempted(action);

        const issues = issuesForAction(action, draftIssues, postIssues);
        if (issues.errors.length > 0) {
            toast({ title: "Cannot save invoice", description: issues.errors[0], variant: "destructive" });
            return;
        }
        if (action === "post" && issues.warnings.length > 0) {
            agentDebugLog("PurchaseInvoiceModal:handleAction", "rate warning dialog", {
                warningCount: issues.warnings.length,
            });
            setPendingAction(action);
            setRateWarningOpen(true);
            toast({
                title: "Confirm rates to post",
                description: "Invoice rate differs from the linked PO — confirm in the dialog.",
            });
            return;
        }
        void runAction(action);
    };

    const confirmDelete = async () => {
        if (!dbId || !onDelete) return;
        setDeleteLoading(true);
        try {
            const result = await onDelete(dbId);
            if (result === false) return;
            onOpenChange(false);
            resetForm();
        } finally {
            setDeleteLoading(false);
        }
    };

    const modalTitle = readOnly
        ? "View purchase invoice"
        : editInvoiceDbId
          ? "Edit purchase invoice"
          : "Purchase invoice";

    const linesPanelContent = isSettleAdvance ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center px-6 rounded-xl border border-dashed border-amber-200/80 bg-amber-50/30">
            <Calculator className="h-8 w-8 text-amber-400/80 mb-3 stroke-[1.25]" />
            <p className="text-sm font-medium text-amber-900">Advance settlement</p>
            <p className="text-[11px] text-amber-700/80 mt-1 max-w-[220px] leading-relaxed">
                Line items are disabled. Settlement is calculated from the selected batch and market rate.
            </p>
            {selectedBatch && finalMarketRate && (
                <div className="mt-5 w-full max-w-xs rounded-lg bg-white px-4 py-3 ring-1 ring-amber-200/50 text-left">
                    <p className="text-[11px] text-zinc-500">{selectedBatch.sourceDocNo} · {selectedBatch.itemName}</p>
                    <p className="text-sm font-medium text-zinc-900 mt-1 tabular-nums">
                        {selectedBatch.qty.toLocaleString()} kg × ₨ {Number(finalMarketRate).toLocaleString()}
                    </p>
                    <p className="text-lg font-semibold text-zinc-900 mt-2 tabular-nums">
                        ₨ {(selectedBatch.qty * Number(finalMarketRate)).toLocaleString()}
                    </p>
                </div>
            )}
        </div>
    ) : (
        <LineItemsPanel
            lines={purchaseMode === "premium" ? splitPreview.items : lines}
            emptyMessage="Add lines from the form on the left"
            onRemove={
                readOnly
                    ? undefined
                      : (id) => {
                          const sourceId = (splitPreview.items.find((x: any) => x.id === id)?.premiumSourceLineId ?? id) as string;
                          setLines((prev) => prev.filter((l) => l.id !== sourceId));
                          if (editingLineId === sourceId) setEditingLineId(null);
                      }
            }
            onEdit={
                readOnly
                    ? undefined
                    : (id) => {
                          const sourceId = (splitPreview.items.find((x: any) => x.id === id)?.premiumSourceLineId ?? id) as string;
                          handleEditLine(sourceId);
                      }
            }
            renderLine={(line: (typeof lines)[number]) => (
                <div className="flex justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="font-medium text-zinc-900 text-[13px] leading-snug truncate">
                            {line.itemName}
                            {isWire8ItemCode(line.itemCode ?? line.item ?? "") && line.wire8Grade && (
                                <span className="ml-1.5 text-[10px] font-normal text-violet-700">
                                    ({line.wire8Grade})
                                </span>
                            )}
                        </p>
                        {!readOnly &&
                        isWire8ItemCode(line.itemCode ?? line.item ?? "") &&
                        Number(line.netWeight) > 0 ? (
                            <Select
                                value={line.wire8Grade ?? "Fail"}
                                onValueChange={(v) => {
                                    const sourceLineId = resolveSourceLineId(line);
                                    setLines((prev) =>
                                        prev.map((l) =>
                                            l.id === sourceLineId ? { ...l, wire8Grade: v as Wire8Grade } : l,
                                        ),
                                    );
                                }}
                            >
                                <SelectTrigger className="h-7 mt-1 w-28 text-[11px]">
                                    <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                    {WIRE8_GRADE_OPTIONS.map((g) => (
                                        <SelectItem key={g} value={g}>
                                            {g}
                                        </SelectItem>
                                    ))}
                                        </SelectContent>
                                    </Select>
                        ) : null}
                        {line.purchaseOrderLineId && line.orderedQty != null && (
                            <p className="text-[10px] text-blue-600 mt-0.5">Open on PO: {line.orderedQty.toLocaleString()} kg</p>
                        )}
                        {line.purchaseOrderLineId && Number(line.netWeight) === 0 && !readOnly ? (
                            <button
                                type="button"
                                onClick={() => focusLinkedLine(line)}
                                className={cn(
                                    "text-[10px] mt-0.5 text-left hover:underline",
                                    currentItem === (line.itemCode ?? line.item) ? "text-amber-700 font-medium" : "text-amber-600"
                                )}
                            >
                                {currentItem === (line.itemCode ?? line.item) ? "Selected — enter weight on the left" : "Pending — click to select"}
                            </button>
                        ) : (
                            <p className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                                {line.quantity && tracksUnitsForLine(line) ? `${line.quantity} units · ` : ""}
                                {line.gross} − {line.tare} →{" "}
                                <span className="text-zinc-700">{line.netWeight} kg</span>
                                {line.rateStatus !== "pending" && (
                                    <>
                                        {" · "}₨ {line.rate}
                                    </>
                                )}
                            </p>
                                    )}
                                </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                        {!readOnly && (
                            <RateStatusCell
                                compact
                                value={(line.rateStatus ?? "fixed") as RateStatus}
                                onChange={(status) => {
                                    const sourceLineId = resolveSourceLineId(line);
                                    setLines((prev) =>
                                        prev.map((l) =>
                                            l.id === sourceLineId
                                                ? {
                                                      ...l,
                                                      rateStatus: status,
                                                      rate: status === "pending" ? 0 : l.rate,
                                                      amount:
                                                          status === "pending"
                                                              ? 0
                                                              : Number(l.netWeight) * Number(l.rate),
                                                  }
                                                : l,
                                        ),
                                    );
                                }}
                            />
                        )}
                        <p className="text-[13px] font-semibold tabular-nums text-slate-900">
                            {line.rateStatus === "pending" ? "—" : `₨ ${fixedLineAmount(line).toLocaleString()}`}
                        </p>
                                        </div>
                                    </div>
                                )}
        />
    );

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
                        : "Inward supply & stock in"
            }
            headerEnd={
                                        <div className="flex items-center gap-2">
                    {!readOnly && (
                        <ModeToggle
                            value={settlementMode}
                            onChange={setSettlementMode}
                            className="w-auto min-w-[180px]"
                            options={[
                                { value: "Standard Intake", label: "Standard" },
                                { value: "Settle Advance", label: "Suda" },
                            ]}
                        />
                    )}
                    <span className="font-mono text-xs text-zinc-400 tabular-nums hidden sm:inline">
                        {invoiceId}
                    </span>
                                                            </div>
            }
            footer={
                <DialogFooter className="shrink-0 px-6 py-3.5 border-t border-zinc-200/60 bg-white gap-2 sm:justify-end rounded-none">
                    {justPosted ? (
                        <>
                            <span className="mr-auto text-sm font-medium text-emerald-700 inline-flex items-center gap-1.5">
                                <CheckCircle2 className="h-4 w-4" />
                                Invoice {invoiceId} posted · Stock updated
                            </span>
                            <Button variant="outline" size="sm" onClick={() => resetForm()}>
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
                    ) : readOnly ? (
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
                                    disabled={(!isSettleAdvance && lines.length === 0) || loading}
                                    className="min-w-[128px] rounded-lg bg-zinc-900 hover:bg-zinc-800"
                                >
                                    <Save className="h-3.5 w-3.5 mr-1.5" />
                                    Save changes
                                </Button>
                            ) : (
                                <>
                                    {!isSettleAdvance && (
                                        <Button variant="outline" size="sm" onClick={() => handleAction("draft")} disabled={lines.length === 0 || loading}>
                                            <Save className="h-3.5 w-3.5 mr-1.5" />
                                            Save draft
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        onClick={() => handleAction("post")}
                                        disabled={(!isSettleAdvance && lines.length === 0) || loading}
                                        className="min-w-[128px] rounded-lg bg-zinc-900 hover:bg-zinc-800"
                                    >
                                        {isSettleAdvance ? <Save className="h-3.5 w-3.5 mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                                        {isSettleAdvance ? "Post settlement" : "Post invoice"}
                                    </Button>
                                </>
                            )}
                        </>
                    )}
                </DialogFooter>
            }
        >
                <InvoiceSplitLayout
                    formWidthClassName="w-full lg:w-[40%] lg:min-w-[380px] lg:max-w-[560px]"
                    form={
                        <InvoiceFormScroll className={cn(readOnly && "pointer-events-none opacity-80")}>
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
                            <FormBlock label="Supplier">
                                <div className="grid grid-cols-2 gap-3">
                                    <FieldGroup label="Supplier" className="col-span-2">
                                        <PartyCombobox
                                            value={supplier}
                                            onValueChange={setSupplier}
                                            options={supplierOptions}
                                            placeholder="Search supplier…"
                                            triggerClassName={cn(
                                                invoiceInputClass,
                                                isSettleAdvance && "ring-amber-300/60",
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
                                            ariaLabel="Purchase invoice date"
                                        />
                                    </FieldGroup>
                                    <FieldGroup label="Warehouse">
                                    <Select value={warehouse} onValueChange={setWarehouse}>
                                            <SelectTrigger className={invoiceInputClass}>
                                                <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                                <SelectItem value="finished_goods">Finished Goods</SelectItem>
                                                <SelectItem value="raw_material">Raw Material</SelectItem>
                                                <SelectItem value="packing_material">Packing Material</SelectItem>
                                                <SelectItem value="varnish">Varnish</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    </FieldGroup>
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

                                {!isSettleAdvance && (
                                    <FieldGroup label="Purchase mode">
                                        <ModeToggle
                                            value={purchaseMode}
                                            onChange={setPurchaseMode}
                                            options={[
                                                { value: "cash", label: "Cash" },
                                                { value: "premium", label: "Premium" },
                                            ]}
                                        />
                                    </FieldGroup>
                                )}

                                {isSettleAdvance && supplier === "sup-002" && (
                                    <AlertBanner variant="warning">
                                        Unallocated weight pending settlement
                                    </AlertBanner>
                                )}
                                {supplier && supplierPOs.length > 0 && !linkedPOId && !isSettleAdvance && (
                                    <AlertBanner
                                        variant="info"
                                        action={
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-6 px-2 text-[10px]"
                                                onClick={() => setShowPullModal(true)}
                                            >
                                                <ArrowDownToLine className="h-3 w-3 mr-1" />
                                                Pull
                                            </Button>
                                        }
                                    >
                                        {supplierPOs.length} open PO(s)
                                    </AlertBanner>
                                )}
                                {linkedPOId && (
                                    <AlertBanner
                                        variant="success"
                                        action={
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-6 px-2 text-[10px]"
                                                onClick={() => setLinkedPOId(null)}
                                            >
                                                Unlink
                                            </Button>
                                        }
                                    >
                                        Linked · {linkedPOId}
                                    </AlertBanner>
                                )}
                            </FormBlock>

                            {isSettleAdvance ? (
                                <FormBlock label="Settlement">
                                    <div className="space-y-3">
                                        <FieldGroup label="Pending batch">
                                            <Select
                                                value={selectedPendingBatchId}
                                                onValueChange={setSelectedPendingBatchId}
                                            >
                                                <SelectTrigger className={cn(invoiceInputClass, "ring-amber-200/80")}>
                                                    <SelectValue placeholder="Select batch" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                    {pendingBatches.map((stock) => (
                                                    <SelectItem key={stock.id} value={stock.id}>
                                                            {stock.sourceDocNo} — {stock.itemName ?? "Item"} ({stock.qty} kg)
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        </FieldGroup>
                                        <FieldGroup label="Market rate (PKR)">
                                        <Input 
                                            type="number" 
                                                className={cn(invoiceInputClass, "font-mono ring-amber-200/80")}
                                            value={finalMarketRate} 
                                            onChange={(e) => setFinalMarketRate(e.target.value)} 
                                                placeholder="2900"
                                        />
                                        </FieldGroup>
                                    </div>
                                </FormBlock>
                            ) : (
                                <FormBlock label={linkedPOId ? "Add weight from PO" : "New line"}>
                                    <div className="space-y-3">
                                        {linkedPOId && currentItem && lines.some((l) => l.purchaseOrderLineId && (l.itemCode ?? l.item) === currentItem && Number(l.netWeight) === 0) && (
                                            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-md px-2.5 py-2 ring-1 ring-amber-200/80">
                                                Enter the weight below, then Add line to fulfill the selected PO item.
                                            </p>
                                        )}
                                        <FieldGroup
                                            label="Item"
                                            hint={
                                                currentItem
                                                    ? `${getBalance(currentItem).toLocaleString()} in stock`
                                                    : undefined
                                            }
                                        >
                                            <ItemCombobox
                                                ref={itemSelectRef}
                                                value={currentItem}
                                                onSelect={(code) => {
                                                    setCurrentItem(code);
                                                    if (isWire8ItemCode(code)) setCurrentWire8Grade("Fail");
                                                }}
                                                groups={purchaseItemGroups}
                                                placeholder="Search item..."
                                                searchPlaceholder="Type item name or code..."
                                                className={invoiceInputClass}
                                                disabled={readOnly}
                                            />
                                        </FieldGroup>
                                        {currentItemIsWire8 && (
                                            <FieldGroup label="Purity" hint="Used for watta / mazdoori on premium purchases">
                                                <Select
                                                    value={currentWire8Grade}
                                                    onValueChange={(v) => setCurrentWire8Grade(v as Wire8Grade)}
                                                >
                                                    <SelectTrigger className={invoiceInputClass}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                                        {WIRE8_GRADE_OPTIONS.map((g) => (
                                                            <SelectItem key={g} value={g}>
                                                                {g}
                                                            </SelectItem>
                                                        ))}
                                        </SelectContent>
                                    </Select>
                                            </FieldGroup>
                                        )}
                                        {showUnitField ? (
                                            <FieldGroup label="Units">
                                        <Input
                                            type="number"
                                                    className={invoiceInputClass}
                                                    value={currentQuantity}
                                                    onChange={(e) => setCurrentQuantity(e.target.value)}
                                                />
                                            </FieldGroup>
                                        ) : null}
                                        {currentItemIsScrap ? (
                                            <div className="grid grid-cols-3 gap-2">
                                                <FieldGroup label="Gross">
                                                    <Input
                                                        type="number"
                                                        className={invoiceInputClass}
                                            value={currentGross}
                                            onChange={(e) => setCurrentGross(e.target.value)}
                                                    />
                                                </FieldGroup>
                                                <FieldGroup label="Tare">
                                    <Input
                                        type="number"
                                                        className={invoiceInputClass}
                                        value={currentTare}
                                        onChange={(e) => setCurrentTare(e.target.value)}
                                                    />
                                                </FieldGroup>
                                                <FieldGroup label="Net">
                                                    <Input
                                                        readOnly
                                                        tabIndex={-1}
                                                        className={cn(invoiceInputClass, "bg-zinc-50 text-zinc-500 cursor-default")}
                                                        value={currentNet ? currentNet.toFixed(2) : ""}
                                        placeholder="0.00"
                                    />
                                                </FieldGroup>
                                </div>
                                        ) : (
                                            <FieldGroup label="Net weight">
                                <Input
                                    type="number"
                                                    className={invoiceInputClass}
                                                    value={currentNetWeight}
                                                    onChange={(e) => setCurrentNetWeight(e.target.value)}
                                    placeholder="0.00"
                                                />
                                            </FieldGroup>
                                        )}
                                        <FieldGroup
                                            label="Rate"
                                            hint={
                                                purchaseMode === "premium" && !isSettleAdvance
                                                    ? autoPremiumRate > 0
                                                        ? `Auto: ${firstLotRate ?? 0} + ${currentWattaRate} = ${autoPremiumRate}`
                                                        : "Blank → sent to Rate Pending"
                                                    : Number(currentRate) <= 0
                                                      ? "Blank → sent to Rate Pending"
                                                      : undefined
                                            }
                                        >
                                            <Input
                                                type="number"
                                                className={invoiceInputClass}
                                                value={currentRate}
                                                onChange={(e) => {
                                                    setCurrentRate(e.target.value);
                                                    setRateUserEdited(true);
                                                }}
                                                placeholder="Optional"
                                            />
                                        </FieldGroup>
                                        {purchaseMode === "premium" && supplier && !isSettleAdvance && (
                                            <PremiumScrapPurchasePanel
                                                supplierCode={supplier}
                                                lines={lines.map((l) => ({
                                                    id: l.id,
                                                    itemCode: l.itemCode ?? l.item,
                                                    itemName: l.itemName,
                                                    netWeight: Number(l.netWeight ?? 0),
                                                    wire8Grade: l.wire8Grade,
                                                }))}
                                                onAllocationChange={(payload, error, warning) => {
                                                    setPremiumAllocation(payload);
                                                    setPremiumAllocError(error ?? null);
                                                    setPremiumAllocWarning(warning ?? null);
                                                }}
                                                onFirstLotRate={setFirstLotRate}
                                            />
                                        )}
                                        {premiumAllocError && (
                                            <p className="text-xs text-rose-600">{premiumAllocError}</p>
                                        )}
                                        {premiumAllocWarning && !premiumAllocError && (
                                            <p className="text-xs text-amber-700">{premiumAllocWarning}</p>
                                        )}
                                        <AddLineBar
                                            netLabel={`${currentNet.toFixed(2)} ${currentUnit}`}
                                            amountLabel={`₨ ${currentAmount.toLocaleString()}`}
                                            onAdd={attemptAddLine}
                                            disabled={!currentItem || currentNet <= 0}
                                            buttonLabel={editingLineId ? "Update" : "Add"}
                                        />
                        </div>
                                </FormBlock>
                            )}

                            <FormBlock label="Notes">
                                        <Textarea
                                            value={remarks}
                                            onChange={(e) => setRemarks(e.target.value)}
                                    placeholder="Optional remarks"
                                    className="min-h-[72px] resize-none border-0 bg-zinc-100/80 ring-1 ring-zinc-200/70 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-zinc-400/40"
                                />
                            </FormBlock>
                        </InvoiceFormScroll>
                    }
                    lines={
                        <InvoiceLinesColumn
                            title={isSettleAdvance ? "Settlement" : "Invoice lines"}
                            subtitle={
                                isSettleAdvance
                                    ? selectedBatch
                                        ? `${selectedBatch.qty.toLocaleString()} kg · ${selectedBatch.itemName ?? selectedBatch.sourceDocNo}`
                                        : "Select batch on the left"
                                    : (purchaseMode === "premium" ? splitPreview.items.length : lines.length) > 0
                                      ? `${(purchaseMode === "premium" ? splitPreview.items.length : lines.length)} item${(purchaseMode === "premium" ? splitPreview.items.length : lines.length) !== 1 ? "s" : ""} · ${formatInvoicePhysicalSummary(physicalTotals)}`
                                      : "Items appear here as you add them"
                            }
                            badge={
                                !isSettleAdvance && (purchaseMode === "premium" ? splitPreview.items.length : lines.length) > 0 ? (
                                    <span className="text-[11px] font-medium tabular-nums text-zinc-500 bg-white px-2 py-1 rounded-md ring-1 ring-zinc-200/60">
                                        {purchaseMode === "premium" ? splitPreview.items.length : lines.length}
                                    </span>
                                ) : undefined
                            }
                            footer={
                                <InvoiceTotalsPanel
                                    totalLabel="Net payable"
                                    total={netPayable}
                                    physicalTotals={isSettleAdvance ? undefined : physicalTotals}
                                    rows={[
                                        { type: "amount", label: "Subtotal", amount: subtotal },
                                        {
                                            type: "input",
                                            label: "Labor",
                                            value: laborCost,
                                            onChange: setLaborCost,
                                        },
                                        {
                                            type: "input",
                                            label: "Additional",
                                            value: additionalCosts,
                                            onChange: setAdditionalCosts,
                                        },
                                    ]}
                                />
                            }
                        >
                            {linesPanelContent}
                        </InvoiceLinesColumn>
                    }
                />

                {showPullModal && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4"
                        onClick={() => setShowPullModal(false)}
                    >
                        <div
                            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden ring-1 ring-zinc-200/80"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100">
                                <h3 className="text-sm font-medium text-zinc-900">Pull from PO</h3>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowPullModal(false)}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                            <div className={cn("p-3 space-y-1.5 max-h-[50vh] overflow-y-auto", thinScrollbarClass)}>
                                {supplierPOs.map((o) => (
                                    <button
                                        key={o.id}
                                        type="button"
                                        className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-zinc-50 transition-colors"
                                        onClick={() => handlePullPO(o.id)}
                                    >
                                        <div className="flex justify-between text-xs">
                                            <span className="font-mono font-medium text-zinc-800">{o.id}</span>
                                            <span className="text-zinc-500 tabular-nums">
                                                {(
                                                    (o.total_ordered_qty || 0) -
                                                    (o.total_fulfilled_qty || 0)
                                                ).toLocaleString()}{" "}
                                                kg
                                        </span>
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
                variant={readOnly ? "posted" : "draft"}
                docLabel={invoiceId}
                loading={deleteLoading}
                onConfirm={confirmDelete}
            />

            <AlertDialog open={pendingRateConfirmOpen} onOpenChange={setPendingRateConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>No rate entered</AlertDialogTitle>
                        <AlertDialogDescription>
                            {purchaseMode === "premium" && !isSettleAdvance
                                ? "No scrap lot or watta matrix row was found to auto-calculate a rate. Add this line with the rate marked pending — it will show up in Rate Management for fixing later, and this line's amount will be ₨ 0 until then."
                                : "This line has no rate yet. Add it with the rate marked pending — it will show up in Rate Management for fixing later, and this line's amount will be ₨ 0 until then."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Go back</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setPendingRateConfirmOpen(false);
                                commitCurrentLine("pending");
                            }}
                        >
                            Add to rate pending
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={rateWarningOpen} onOpenChange={setRateWarningOpen}>
                <AlertDialogContent className="z-[10050]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Rate differs from purchase order</AlertDialogTitle>
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
        </>
        </ModalErrorBoundary>
    );
}
