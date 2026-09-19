import { useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useItemProductTypes } from "@/hooks/useItemProductTypes";
import {
    buildItemDisplayName,
    composeItemFromForm,
    defaultItemFormState,
    parseItemToForm,
    type ItemFormState,
    type TopCategory,
} from "@/lib/itemFormSchema";
import { ItemProductTypeFields } from "@/components/masters/ItemProductTypeFields";
import { findProductTypeForItem, type ItemProductTypeRow } from "@/lib/itemProductTypes";
import { reclassifyCatalogItem, type ItemMasterRecord } from "@/lib/itemCatalog";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryClient";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: ItemMasterRecord | null;
    onDone?: () => void;
};

function topCategoryForItem(item: ItemMasterRecord): TopCategory {
    if (item.category === "Raw Material" || item.category === "Scrap") return "Raw Material";
    if (item.category === "Packing Material" || item.category === "Consumable") return "Packing Material";
    if (item.category === "Chemicals" || item.category === "Chemical") return "Chemicals";
    return "Finished Goods";
}

function currentProductType(item: ItemMasterRecord, types: ItemProductTypeRow[]): ItemProductTypeRow | undefined {
    const topCategory = topCategoryForItem(item);
    return findProductTypeForItem(types, item, topCategory);
}

export function ReclassifyItemModal({ open, onOpenChange, item, onDone }: Props) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { allTypes: productTypes } = useItemProductTypes();
    const [form, setForm] = useState<ItemFormState>(() => defaultItemFormState("Finished Goods"));
    const [saving, setSaving] = useState(false);

    const topCategory = item ? topCategoryForItem(item) : "Finished Goods";
    const currentType = item ? currentProductType(item, productTypes) : null;
    const targetTypes = useMemo(
        () => productTypes.filter((t) => t.topCategory === topCategory && t.isActive && t.slug !== currentType?.slug),
        [productTypes, topCategory, currentType?.slug],
    );

    const selectedType = useMemo(
        () => productTypes.find((t) => t.slug === form.productTypeSlug) ?? null,
        [productTypes, form.productTypeSlug],
    );

    const preview = useMemo(() => {
        if (!item || !selectedType) return { name: "", spec: "" };
        const composed = composeItemFromForm(form, item.code, selectedType);
        return { name: composed.name, spec: composed.sizeSpec };
    }, [form, selectedType, item]);

    useEffect(() => {
        if (!open || !item) return;
        const parsed = parseItemToForm(item, productTypes);
        setForm(parsed);
    }, [open, item, productTypes]);

    const handleReclassify = async () => {
        if (!item || !selectedType) return;
        if (selectedType.slug === currentType?.slug) {
            toast({ title: "Choose a different product type", variant: "destructive" });
            return;
        }
        const composed = composeItemFromForm(form, item.code, selectedType);
        if (!composed.name.trim() || !composed.sizeSpec.trim()) {
            toast({ title: "Name and spec are required", variant: "destructive" });
            return;
        }
        const confirmed = window.confirm(
            `Reclassify ${item.code} from ${currentType?.label ?? item.itemType} to ${selectedType.label}?\n\n` +
                `Historical invoices and stock stay linked to this item. Code ${item.code} will remain unchanged.`,
        );
        if (!confirmed) return;

        setSaving(true);
        try {
            const result = await reclassifyCatalogItem(item.code, {
                targetProductTypeSlug: selectedType.slug,
                name: composed.name,
                sizeSpec: composed.sizeSpec,
            });
            if (!result.ok) throw new Error(result.error);
            await queryClient.invalidateQueries({ queryKey: queryKeys.inventoryValuationRates });
            onOpenChange(false);
            onDone?.();
            toast({
                title: "Item reclassified",
                description:
                    result.warnings && result.warnings.length > 0
                        ? `${item.code} updated. ${result.warnings.join(" ")}`
                        : `${item.code} is now ${selectedType.label}.`,
            });
        } catch (e) {
            toast({
                title: "Reclassification failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    if (!item) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Reclassify product type</DialogTitle>
                    <DialogDescription>
                        Change category metadata for <span className="font-mono">{item.code}</span>. Stock and posted
                        documents keep the same item ID.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="rounded-md bg-slate-50 border px-3 py-2 text-sm">
                        <p>
                            <span className="text-slate-500">Current:</span>{" "}
                            <span className="font-medium">{currentType?.label ?? item.itemType}</span>
                            {" — "}
                            {buildItemDisplayName(item)}
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <Label>New product type</Label>
                        <Select
                            value={form.productTypeSlug}
                            onValueChange={(slug) => {
                                const nextType = productTypes.find((t) => t.slug === slug);
                                if (!nextType || !item) return;
                                const base = defaultItemFormState(topCategory, slug);
                                if (nextType.formTemplate === "free_text") {
                                    base.freeTextName = item.name;
                                    base.freeTextSpec = item.sizeSpec === "—" ? "" : item.sizeSpec;
                                } else if (nextType.formTemplate === "strip_dimensions") {
                                    base.stripSize =
                                        item.sizeSpec === "—"
                                            ? item.name.replace(/^Copper Strip\s*/i, "")
                                            : item.sizeSpec;
                                } else if (nextType.formTemplate === "enamel_gauge_color") {
                                    const parsed = parseItemToForm(item, productTypes);
                                    Object.assign(base, {
                                        enamelColor: parsed.enamelColor,
                                        enamelGaugePreset: parsed.enamelGaugePreset,
                                        enamelGaugeIsCustom: parsed.enamelGaugeIsCustom,
                                        enamelGaugeCustom: parsed.enamelGaugeCustom,
                                        enamelCustomName: parsed.enamelCustomName,
                                    });
                                }
                                setForm(base);
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select target type" />
                            </SelectTrigger>
                            <SelectContent>
                                {targetTypes.map((t) => (
                                    <SelectItem key={t.slug} value={t.slug}>
                                        {t.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {selectedType && selectedType.slug !== currentType?.slug ? (
                        <>
                            <ItemProductTypeFields
                                template={selectedType.formTemplate}
                                form={form}
                                onPatch={(partial) => setForm((prev) => ({ ...prev, ...partial }))}
                            />
                            <div className="rounded-md border border-dashed px-3 py-2 text-sm text-slate-600">
                                <p>
                                    <span className="text-slate-500">Preview name:</span> {preview.name || "—"}
                                </p>
                                <p>
                                    <span className="text-slate-500">Preview spec:</span> {preview.spec || "—"}
                                </p>
                            </div>
                        </>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={() => void handleReclassify()}
                        disabled={saving || !selectedType || selectedType.slug === currentType?.slug}
                    >
                        {saving ? "Saving…" : "Reclassify"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
