import { forwardRef, type ReactNode, useMemo } from "react";
import { ModalErrorBoundary } from "@/components/error/ModalErrorBoundary";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { invoiceInputClass } from "@/components/invoices/InvoiceFormLayout";
import { cn } from "@/lib/utils";
import { formatPkr, type CashbookClearanceMode, type CashbookEntryMode, type CashbookVoucherType } from "@/lib/cashbookTypes";
import type { CashbookAccountOption } from "@/lib/coaSelectors";
import type { computeParchiClearancePlan } from "@/lib/parchiClearance";
import { partyParchiOptions } from "@/lib/parchiClearance";
import {
    BookOpen,
    Building2,
    Check,
    ChevronsUpDown,
    ArrowLeftRight,
    Save,
    Trash2,
    UserRound,
} from "lucide-react";

const DEFAULT_CASHBOOK_BANK_CODE = "11102";

const inputClass = cn(invoiceInputClass, "h-10 bg-white");

type Accent = "green" | "red" | "blue";

function accentStyles(accent: Accent) {
    if (accent === "blue") {
        return {
            pill: "bg-white text-blue-700 ring-1 ring-blue-200 shadow-sm",
            btn: "bg-blue-600 hover:bg-blue-700 text-white",
            hint: "text-blue-700/90",
            border: "border-l-blue-500",
        };
    }
    if (accent === "red") {
        return {
            pill: "bg-white text-rose-700 ring-1 ring-rose-200 shadow-sm",
            btn: "bg-rose-600 hover:bg-rose-700 text-white",
            hint: "text-rose-700/90",
            border: "border-l-rose-500",
        };
    }
    return {
        pill: "bg-white text-emerald-700 ring-1 ring-emerald-200 shadow-sm",
        btn: "bg-emerald-600 hover:bg-emerald-700 text-white",
        hint: "text-emerald-700/90",
        border: "border-l-emerald-500",
    };
}

function PartyCombobox({
    value,
    open,
    onOpenChange,
    options,
    placeholder,
    onSelect,
    excludeId,
}: {
    value: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    options: CashbookAccountOption[];
    placeholder: string;
    onSelect: (id: string) => void;
    excludeId?: string;
}) {
    const label = value
        ? (options.find((p) => p.id === value)?.name ?? value)
        : null;
    const filtered = excludeId ? options.filter((p) => p.id !== excludeId) : options;

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="h-10 w-full justify-between font-normal border-slate-200/80 bg-white hover:bg-slate-50/80"
                >
                    <span className="flex min-w-0 items-center gap-2 truncate text-sm text-slate-800">
                        {value ? <UserRound className="h-3.5 w-3.5 shrink-0 text-blue-500" /> : null}
                        {label ?? placeholder}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-30" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search party…" className="h-9" />
                    <CommandList className="max-h-[min(280px,40vh)]">
                        <CommandEmpty>No party found</CommandEmpty>
                        <CommandGroup heading="Parties">
                            {filtered.map((acc) => (
                                <CommandItem
                                    key={acc.id}
                                    value={`${acc.id} ${acc.name}`}
                                    onSelect={() => {
                                        onSelect(acc.id);
                                        onOpenChange(false);
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === acc.id ? "opacity-100" : "opacity-0",
                                        )}
                                    />
                                    {acc.name}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function Field({
    label,
    children,
    className,
}: {
    label: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("space-y-1.5", className)}>
            <Label className="text-xs font-medium text-slate-600">{label}</Label>
            {children}
        </div>
    );
}

/** Soft two-option toggle — inactive options stay neutral (easy on the eyes). */
function SoftToggle({
    value,
    onChange,
    options,
    accent,
}: {
    value: string;
    onChange: (id: string) => void;
    options: { id: string; label: string }[];
    accent: Accent;
}) {
    const activeStyle = accentStyles(accent).pill;
    return (
        <div className="flex gap-1 rounded-lg bg-slate-100/70 p-1">
            {options.map((opt) => (
                <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChange(opt.id)}
                    className={cn(
                        "flex-1 rounded-md py-2 text-sm font-medium transition-colors",
                        value === opt.id ? activeStyle : "text-slate-500 hover:text-slate-700",
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

export type CashbookEntryFormProps = {
    editingId: string | null;
    voucherId: string;
    pageNo: string;
    date: string;
    entryMode: CashbookEntryMode;
    actionType: CashbookVoucherType;
    clearanceMode: CashbookClearanceMode;
    selectedAccount: string;
    receivingPartyCode: string;
    amount: string;
    desc: string;
    accountOpen: boolean;
    receivingPartyOpen: boolean;
    onAccountOpenChange: (open: boolean) => void;
    onReceivingPartyOpenChange: (open: boolean) => void;
    accountOptions: CashbookAccountOption[];
    coaNameMap: Record<string, string>;
    liveMode: boolean;
    selectedIsParty: boolean;
    resolvePartyName: (code: string) => string;
    receiptAmount: number;
    currentBalance: number;
    selectedParchiId: string;
    additionalParchiIds: string[];
    applyRemainderAsCash: boolean;
    isAdvance: boolean;
    partyParchisForAccount: Array<{
        parchi_id: string;
        available_balance: number;
        total_amount: number;
    }>;
    additionalParchiOptions: Array<{ parchi_id: string; available_balance: number }>;
    selectedParchi?: { total_amount: number; available_balance: number };
    parchiClearancePlan: ReturnType<typeof computeParchiClearancePlan> | null;
    isReadyToSave: boolean;
    onDateChange: (v: string) => void;
    onPageNoChange: (v: string) => void;
    onEntryModeChange: (v: CashbookEntryMode) => void;
    onActionTypeChange: (v: CashbookVoucherType) => void;
    onClearanceModeChange: (v: CashbookClearanceMode) => void;
    onSelectedAccountChange: (v: string) => void;
    onReceivingPartyCodeChange: (v: string) => void;
    onSwapParties: () => void;
    onAmountChange: (v: string) => void;
    onDescChange: (v: string) => void;
    onSelectedParchiIdChange: (v: string) => void;
    onAdditionalParchiIdsChange: (ids: string[]) => void;
    onApplyRemainderAsCashChange: (v: boolean) => void;
    onIsAdvanceChange: (v: boolean) => void;
    onSave: () => void;
    onDelete: () => void;
    onReset: () => void;
    accountBtnRef: React.RefObject<HTMLButtonElement | null>;
    amountInputRef?: React.RefObject<HTMLInputElement | null>;
};

export const CashbookEntryForm = forwardRef<HTMLDivElement, CashbookEntryFormProps>(
    function CashbookEntryForm(props, ref) {
        const {
            editingId,
            pageNo,
            date,
            entryMode,
            actionType,
            clearanceMode,
            selectedAccount,
            receivingPartyCode,
            amount,
            desc,
            accountOpen,
            receivingPartyOpen,
            onAccountOpenChange,
            onReceivingPartyOpenChange,
            accountOptions,
            coaNameMap,
            liveMode,
            selectedIsParty,
            resolvePartyName,
            receiptAmount,
            currentBalance,
            selectedParchiId,
            additionalParchiIds,
            applyRemainderAsCash,
            isAdvance,
            partyParchisForAccount,
            additionalParchiOptions,
            selectedParchi,
            parchiClearancePlan,
            isReadyToSave,
            onDateChange,
            onPageNoChange,
            onEntryModeChange,
            onActionTypeChange,
            onClearanceModeChange,
            onSelectedAccountChange,
            onReceivingPartyCodeChange,
            onSwapParties,
            onAmountChange,
            onDescChange,
            onSelectedParchiIdChange,
            onAdditionalParchiIdsChange,
            onApplyRemainderAsCashChange,
            onIsAdvanceChange,
            onSave,
            onDelete,
            onReset,
            accountBtnRef,
            amountInputRef,
        } = props;

        const isCrossParty = entryMode === "cross_party";
        const isReceipt = actionType === "CRV";
        const isParchiMode = clearanceMode === "Clear Parchi" && (isCrossParty || isReceipt);
        const accent: Accent = isCrossParty ? "blue" : isParchiMode ? "blue" : isReceipt ? "green" : "red";
        const styles = accentStyles(accent);

        const cashBankLabel = coaNameMap[DEFAULT_CASHBOOK_BANK_CODE]
            ? coaNameMap[DEFAULT_CASHBOOK_BANK_CODE]
            : "Main cash / bank";

        const projected = isReceipt ? currentBalance + receiptAmount : currentBalance - receiptAmount;

        const accountLabel =
            selectedAccount
                ? (accountOptions.find((a) => a.id === selectedAccount)?.name ??
                  (liveMode ? resolvePartyName(selectedAccount) : selectedAccount))
                : null;

        const { partyOptions, glByType } = useMemo(() => {
            const parties = accountOptions.filter((a) => a.kind === "party");
            const gl = accountOptions.filter((a) => a.kind === "gl");
            const typeOrder = ["expense", "income", "asset", "liability", "equity"] as const;
            const typeLabels: Record<string, string> = {
                expense: "Expenses",
                income: "Income",
                asset: "Assets",
                liability: "Liabilities",
                equity: "Equity",
            };
            const buckets = new Map<string, typeof gl>();
            for (const acc of gl) {
                const key = acc.accountType ?? "other";
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key)!.push(acc);
            }
            const ordered: { label: string; items: typeof gl }[] = [];
            for (const t of typeOrder) {
                const items = buckets.get(t);
                if (items?.length) ordered.push({ label: typeLabels[t] ?? t, items });
                buckets.delete(t);
            }
            for (const [t, items] of buckets) {
                if (items.length) ordered.push({ label: typeLabels[t] ?? t, items });
            }
            return { partyOptions: parties, glByType: ordered };
        }, [accountOptions]);

        const payingPartyLabel = selectedAccount
            ? (partyOptions.find((p) => p.id === selectedAccount)?.name ?? resolvePartyName(selectedAccount))
            : null;
        const receivingPartyLabel = receivingPartyCode
            ? (partyOptions.find((p) => p.id === receivingPartyCode)?.name ?? resolvePartyName(receivingPartyCode))
            : null;

        const journalLine = useMemo(() => {
            if (receiptAmount <= 0) return null;
            if (isCrossParty) {
                if (!selectedAccount || !receivingPartyCode) return null;
                let parchiSuffix = "";
                if (isParchiMode && parchiClearancePlan?.ok) {
                    const parchiPart = parchiClearancePlan.allocations
                        .map((a) => `${a.parchiNo} ${formatPkr(a.amount)}`)
                        .join(", ");
                    const onAccountPart =
                        parchiClearancePlan.cashAmount > 0
                            ? `; On account ${formatPkr(parchiClearancePlan.cashAmount)}`
                            : "";
                    parchiSuffix = ` · ${parchiPart}${onAccountPart}`;
                }
                return `Dr AP ${receivingPartyLabel ?? receivingPartyCode} · Cr AR ${payingPartyLabel ?? selectedAccount} · ${formatPkr(receiptAmount)} (no cash)${parchiSuffix}`;
            }
            if (!selectedAccount) return null;
            const counter = accountLabel ?? selectedAccount;
            if (isParchiMode) {
                if (parchiClearancePlan?.ok) {
                    const parchiPart = parchiClearancePlan.allocations
                        .map((a) => `${a.parchiNo} ${formatPkr(a.amount)}`)
                        .join(", ");
                    const cashPart =
                        parchiClearancePlan.cashAmount > 0
                            ? `; Cash ${formatPkr(parchiClearancePlan.cashAmount)}`
                            : "";
                    return `Dr ${cashBankLabel} · Cr ${counter} · ${formatPkr(receiptAmount)} (${parchiPart}${cashPart})`;
                }
                return `Dr ${cashBankLabel} · Cr ${counter} · ${formatPkr(receiptAmount)} (parchi clearance)`;
            }
            if (isReceipt) {
                return `Dr ${cashBankLabel} · Cr ${counter} (AR / auto-advance if overpay) · ${formatPkr(receiptAmount)}`;
            }
            return `Dr ${counter} (AP / auto-advance if overpay) · Cr ${cashBankLabel} · ${formatPkr(receiptAmount)}`;
        }, [
            receiptAmount,
            selectedAccount,
            receivingPartyCode,
            payingPartyLabel,
            receivingPartyLabel,
            accountLabel,
            isCrossParty,
            isParchiMode,
            isReceipt,
            cashBankLabel,
            parchiClearancePlan,
        ]);

        const additionalSlipSlotCount = useMemo(() => {
            if (applyRemainderAsCash) return additionalParchiIds.length;
            if (!parchiClearancePlan || parchiClearancePlan.ok) return additionalParchiIds.length;
            if (parchiClearancePlan.needsMoreParchi) {
                return Math.max(additionalParchiIds.length + 1, 1);
            }
            return additionalParchiIds.length;
        }, [parchiClearancePlan, additionalParchiIds.length, applyRemainderAsCash]);

        const unallocatedRemainderAmount = useMemo(() => {
            if (!parchiClearancePlan) return 0;
            if (parchiClearancePlan.ok) return parchiClearancePlan.cashAmount;
            return parchiClearancePlan.unallocatedRemainder ?? 0;
        }, [parchiClearancePlan]);

        const handleSubmit = (e: React.FormEvent) => {
            e.preventDefault();
            if (isReadyToSave) onSave();
        };

        return (
            <ModalErrorBoundary onReset={onReset}>
            <div ref={ref} className="w-full">
                <form
                    onSubmit={handleSubmit}
                    className={cn(
                        "rounded-xl border border-slate-200/80 bg-white shadow-soft border-l-[3px]",
                        styles.border,
                    )}
                >
                    {/* Title row */}
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">
                                {editingId ? "Edit entry" : "New entry"}
                            </h2>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                {isCrossParty
                                    ? "Online slip — customer pays supplier, zero cash impact"
                                    : `Posts to ${cashBankLabel}`}
                            </p>
                        </div>
                        <div className="text-right text-[11px] text-slate-400 tabular-nums">
                            Page <span className="font-mono text-slate-600">{pageNo || "1"}</span>
                        </div>
                    </div>

                    <div className="space-y-4 px-5 py-4">
                        {editingId ? (
                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>Editing entry</span>
                                <button
                                    type="button"
                                    onClick={onReset}
                                    className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : null}

                        {/* Entry mode */}
                        <SoftToggle
                            value={entryMode}
                            onChange={(v) => onEntryModeChange(v as CashbookEntryMode)}
                            accent="blue"
                            options={[
                                { id: "standard", label: "Cash entry" },
                                { id: "cross_party", label: "Cross-party" },
                            ]}
                        />

                        {/* Type — standard only */}
                        {!isCrossParty ? (
                        <SoftToggle
                            value={actionType}
                            onChange={(v) => onActionTypeChange(v as CashbookVoucherType)}
                            accent={actionType === "CPV" ? "red" : isParchiMode ? "blue" : "green"}
                            options={[
                                { id: "CRV", label: "Receipt" },
                                { id: "CPV", label: "Payment" },
                            ]}
                        />
                        ) : null}

                        {/* 2 — Date & page */}
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Date">
                                <Input
                                    type="date"
                                    className={inputClass}
                                    value={date}
                                    onChange={(e) => onDateChange(e.target.value)}
                                />
                            </Field>
                            <Field label="Page">
                                <Input
                                    className={cn(inputClass, "font-mono tabular-nums")}
                                    value={pageNo}
                                    onChange={(e) => onPageNoChange(e.target.value)}
                                    inputMode="numeric"
                                />
                            </Field>
                        </div>

                        {/* Method (receipts and cross-party) */}
                        {isCrossParty || isReceipt ? (
                            <Field label="Method">
                                <SoftToggle
                                    value={clearanceMode}
                                    onChange={(v) => onClearanceModeChange(v as CashbookClearanceMode)}
                                    accent={clearanceMode === "Clear Parchi" || isCrossParty ? "blue" : "green"}
                                    options={[
                                        { id: "Cash", label: isCrossParty ? "On account" : "Cash / bank" },
                                        { id: "Clear Parchi", label: "Clear parchi" },
                                    ]}
                                />
                            </Field>
                        ) : null}

                        {/* Account / parties */}
                        {isCrossParty ? (
                            <div className="space-y-3">
                                <Field label="Paying party (sent online slip)">
                                    <PartyCombobox
                                        value={selectedAccount}
                                        open={accountOpen}
                                        onOpenChange={onAccountOpenChange}
                                        options={partyOptions}
                                        placeholder="Customer who transferred funds"
                                        onSelect={onSelectedAccountChange}
                                        excludeId={receivingPartyCode}
                                    />
                                </Field>
                                <div className="flex justify-center">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-2 text-xs"
                                        onClick={onSwapParties}
                                        disabled={!selectedAccount && !receivingPartyCode}
                                    >
                                        <ArrowLeftRight className="h-3.5 w-3.5" />
                                        Swap parties
                                    </Button>
                                </div>
                                <Field label="Receiving party (got the funds)">
                                    <PartyCombobox
                                        value={receivingPartyCode}
                                        open={receivingPartyOpen}
                                        onOpenChange={onReceivingPartyOpenChange}
                                        options={partyOptions}
                                        placeholder="Supplier who received funds"
                                        onSelect={onReceivingPartyCodeChange}
                                        excludeId={selectedAccount}
                                    />
                                </Field>
                            </div>
                        ) : (
                        <Field label={isParchiMode ? "Party" : isReceipt ? "Received from" : "Paid to"}>
                            <div className="flex gap-2">
                                <Popover open={accountOpen} onOpenChange={onAccountOpenChange}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            role="combobox"
                                            aria-expanded={accountOpen}
                                            className={cn(
                                                "h-10 w-full justify-between font-normal border-slate-200/80 bg-white hover:bg-slate-50/80",
                                            )}
                                            ref={accountBtnRef}
                                        >
                                            <span className="flex min-w-0 items-center gap-2 truncate text-sm text-slate-800">
                                                {selectedAccount && selectedIsParty ? (
                                                    <UserRound
                                                        className={cn(
                                                            "h-3.5 w-3.5 shrink-0",
                                                            isParchiMode ? "text-blue-500" : "text-slate-400",
                                                        )}
                                                    />
                                                ) : selectedAccount ? (
                                                    <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                                ) : null}
                                                {accountLabel ?? "Select party or account"}
                                            </span>
                                            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-30" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
                                        align="start"
                                    >
                                        <Command>
                                            <CommandInput placeholder="Search…" className="h-9" />
                                            <CommandList className="max-h-[min(320px,45vh)]">
                                                <CommandEmpty>No results</CommandEmpty>
                                                {partyOptions.length > 0 ? (
                                                    <CommandGroup heading="Parties">
                                                        {partyOptions.map((acc) => (
                                                            <CommandItem
                                                                key={acc.id}
                                                                value={`${acc.id} ${acc.name}`}
                                                                onSelect={() => {
                                                                    onSelectedAccountChange(acc.id);
                                                                    onAccountOpenChange(false);
                                                                }}
                                                            >
                                                                <Check
                                                                    className={cn(
                                                                        "mr-2 h-4 w-4",
                                                                        selectedAccount === acc.id
                                                                            ? "opacity-100"
                                                                            : "opacity-0",
                                                                    )}
                                                                />
                                                                {acc.name}
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                ) : null}
                                                {partyOptions.length > 0 && glByType.length > 0 ? (
                                                    <CommandSeparator />
                                                ) : null}
                                                {glByType.map((group) => (
                                                    <CommandGroup key={group.label} heading={group.label}>
                                                        {group.items.map((acc) => (
                                                            <CommandItem
                                                                key={acc.id}
                                                                value={`${acc.id} ${acc.name}`}
                                                                onSelect={() => {
                                                                    onSelectedAccountChange(acc.id);
                                                                    onAccountOpenChange(false);
                                                                }}
                                                            >
                                                                <Check
                                                                    className={cn(
                                                                        "mr-2 h-4 w-4",
                                                                        selectedAccount === acc.id
                                                                            ? "opacity-100"
                                                                            : "opacity-0",
                                                                    )}
                                                                />
                                                                <span className="truncate text-xs">{acc.name}</span>
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                ))}
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                {selectedAccount && liveMode && selectedIsParty ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-10 shrink-0 border-slate-200/80"
                                        asChild
                                    >
                                        <Link
                                            to={`/reports?report=unified-ledgers&party=${encodeURIComponent(selectedAccount)}&parchi=1`}
                                            title="Party ledger"
                                        >
                                            <BookOpen className="h-4 w-4 text-slate-400" />
                                        </Link>
                                    </Button>
                                ) : null}
                            </div>
                        </Field>
                        )}

                        {/* 5 — Amount (standard field, easy to type) */}
                        <Field label="Amount (PKR)">
                            <div className="relative">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                                    ₨
                                </span>
                                <Input
                                    ref={amountInputRef}
                                    type="number"
                                    min={0}
                                    step="any"
                                    inputMode="decimal"
                                    className={cn(
                                        inputClass,
                                        "pl-8 text-right font-mono text-lg tabular-nums tracking-tight",
                                    )}
                                    placeholder="0"
                                    value={amount}
                                    onChange={(e) => onAmountChange(e.target.value)}
                                    disabled={isParchiMode && !selectedParchiId}
                                    autoComplete="off"
                                />
                            </div>
                            {receiptAmount > 0 && clearanceMode === "Cash" && !isCrossParty ? (
                                <p className={cn("text-[11px] tabular-nums", styles.hint)}>
                                    Balance after: {formatPkr(projected)}
                                </p>
                            ) : null}
                        </Field>

                        {/* 6 — Parchi details or description */}
                        {isParchiMode ? (
                            <div className="space-y-3 rounded-lg bg-slate-50/80 px-3 py-3">
                                <Field label="Parchi slip">
                                    <Select
                                        value={selectedParchiId}
                                        onValueChange={(v) => {
                                            onSelectedParchiIdChange(v);
                                        }}
                                        disabled={!selectedAccount}
                                    >
                                        <SelectTrigger className={inputClass}>
                                            <SelectValue
                                                placeholder={
                                                    selectedAccount ? "Choose slip…" : "Select party first"
                                                }
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {partyParchisForAccount
                                                .filter(
                                                    (p) =>
                                                        p.available_balance > 0 ||
                                                        p.parchi_id === selectedParchiId,
                                                )
                                                .map((p) => (
                                                    <SelectItem key={p.parchi_id} value={p.parchi_id}>
                                                        {p.parchi_id} — {formatPkr(p.available_balance)} open
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                </Field>

                                {selectedParchi ? (
                                    <p className="text-[11px] text-slate-500 tabular-nums">
                                        Open {formatPkr(selectedParchi.available_balance)} of{" "}
                                        {formatPkr(selectedParchi.total_amount)}
                                    </p>
                                ) : null}

                                {additionalSlipSlotCount > 0 &&
                                    Array.from({ length: additionalSlipSlotCount }, (_, slotIndex) => {
                                        const value = additionalParchiIds[slotIndex] ?? "";
                                        const excludeIds = [
                                            selectedParchiId,
                                            ...additionalParchiIds.slice(0, slotIndex),
                                            ...additionalParchiIds.slice(slotIndex + 1),
                                        ].filter(Boolean);
                                        const options = partyParchiOptions(partyParchisForAccount, {
                                            excludeParchiIds: excludeIds,
                                            includeParchiId: value || undefined,
                                        });
                                        return (
                                            <Field
                                                key={`additional-parchi-${slotIndex}`}
                                                label={`Additional slip ${slotIndex + 1}`}
                                            >
                                                <Select
                                                    value={value}
                                                    onValueChange={(v) => {
                                                        const next = [...additionalParchiIds];
                                                        next[slotIndex] = v;
                                                        onAdditionalParchiIdsChange(next.slice(0, slotIndex + 1));
                                                        onApplyRemainderAsCashChange(false);
                                                    }}
                                                >
                                                    <SelectTrigger className={inputClass}>
                                                        <SelectValue placeholder="Select…" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {options.map((p) => (
                                                            <SelectItem key={p.parchi_id} value={p.parchi_id}>
                                                                {p.parchi_id} — {formatPkr(p.available_balance)}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </Field>
                                        );
                                    })}

                                {unallocatedRemainderAmount > 0.001 ? (
                                    <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-3 space-y-2">
                                        <div className="flex items-start gap-2">
                                            <Checkbox
                                                id="apply-remainder-cash"
                                                checked={applyRemainderAsCash}
                                                onCheckedChange={(checked) =>
                                                    onApplyRemainderAsCashChange(checked === true)
                                                }
                                            />
                                            <label
                                                htmlFor="apply-remainder-cash"
                                                className="text-xs text-amber-950 leading-relaxed cursor-pointer"
                                            >
                                                Record {formatPkr(unallocatedRemainderAmount)}{" "}
                                                {isCrossParty ? "on account" : "as cash"} (not applied to a parchi).
                                                You can use this instead of selecting another slip.
                                            </label>
                                        </div>
                                        {applyRemainderAsCash ? (
                                            <p className="text-[11px] text-amber-900 pl-6">
                                                Add a note below describing this{" "}
                                                {isCrossParty ? "on-account" : "cash"} portion (e.g. advance, on
                                                account).
                                            </p>
                                        ) : null}
                                    </div>
                                ) : null}

                                {parchiClearancePlan &&
                                !parchiClearancePlan.ok &&
                                parchiClearancePlan.needsMoreParchi &&
                                !applyRemainderAsCash &&
                                additionalParchiOptions.length > 0 &&
                                receiptAmount > 0 ? (
                                    <p className="text-[11px] text-slate-500">
                                        {formatPkr(parchiClearancePlan.unallocatedRemainder ?? 0)} still unallocated —
                                        pick another slip above or apply {isCrossParty ? "on account" : "as cash"} below.
                                    </p>
                                ) : null}

                                {parchiClearancePlan &&
                                !parchiClearancePlan.ok &&
                                !parchiClearancePlan.needsMoreParchi &&
                                receiptAmount > 0 ? (
                                    <p className="text-xs text-rose-600">{parchiClearancePlan.error}</p>
                                ) : null}

                                {parchiClearancePlan?.ok && receiptAmount > 0 ? (
                                    <p className="text-[11px] text-slate-600 leading-relaxed">
                                        {parchiClearancePlan.remarks}
                                    </p>
                                ) : null}

                                <Field
                                    label={
                                        applyRemainderAsCash
                                            ? isCrossParty
                                                ? "Note (required for on-account portion)"
                                                : "Note (required for cash portion)"
                                            : "Note (optional)"
                                    }
                                >
                                    <Input
                                        className={inputClass}
                                        value={desc}
                                        onChange={(e) => onDescChange(e.target.value)}
                                        disabled={!selectedParchiId}
                                        placeholder={
                                            applyRemainderAsCash
                                                ? isCrossParty
                                                    ? "Describe on-account portion"
                                                    : "Describe cash portion (e.g. advance on account)"
                                                : isCrossParty
                                                  ? "Slip no., WhatsApp group, bank ref…"
                                                  : "Remarks"
                                        }
                                    />
                                </Field>
                            </div>
                        ) : (
                            <Field label={isCrossParty ? "Reference / remarks" : "Description"}>
                                <Textarea
                                    className={cn(inputClass, "min-h-[72px] resize-none py-2.5")}
                                    value={desc}
                                    onChange={(e) => onDescChange(e.target.value)}
                                    placeholder={
                                        isCrossParty
                                            ? "Slip no., WhatsApp group, bank ref…"
                                            : "What is this for?"
                                    }
                                    rows={2}
                                />
                            </Field>
                        )}

                        {!isCrossParty && !isParchiMode && selectedIsParty ? (
                            <p className="text-[11px] text-slate-500 leading-snug border border-slate-100 rounded-lg px-3 py-2 bg-slate-50/60">
                                Overpayments auto-route to Special G/L advances (21104 / 11203). Apply later via{" "}
                                <span className="font-medium text-slate-700">Settle advances</span>.
                            </p>
                        ) : null}

                        {journalLine ? (
                            <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">
                                {journalLine}
                            </p>
                        ) : null}
                    </div>

                    {/* Actions — always at bottom of flow */}
                    <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-4">
                        <Button
                            type="submit"
                            disabled={!isReadyToSave}
                            className={cn(
                                "h-10 w-full rounded-lg text-sm font-medium",
                                isReadyToSave ? styles.btn : "bg-slate-200 text-slate-500 hover:bg-slate-200",
                            )}
                        >
                            <Save className="mr-2 h-4 w-4" />
                            {editingId ? "Save" : "Post entry"}
                        </Button>
                        {!isReadyToSave ? (
                            <p className="text-center text-[11px] text-slate-400">
                                {isCrossParty
                                    ? !selectedAccount || !receivingPartyCode
                                        ? "Select both parties"
                                        : selectedAccount === receivingPartyCode
                                          ? "Parties must be different"
                                          : receiptAmount <= 0
                                            ? "Enter amount"
                                            : isParchiMode
                                              ? applyRemainderAsCash && !desc.trim()
                                                  ? "Add a note for the on-account portion"
                                                  : "Complete parchi details"
                                              : "Add reference or remarks"
                                    : !selectedAccount
                                      ? "Select an account"
                                      : receiptAmount <= 0
                                        ? "Enter amount"
                                        : isParchiMode
                                          ? applyRemainderAsCash && !desc.trim()
                                            ? "Add a note for the cash portion"
                                            : "Complete parchi details"
                                          : "Add description"}
                            </p>
                        ) : null}
                        {editingId ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-9 text-rose-600 hover:text-rose-700 hover:bg-rose-50/80"
                                onClick={onDelete}
                            >
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                Delete entry
                            </Button>
                        ) : null}
                    </div>
                </form>
            </div>
            </ModalErrorBoundary>
        );
    },
);
