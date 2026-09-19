import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import { Plus, Sparkles, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast";
import { useInventoryValuationRates } from "@/hooks/useErpQueries";
import { queryKeys } from "@/lib/queryClient";
import { useInventory } from "@/contexts/InventoryContext";
import {
    deleteInventoryValuationRate,
    upsertInventoryValuationRate,
    type InventoryValuationProductKind,
    type InventoryValuationRateRow,
} from "@/lib/repositories/inventoryValuationRepo";
import {
    findValuationOverlapError,
    findUnmatchedValuationItems,
    formatValuationSpecKeyLabel,
    hasStandardEnamelValuationDefaults,
    STANDARD_ENAMEL_VALUATION_PRESETS,
    validateInventoryValuationForm,
    type InventoryValuationFormValues,
} from "@/lib/inventoryValuationValidation";
import { EnamelValuationBands } from "@/components/inventory/EnamelValuationBands";
import { FlatValuationRates } from "@/components/inventory/FlatValuationRates";
import { SpecValuationRates } from "@/components/inventory/SpecValuationRates";

const CARD = "shadow-soft border-slate-100 bg-white";

const emptyForm = (kind: InventoryValuationProductKind): InventoryValuationFormValues => ({
    product_kind: kind,
    swg_min: kind === "enamel" ? 1 : null,
    swg_max: kind === "enamel" ? 24 : null,
    wire8_grade: kind === "wire8" ? "Pass" : null,
    scrap_kind: kind === "scrap" ? "feed" : null,
    spec_key: kind === "copper_wire" || kind === "strip" ? "" : null,
    unit_rate: 0,
    effective_from: new Date().toISOString().slice(0, 10),
    is_active: true,
    remarks: null,
});

export function ValuationRatesPanel() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { catalog } = useInventory();
    const { data: rows = [], isLoading, error } = useInventoryValuationRates();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<InventoryValuationRateRow | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<InventoryValuationRateRow | null>(null);
    const [form, setForm] = useState<InventoryValuationFormValues>(emptyForm("enamel"));
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const invalidate = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.inventoryValuationRates });
    }, [queryClient]);

    const openCreate = (kind: InventoryValuationProductKind) => {
        setEditing(null);
        setForm(emptyForm(kind));
        setFormError(null);
        setDialogOpen(true);
    };

    const openEdit = (row: InventoryValuationRateRow) => {
        setEditing(row);
        setForm({
            id: row.id,
            product_kind: row.product_kind,
            swg_min: row.swg_min,
            swg_max: row.swg_max,
            wire8_grade: row.wire8_grade,
            scrap_kind: row.scrap_kind,
            spec_key: row.spec_key,
            unit_rate: row.unit_rate,
            effective_from: row.effective_from,
            is_active: row.is_active,
            remarks: row.remarks,
        });
        setFormError(null);
        setDialogOpen(true);
    };

    const openCreateFromUnmatched = (productKind: "copper_wire" | "strip", specKey: string) => {
        setEditing(null);
        setForm({
            ...emptyForm(productKind),
            spec_key: specKey,
        });
        setFormError(null);
        setDialogOpen(true);
    };

    const applyEnamelPreset = async () => {
        setSaving(true);
        try {
            for (const preset of STANDARD_ENAMEL_VALUATION_PRESETS) {
                const result = await upsertInventoryValuationRate(preset);
                if (!result.ok) throw new Error(result.error);
            }
            await invalidate();
            toast({ title: "Default enamel bands applied" });
        } catch (e) {
            toast({
                title: "Could not apply preset",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async () => {
        const validation = validateInventoryValuationForm(form);
        if (!validation.ok) {
            setFormError(validation.error);
            return;
        }
        const overlap = findValuationOverlapError(form, rows);
        if (overlap) {
            setFormError(overlap);
            return;
        }
        setSaving(true);
        setFormError(null);
        try {
            const result = await upsertInventoryValuationRate(form);
            if (!result.ok) throw new Error(result.error);
            await invalidate();
            setDialogOpen(false);
            toast({ title: editing ? "Rate updated" : "Rate added" });
        } catch (e) {
            setFormError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setSaving(true);
        try {
            const result = await deleteInventoryValuationRate(deleteTarget.id);
            if (!result.ok) throw new Error(result.error);
            await invalidate();
            toast({ title: "Rate deleted" });
        } catch (e) {
            toast({
                title: "Delete failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
            setDeleteTarget(null);
        }
    };

    const showEnamelPreset = useMemo(
        () => !hasStandardEnamelValuationDefaults(rows),
        [rows],
    );

    const unmatchedItems = useMemo(
        () => findUnmatchedValuationItems(catalog, rows),
        [catalog, rows],
    );

    if (isLoading) {
        return <p className="text-sm text-slate-500 py-8 text-center">Loading valuation rates…</p>;
    }

    if (error) {
        return (
            <p className="text-sm text-rose-600 py-8 text-center">
                {error instanceof Error ? error.message : "Failed to load valuation rates."}
            </p>
        );
    }

    return (
        <div className="space-y-6">
            <Card className={CARD}>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                        <CardTitle className="text-lg">Enamel wire (SWG bands)</CardTitle>
                        <CardDescription>
                            Absolute PKR/kg by SWG range. Used for stock valuation report — not commercial watta.
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                        {showEnamelPreset ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => void applyEnamelPreset()} disabled={saving}>
                                <Sparkles className="h-4 w-4 mr-1.5" />
                                Default bands
                            </Button>
                        ) : null}
                        <Button type="button" size="sm" onClick={() => openCreate("enamel")}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Add band
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <EnamelValuationBands rows={rows} onEdit={openEdit} onDelete={setDeleteTarget} />
                </CardContent>
            </Card>

            <Card className={CARD}>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                        <CardTitle className="text-lg">Copper wire & strip (spec rates)</CardTitle>
                        <CardDescription>
                            PKR/kg by normalized spec key — thousand gauge, mm sizes, strip dimensions. Not SWG enamel bands.
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                        <Button type="button" variant="outline" size="sm" onClick={() => openCreate("copper_wire")}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Copper wire
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openCreate("strip")}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Strip
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <SpecValuationRates rows={rows} onEdit={openEdit} onDelete={setDeleteTarget} />
                    {unmatchedItems.length > 0 ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 space-y-3">
                            <div className="flex items-center gap-2 text-amber-900 text-sm font-medium">
                                <Search className="h-4 w-4" />
                                {unmatchedItems.length} FG item{unmatchedItems.length === 1 ? "" : "s"} without a valuation rate
                            </div>
                            <ul className="space-y-2 text-sm">
                                {unmatchedItems.map((row) => (
                                    <li key={row.item.code} className="flex flex-wrap items-center justify-between gap-2">
                                        <span>
                                            <span className="font-mono text-xs text-slate-600">{row.item.code}</span>
                                            {" — "}
                                            {row.item.name}
                                            {row.specKey ? (
                                                <span className="text-slate-500"> ({formatValuationSpecKeyLabel(row.specKey)})</span>
                                            ) : null}
                                        </span>
                                        {row.productKind === "copper_wire" || row.productKind === "strip" ? (
                                            row.specKey ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        openCreateFromUnmatched(
                                                            row.productKind as "copper_wire" | "strip",
                                                            row.specKey!,
                                                        )
                                                    }
                                                >
                                                    Add rate
                                                </Button>
                                            ) : null
                                        ) : (
                                            <span className="text-xs text-slate-500">Add enamel band or item override</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card className={CARD}>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                        <CardTitle className="text-lg">Wire No 8, rod & scrap</CardTitle>
                        <CardDescription>Flat PKR/kg rates by wire grade or scrap category.</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                        <Button type="button" variant="outline" size="sm" onClick={() => openCreate("wire8")}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Wire 8
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openCreate("rod")}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Rod
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openCreate("scrap")}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Scrap
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <FlatValuationRates rows={rows} onEdit={openEdit} onDelete={setDeleteTarget} />
                </CardContent>
            </Card>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit valuation rate" : "Add valuation rate"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {form.product_kind === "enamel" ? (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>SWG min</Label>
                                    <Input
                                        type="number"
                                        value={form.swg_min ?? ""}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, swg_min: e.target.value ? Number(e.target.value) : null }))
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>SWG max</Label>
                                    <Input
                                        type="number"
                                        value={form.swg_max ?? ""}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, swg_max: e.target.value ? Number(e.target.value) : null }))
                                        }
                                    />
                                </div>
                            </div>
                        ) : null}

                        {form.product_kind === "wire8" ? (
                            <div className="space-y-1.5">
                                <Label>Grade</Label>
                                <Select
                                    value={form.wire8_grade ?? "Pass"}
                                    onValueChange={(v) => setForm((f) => ({ ...f, wire8_grade: v as "Fail" | "Pass" | "Special" }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Fail">Fail</SelectItem>
                                        <SelectItem value="Pass">Pass</SelectItem>
                                        <SelectItem value="Special">Special</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}

                        {form.product_kind === "scrap" ? (
                            <div className="space-y-1.5">
                                <Label>Scrap kind</Label>
                                <Select
                                    value={form.scrap_kind ?? "feed"}
                                    onValueChange={(v) =>
                                        setForm((f) => ({
                                            ...f,
                                            scrap_kind: v as "drawing" | "enamel" | "workshop" | "feed",
                                        }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="drawing">Drawing</SelectItem>
                                        <SelectItem value="enamel">Enamel</SelectItem>
                                        <SelectItem value="workshop">Workshop</SelectItem>
                                        <SelectItem value="feed">Copper feed</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}

                        {form.product_kind === "copper_wire" || form.product_kind === "strip" ? (
                            <div className="space-y-1.5">
                                <Label>Spec key</Label>
                                <Input
                                    value={form.spec_key ?? ""}
                                    onChange={(e) => setForm((f) => ({ ...f, spec_key: e.target.value || null }))}
                                    placeholder="e.g. 7_thousand, 20_mm, 6x1_5_mm"
                                    className="font-mono"
                                />
                                <p className="text-xs text-slate-500">
                                    Normalized label used to match item size_spec (underscores, lowercase).
                                </p>
                            </div>
                        ) : null}

                        <div className="space-y-1.5">
                            <Label>Rate (PKR/kg)</Label>
                            <Input
                                type="number"
                                min={0}
                                step="0.001"
                                value={form.unit_rate || ""}
                                onChange={(e) => setForm((f) => ({ ...f, unit_rate: Number(e.target.value) || 0 }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Effective from</Label>
                            <Input
                                type="date"
                                value={form.effective_from}
                                onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Remarks (optional)</Label>
                            <Input
                                value={form.remarks ?? ""}
                                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value || null }))}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="ivr-active"
                                checked={form.is_active}
                                onCheckedChange={(c) => setForm((f) => ({ ...f, is_active: c === true }))}
                            />
                            <Label htmlFor="ivr-active" className="font-normal">
                                Active
                            </Label>
                        </div>
                        {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete valuation rate?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This removes the rate row. The stock valuation report will no longer use it for matching items.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleDelete()} className="bg-rose-600 hover:bg-rose-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
