import { DialogFooter } from "@/components/ui/dialog";
import { InvoiceModalShell, thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo, useEffect, useCallback, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getCustomers, getVendors, initPartyCatalog } from "@/lib/partyCatalog";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import {
    listScrapCatalogItems,
    resolveScrapItemCode,
    scrapItemLabel,
    type ScrapTradeFormPayload,
    type ScrapTradeListItem,
} from "@/lib/scrapTradeTypes";
import { fetchScrapObligationsForParty, fetchPartyScrapCredits, fetchNextScrapTradeNo } from "@/lib/repositories/scrapRepo";
import type { PartyScrapCreditRow, ScrapObligationRow } from "@/lib/scrapObligationTypes";
import {
    computeCreditAllocations,
    remainderKgAfterCredits,
    totalAllocationAmount,
    totalCreditAllocatedKg,
} from "@/lib/scrapReceivableAllocation";
import {
    ScrapObligationAllocationPanel,
    useScrapReceivableAllocation,
} from "@/components/trading/ScrapObligationAllocationPanel";
import { ScrapAdvanceCreditPanel } from "@/components/trading/ScrapAdvanceCreditPanel";
import { invoiceInputClass } from "@/components/invoices/InvoiceFormLayout";
import { FormValidationPanel } from "@/components/invoices/InvoiceFormValidationAlerts";
import { collectTriangleTradeIssues } from "@/lib/formValidation";
import { useFormValidationGate } from "@/hooks/useFormValidationGate";
import { RateStatusCell } from "@/components/shared/RateStatusCell";
import { PendingReasonSelect } from "@/components/shared/PendingReasonSelect";
import type { PendingReason, RateStatus } from "@/lib/ratePending";

interface CreateTriangleTradeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialData?: ScrapTradeListItem | null;
    onSubmit?: (data: ScrapTradeFormPayload) => void | Promise<void>;
}

function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
    return (
        <div className={cn("rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-4 space-y-3", className)}>
            {title ? (
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
            ) : null}
            {children}
        </div>
    );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
    return (
        <div className={cn("min-w-0 space-y-1.5", className)}>
            <Label className="text-[11px] font-medium text-zinc-500">{label}</Label>
            {children}
        </div>
    );
}

function ReadonlyValue({ value, emphasize }: { value: string; emphasize?: boolean }) {
    return (
        <div
            className={cn(
                "h-9 flex items-center justify-end px-3 rounded-lg font-mono text-sm font-semibold tabular-nums",
                emphasize
                    ? "bg-zinc-900 text-white ring-1 ring-zinc-900"
                    : "bg-white ring-1 ring-zinc-200/70 text-zinc-900",
            )}
        >
            {value}
        </div>
    );
}

export function CreateTriangleTradeModal({
    open,
    onOpenChange,
    initialData,
    onSubmit,
}: CreateTriangleTradeModalProps) {
    const [customers, setCustomers] = useState(() => getCustomers());
    const [vendors, setVendors] = useState(() => getVendors());
    const [submitting, setSubmitting] = useState(false);
    const [obligations, setObligations] = useState<ScrapObligationRow[]>([]);
    const [scrapCredits, setScrapCredits] = useState<PartyScrapCreditRow[]>([]);
    const [loadingObl, setLoadingObl] = useState(false);
    const [selectedObligationIds, setSelectedObligationIds] = useState<string[]>([]);
    const [selectedCreditIds, setSelectedCreditIds] = useState<string[]>([]);
    const scrapItems = listScrapCatalogItems();
    const defaultItemCode = scrapItems[0]?.code ?? "RM-SCP-001";

    const [transferId, setTransferId] = useState("");
    const [source, setSource] = useState("");
    const [destination, setDestination] = useState("");
    const [itemCode, setItemCode] = useState(defaultItemCode);
    const [biltyNo, setBiltyNo] = useState("");
    const [vehicleNo, setVehicleNo] = useState("");
    const [grossWeight, setGrossWeight] = useState("");
    const [tareWeight, setTareWeight] = useState("");
    const [rate, setRate] = useState("");
    const [rateStatus, setRateStatus] = useState<RateStatus>("fixed");
    const [pendingReason, setPendingReason] = useState<PendingReason>("rate");
    const [settlementMode, setSettlementMode] = useState<"triangle" | "cash">("triangle");
    const [tradeDate, setTradeDate] = useState(() => new Date().toISOString().slice(0, 10));
    /** Guards one-time-per-open initialization so a post (which rolls the ID
     *  itself) is never clobbered by the stale parent-suggested number. */
    const didInitForOpenRef = useRef(false);
    const { markAttempted, resetValidation, showValidation } = useFormValidationGate();

    useEffect(() => {
        if (!open) return;
        void initPartyCatalog().then(() => {
            setCustomers(getCustomers());
            setVendors(getVendors());
        });
    }, [open]);

    useEffect(() => {
        if (!open) {
            didInitForOpenRef.current = false;
            return;
        }
        if (initialData) {
            setTransferId(initialData.id);
            setSource(initialData.sourceId || "");
            setDestination(initialData.destinationId || "");
            setItemCode(initialData.itemCode ?? defaultItemCode);
            setBiltyNo(initialData.biltyNo || "");
            setVehicleNo(initialData.vehicleNo || "");
            setGrossWeight(initialData.grossWeight ? String(initialData.grossWeight) : "");
            setTareWeight(initialData.tareWeight ? String(initialData.tareWeight) : "0");
            setRate(initialData.rateValue ? String(initialData.rateValue) : "");
            setRateStatus(initialData.rateStatus === "pending" ? "pending" : "fixed");
            setSettlementMode(initialData.settlementMode === "cash" ? "cash" : "triangle");
            setTradeDate(initialData.date || new Date().toISOString().slice(0, 10));
            setSelectedObligationIds([]);
            didInitForOpenRef.current = true;
            return;
        }
        // New scrap: initialize once per open. Fetch next number here so a
        // parent-held peek cannot overwrite the ID we roll after a post.
        if (!didInitForOpenRef.current) {
            didInitForOpenRef.current = true;
            resetForm();
            setTradeDate(new Date().toISOString().slice(0, 10));
            void fetchNextScrapTradeNo().then((no) => {
                setTransferId(
                    no ??
                        `SCRAP-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000)
                            .toString()
                            .padStart(3, "0")}`,
                );
            });
        }
    }, [open, initialData, defaultItemCode]);

    const reloadObligations = useCallback(async (partyCode: string) => {
        if (!open || !partyCode || initialData) {
            setObligations([]);
            setScrapCredits([]);
            setSelectedObligationIds([]);
            setSelectedCreditIds([]);
            return;
        }
        setLoadingObl(true);
        try {
            const [oblRows, creditRows] = await Promise.all([
                fetchScrapObligationsForParty(partyCode, true),
                fetchPartyScrapCredits(partyCode, true),
            ]);
            setObligations(oblRows);
            setScrapCredits(creditRows);
            setSelectedObligationIds([]);
            setSelectedCreditIds([]);
        } catch {
            setObligations([]);
            setScrapCredits([]);
        } finally {
            setLoadingObl(false);
        }
    }, [open, initialData]);

    useEffect(() => {
        void reloadObligations(source);
    }, [reloadObligations, source]);

    const sourceParties = useMemo(() => {
        const seen = new Set<string>();
        return [...customers, ...vendors].filter((p) => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
        });
    }, [customers, vendors]);

    const allPartyOptions = useMemo(() => toPartyComboboxOptions(sourceParties), [sourceParties]);

    const netWeight = useMemo(() => {
        const gross = parseFloat(grossWeight) || 0;
        const tare = parseFloat(tareWeight) || 0;
        const manualOnly = selectedObligationIds.length === 0;
        if (manualOnly && rateStatus === "pending" && pendingReason !== "rate" && tare <= 0) {
            return 0;
        }
        return Math.max(0, gross - tare);
    }, [grossWeight, tareWeight, selectedObligationIds.length, rateStatus, pendingReason]);

    const creditAllocationPreview = useMemo(
        () =>
            computeCreditAllocations(
                netWeight,
                selectedCreditIds,
                scrapCredits.map((c) => ({
                    credit_id: c.credit_id,
                    trade_no: c.trade_no,
                    open_kg: c.open_kg,
                })),
            ),
        [netWeight, selectedCreditIds, scrapCredits],
    );

    const creditLines = creditAllocationPreview.lines;
    const creditAllocatedKg = totalCreditAllocatedKg(creditLines);
    const obligationNetKg = remainderKgAfterCredits(netWeight, creditAllocatedKg);

    const { lines: allocationLines, error: allocationError } = useScrapReceivableAllocation(
        obligationNetKg,
        selectedObligationIds,
        obligations,
    );

    const premiumTotalAmount = useMemo(
        () => (allocationLines.length > 0 ? totalAllocationAmount(allocationLines) : 0),
        [allocationLines],
    );

    const manualRate = parseFloat(rate) || 0;
    const linkedInvoices = selectedObligationIds.length > 0;
    const hasPremiumLines = linkedInvoices && allocationLines.length > 0;
    const showManualRate = selectedObligationIds.length === 0;
    const isRatePending = showManualRate && rateStatus === "pending";
    const totalAmount = isRatePending ? 0 : hasPremiumLines ? premiumTotalAmount : manualRate * netWeight;
    const tradeUnitRate = netWeight > 0 ? totalAmount / netWeight : manualRate;
    const sameParty = Boolean(source && destination && source === destination);

    const validationIssues = useMemo(
        () =>
            collectTriangleTradeIssues({
                source,
                destination,
                netWeight,
                sameParty,
                allocationError: allocationError ?? null,
                hasPremiumSelection: selectedObligationIds.length > 0,
                manualRate,
                rateStatus,
            }),
        [
            source,
            destination,
            netWeight,
            sameParty,
            allocationError,
            selectedObligationIds.length,
            manualRate,
            rateStatus,
        ],
    );

    const handleSubmit = async () => {
        markAttempted("submit");
        if (validationIssues.errors.length > 0) {
            toast.error("Cannot submit scrap transfer", {
                description: validationIssues.errors[0],
            });
            return;
        }

        const sourceName = sourceParties.find((p) => p.id === source)?.name ?? source;
        const destName = sourceParties.find((p) => p.id === destination)?.name ?? destination;
        const itemLabel = scrapItems.find((i) => i.code === itemCode)?.name ?? itemCode;

        setSubmitting(true);
        try {
            await onSubmit?.({
                id: transferId,
                source: sourceName,
                destination: destName,
                sourceId: source,
                destinationId: destination,
                date: tradeDate,
                item: itemLabel,
                itemCode: resolveScrapItemCode(itemCode),
                biltyNo,
                vehicleNo,
                grossWeight: parseFloat(grossWeight) || 0,
                tareWeight: parseFloat(tareWeight) || 0,
                netWeight,
                rateValue: tradeUnitRate,
                rate: hasPremiumLines
                    ? allocationLines.map((l) => `${l.salesInvoiceNo} @ ${l.refScrapRate.toLocaleString()}`).join(" · ")
                    : `${manualRate} PKR/kg`,
                amount: `${totalAmount.toLocaleString()} PKR`,
                status: "Posted",
                obligationId:
                    hasPremiumLines && allocationLines.length === 1 ? allocationLines[0].obligationId : undefined,
                salesInvoiceNo:
                    hasPremiumLines && allocationLines.length === 1 ? allocationLines[0].salesInvoiceNo : undefined,
                obligationAllocations: hasPremiumLines
                    ? allocationLines.map((l) => ({
                          obligationId: l.obligationId,
                          allocatedKg: l.allocatedKg,
                          salesInvoiceNo: l.salesInvoiceNo,
                          refScrapRate: l.refScrapRate,
                      }))
                    : undefined,
                rateStatus: hasPremiumLines ? "fixed" : rateStatus,
                pendingReason: hasPremiumLines || rateStatus !== "pending" ? undefined : pendingReason,
                settlementMode,
                creditAllocations: creditLines.length
                    ? creditLines.map((l) => ({
                          scrapCreditId: l.scrapCreditId,
                          allocatedKg: l.allocatedKg,
                          tradeNo: l.tradeNo,
                      }))
                    : undefined,
            });
            if (initialData) {
                // edit: close after save (unchanged behavior)
                onOpenChange(false);
            } else {
                // create: keep modal open and prep the next scrap.
                // Prefer bumping the just-used ID so we never re-show the same
                // number even if next_scrap_trade_no races a slow commit.
                const used = transferId;
                const bumped = (() => {
                    const m = used.match(/^(.*?)(\d+)$/);
                    if (!m) return null;
                    return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, "0")}`;
                })();
                const nextNo = await fetchNextScrapTradeNo();
                // Prefer server peek when it actually advanced; else local bump.
                const rolled =
                    nextNo && nextNo !== used
                        ? nextNo
                        : bumped ?? nextNo ?? `SCRAP-${Date.now()}`;
                setTransferId(rolled);
                resetForNextScrap();
                // source is preserved; re-fetch obligations/credits since the
                // just-posted scrap may have cleared a premium obligation.
                await reloadObligations(source);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const resetForm = useCallback(() => {
        setSource("");
        setDestination("");
        setItemCode(defaultItemCode);
        setBiltyNo("");
        setVehicleNo("");
        setGrossWeight("");
        setTareWeight("");
        setRate("");
        setRateStatus("fixed");
        setPendingReason("rate");
        setSettlementMode("triangle");
        setSelectedObligationIds([]);
        setSelectedCreditIds([]);
        setObligations([]);
        setScrapCredits([]);
        resetValidation();
    }, [defaultItemCode, resetValidation]);

    /** Partial reset for successive posting: keeps source/destination/item/settlement/date. */
    const resetForNextScrap = useCallback(() => {
        setBiltyNo("");
        setVehicleNo("");
        setGrossWeight("");
        setTareWeight("");
        setRate("");
        setRateStatus("fixed");
        setPendingReason("rate");
        setSelectedObligationIds([]);
        setSelectedCreditIds([]);
        resetValidation();
    }, [resetValidation]);
    const inputClass = cn(invoiceInputClass, "w-full min-w-0 tabular-nums");

    return (
        <InvoiceModalShell
            open={open}
            onOpenChange={onOpenChange}
            title={initialData ? "Edit scrap trade" : "Scrap trade"}
            subtitle="Source receives weight (+) · Destination issues (−) · AP/AR on ledger"
            headerEnd={
                <span className="font-mono text-xs text-zinc-400 tabular-nums">{transferId}</span>
            }
            footer={
                <DialogFooter className="shrink-0 flex-col gap-3 px-6 py-3.5 border-t border-zinc-200/60 bg-white sm:flex-row sm:items-center sm:justify-between rounded-none">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 min-w-0 flex-1">
                        <div className="min-w-0">
                            <p className="text-[11px] text-zinc-500 leading-snug">
                                {settlementMode === "cash"
                                    ? "Posts GL (Dr Cash / Cr AP). No AR, no metal khata, no scrap lot."
                                    : "Posts GL (AP/AR) and metal khata."}
                                {selectedObligationIds.length > 0
                                    ? " Premium scrap clears linked invoices."
                                    : " Premium invoices optional — enter trade rate below."}
                            </p>
                            {hasPremiumLines ? (
                                <ul className="text-[11px] text-zinc-400 mt-1 space-y-0.5 tabular-nums">
                                    {allocationLines.map((l) => (
                                        <li key={l.obligationId}>
                                            {l.allocatedKg.toLocaleString()} kg × {l.refScrapRate.toLocaleString()} ({l.salesInvoiceNo})
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                netWeight > 0 &&
                                manualRate > 0 && (
                                    <p className="text-[11px] text-zinc-400 mt-1 tabular-nums animate-in fade-in duration-200">
                                        {netWeight.toLocaleString()} kg × {manualRate.toLocaleString()} PKR/kg
                                    </p>
                                )
                            )}
                        </div>
                        <div className="flex items-baseline gap-2 shrink-0 sm:ml-auto">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Amount</span>
                            <span className="font-mono text-lg font-semibold text-zinc-900 tabular-nums">
                                {isRatePending ? "—" : `₨ ${totalAmount.toLocaleString()}`}
                            </span>
                        </div>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto shrink-0">
                        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">
                            Close
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => void handleSubmit()}
                            disabled={submitting}
                            className="flex-1 sm:flex-none bg-zinc-900 hover:bg-zinc-800 min-w-[7.5rem]"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                    Posting…
                                </>
                            ) : (
                                "Post scrap"
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            }
        >
            <div
                className={cn(
                    "flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5 space-y-4",
                    thinScrollbarClass,
                )}
            >
                    <FormValidationPanel
                        visible={showValidation}
                        issues={validationIssues}
                        title="Complete these fields before posting"
                    />
                    <Panel title="Parties">
                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end gap-3 sm:gap-2">
                            <Field label="From — gives scrap">
                                <PartyCombobox
                                    value={source}
                                    onValueChange={setSource}
                                    options={allPartyOptions}
                                    placeholder="Select source…"
                                    className={inputClass}
                                />
                            </Field>
                            <div
                                className="hidden sm:flex items-center justify-center h-9 text-zinc-300 shrink-0 px-1"
                                aria-hidden
                            >
                                <ArrowRight className="h-4 w-4" />
                            </div>
                            <div className="flex sm:hidden items-center justify-center text-zinc-300 py-0.5" aria-hidden>
                                <ArrowDown className="h-4 w-4" />
                            </div>
                            <Field label="To — receives scrap">
                                <PartyCombobox
                                    value={destination}
                                    onValueChange={setDestination}
                                    options={allPartyOptions}
                                    placeholder="Select destination…"
                                    className={inputClass}
                                />
                            </Field>
                        </div>
                        {sameParty && (
                            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                Source and destination are the same — pick different parties for AP/AR to post.
                            </p>
                        )}
                    </Panel>

                    {source && !initialData && settlementMode !== "cash" && (
                        <Panel title="Advance scrap on hand">
                            {loadingObl ? (
                                <div className="flex items-center gap-2 text-sm text-zinc-500 py-1 min-h-[4rem]">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading advance scrap…
                                </div>
                            ) : (
                                <div className="animate-in fade-in duration-300">
                                    <ScrapAdvanceCreditPanel
                                        credits={scrapCredits}
                                        physicalKg={netWeight}
                                        selectedIds={selectedCreditIds}
                                        onChangeSelectedIds={setSelectedCreditIds}
                                        allocationLines={creditLines}
                                        onApplySelection={(kg) => {
                                            if (!grossWeight) setGrossWeight(String(kg));
                                            if (!tareWeight) setTareWeight("0");
                                        }}
                                    />
                                </div>
                            )}
                        </Panel>
                    )}

                    {source && !initialData && (
                        <Panel title="Premium scrap due">
                            {loadingObl ? (
                                <div className="flex items-center gap-2 text-sm text-zinc-500 py-1 min-h-[4rem]">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading open invoices…
                                </div>
                            ) : obligations.length === 0 ? (
                                <p className="text-sm text-zinc-500 rounded-lg border border-dashed border-zinc-200 bg-white px-3 py-2.5 animate-in fade-in duration-300">
                                    No open premium scrap for this party — enter rate manually below.
                                </p>
                            ) : (
                                <div className="animate-in fade-in duration-300">
                                    <ScrapObligationAllocationPanel
                                        obligations={obligations}
                                        netKg={obligationNetKg}
                                        selectedIds={selectedObligationIds}
                                        onChangeSelectedIds={setSelectedObligationIds}
                                        allocationLines={allocationLines}
                                        allocationError={allocationError}
                                    />
                                </div>
                            )}
                            {creditAllocatedKg > 0 && (
                                <p className="text-[11px] text-violet-700 mt-2 animate-in fade-in duration-200">
                                    {creditAllocatedKg.toLocaleString()} kg advance +{" "}
                                    {obligationNetKg.toLocaleString()} kg vs invoices (physical{" "}
                                    {netWeight.toLocaleString()} kg)
                                </p>
                            )}
                        </Panel>
                    )}

                    <Panel title="Trade details">
                        <Field label="Trade date">
                            <Input
                                type="date"
                                className={inputClass}
                                value={tradeDate}
                                onChange={(e) => setTradeDate(e.target.value)}
                            />
                        </Field>
                        <Field label="Material">
                            <Select value={itemCode} onValueChange={setItemCode}>
                                <SelectTrigger className={inputClass}>
                                    <SelectValue placeholder="Select scrap item" />
                                </SelectTrigger>
                                <SelectContent>
                                    {scrapItems.map((item) => (
                                        <SelectItem key={item.code} value={item.code}>
                                            {scrapItemLabel(item)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>

                        <div className="flex flex-col gap-2">
                            <Label className="text-[11px] font-medium text-zinc-500">Settlement</Label>
                            <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 w-fit">
                                <button
                                    type="button"
                                    onClick={() => setSettlementMode("triangle")}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                                        settlementMode === "triangle"
                                            ? "bg-zinc-900 text-white"
                                            : "text-zinc-600 hover:text-zinc-900",
                                    )}
                                >
                                    Triangle
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSettlementMode("cash")}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                                        settlementMode === "cash"
                                            ? "bg-emerald-600 text-white"
                                            : "text-zinc-600 hover:text-zinc-900",
                                    )}
                                >
                                    Cash
                                </button>
                            </div>
                            {settlementMode === "cash" && (
                                <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 leading-snug animate-in fade-in slide-in-from-top-1 duration-200">
                                    Cash mode: destination pays cash immediately (Dr Cash in hand). No AR
                                    document, no metal khata movement, and no scrap lot created — so this
                                    trade will not appear in the Purchase premium-scrap panel to deduct
                                    against wire-8/rod. The source party is still owed via AP, and any
                                    linked premium scrap obligation is still cleared.
                                </p>
                            )}
                        </div>

                        <div className={cn("grid gap-3", showManualRate ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3")}>
                            <Field label="Gross (kg)">
                                <Input
                                    type="number"
                                    inputMode="decimal"
                                    className={inputClass}
                                    value={grossWeight}
                                    onChange={(e) => setGrossWeight(e.target.value)}
                                    placeholder="0"
                                />
                            </Field>
                            <Field label="Tare (kg)">
                                <Input
                                    type="number"
                                    inputMode="decimal"
                                    className={inputClass}
                                    value={tareWeight}
                                    onChange={(e) => setTareWeight(e.target.value)}
                                    placeholder="0"
                                />
                            </Field>
                            <Field label="Net (kg)">
                                <ReadonlyValue value={netWeight.toLocaleString()} emphasize />
                            </Field>
                            {showManualRate && (
                                <>
                                    <Field label="Rate (PKR/kg)">
                                        <Input
                                            type="number"
                                            inputMode="decimal"
                                            className={inputClass}
                                            value={rate}
                                            onChange={(e) => setRate(e.target.value)}
                                            placeholder="3600"
                                            disabled={rateStatus === "pending"}
                                        />
                                    </Field>
                                </>
                            )}
                        </div>
                        {showManualRate && (
                            <div className="space-y-2">
                                <RateStatusCell value={rateStatus} onChange={setRateStatus} />
                                {rateStatus === "pending" && (
                                    <Field label="Pending reason">
                                        <PendingReasonSelect value={pendingReason} onChange={setPendingReason} />
                                    </Field>
                                )}
                            </div>
                        )}
                        {hasPremiumLines && (
                            <p className="text-[11px] text-zinc-500">
                                Rate and amount are per linked invoice in the table above — not averaged.
                            </p>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label="Bilty no.">
                                <Input
                                    className={inputClass}
                                    value={biltyNo}
                                    onChange={(e) => setBiltyNo(e.target.value)}
                                    placeholder="Optional"
                                />
                            </Field>
                            <Field label="Vehicle no.">
                                <Input
                                    className={inputClass}
                                    value={vehicleNo}
                                    onChange={(e) => setVehicleNo(e.target.value)}
                                    placeholder="Optional"
                                />
                            </Field>
                        </div>
                    </Panel>
            </div>
        </InvoiceModalShell>
    );
}
