import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Save, AlertCircle, Send, Trash2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useInventory } from "@/contexts/InventoryContext";
import { getFinishedGoodsItems, getManagedCategoryForItem, itemTracksUnitCount } from "@/lib/itemCatalog";
import { ItemCombobox } from "@/components/invoices/ItemCombobox";
import { formatItemLabel } from "@/lib/inventoryStore";
import { getCustomers, initPartyCatalog, subscribeParties } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { allocateNextSalesReturnNo } from "@/lib/documentNumbers";
import { fetchSalesReturnDocument } from "@/lib/api/returns";
import { sumFixedLineAmounts, mapLineFromDb, type RateStatus } from "@/lib/ratePending";
import { useRatePendingLines } from "@/hooks/useRatePendingLines";
import { RateStatusCell } from "@/components/shared/RateStatusCell";
import { InvoiceModalShell } from "@/components/invoices/InvoiceModalShell";
import { InvoiceDateInput } from "@/components/invoices/InvoiceDateInput";
import {
    AddLineBar,
    AlertBanner,
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
import { collectReturnFormIssues, issuesForAction } from "@/lib/formValidation";
import { useFormValidationGate } from "@/hooks/useFormValidationGate";

interface CreateCreditNoteModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaveDraft: (data: any) => boolean | void | Promise<boolean | void>;
    onPost: (data: any) => boolean | void | Promise<boolean | void>;
    onDelete?: (id: string) => boolean | void | Promise<boolean | void>;
    editReturnDbId?: string | null;
}

export function CreateCreditNoteModal({
    open,
    onOpenChange,
    onSaveDraft,
    onPost,
    onDelete,
    editReturnDbId = null,
}: CreateCreditNoteModalProps) {
    const { getBalance, getUnitBalance } = useInventory();
    const catalogItems = getFinishedGoodsItems();
    const [, forcePartyRefresh] = useState(0);
    const customers = getCustomers();
    const customerOptions = useMemo(() => toPartyComboboxOptions(customers), [customers]);

    const [returnId, setReturnId] = useState("");
    const [dbId, setDbId] = useState<string | null>(null);
    const [readOnly, setReadOnly] = useState(false);
    const [justPosted, setJustPosted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [customerId, setCustomerId] = useState("");
    const [originalInv, setOriginalInv] = useState("");
    const [returnAction, setReturnAction] = useState<"restock" | "scrap">("restock");
    const [remarks, setRemarks] = useState("");
    const [lines, setLines] = useState<any[]>([]);
    const { fixedTotal } = useRatePendingLines();

    const itemSelectRef = useRef<HTMLButtonElement>(null);
    const quantityRef = useRef<HTMLInputElement>(null);
    const weightRef = useRef<HTMLInputElement>(null);
    const grossRef = useRef<HTMLInputElement>(null);
    const tareRef = useRef<HTMLInputElement>(null);
    const rateRef = useRef<HTMLInputElement>(null);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const returnNoPromiseRef = useRef<Promise<string> | null>(null);
    const [currentItem, setCurrentItem] = useState("");
    const [currentQuantity, setCurrentQuantity] = useState("");
    const [currentUnit, setCurrentUnit] = useState("kg");
    const [currentGross, setCurrentGross] = useState("");
    const [currentTare, setCurrentTare] = useState("");
    const [currentWeight, setCurrentWeight] = useState("");
    const [currentRate, setCurrentRate] = useState("");
    const [currentRateStatus, setCurrentRateStatus] = useState<RateStatus>("fixed");
    const [editingLineId, setEditingLineId] = useState<string | null>(null);
    const [deduction, setDeduction] = useState("0");
    const { attemptedAction, markAttempted, resetValidation, showValidation } = useFormValidationGate();

    const resetForm = useCallback(() => {
        setReturnId("");
        returnNoPromiseRef.current = null;
        setDbId(null);
        setReadOnly(false);
        setJustPosted(false);
        setDate(new Date());
        setCustomerId("");
        setOriginalInv("");
        setReturnAction("restock");
        setRemarks("");
        setLines([]);
        setCurrentItem("");
        setCurrentQuantity("");
        setCurrentUnit("kg");
        setCurrentGross("");
        setCurrentTare("");
        setCurrentWeight("");
        setCurrentRate("");
        setCurrentRateStatus("fixed");
        setEditingLineId(null);
        setDeduction("0");
        resetValidation();
    }, [resetValidation]);

    const allocateReturnNo = useCallback(() => {
        const request = allocateNextSalesReturnNo().then((nextReturnNo) => {
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
        const doc = await fetchSalesReturnDocument(id);
        setLoading(false);
        if (!doc) return;
        returnNoPromiseRef.current = null;
        setReadOnly(false);
        setDbId(doc.id);
        setReturnId(doc.return_no);
        setDate(doc.return_date ? new Date(doc.return_date) : new Date());
        setCustomerId(doc.parties?.code ?? "");
        setOriginalInv(doc.sales_invoices?.invoice_no ?? "");
        setReturnAction(doc.return_action === "scrap" ? "scrap" : "restock");
        setRemarks(doc.remarks ?? "");
        setLines(
            (doc.sales_return_lines ?? []).map((l: any) => {
                const rateFields = mapLineFromDb(l);
                return {
                    id: l.id,
                    itemCode: l.items?.code ?? "",
                    itemName: l.items?.name ?? l.items?.code ?? "",
                    quantity: Number(l.unit_count ?? 0),
                    unit: "kg",
                    gross: Number(l.qty ?? 0),
                    tare: 0,
                    netWeight: Number(l.qty ?? 0),
                    rate: rateFields.rate,
                    deductionPercent: 0,
                    creditAmount: rateFields.amount,
                    rateStatus: rateFields.rateStatus,
                };
            })
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

    const currentItemRecord = useMemo(
        () => catalogItems.find((i) => i.code === currentItem) ?? null,
        [catalogItems, currentItem],
    );
    const showUnitField = currentItemRecord ? itemTracksUnitCount(currentItemRecord) : false;
    const stockHint = currentItem
        ? (() => {
              const kg = getBalance(currentItem).toLocaleString();
              const units = getUnitBalance(currentItem);
              return units > 0 ? `${kg} kg · ${units.toLocaleString()} units available` : `${kg} kg available`;
          })()
        : undefined;

    const isStripItem = useMemo(() => {
        if (!currentItemRecord) return false;
        return getManagedCategoryForItem(currentItemRecord) === "Strip" || currentItemRecord.itemType === "Strip";
    }, [currentItemRecord]);

    const focusEl = <T extends HTMLElement>(ref: React.RefObject<T | null>) => {
        setTimeout(() => ref.current?.focus(), 0);
    };
    const handleEnter = (next: () => void) => (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            next();
        }
    };

    const handleItemSelect = (code: string) => {
        setCurrentItem(code);
        const item = catalogItems.find((i) => i.code === code);
        if (item) {
            // Leave Credit Rate for the user — do not overwrite with item stdCost.
            setCurrentUnit(item.unit === "KG" ? "kg" : item.unit.toLowerCase());
        }
        focusEl(quantityRef);
    };

    const currentNet = isStripItem
        ? Math.max(0, Number(currentGross) - (Number(currentTare) || 0))
        : Math.max(0, Number(currentWeight));
    const creditAmountBeforeDeduction =
        currentRateStatus === "pending" ? 0 : currentNet * Number(currentRate);
    const deductionAmount = creditAmountBeforeDeduction * (Number(deduction) / 100);
    const currentCreditAmount = creditAmountBeforeDeduction - deductionAmount;
    const totalCreditAmount = fixedTotal(
        lines.map((l) => ({ rateStatus: l.rateStatus, amount: l.creditAmount })),
    );

    const handleAddLine = () => {
        if (!currentItem) return;
        if (isStripItem ? !currentGross : !currentWeight) return;
        if (currentRateStatus === "fixed" && !(Number(currentRate) > 0)) return;
        const itemDetails = catalogItems.find((i) => i.code === currentItem);
        const tare = isStripItem ? Number(currentTare) || 0 : 0;
        const gross = isStripItem ? Number(currentGross) : 0;
        const newLine = {
            id: editingLineId ?? Math.random().toString(36).substr(2, 9),
            itemCode: currentItem,
            itemName: itemDetails ? formatItemLabel(itemDetails) : "Unknown Item",
            quantity: Number(currentQuantity),
            unit: currentUnit,
            gross,
            tare,
            netWeight: currentNet,
            rate: currentRateStatus === "pending" ? 0 : Number(currentRate),
            deductionPercent: Number(deduction),
            creditAmount: currentCreditAmount,
            rateStatus: currentRateStatus,
        };
        setLines((prev) =>
            editingLineId ? prev.map((line) => (line.id === editingLineId ? newLine : line)) : [...prev, newLine],
        );
        setCurrentGross("");
        setCurrentTare("");
        setCurrentWeight("");
        setCurrentQuantity("");
        setCurrentRate("");
        setEditingLineId(null);
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const getPayload = (resolvedReturnId = returnId) => ({
        dbId,
        header: { returnId: resolvedReturnId, date, customerId, originalInv, returnAction, remarks },
        items: lines,
        totalCreditAmount,
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
                partyId: customerId,
                partyLabel: "customer",
                lines,
                forPost: false,
            }),
        [customerId, lines],
    );

    const postIssues = useMemo(
        () =>
            collectReturnFormIssues({
                partyId: customerId,
                partyLabel: "customer",
                lines,
                forPost: true,
            }),
        [customerId, lines],
    );

    const displayIssues = useMemo(() => {
        if (!showValidation || !attemptedAction || attemptedAction === "submit") {
            return { errors: [] as string[], warnings: [] as string[] };
        }
        return issuesForAction(attemptedAction, draftIssues, postIssues);
    }, [showValidation, attemptedAction, draftIssues, postIssues]);

    const handleAction = (action: "draft" | "post") => {
        markAttempted(action);
        const issues = issuesForAction(action, draftIssues, postIssues);
        if (issues.errors.length > 0) return;
        void runAction(action);
    };

    const handleDelete = async () => {
        if (!dbId || !onDelete) return;
        const result = await onDelete(dbId);
        if (result === false) return;
        onOpenChange(false);
        resetForm();
    };

    const removeLine = (id: string) => {
        setLines((prev) => prev.filter((l) => l.id !== id));
        if (editingLineId === id) setEditingLineId(null);
    };

    const handleEditLine = (id: string) => {
        const line = lines.find((l) => l.id === id);
        if (!line) return;
        const lineRecord = catalogItems.find((i) => i.code === line.itemCode);
        const lineIsStrip =
            !!lineRecord &&
            (getManagedCategoryForItem(lineRecord) === "Strip" || lineRecord.itemType === "Strip");
        setCurrentItem(line.itemCode ?? "");
        setCurrentQuantity(line.quantity ? String(line.quantity) : "");
        setCurrentUnit(line.unit ?? "kg");
        if (lineIsStrip) {
            setCurrentGross(line.gross != null ? String(line.gross) : "");
            setCurrentTare(line.tare != null ? String(line.tare) : "");
            setCurrentWeight("");
        } else {
            setCurrentWeight(line.netWeight != null ? String(line.netWeight) : "");
            setCurrentGross("");
            setCurrentTare("");
        }
        setCurrentRate(line.rate != null ? String(line.rate) : "");
        setCurrentRateStatus((line.rateStatus === "pending" ? "pending" : "fixed") as RateStatus);
        setEditingLineId(id);
        setTimeout(() => itemSelectRef.current?.focus(), 0);
    };

    const modalTitle = readOnly ? "View credit note" : editReturnDbId ? "Edit credit note" : "Sales return (credit note)";

    return (
        <InvoiceModalShell
            open={open}
            onOpenChange={onOpenChange}
            title={modalTitle}
            subtitle={loading ? "Loading…" : readOnly ? "Posted — read only" : "Process returned goods and issue credit."}
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
                                Credit note {returnId} posted · Stock updated
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
                                <Send className="h-4 w-4 mr-2" /> Post credit note
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
                            <FieldGroup label="Customer">
                                <PartyCombobox
                                    value={customerId}
                                    onValueChange={setCustomerId}
                                    options={customerOptions}
                                    placeholder="Search customer…"
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
                                    ariaLabel="Sales return date"
                                />
                            </FieldGroup>
                            <FieldGroup label="Return Action">
                                <ModeToggle value={returnAction} onChange={setReturnAction} options={[{ value: "restock", label: "Restock" }, { value: "scrap", label: "Scrap" }]} />
                            </FieldGroup>
                            <FieldGroup label="Ref Invoice #">
                                <Input placeholder="INV-2023-..." value={originalInv} onChange={(e) => setOriginalInv(e.target.value)} className={invoiceInputClass} />
                            </FieldGroup>
                        </FormBlock>

                        {!readOnly && (
                            <FormBlock label="Add Returned Item">
                                <FieldGroup
                                    label="Item"
                                    hint={stockHint}
                                >
                                    <ItemCombobox
                                        ref={itemSelectRef}
                                        value={currentItem}
                                        onSelect={handleItemSelect}
                                        groups={[
                                            {
                                                label: "Enameled Wire",
                                                items: catalogItems
                                                    .filter((i) => getManagedCategoryForItem(i) !== "Strip" && i.itemType !== "Strip")
                                                    .map((i) => ({ code: i.code, name: i.name, sizeSpec: i.sizeSpec })),
                                            },
                                            {
                                                label: "Copper Strip",
                                                items: catalogItems
                                                    .filter((i) => getManagedCategoryForItem(i) === "Strip" || i.itemType === "Strip")
                                                    .map((i) => ({ code: i.code, name: i.name, sizeSpec: i.sizeSpec })),
                                            },
                                        ].filter((g) => g.items.length > 0)}
                                    />
                                </FieldGroup>
                                {showUnitField ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        <FieldGroup label="Units">
                                            <Input
                                                ref={quantityRef}
                                                type="number"
                                                value={currentQuantity}
                                                onChange={(e) => setCurrentQuantity(e.target.value)}
                                                onKeyDown={handleEnter(() => focusEl(isStripItem ? grossRef : weightRef))}
                                                className={invoiceInputClass}
                                                placeholder="0"
                                            />
                                        </FieldGroup>
                                    </div>
                                ) : null}
                                {isStripItem ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        <FieldGroup label="Gross Wt">
                                            <Input
                                                ref={grossRef}
                                                type="number"
                                                value={currentGross}
                                                onChange={(e) => setCurrentGross(e.target.value)}
                                                onKeyDown={handleEnter(() => focusEl(tareRef))}
                                                className={invoiceInputClass}
                                            />
                                        </FieldGroup>
                                        <FieldGroup label="Tare">
                                            <Input
                                                ref={tareRef}
                                                type="number"
                                                value={currentTare}
                                                onChange={(e) => setCurrentTare(e.target.value)}
                                                onKeyDown={handleEnter(() => focusEl(rateRef))}
                                                className={invoiceInputClass}
                                                placeholder="0"
                                            />
                                        </FieldGroup>
                                    </div>
                                ) : (
                                    <FieldGroup label="Weight (kg)">
                                        <Input
                                            ref={weightRef}
                                            type="number"
                                            value={currentWeight}
                                            onChange={(e) => setCurrentWeight(e.target.value)}
                                            onKeyDown={handleEnter(() => focusEl(rateRef))}
                                            className={invoiceInputClass}
                                        />
                                    </FieldGroup>
                                )}
                                <div className="grid grid-cols-2 gap-3">
                                    <FieldGroup label="Credit Rate">
                                        <Input
                                            ref={rateRef}
                                            type="number"
                                            value={currentRate}
                                            onChange={(e) => setCurrentRate(e.target.value)}
                                            onKeyDown={handleEnter(() => focusEl(addButtonRef))}
                                            placeholder="Enter credit rate"
                                            className={invoiceInputClass}
                                        />
                                    </FieldGroup>
                                    <FieldGroup label="Deduction (%)">
                                        <Input type="number" value={deduction} onChange={(e) => setDeduction(e.target.value)} className={invoiceInputClass} />
                                    </FieldGroup>
                                </div>
                                <RateStatusCell value={currentRateStatus} onChange={setCurrentRateStatus} />
                                <AlertBanner variant="warning">
                                    <span className="inline-flex items-center gap-1">
                                        <AlertCircle className="h-3.5 w-3.5" />
                                        Net: {currentNet.toFixed(2)} {currentUnit} · Credit:{" "}
                                        {currentRateStatus === "pending" ? "—" : `₨ ${currentCreditAmount.toLocaleString()}`}
                                    </span>
                                </AlertBanner>
                                <AddLineBar
                                    netLabel={`${currentNet.toFixed(2)} ${currentUnit}`}
                                    amountLabel={currentRateStatus === "pending" ? "—" : `₨ ${currentCreditAmount.toLocaleString()}`}
                                    onAdd={handleAddLine}
                                    disabled={
                                        !currentItem ||
                                        (isStripItem ? !currentGross : !currentWeight) ||
                                        (currentRateStatus === "fixed" && !(Number(currentRate) > 0))
                                    }
                                    buttonRef={addButtonRef}
                                    buttonLabel={editingLineId ? "Update" : "Add"}
                                />
                            </FormBlock>
                        )}
                    </InvoiceFormScroll>
                }
                lines={
                    <InvoiceLinesColumn
                        title="Credit Note Lines"
                        subtitle={`${lines.length} item${lines.length !== 1 ? "s" : ""}`}
                        badge={<span className="text-xs font-medium bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-full">{lines.length}</span>}
                        footer={
                            <div className="space-y-4">
                                <FieldGroup label="Remarks">
                                    <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Reason..." className="bg-white resize-none h-20" disabled={readOnly} />
                                </FieldGroup>
                                <InvoiceTotalsPanel rows={[{ type: "amount", label: "Credit subtotal", amount: totalCreditAmount }]} totalLabel="Total Credit" total={totalCreditAmount} accentClass="text-rose-600" />
                            </div>
                        }
                    >
                        <LineItemsPanel
                            lines={lines}
                            emptyMessage="No returned items added yet"
                            onRemove={readOnly ? undefined : removeLine}
                            onEdit={readOnly ? undefined : handleEditLine}
                            renderLine={(line: (typeof lines)[number]) => (
                                <div className="space-y-1">
                                    <div className="font-medium text-zinc-900 leading-tight">{line.itemName}</div>
                                    <div className="text-xs text-zinc-500 tabular-nums">
                                        {Number(line.quantity ?? 0) > 0 ? `${line.quantity} units · ` : ""}
                                        Net {line.netWeight} {line.unit}
                                        {line.rateStatus === "pending" ? " · Rate pending" : ` · Rate ₨ ${Number(line.rate ?? 0).toLocaleString()}/kg`}
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs text-zinc-600">
                                            {line.rateStatus === "pending" ? (
                                                <span className="text-amber-700">Rate pending</span>
                                            ) : (
                                                <>
                                                    Deduction {line.deductionPercent}% ·
                                                    <span className="font-semibold text-rose-600"> ₨ {line.creditAmount.toLocaleString()}</span>
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
                                                                      creditAmount:
                                                                          status === "pending"
                                                                              ? 0
                                                                              : Number(l.netWeight) * Number(l.rate) * (1 - Number(l.deductionPercent) / 100),
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
