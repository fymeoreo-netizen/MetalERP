import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useMemo, useState } from "react";
import {
    addCatalogItem,
    allocateNextItemCode,
    getInventorySection,
    getSectionLabel,
    getWarehouseType,
    itemTracksUnitCount,
    updateCatalogItem,
    type ItemMasterRecord,
} from "@/lib/itemCatalog";
import {
    TOP_CATEGORIES,
    buildItemDisplayName,
    composeItemFromForm,
    defaultItemFormState,
    parseItemToForm,
    resolveProductTypeForForm,
    resolveStorageCategoryForCode,
    resolveItemTypeForCode,
    validateItemForm,
    type ItemFormState,
    type TopCategory,
} from "@/lib/itemFormSchema";
import { defaultProductTypeSlug, inventoryGroupTracksUnits } from "@/lib/itemProductTypes";
import { ItemProductTypeFields } from "@/components/masters/ItemProductTypeFields";
import { useItemProductTypes } from "@/hooks/useItemProductTypes";
import { useInventory } from "@/contexts/InventoryContext";
import { useToast } from "@/components/ui/use-toast";
import { setReorderLevelForItem } from "@/lib/itemCatalog";
import { fetchItemOpeningStock, postOpeningStock, upsertOpeningStock } from "@/lib/api/posting";
import { DEFAULT_INVENTORY_CUTOVER_DATE, SUGGESTED_OPENING_UNIT_COST } from "@/lib/openingStock";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { supabase } from "@/lib/supabase";
import { thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type OpeningBaseline = {
    qty: number;
    units: number;
    unitCost: number;
    asOf: string;
};

const fieldGrid = "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4 items-start";

function FormField({
    label,
    labelExtra,
    hint,
    error,
    className,
    children,
}: {
    label: string;
    labelExtra?: ReactNode;
    hint?: string;
    error?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={`grid gap-2 ${className ?? ""}`}>
            <div className="flex items-center justify-between gap-2 min-h-5">
                <Label>{label}</Label>
                {labelExtra}
            </div>
            {hint ? <p className="text-xs text-slate-500 -mt-1">{hint}</p> : null}
            {children}
            {error ? <p className="text-xs text-red-600 font-medium">{error}</p> : null}
        </div>
    );
}

interface AddItemModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode?: "add" | "edit";
    initialItem?: ItemMasterRecord | null;
    onDone?: () => void;
}

export function AddItemModal({ open, onOpenChange, mode = "add", initialItem = null, onDone }: AddItemModalProps) {
    const { applyStockMovement, refresh } = useInventory();
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const isEdit = mode === "edit";
    const { allTypes: productTypes } = useItemProductTypes();

    const [form, setForm] = useState<ItemFormState>(() => defaultItemFormState());
    const [code, setCode] = useState("");
    const [openingQty, setOpeningQty] = useState("");
    const [openingUnits, setOpeningUnits] = useState("");
    const [openingAsOf, setOpeningAsOf] = useState(DEFAULT_INVENTORY_CUTOVER_DATE);
    const [openingBaseline, setOpeningBaseline] = useState<OpeningBaseline | null>(null);
    const [loadingOpening, setLoadingOpening] = useState(false);
    const [reorderLevelVal, setReorderLevelVal] = useState("");

    const patchForm = (partial: Partial<ItemFormState>) => setForm((prev) => ({ ...prev, ...partial }));

    const categoryTypes = useMemo(
        () => productTypes.filter((t) => t.topCategory === form.topCategory && t.isActive),
        [productTypes, form.topCategory],
    );

    const selectedProductType = useMemo(() => {
        try {
            return resolveProductTypeForForm(productTypes, form);
        } catch {
            return categoryTypes[0] ?? null;
        }
    }, [productTypes, form, categoryTypes]);

    const previewRecord = useMemo(() => {
        if (!code || !selectedProductType) return null;
        return composeItemFromForm(form, code, selectedProductType);
    }, [form, code, selectedProductType]);

    const previewName = previewRecord ? buildItemDisplayName(previewRecord) : "";

    const tracksUnits = Boolean(
        selectedProductType?.tracksUnitCount ||
            inventoryGroupTracksUnits(selectedProductType?.inventoryGroup ?? "") ||
            (previewRecord && itemTracksUnitCount(previewRecord)),
    );

    const openingQtyNum = Number(openingQty) || 0;
    const openingUnitCost = Number(form.cost) || 0;
    const openingCostRequired = openingQtyNum > 0;
    const openingCostMissing = openingCostRequired && openingUnitCost <= 0;

    const openingChanged = useMemo(() => {
        const qty = Number(openingQty) || 0;
        const units = Number(openingUnits) || 0;
        const cost = Number(form.cost) || 0;
        const asOf = openingAsOf || DEFAULT_INVENTORY_CUTOVER_DATE;
        if (!openingBaseline) {
            return qty > 0;
        }
        return (
            Math.abs(qty - openingBaseline.qty) > 0.0005 ||
            Math.abs(units - openingBaseline.units) > 0.0005 ||
            Math.abs(cost - openingBaseline.unitCost) > 0.005 ||
            asOf !== openingBaseline.asOf
        );
    }, [openingQty, openingUnits, form.cost, openingAsOf, openingBaseline]);

    useEffect(() => {
        if (!open) return;
        if (isEdit && initialItem) {
            const parsed = parseItemToForm(initialItem, productTypes);
            setForm(parsed);
            setCode(initialItem.code);
            setOpeningQty("");
            setOpeningUnits("");
            setOpeningAsOf(DEFAULT_INVENTORY_CUTOVER_DATE);
            setOpeningBaseline(null);
            setReorderLevelVal("");

            if (liveMode) {
                setLoadingOpening(true);
                void (async () => {
                    try {
                        const { data: itemRow } = await supabase
                            .schema("erp")
                            .from("items")
                            .select("id")
                            .eq("code", initialItem.code)
                            .maybeSingle();
                        if (!itemRow?.id) return;
                        const whType = getWarehouseType(initialItem);
                        const { data: whRow } = await supabase
                            .schema("erp")
                            .from("warehouses")
                            .select("id")
                            .eq("wh_type", whType)
                            .limit(1)
                            .maybeSingle();
                        const rows = await fetchItemOpeningStock(itemRow.id, whRow?.id ?? null);
                        const row = rows[0];
                        if (row) {
                            setOpeningQty(String(row.qty));
                            setOpeningUnits(row.unit_count > 0 ? String(row.unit_count) : "");
                            setOpeningAsOf(row.as_of || DEFAULT_INVENTORY_CUTOVER_DATE);
                            if (row.unit_cost > 0) {
                                setForm((prev) => ({ ...prev, cost: String(row.unit_cost) }));
                            }
                            setOpeningBaseline({
                                qty: row.qty,
                                units: row.unit_count,
                                unitCost: row.unit_cost,
                                asOf: row.as_of || DEFAULT_INVENTORY_CUTOVER_DATE,
                            });
                        } else {
                            setOpeningBaseline({
                                qty: 0,
                                units: 0,
                                unitCost: 0,
                                asOf: DEFAULT_INVENTORY_CUTOVER_DATE,
                            });
                        }
                    } finally {
                        setLoadingOpening(false);
                    }
                })();
            } else {
                setOpeningBaseline({
                    qty: 0,
                    units: 0,
                    unitCost: 0,
                    asOf: DEFAULT_INVENTORY_CUTOVER_DATE,
                });
            }
        } else {
            const slug = defaultProductTypeSlug(productTypes, "Raw Material");
            const initial = defaultItemFormState("Raw Material", slug);
            setForm(initial);
            setOpeningQty("");
            setOpeningUnits("");
            setOpeningAsOf(DEFAULT_INVENTORY_CUTOVER_DATE);
            setOpeningBaseline(null);
            setReorderLevelVal("");
            const pt = productTypes.find((t) => t.slug === slug);
            if (pt) {
                void allocateNextItemCode(
                    resolveStorageCategoryForCode(initial, pt),
                    resolveItemTypeForCode(initial, pt),
                    pt.codePrefix,
                ).then(setCode);
            }
        }
    }, [open, isEdit, initialItem, productTypes, liveMode]);

    useEffect(() => {
        if (!open || isEdit || !selectedProductType) return;
        void allocateNextItemCode(
            resolveStorageCategoryForCode(form, selectedProductType),
            resolveItemTypeForCode(form, selectedProductType),
            selectedProductType.codePrefix,
        ).then(setCode);
    }, [open, isEdit, form.topCategory, form.productTypeSlug, selectedProductType]);

    const handleCategoryChange = (topCategory: TopCategory) => {
        const slug = defaultProductTypeSlug(productTypes, topCategory);
        const next = defaultItemFormState(topCategory, slug);
        setForm((prev) => ({
            ...next,
            cost: prev.cost,
            solidContent: prev.solidContent,
            wastagePct: prev.wastagePct,
        }));
    };

    const handleProductTypeChange = (slug: string) => {
        const pt = productTypes.find((t) => t.slug === slug);
        patchForm({
            productTypeSlug: slug,
            unit: pt?.formTemplate === "varnish_drum" ? "Drum" : form.unit,
        });
    };

    const handleSubmit = async () => {
        if (!selectedProductType) {
            toast({ title: "No product type", description: "Select a product type.", variant: "destructive" });
            return;
        }
        const validationError = validateItemForm(form, selectedProductType);
        if (validationError) {
            toast({ title: "Missing fields", description: validationError, variant: "destructive" });
            return;
        }
        if (!isEdit && !code.trim()) {
            toast({ title: "Missing code", description: "Item code could not be allocated.", variant: "destructive" });
            return;
        }

        const openQty = Number(openingQty) || 0;
        const openUnits = Number(openingUnits) || 0;
        if (openingCostMissing) {
            toast({
                title: "Opening unit cost required",
                description: `Enter opening unit cost (e.g. ${SUGGESTED_OPENING_UNIT_COST.toLocaleString()} Rs/kg for enameled wire) before posting opening stock.`,
                variant: "destructive",
            });
            return;
        }

        const record = composeItemFromForm(form, isEdit ? initialItem!.code : code.trim().toUpperCase(), selectedProductType);

        try {
            const reorderNum = reorderLevelVal ? Number(reorderLevelVal) : 0;
            if (isEdit) {
                await updateCatalogItem(record.code, {
                    name: record.name,
                    category: record.category,
                    itemType: record.itemType,
                    sizeSpec: record.sizeSpec,
                    unit: record.unit,
                    stdCost: record.stdCost,
                });
                if (reorderNum > 0) setReorderLevelForItem(record.code, reorderNum);
            } else {
                await addCatalogItem(record, reorderNum);
            }

            let openingStockWarning: string | null = null;
            const shouldWriteOpening = isEdit ? openingChanged : openQty > 0;
            if (shouldWriteOpening) {
                if (liveMode) {
                    const { data: itemRow } = await supabase
                        .schema("erp")
                        .from("items")
                        .select("id")
                        .eq("code", record.code)
                        .maybeSingle();
                    const whType = getWarehouseType(record);
                    const { data: whRow } = await supabase
                        .schema("erp")
                        .from("warehouses")
                        .select("id")
                        .eq("wh_type", whType)
                        .limit(1)
                        .maybeSingle();
                    if (!itemRow?.id || !whRow?.id) {
                        openingStockWarning =
                            "Item saved, but warehouse was not found — opening stock was not updated.";
                    } else {
                        const stockResult = isEdit
                            ? await upsertOpeningStock(
                                  itemRow.id,
                                  whRow.id,
                                  openQty,
                                  Number(form.cost) || 0,
                                  openingAsOf || DEFAULT_INVENTORY_CUTOVER_DATE,
                                  openUnits,
                              )
                            : await postOpeningStock(
                                  itemRow.id,
                                  whRow.id,
                                  openQty,
                                  Number(form.cost) || 0,
                                  openingAsOf || DEFAULT_INVENTORY_CUTOVER_DATE,
                                  openUnits,
                              );
                        if (!stockResult.ok) {
                            openingStockWarning = `Item saved, but opening stock failed: ${stockResult.error}`;
                        }
                    }
                } else if (!isEdit && openQty > 0) {
                    applyStockMovement({
                        type: "OPENING",
                        itemCode: record.code,
                        qty: openQty,
                        refDocId: `OPEN-${record.code}`,
                        refDocType: "OPENING",
                    });
                }
            }
            await refresh();
            if (openingStockWarning) {
                toast({
                    title: isEdit ? "Item updated" : "Item added (opening stock issue)",
                    description: openingStockWarning,
                    variant: "destructive",
                });
            } else {
                toast({
                    title: isEdit ? "Item updated" : "Item added",
                    description: `${record.code} → ${getSectionLabel(getInventorySection(record))}`,
                });
            }
        onOpenChange(false);
            onDone?.();
        } catch (e) {
            toast({
                title: isEdit ? "Could not update item" : "Could not add item",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex flex-col w-[calc(100vw-1rem)] max-w-[760px] max-h-[92dvh] overflow-hidden p-0 gap-0">
                <DialogHeader className="shrink-0 px-4 sm:px-6 py-4 border-b">
                    <DialogTitle>{isEdit ? "Edit Item" : "Add New Item"}</DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "Update item details and opening stock (qty, units, rate, as-of)."
                            : "Choose category and product type — item name and code are generated from your selections."}
                    </DialogDescription>
                </DialogHeader>
                <div
                    className={cn(
                        "flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 space-y-6",
                        thinScrollbarClass,
                    )}
                >
                    <div className="space-y-3">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Category</p>
                        <div className={fieldGrid}>
                            <FormField label="Category" className="sm:col-span-2">
                                <Select
                                    value={form.topCategory}
                                    onValueChange={(v) => handleCategoryChange(v as TopCategory)}
                                    disabled={isEdit}
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {TOP_CATEGORIES.map((c) => (
                                            <SelectItem key={c} value={c}>
                                                {c}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormField>
                            {!isEdit && (
                                <FormField label="Item code">
                                    <Input value={code} readOnly className="bg-slate-50 font-mono h-10" />
                                </FormField>
                            )}
                            <FormField label="Name preview" className={isEdit ? "sm:col-span-2" : undefined}>
                                <Input value={previewName} readOnly className="bg-slate-50 h-10" placeholder="Select options above" />
                            </FormField>
                    </div>
                    </div>

                    <div className="space-y-3">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Product type</p>
                        <div className={fieldGrid}>
                            <FormField label="Type" className="sm:col-span-2">
                                <Select
                                    value={form.productTypeSlug}
                                    onValueChange={handleProductTypeChange}
                                    disabled={isEdit}
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Select product type" />
                            </SelectTrigger>
                            <SelectContent>
                                        {categoryTypes.map((t) => (
                                            <SelectItem key={t.slug} value={t.slug}>
                                                {t.label}
                                            </SelectItem>
                                        ))}
                            </SelectContent>
                        </Select>
                            </FormField>
                        </div>
                        {selectedProductType ? (
                            <ItemProductTypeFields
                                template={selectedProductType.formTemplate}
                                form={form}
                                onPatch={patchForm}
                            />
                        ) : null}
                    </div>

                    <div className="space-y-3">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Cost & inventory</p>
                        <div className={fieldGrid}>
                            <FormField label="UOM">
                                <Select value={form.unit} onValueChange={(v) => patchForm({ unit: v as ItemFormState["unit"] })}>
                                    <SelectTrigger className="h-10">
                                        <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="KG">Kilogram (KG)</SelectItem>
                                <SelectItem value="Drum">Drum</SelectItem>
                                        <SelectItem value="Roll">Roll</SelectItem>
                                <SelectItem value="Piece">Piece</SelectItem>
                            </SelectContent>
                        </Select>
                            </FormField>
                            <FormField
                                label={openingCostRequired ? "Opening unit cost (₨/kg) *" : "Reference cost (optional)"}
                                hint={
                                    openingCostRequired
                                        ? `Required when posting opening stock — typical FG rate: ${SUGGESTED_OPENING_UNIT_COST.toLocaleString()} Rs/kg`
                                        : "Not used for stock valuation report; configure rates under Inventory → Valuation rates"
                                }
                                error={
                                    openingCostMissing
                                        ? `Enter opening unit cost (e.g. ${SUGGESTED_OPENING_UNIT_COST.toLocaleString()} Rs/kg).`
                                        : undefined
                                }
                            >
                                <Input
                                    className={cn("h-10", openingCostMissing && "border-red-500 focus-visible:ring-red-500")}
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={form.cost}
                                    onChange={(e) => patchForm({ cost: e.target.value })}
                                    placeholder={openingCostRequired ? String(SUGGESTED_OPENING_UNIT_COST) : "0.00"}
                                />
                            </FormField>
                            <FormField
                                label="Opening stock (kg)"
                                hint={
                                    loadingOpening
                                        ? "Loading current opening…"
                                        : isEdit
                                          ? "Edit to replace the posted opening (set 0 to clear)"
                                          : "Weight on hand at cutover"
                                }
                            >
                        <Input
                                    className="h-10"
                                    placeholder="0"
                            type="number"
                                    min={0}
                                    step="0.001"
                                    value={openingQty}
                                    onChange={(e) => setOpeningQty(e.target.value)}
                                    disabled={loadingOpening}
                                />
                            </FormField>
                            {tracksUnits ? (
                                <FormField
                                    label="Opening units"
                                    hint="Coil or piece count — parallel to kg for FG/RM"
                                >
                            <Input
                                        className="h-10"
                                        placeholder="0"
                                type="number"
                                        min={0}
                                        step={1}
                                        value={openingUnits}
                                        onChange={(e) => setOpeningUnits(e.target.value)}
                                        disabled={loadingOpening}
                                    />
                                </FormField>
                            ) : null}
                            <FormField
                                label="Opening as-of date"
                                hint="Cutover date for inventory movement and GL"
                            >
                                <Input
                                    className="h-10"
                                    type="date"
                                    value={openingAsOf}
                                    onChange={(e) => setOpeningAsOf(e.target.value)}
                                    disabled={loadingOpening}
                                />
                            </FormField>
                            <FormField label="Min reorder level">
                            <Input
                                    className="h-10"
                                type="number"
                                    min={0}
                                    value={reorderLevelVal}
                                    onChange={(e) => setReorderLevelVal(e.target.value)}
                                    placeholder="0"
                                />
                            </FormField>
                            <FormField label="Std wastage %">
                        <Input
                                    className="h-10"
                            type="number"
                                    min={0}
                                    value={form.wastagePct}
                                    onChange={(e) => patchForm({ wastagePct: e.target.value })}
                                    placeholder="For formulas"
                                />
                            </FormField>
                            {form.topCategory === "Chemicals" && (
                                <FormField label="Solid content %">
                            <Input
                                        className="h-10"
                                type="number"
                                        min={0}
                                        value={form.solidContent}
                                        onChange={(e) => patchForm({ solidContent: e.target.value })}
                                placeholder="%"
                            />
                                </FormField>
                            )}
                        </div>
                    </div>
                </div>
                <DialogFooter className="shrink-0 border-t px-4 sm:px-6 py-3 flex-col-reverse sm:flex-row gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void handleSubmit()}
                        disabled={openingCostMissing || loadingOpening}
                        className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto disabled:opacity-50"
                    >
                        {isEdit ? "Save Changes" : "Add Item"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
