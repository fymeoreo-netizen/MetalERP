import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Send, Trash2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useInventory } from "@/contexts/InventoryContext";
import { getPurchaseableItems } from "@/lib/itemCatalog";
import { formatItemLabel } from "@/lib/inventoryStore";
import { getSuppliers, initPartyCatalog, subscribeParties } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { allocateNextPurchaseReturnNo } from "@/lib/documentNumbers";
import { fetchPurchaseReturnDocument } from "@/lib/api/returns";
import { sumFixedLineAmounts, mapLineFromDb, type RateStatus } from "@/lib/ratePending";
import { useRatePendingLines } from "@/hooks/useRatePendingLines";
import { RateStatusCell } from "@/components/shared/RateStatusCell";
import { InvoiceModalShell } from "@/components/invoices/InvoiceModalShell";
import { InvoiceDateInput } from "@/components/invoices/InvoiceDateInput";
import {
    AddLineBar,
    FieldGroup,
    FormBlock,
    InvoiceFormScroll,
    InvoiceLinesColumn,
    InvoiceSplitLayout,
    InvoiceTotalsPanel,
    LineItemsPanel,
    ModeToggle,
    invoiceInputClass,
} from "@/components/invoices/InvoiceFormLayout";
import { FormValidationPanel } from "@/components/invoices/InvoiceFormValidationAlerts";
import { aggregateOutboundDemand, formatOutboundStockErrors, validateOutboundStock, type OutboundStockLine } from "@/lib/outboundStockValidation";
import { collectReturnFormIssues, issuesForAction } from "@/lib/formValidation";
import { useFormValidationGate } from "@/hooks/useFormValidationGate";
import { useToast } from "@/components/ui/use-toast";

interface PurchaseReturnModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaveDraft: (data: any) => boolean | void | Promise<boolean | void>;
    onPost: (data: any) => boolean | void | Promise<boolean | void>;
    onDelete?: (id: string) => boolean | void | Promise<boolean | void>;
    editReturnDbId?: string | null;
}

export function PurchaseReturnModal({
    open,
    onOpenChange,
    onSaveDraft,
    onPost,
    onDelete,
    editReturnDbId = null,
}: PurchaseReturnModalProps) {
    const { toast } = useToast();
    const { getBalance } = useInventory();
    const catalogItems = getPurchaseableItems();
    const suppliers = getSuppliers();
    const supplierOptions = useMemo(() => toPartyComboboxOptions(suppliers), [suppliers]);
    const [, forcePartyRefresh] = useState(0);

    const [returnId, setReturnId] = useState("");
    const [dbId, setDbId] = useState<string | null>(null);
    const [readOnly, setReadOnly] = useState(false);
    const [isPosted, setIsPosted] = useState(false);
    const [justPosted, setJustPosted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [supplierId, setSupplierId] = useState("");
    const [refInvoice, setRefInvoice] = useState("");
    const [returnAction, setReturnAction] = useState<"stock" | "financial">("stock");
    const [remarks, setRemarks] = useState("");
    const [lines, setLines] = useState<any[]>([]);
    const [baselineOutboundLines, setBaselineOutboundLines] = useState<OutboundStockLine[]>([]);
    const { fixedTotal, mapLineRateStatus } = useRatePendingLines();

    const itemSelectRef = useRef<HTMLButtonElement>(null);
    const returnNoPromiseRef = useRef<Promise<string> | null>(null);
    const [currentItem, setCurrentItem] = useState("");
    const [currentQuantity, setCurrentQuantity] = useState("");
    const [currentUnit, setCurrentUnit] = useState("kg");
    const [currentWeight, setCurrentWeight] = useState("");
    const [currentRate, setCurrentRate] = useState("");
    const [currentRateStatus, setCurrentRateStatus] = useState<RateStatus>("fixed");
    const [editingLineId, setEditingLineId] = useState<string | null>(null);
    const { attemptedAction, markAttempted, resetValidation, showValidation } = useFormValidationGate();

    const resetForm = useCallback(() => {
        setReturnId("");
        returnNoPromiseRef.current = null;
        setDbId(null);
        setReadOnly(false);
        setIsPosted(false);
        setJustPosted(false);
        setDate(new Date());
        setSupplierId("");
        setRefInvoice("");
        setReturnAction("stock");
        setRemarks("");
        setLines([]);
        setBaselineOutboundLines([]);
        setCurrentItem("");
        setCurrentQuantity("");
        setCurrentUnit("kg");
        setCurrentWeight("");
        setCurrentRate("");
        setCurrentRateStatus("fixed");
        setEditingLineId(null);
        resetValidation();
    }, [resetValidation]);

    const allocateReturnNo = useCallback(() => {
        const request = allocateNextPurchaseReturnNo().then((nextReturnNo) => {
            setReturnId(nextReturnNo);
            return nextReturnNo;
        });
        returnNoPromiseRef.current = request;
        return request;
    }, []);

    const startNewReturn = useCallback(() => {
        resetForm();
        return allocateReturnNo();
    }, [allocateReturnNo, resetForm]);

    const loadEditReturn = useCallback(async (id: string) => {
        setLoading(true);
        const doc = await fetchPurchaseReturnDocument(id);
        setLoading(false);
        if (!doc) return;
        returnNoPromiseRef.current = null;
        setReadOnly(false);
        setIsPosted(doc.posting_status === "posted");
        setDbId(doc.id);
        setReturnId(doc.return_no);
        setDate(doc.return_date ? new Date(doc.return_date) : new Date());
        setSupplierId(doc.parties?.code ?? "");
        setReturnAction(doc.return_action === "financial_only" ? "financial" : "stock");
        setRemarks(doc.remarks ?? "");
        const mapped = (doc.purchase_return_lines ?? []).map((l: any) => ({
                id: l.id,
                itemCode: l.items?.code ?? "",
                item: l.items?.code ?? "",
                itemName: l.items?.name ?? l.items?.code ?? "",
                quantity: 0,
                unit: "kg",
                netWeight: Number(l.qty ?? 0),
                weight: Number(l.qty ?? 0),
                ...mapLineFromDb(l),
        }));
        setLines(mapped);
        setBaselineOutboundLines(
            doc.posting_status === "posted"
                ? mapped
                      .filter((line: any) => line.itemCode && Number(line.netWeight ?? line.weight ?? 0) > 0)
                      .map((line: any) => ({
                          itemCode: line.itemCode,
                          netWeight: Number(line.netWeight ?? line.weight ?? 0),
                      }))
                : [],
        );
    }, []);

    useEffect(() => {
        if (!open) return;
        void initPartyCatalog().then(() => forcePartyRefresh((t) => t + 1));
        const unsub = subscribeParties(() => forcePartyRefresh((t) => t + 1));
        if (editReturnDbId) void loadEditReturn(editReturnDbId);
        else void startNewReturn();
        return () => unsub();
    }, [open, editReturnDbId, loadEditReturn, startNewReturn]);

    const currentAmount = currentRateStatus === "pending" ? 0 : Number(currentWeight) * Number(currentRate);
    const totalDebit = fixedTotal(lines);

    const stockAvailability = useMemo(
        () => {
            if (!isPosted || !editReturnDbId || baselineOutboundLines.length === 0) {
                return {
                    getKg: getBalance,
                    getUnits: () => 0,
                };
            }
            const baseline = aggregateOutboundDemand(baselineOutboundLines);
            return {
                getKg: (itemCode: string) => getBalance(itemCode) + (baseline.kgByItem[itemCode] ?? 0),
            getUnits: () => 0,
            };
        },
        [baselineOutboundLines, editReturnDbId, getBalance, isPosted],
    );

    const stockPostIssues = useMemo(() => {
        if (returnAction !== "stock") return [];
        const outbound = lines
            .filter((l) => (l.itemCode ?? l.item) && Number(l.netWeight ?? l.weight ?? 0) > 0)
            .map((l) => ({
                itemCode: l.itemCode ?? l.item ?? "",
                netWeight: Number(l.netWeight ?? l.weight ?? 0),
            }));
        const check = validateOutboundStock({ lines: outbound, availability: stockAvailability });
        return check.ok ? [] : check.errors;
    }, [lines, returnAction, stockAvailability]);

    const handleAddLine = () => {
        if (!currentItem || !currentWeight) return;
        if (currentRateStatus === "fixed" && !currentRate) return;
        const itemDetails = catalogItems.find((i) => i.code === currentItem);
        const newLine = {
            id: editingLineId ?? Math.random().toString(36).substr(2, 9),
            itemCode: currentItem,
            item: currentItem,
            itemName: itemDetails ? formatItemLabel(itemDetails) : currentItem,
            quantity: Number(currentQuantity),
            unit: currentUnit,
            netWeight: Number(currentWeight),
            weight: Number(currentWeight),
            rate: Number(currentRate),
            amount: currentAmount,
            rateStatus: currentRateStatus,
        };
        if (returnAction === "stock") {
            const projected = editingLineId
                ? lines.map((l) =>
                      l.id === editingLineId
                          ? { itemCode: currentItem, netWeight: Number(currentWeight) }
                          : {
                    itemCode: l.itemCode ?? l.item ?? "",
                    netWeight: Number(l.netWeight ?? l.weight ?? 0),
                            },
                  )
                : [
                      ...lines.map((l) => ({
                          itemCode: l.itemCode ?? l.item ?? "",
                          netWeight: Number(l.netWeight ?? l.weight ?? 0),
                      })),
                      { itemCode: currentItem, netWeight: Number(currentWeight) },
                  ];
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
        setLines((prev) =>
            editingLineId ? prev.map((line) => (line.id === editingLineId ? newLine : line)) : [...prev, newLine],
        );
        setCurrentWeight("");
        setCurrentQuantity("");
        setCurrentRate("");
        setEditingLineId(null);
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const removeLine = (id: string) => {
        setLines((prev) => prev.filter((l) => l.id !== id));
        if (editingLineId === id) setEditingLineId(null);
    };

    const handleEditLine = (id: string) => {
        const line = lines.find((l) => l.id === id);
        if (!line) return;
        setCurrentItem(line.itemCode ?? line.item ?? "");
        setCurrentQuantity(line.quantity ? String(line.quantity) : "");
        setCurrentUnit(line.unit ?? "kg");
        setCurrentWeight(line.netWeight != null ? String(line.netWeight) : line.weight != null ? String(line.weight) : "");
        setCurrentRate(line.rate != null ? String(line.rate) : "");
        setCurrentRateStatus(mapLineRateStatus(line.rateStatus));
        setEditingLineId(id);
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const getPayload = (resolvedReturnId = returnId) => ({
        dbId,
        header: { returnId: resolvedReturnId, date, supplierId, refInvoice, returnAction, remarks },
        items: lines,
        totalDebit,
    });

    const ensureReturnNo = async () => {
        if (returnId) return returnId;
        if (returnNoPromiseRef.current) return returnNoPromiseRef.current;
        return allocateReturnNo();
    };

    const runAction = async (action: "draft" | "post") => {
        const resolvedReturnId = await ensureReturnNo();
        if (!resolvedReturnId) return;
        const payload = getPayload(resolvedReturnId);
        const result = action === "draft" ? await onSaveDraft(payload) : await onPost(payload);
        if (result === false) return;
        if (action === "post") {
            await startNewReturn();
        } else {
            onOpenChange(false);
            resetForm();
        }
    };

    const draftIssues = useMemo(
        () =>
            collectReturnFormIssues({
                partyId: supplierId,
                partyLabel: "supplier",
                lines,
                forPost: false,
            }),
        [supplierId, lines],
    );

    const postIssues = useMemo(
        () =>
            collectReturnFormIssues({
                partyId: supplierId,
                partyLabel: "supplier",
                lines,
                forPost: true,
            }),
        [supplierId, lines],
    );

    const displayIssues = useMemo(() => {
        if (!showValidation || !attemptedAction || attemptedAction === "submit") {
            return { errors: [] as string[], warnings: [] as string[] };
        }
        const base = issuesForAction(attemptedAction, draftIssues, postIssues);
        if (attemptedAction !== "post") return base;
        return {
            errors: [...base.errors, ...stockPostIssues.filter((e) => !base.errors.includes(e))],
            warnings: base.warnings,
        };
    }, [showValidation, attemptedAction, draftIssues, postIssues, stockPostIssues]);

    const handleAction = (action: "draft" | "post") => {
        markAttempted(action);
        const issues = issuesForAction(action, draftIssues, postIssues);
        const stockErrors = action === "post" ? stockPostIssues.filter((e) => !issues.errors.includes(e)) : [];
        if (issues.errors.length + stockErrors.length > 0) return;
        void runAction(action);
    };

    const handleDelete = async () => {
        if (!dbId || !onDelete) return;
        const result = await onDelete(dbId);
        if (result === false) return;
        onOpenChange(false);
        resetForm();
    };

    const modalTitle = readOnly ? "View debit note" : editReturnDbId ? "Edit debit note" : "Purchase return (debit note)";

    return (
        <InvoiceModalShell
            open={open}
            onOpenChange={onOpenChange}
            title={modalTitle}
            subtitle={loading ? "Loading…" : readOnly ? "Posted — read only" : "Return stock or adjust financial liability."}
            headerEnd={
                <div className="text-right">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Return ID</div>
                    <div className="font-mono font-bold text-sm text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                        {returnId}
                    </div>
                </div>
            }
            footer={
                <div className="shrink-0 border-t border-zinc-200/70 bg-white px-5 py-4 flex items-center justify-end gap-2">
                    {justPosted ? (
                        <>
                            <span className="mr-auto text-sm font-medium text-emerald-700 inline-flex items-center gap-1.5">
                                <CheckCircle2 className="h-4 w-4" />
                                Debit note {returnId} posted · Stock updated
                            </span>
                            <Button variant="outline" onClick={() => resetForm()}>New return</Button>
                            <Button className="bg-zinc-900 hover:bg-zinc-800" onClick={() => { onOpenChange(false); resetForm(); }}>Close</Button>
                        </>
                    ) : readOnly ? (
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                    ) : (
                        <>
                            {dbId && onDelete ? (
                                <Button variant="outline" className="mr-auto text-rose-600 border-rose-200 hover:bg-rose-50" onClick={() => void handleDelete()} disabled={loading}>
                                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                                </Button>
                            ) : null}
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                            <Button variant="outline" onClick={() => handleAction("draft")} disabled={loading}>
                                <Save className="h-4 w-4 mr-2" /> Save draft
                            </Button>
                            <Button onClick={() => handleAction("post")} disabled={loading} className="bg-rose-600 hover:bg-rose-700">
                                <Send className="h-4 w-4 mr-2" /> Post debit note
                            </Button>
                        </>
                    )}
                </div>
            }
        >
            <InvoiceSplitLayout
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
                        <FormBlock label="Return Details">
                            <FieldGroup label="Supplier">
                                <PartyCombobox
                                    value={supplierId}
                                    onValueChange={setSupplierId}
                                    options={supplierOptions}
                                    placeholder="Search supplier…"
                                    triggerClassName={invoiceInputClass}
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
                                    ariaLabel="Purchase return date"
                                />
                            </FieldGroup>
                            <FieldGroup label="Ref Invoice #">
                                <Input placeholder="Link original purchase" value={refInvoice} onChange={(e) => setRefInvoice(e.target.value)} className={invoiceInputClass} />
                            </FieldGroup>
                            <FieldGroup label="Action Type">
                                <ModeToggle value={returnAction} onChange={setReturnAction} options={[{ value: "stock", label: "Return Stock" }, { value: "financial", label: "Financial Only" }]} />
                            </FieldGroup>
                        </FormBlock>

                        {!readOnly && (
                            <FormBlock label="Add Item">
                                <FieldGroup label="Item">
                                    <Select value={currentItem} onValueChange={setCurrentItem}>
                                        <SelectTrigger ref={itemSelectRef} className={invoiceInputClass}>
                                            <SelectValue placeholder="Select Item" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {catalogItems.map((i) => (
                                                <SelectItem key={i.code} value={i.code}>
                                                    {formatItemLabel(i)} — Avail: {getBalance(i.code).toLocaleString()} {i.unit}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FieldGroup>
                                <div className="grid grid-cols-2 gap-3">
                                    <FieldGroup label="Quantity (Nos)">
                                        <Input type="number" value={currentQuantity} onChange={(e) => setCurrentQuantity(e.target.value)} className={invoiceInputClass} placeholder="0" />
                                    </FieldGroup>
                                    <FieldGroup label="Unit">
                                        <Select value={currentUnit} onValueChange={setCurrentUnit}>
                                            <SelectTrigger className={invoiceInputClass}><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="kg">kg</SelectItem>
                                                <SelectItem value="metric_ton">MT</SelectItem>
                                                <SelectItem value="pcs">Pcs</SelectItem>
                                                <SelectItem value="meter">Meter</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </FieldGroup>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <FieldGroup label={returnAction === "stock" ? "Return Weight" : "Weight"}>
                                        <Input type="number" value={currentWeight} onChange={(e) => setCurrentWeight(e.target.value)} placeholder="0.00" className={invoiceInputClass} />
                                    </FieldGroup>
                                    <FieldGroup label="Rate / Cost">
                                        <Input
                                            type="number"
                                            value={currentRate}
                                            onChange={(e) => setCurrentRate(e.target.value)}
                                            placeholder="0.00"
                                            className={invoiceInputClass}
                                            disabled={currentRateStatus === "pending"}
                                        />
                                    </FieldGroup>
                                </div>
                                <RateStatusCell value={currentRateStatus} onChange={setCurrentRateStatus} />
                                <AddLineBar
                                    netLabel={`${Number(currentWeight || 0).toFixed(2)} ${currentUnit}`}
                                    amountLabel={currentRateStatus === "pending" ? "—" : `₨ ${currentAmount.toLocaleString()}`}
                                    onAdd={handleAddLine}
                                    disabled={!currentItem || !currentWeight || (currentRateStatus === "fixed" && !currentRate)}
                                    buttonLabel={editingLineId ? "Update" : "Add"}
                                />
                            </FormBlock>
                        )}
                    </InvoiceFormScroll>
                }
                lines={
                    <InvoiceLinesColumn
                        title="Debit Note Lines"
                        subtitle={`${lines.length} item${lines.length !== 1 ? "s" : ""}`}
                        badge={<span className="text-xs font-medium bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-full">{lines.length}</span>}
                        footer={
                            <div className="space-y-4">
                                <FieldGroup label="Reason / Remarks">
                                    <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Enter reason for return..." className="bg-white resize-none h-20" disabled={readOnly} />
                                </FieldGroup>
                                <InvoiceTotalsPanel rows={[{ type: "amount", label: "Debit subtotal", amount: totalDebit }]} totalLabel="Total Debit" total={totalDebit} accentClass="text-rose-600" />
                            </div>
                        }
                    >
                        <LineItemsPanel
                            lines={lines}
                            emptyMessage="No items added yet"
                            onRemove={readOnly ? undefined : removeLine}
                            onEdit={readOnly ? undefined : handleEditLine}
                            renderLine={(line: (typeof lines)[number]) => (
                                <div className="space-y-1">
                                    <div className="font-medium text-zinc-900 leading-tight">{line.itemName || line.item}</div>
                                    <div className="text-xs text-zinc-500 tabular-nums">
                                        {Number(line.quantity ?? 0) > 0 ? `${line.quantity} units · ` : ""}
                                        Weight {line.weight} {line.unit}
                                        {line.rateStatus === "pending" ? " · Rate pending" : ` · Rate ₨ ${Number(line.rate ?? 0).toLocaleString()}/kg`}
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs text-zinc-600">
                                            {line.rateStatus === "pending" ? (
                                                <span className="text-amber-700">Rate pending</span>
                                            ) : (
                                                <>
                                                    <span className="font-semibold text-rose-600"> ₨ {line.amount.toLocaleString()}</span>
                                                </>
                                            )}
                                        </div>
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
                                                                              : Number(l.netWeight ?? l.weight) * Number(l.rate),
                                                                  }
                                                                : l,
                                                        ),
                                                    )
                                                }
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    </InvoiceLinesColumn>
                }
            />
        </InvoiceModalShell>
    );
}
