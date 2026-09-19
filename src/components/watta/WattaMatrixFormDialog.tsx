import { useEffect, useMemo, useState } from "react";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FieldGroup, invoiceInputClass } from "@/components/invoices/InvoiceFormLayout";
import type { WattaMatrixRow } from "@/lib/scrapObligationTypes";
import {
    validateWattaForm,
    type WattaFormValues,
} from "@/lib/wattaMatrixValidation";

export type WattaMatrixFormDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    direction: "sales" | "purchase";
    parties: { id: string; name: string }[];
    initial: WattaMatrixRow | null;
    onSubmit: (values: WattaFormValues) => Promise<void>;
};

const emptyForm = (direction: "sales" | "purchase"): WattaFormValues => ({
    party_id: null,
    direction,
    product_kind: direction === "sales" ? "enamel" : "wire8",
    wire8_grade: direction === "purchase" ? "Pass" : null,
    swg_min: direction === "sales" ? 1 : null,
    swg_max: direction === "sales" ? 24 : null,
    base_watta: 0,
    increment_per_swg: 0,
    effective_from: new Date().toISOString().slice(0, 10),
    is_active: true,
    remarks: null,
});

function rowToForm(row: WattaMatrixRow): WattaFormValues {
    return {
        id: row.id,
        party_id: row.party_code ?? row.party_id,
        direction: row.direction,
        product_kind: row.product_kind,
        wire8_grade: row.wire8_grade,
        swg_min: row.swg_min,
        swg_max: row.swg_max,
        base_watta: row.base_watta,
        increment_per_swg: row.increment_per_swg,
        effective_from: row.effective_from,
        is_active: row.is_active,
        remarks: row.remarks,
    };
}

export function WattaMatrixFormDialog({
    open,
    onOpenChange,
    direction,
    parties,
    initial,
    onSubmit,
}: WattaMatrixFormDialogProps) {
    const [form, setForm] = useState<WattaFormValues>(() => emptyForm(direction));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setError(null);
        setForm(initial ? rowToForm(initial) : emptyForm(direction));
    }, [open, initial, direction]);

    const isSales = direction === "sales";
    const isEdit = Boolean(initial?.id);
    const partyOptions = useMemo(() => toPartyComboboxOptions(parties), [parties]);

    const handleSave = async () => {
        const values: WattaFormValues = {
            ...form,
            id: initial?.id,
            direction,
            product_kind: isSales ? "enamel" : form.product_kind,
            wire8_grade: isSales ? null : form.product_kind === "wire8" ? form.wire8_grade : null,
            swg_min: isSales && form.swg_min != null ? Number(form.swg_min) : null,
            swg_max: isSales && form.swg_max != null ? Number(form.swg_max) : null,
            base_watta: Number(form.base_watta) || 0,
            increment_per_swg: isSales ? Number(form.increment_per_swg) || 0 : 0,
        };
        const v = validateWattaForm(values);
        if (!v.ok) {
            setError(v.error);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onSubmit(values);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit watta row" : "Add watta row"}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    {error ? <p className="text-sm text-rose-600">{error}</p> : null}
                    <FieldGroup label="Party (optional)" hint="Leave default for company-wide rate">
                        <PartyCombobox
                            value={form.party_id ?? "__default"}
                            onValueChange={(v) => setForm({ ...form, party_id: v === "__default" ? null : v })}
                            options={partyOptions}
                            placeholder="Default (all parties)"
                            leadingOptions={[{ value: "__default", label: "Default (all parties)" }]}
                            triggerClassName={invoiceInputClass}
                        />
                    </FieldGroup>

                    {!isSales && (
                        <FieldGroup label="Product">
                            <Select
                                value={form.product_kind}
                                onValueChange={(v) =>
                                    setForm({
                                        ...form,
                                        product_kind: v as "wire8" | "rod",
                                        wire8_grade: v === "wire8" ? form.wire8_grade ?? "Pass" : null,
                                    })
                                }
                            >
                                <SelectTrigger className={invoiceInputClass}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="wire8">Wire No 8</SelectItem>
                                    <SelectItem value="rod">Copper rod</SelectItem>
                                </SelectContent>
                            </Select>
                        </FieldGroup>
                    )}

                    {!isSales && form.product_kind === "wire8" && (
                        <FieldGroup label="Wire grade">
                            <Select
                                value={form.wire8_grade ?? "Pass"}
                                onValueChange={(v) =>
                                    setForm({ ...form, wire8_grade: v as "Fail" | "Pass" | "Special" })
                                }
                            >
                                <SelectTrigger className={invoiceInputClass}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Fail">Fail</SelectItem>
                                    <SelectItem value="Pass">Pass</SelectItem>
                                    <SelectItem value="Special">Special</SelectItem>
                                </SelectContent>
                            </Select>
                        </FieldGroup>
                    )}

                    {isSales && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <FieldGroup label="SWG min">
                                    <Input
                                        type="number"
                                        className={invoiceInputClass}
                                        value={form.swg_min ?? ""}
                                        onChange={(e) =>
                                            setForm({ ...form, swg_min: e.target.value === "" ? null : Number(e.target.value) })
                                        }
                                    />
                                </FieldGroup>
                                <FieldGroup label="SWG max">
                                    <Input
                                        type="number"
                                        className={invoiceInputClass}
                                        value={form.swg_max ?? ""}
                                        onChange={(e) =>
                                            setForm({ ...form, swg_max: e.target.value === "" ? null : Number(e.target.value) })
                                        }
                                    />
                                </FieldGroup>
                            </div>
                            <FieldGroup label="+ per SWG above band min" hint="Enamel only; applied when SWG &gt; min">
                                <Input
                                    type="number"
                                    className={invoiceInputClass}
                                    value={form.increment_per_swg}
                                    onChange={(e) => setForm({ ...form, increment_per_swg: Number(e.target.value) || 0 })}
                                />
                            </FieldGroup>
                        </>
                    )}

                    <FieldGroup label="Base watta (PKR/kg)">
                        <Input
                            type="number"
                            className={invoiceInputClass}
                            value={form.base_watta}
                            onChange={(e) => setForm({ ...form, base_watta: Number(e.target.value) || 0 })}
                        />
                    </FieldGroup>

                    <FieldGroup label="Effective from">
                        <Input
                            type="date"
                            className={invoiceInputClass}
                            value={form.effective_from}
                            onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
                        />
                    </FieldGroup>

                    <FieldGroup label="Remarks">
                        <Input
                            className={invoiceInputClass}
                            value={form.remarks ?? ""}
                            onChange={(e) => setForm({ ...form, remarks: e.target.value || null })}
                            placeholder="Optional note"
                        />
                    </FieldGroup>

                    <label className="flex items-center gap-2 text-sm text-zinc-600">
                        <Checkbox
                            checked={form.is_active}
                            onCheckedChange={(c) => setForm({ ...form, is_active: c === true })}
                        />
                        Active (used in resolve_watta)
                    </label>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                        {saving ? "Saving…" : isEdit ? "Update" : "Create"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
