import { useMemo, type ReactNode } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PartyCombobox, type PartyComboboxOption } from "@/components/masters/PartyCombobox";
import { thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";
import { invoiceInputClass } from "@/components/invoices/InvoiceFormLayout";
import { ParchiSlip } from "@/components/parchi/ParchiSlip";
import { cn } from "@/lib/utils";
import { resolvePartyName } from "@/lib/partyCatalog";
import type { ParchiFormValues, ParchiRegisterRow } from "@/lib/parchiTypes";

interface IssueParchiModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editing: ParchiRegisterRow | null;
    values: ParchiFormValues;
    onChange: <K extends keyof ParchiFormValues>(key: K, value: ParchiFormValues[K]) => void;
    parties: { id: string; name: string }[];
    onSave: () => void;
    saving?: boolean;
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
            <Label className="text-[11px] font-medium text-zinc-500">{label}</Label>
            {children}
        </div>
    );
}

export function IssueParchiModal({
    open,
    onOpenChange,
    editing,
    values,
    onChange,
    parties,
    onSave,
    saving,
}: IssueParchiModalProps) {
    const previewRow: ParchiRegisterRow = useMemo(
        () => ({
            id: editing?.id ?? "Auto-Generated",
            parchi_type: values.parchiType,
            date: values.date,
            due_date: values.dueDate,
            party: values.party ? resolvePartyName(values.party, values.party) : "",
            total_amount: Number(values.amount) || 0,
            cleared_amount: editing?.cleared_amount ?? 0,
            available_balance: Number(values.amount) || 0,
            status: editing?.status ?? "Pending",
            bank: values.bank,
            cheque_no: values.chequeNo,
            guarantor: values.guarantor,
            narration: values.narration,
            direction: values.direction,
        }),
        [editing, values],
    );

    const canSave = Boolean(values.party && values.amount && values.dueDate);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-none w-[96vw] sm:max-w-5xl p-0 gap-0 overflow-hidden border-zinc-200/80 shadow-2xl rounded-2xl">
                <div className="px-6 py-4 border-b border-zinc-200/60 bg-white">
                    <DialogTitle className="text-base font-semibold tracking-tight text-zinc-900">
                        {editing ? "Edit parchi" : "Issue parchi"}
                    </DialogTitle>
                    <DialogDescription className="text-[11px] text-zinc-500 mt-0.5">
                        Hwala commitment — no party ledger impact until cleared in cashbook.
                    </DialogDescription>
                </div>

                <div className="flex flex-col lg:flex-row min-h-0 max-h-[min(78vh,720px)]">
                    {/* Form */}
                    <div
                        className={cn(
                            "flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-5 bg-white lg:border-r border-zinc-200/70",
                            thinScrollbarClass,
                        )}
                    >
                        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-zinc-100/80 ring-1 ring-zinc-200/60">
                            <button
                                type="button"
                                onClick={() => onChange("parchiType", "Company Parchi")}
                                className={cn(
                                    "rounded-lg py-2 text-xs font-semibold transition-all",
                                    values.parchiType === "Company Parchi"
                                        ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
                                        : "text-zinc-500 hover:text-zinc-700",
                                )}
                            >
                                Company parchi
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange("parchiType", "Bank Cheque")}
                                className={cn(
                                    "rounded-lg py-2 text-xs font-semibold transition-all",
                                    values.parchiType === "Bank Cheque"
                                        ? "bg-white text-sky-900 shadow-sm ring-1 ring-sky-200/80"
                                        : "text-zinc-500 hover:text-zinc-700",
                                )}
                            >
                                Bank cheque
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-zinc-100/80 ring-1 ring-zinc-200/60">
                            <button
                                type="button"
                                onClick={() => onChange("direction", "Received")}
                                className={cn(
                                    "rounded-lg py-2 text-xs font-semibold transition-all",
                                    values.direction === "Received"
                                        ? "bg-emerald-600 text-white shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-700",
                                )}
                            >
                                Received
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange("direction", "Issued")}
                                className={cn(
                                    "rounded-lg py-2 text-xs font-semibold transition-all",
                                    values.direction === "Issued"
                                        ? "bg-zinc-900 text-white shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-700",
                                )}
                            >
                                Issued
                            </button>
                        </div>

                        <Field label="Party">
                            <PartyCombobox
                                value={values.party}
                                onValueChange={(v) => onChange("party", v)}
                                options={parties as PartyComboboxOption[]}
                                placeholder="Search party…"
                                triggerClassName={invoiceInputClass}
                                highlightWhenEmpty
                            />
                        </Field>

                        {values.parchiType === "Bank Cheque" ? (
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Cheque no.">
                                    <Input
                                        className={cn(invoiceInputClass, "font-mono")}
                                        placeholder="838192"
                                        value={values.chequeNo}
                                        onChange={(e) => onChange("chequeNo", e.target.value)}
                                    />
                                </Field>
                                <Field label="Bank">
                                    <Input
                                        className={invoiceInputClass}
                                        placeholder="Meezan Bank"
                                        value={values.bank}
                                        onChange={(e) => onChange("bank", e.target.value)}
                                    />
                                </Field>
                            </div>
                        ) : null}

                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Issue date">
                                <Input
                                    type="date"
                                    className={invoiceInputClass}
                                    value={values.date}
                                    onChange={(e) => onChange("date", e.target.value)}
                                />
                            </Field>
                            <Field label="Due date">
                                <Input
                                    type="date"
                                    className={cn(invoiceInputClass, "font-medium")}
                                    value={values.dueDate}
                                    onChange={(e) => onChange("dueDate", e.target.value)}
                                />
                            </Field>
                        </div>

                        <Field label="Amount (PKR)">
                            <Input
                                type="number"
                                className={cn(
                                    invoiceInputClass,
                                    "h-11 text-lg font-mono font-bold tabular-nums",
                                )}
                                placeholder="0"
                                value={values.amount}
                                onChange={(e) => onChange("amount", e.target.value)}
                            />
                        </Field>

                        <Field label="Guarantor (optional)">
                            <Select value={values.guarantor} onValueChange={(v) => onChange("guarantor", v)}>
                                <SelectTrigger className={invoiceInputClass}>
                                    <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="Broker A">Broker A</SelectItem>
                                    <SelectItem value="Broker B">Broker B</SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>

                        <Field label="Narration">
                            <Input
                                className={invoiceInputClass}
                                placeholder="Against wire delivery, bilty ref…"
                                value={values.narration}
                                onChange={(e) => onChange("narration", e.target.value)}
                            />
                        </Field>
                    </div>

                    {/* Live preview */}
                    <div className="hidden lg:flex flex-col w-[min(100%,340px)] shrink-0 bg-zinc-50/80 border-l border-zinc-200/60">
                        <div className="px-5 py-4 border-b border-zinc-200/50">
                            <p className="text-xs font-medium text-zinc-700">Slip preview</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Updates as you type</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 flex items-start justify-center">
                            <ParchiSlip
                                parchi={previewRow}
                                variant="preview"
                                previewId={editing?.id}
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-zinc-200/60 bg-zinc-50/50 sm:justify-between gap-2">
                    <p className="text-[10px] text-zinc-500 hidden sm:block self-center">
                        Posted to parchi register · clears via cashbook
                    </p>
                    <div className="flex gap-2 w-full sm:w-auto justify-end">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-600">
                            Cancel
                        </Button>
                        <Button
                            onClick={onSave}
                            disabled={!canSave || saving}
                            className="min-w-[120px] rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium"
                        >
                            {editing ? "Save changes" : "Issue parchi"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
