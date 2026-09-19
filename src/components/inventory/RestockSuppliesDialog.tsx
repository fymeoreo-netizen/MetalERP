import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
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
import { useInventory } from "@/contexts/InventoryContext";
import { postSuppliesRestock, postSuppliesStockSet, updateSuppliesRestock } from "@/lib/api/posting";
import { isErpLiveMode } from "@/lib/backendFlags";
import { applyStockMovement, formatItemLabel, setSuppliesStockBalance } from "@/lib/inventoryStore";
import {
    computeVarnishRestockKg,
    computeVarnishUnitCostPerKg,
    defaultDrumWeightKg,
    deriveVarnishRestockFields,
    formatVarnishRestockRemark,
    getSuppliesRestockItems,
    suppliesStockUnit,
    type SuppliesRestockKind,
    type SuppliesRestockRow,
} from "@/lib/suppliesRestock";

export type SuppliesStockMode = "add" | "set" | "edit";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: SuppliesRestockKind;
    mode?: SuppliesStockMode;
    preselectedItemCode?: string;
    editRow?: SuppliesRestockRow;
    onSaved?: () => void | Promise<void>;
};

export function RestockSuppliesDialog({
    open,
    onOpenChange,
    kind,
    mode = "add",
    preselectedItemCode,
    editRow,
    onSaved,
}: Props) {
    const { toast } = useToast();
    const { getBalance, refresh } = useInventory();
    const liveMode = isErpLiveMode();
    const items = useMemo(() => getSuppliesRestockItems(kind), [kind]);

    const [itemCode, setItemCode] = useState("");
    const [postingDate, setPostingDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [drums, setDrums] = useState("");
    const [drumWeightKg, setDrumWeightKg] = useState("");
    const [qty, setQty] = useState("");
    const [newQty, setNewQty] = useState("");
    const [unitCost, setUnitCost] = useState("");
    const [pricePerDrum, setPricePerDrum] = useState("");
    const [remarks, setRemarks] = useState("");
    const [saving, setSaving] = useState(false);

    const selectedItem = items.find((i) => i.code === itemCode);
    const stockUnit = suppliesStockUnit(kind, selectedItem);
    const onHand = itemCode ? getBalance(itemCode) : 0;
    const drumDefault = defaultDrumWeightKg(selectedItem);
    const drumCount = Number(drums) || 0;
    const perDrum = Number(drumWeightKg) || drumDefault;
    const varnishKg = computeVarnishRestockKg(drumCount, perDrum);
    const packingQty = Number(qty) || 0;
    const targetQty = Number(newQty);
    const isEdit = mode === "edit" && Boolean(editRow);

    useEffect(() => {
        if (!open) return;

        if (isEdit && editRow) {
            const item = items.find((i) => i.code === editRow.itemCode) ?? getSuppliesRestockItems(kind).find((i) => i.code === editRow.itemCode);
            setItemCode(editRow.itemCode);
            setPostingDate(editRow.postingDate || format(new Date(), "yyyy-MM-dd"));
            setRemarks(editRow.remarks ?? "");
            if (kind === "varnish") {
                const derived = deriveVarnishRestockFields(editRow, defaultDrumWeightKg(item));
                setDrums(String(derived.drumCount));
                setDrumWeightKg(String(derived.drumWeightKg));
                setPricePerDrum(String(derived.pricePerDrum));
            } else {
                setQty(String(editRow.qtyKg));
                setUnitCost(String(editRow.unitCostPerKg));
            }
            return;
        }

        const initial = preselectedItemCode && items.some((i) => i.code === preselectedItemCode)
            ? preselectedItemCode
            : items[0]?.code ?? "";
        setItemCode(initial);
        setPostingDate(format(new Date(), "yyyy-MM-dd"));
        setDrums("");
        setDrumWeightKg("");
        setQty("");
        setNewQty("");
        setUnitCost("");
        setPricePerDrum("");
        setRemarks("");
    }, [open, preselectedItemCode, items, mode, isEdit, editRow, kind]);

    useEffect(() => {
        if (!open || mode !== "set" || !itemCode) return;
        setNewQty(String(getBalance(itemCode)));
    }, [open, mode, itemCode, getBalance]);

    useEffect(() => {
        if (!selectedItem || kind !== "varnish" || mode === "set") return;
        const w = defaultDrumWeightKg(selectedItem);
        if (w > 0 && !drumWeightKg && !isEdit) setDrumWeightKg(String(w));
    }, [selectedItem, kind, drumWeightKg, mode, isEdit]);

    const restockQty = kind === "varnish" ? varnishKg : isEdit && editRow && kind === "packing" ? packingQty : packingQty;
    const varnishUnitCostPerKg =
        kind === "varnish" ? computeVarnishUnitCostPerKg(Number(pricePerDrum) || 0, perDrum) : Number(unitCost) || 0;

    const buildVarnishNote = () =>
        formatVarnishRestockRemark(drumCount, perDrum, Number(pricePerDrum) || 0);

    const finishSave = async (message: string) => {
        await refresh();
        await onSaved?.();
        toast({ title: isEdit ? "Restock updated" : "Stock updated", description: message });
        onOpenChange(false);
    };

    const handleAdd = async () => {
        if (!itemCode) {
            toast({ title: "Select an item", variant: "destructive" });
            return;
        }
        if (kind === "varnish" && (!drumCount || !perDrum)) {
            toast({
                title: "Enter drum details",
                description: "Number of drums and kg per drum are required.",
                variant: "destructive",
            });
            return;
        }
        if (kind === "packing" && packingQty <= 0) {
            toast({ title: "Enter quantity received", variant: "destructive" });
            return;
        }

        setSaving(true);
        try {
            const cost = kind === "varnish" ? varnishUnitCostPerKg : Number(unitCost) || 0;
            const note =
                kind === "varnish"
                    ? buildVarnishNote()
                    : remarks.trim() || `${packingQty} ${selectedItem?.unit ?? "units"}`;

            if (liveMode) {
                const result = await postSuppliesRestock(
                    itemCode,
                    restockQty,
                    cost,
                    note,
                    postingDate,
                    kind === "varnish" ? drumCount : undefined,
                );
                if (!result.ok) {
                    toast({ title: "Restock failed", description: result.error, variant: "destructive" });
                    return;
                }
            } else {
                applyStockMovement({
                    type: "ADJUSTMENT",
                    itemCode,
                    qty: restockQty,
                    refDocId: `RESTOCK-${Date.now()}`,
                    refDocType: "SUPPLIES_RESTOCK",
                    docDate: postingDate,
                    rate: cost,
                    amount: restockQty * cost,
                    metadata: { remarks: note },
                });
            }

            await finishSave(
                kind === "varnish"
                    ? `${itemCode}: +${restockQty.toLocaleString()} kg (${drumCount} drum${drumCount === 1 ? "" : "s"}) · now ${getBalance(itemCode).toLocaleString()} kg on hand`
                    : `${itemCode}: +${restockQty.toLocaleString()} ${stockUnit} (now ${getBalance(itemCode).toLocaleString()} on hand)`,
            );
        } finally {
            setSaving(false);
        }
    };

    const handleEdit = async () => {
        if (!editRow) return;
        if (kind === "varnish" && (!drumCount || !perDrum)) {
            toast({ title: "Enter drum details", variant: "destructive" });
            return;
        }
        if (kind === "packing" && packingQty <= 0) {
            toast({ title: "Enter quantity", variant: "destructive" });
            return;
        }

        setSaving(true);
        try {
            const qtyToSave = kind === "varnish" ? varnishKg : packingQty;
            const cost = kind === "varnish" ? varnishUnitCostPerKg : Number(unitCost) || 0;
            const note =
                kind === "varnish"
                    ? buildVarnishNote()
                    : remarks.trim() || `${packingQty} ${selectedItem?.unit ?? "units"}`;

            const result = await updateSuppliesRestock(
                editRow.id,
                itemCode,
                qtyToSave,
                cost,
                postingDate,
                note,
                kind === "varnish" ? drumCount : undefined,
            );
            if (!result.ok) {
                toast({ title: "Update failed", description: result.error, variant: "destructive" });
                return;
            }

            await finishSave(`${itemCode}: restock updated · ${qtyToSave.toLocaleString()} ${stockUnit}`);
        } finally {
            setSaving(false);
        }
    };

    const handleSet = async () => {
        if (!itemCode) {
            toast({ title: "Select an item", variant: "destructive" });
            return;
        }
        if (Number.isNaN(targetQty) || targetQty < 0) {
            toast({ title: "Enter a valid quantity", variant: "destructive" });
            return;
        }

        setSaving(true);
        try {
            const note = remarks.trim() || undefined;

            if (liveMode) {
                const result = await postSuppliesStockSet(itemCode, targetQty, note);
                if (!result.ok) {
                    toast({ title: "Update failed", description: result.error, variant: "destructive" });
                    return;
                }
            } else {
                setSuppliesStockBalance(itemCode, targetQty, note);
            }

            await finishSave(`${itemCode}: now ${getBalance(itemCode).toLocaleString()} ${stockUnit} on hand`);
        } catch (e) {
            toast({
                title: "Update failed",
                description: e instanceof Error ? e.message : "Could not update stock.",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleSave = () => {
        if (mode === "set") void handleSet();
        else if (mode === "edit") void handleEdit();
        else void handleAdd();
    };

    const title =
        mode === "edit"
            ? kind === "varnish"
                ? "Edit varnish restock"
                : "Edit packing restock"
            : mode === "set"
              ? kind === "varnish"
                  ? "Edit varnish stock"
                  : "Edit packing stock"
              : kind === "varnish"
                ? "Restock varnish"
                : "Restock packing material";

    const description =
        mode === "edit"
            ? "Change drums, price, date, or remarks. On-hand and avg cost recalculate from all restocks."
            : mode === "set"
              ? `Set the on-hand quantity for this item (${stockUnit}).`
              : kind === "varnish"
                ? "Add golden or black varnish drums to chemical stock."
                : "Add goats, paper, wrappers, or other packing items.";

    const showVarnishFields = kind === "varnish" && mode !== "set";
    const showPackingQty = kind === "packing" && mode !== "set";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label>Item</Label>
                        <Select
                            value={itemCode}
                            onValueChange={setItemCode}
                            disabled={mode === "set" && Boolean(preselectedItemCode)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select item" />
                            </SelectTrigger>
                            <SelectContent>
                                {items.map((item) => (
                                    <SelectItem key={item.code} value={item.code}>
                                        {formatItemLabel(item)} ({item.code})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {itemCode ? (
                            <p className="text-xs text-slate-500">
                                On hand: {onHand.toLocaleString()} {stockUnit}
                            </p>
                        ) : null}
                    </div>

                    {mode !== "set" ? (
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <Input
                                type="date"
                                className="font-mono"
                                value={postingDate}
                                onChange={(e) => setPostingDate(e.target.value)}
                            />
                        </div>
                    ) : null}

                    {mode === "set" ? (
                        <div className="space-y-2">
                            <Label>New on-hand ({stockUnit})</Label>
                            <Input
                                type="number"
                                className="font-mono"
                                value={newQty}
                                onChange={(e) => setNewQty(e.target.value)}
                                placeholder="0"
                                min={0}
                            />
                        </div>
                    ) : showVarnishFields ? (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Drums</Label>
                                    <Input
                                        type="number"
                                        className="font-mono"
                                        value={drums}
                                        onChange={(e) => setDrums(e.target.value)}
                                        placeholder="0"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Kg / drum</Label>
                                    <Input
                                        type="number"
                                        className="font-mono"
                                        value={drumWeightKg}
                                        onChange={(e) => setDrumWeightKg(e.target.value)}
                                        placeholder={drumDefault > 0 ? String(drumDefault) : "200"}
                                    />
                                </div>
                            </div>
                            <p className="text-sm font-medium text-purple-900 bg-purple-50 rounded-md px-3 py-2">
                                Total: {varnishKg.toLocaleString()} kg
                                {drumCount > 0 && perDrum > 0 ? (
                                    <span className="text-purple-700 font-normal">
                                        {" "}
                                        ({drumCount} drum{drumCount === 1 ? "" : "s"} × {perDrum} kg)
                                    </span>
                                ) : null}
                            </p>
                            <div className="space-y-2">
                                <Label>Price per drum (PKR)</Label>
                                <Input
                                    type="number"
                                    className="font-mono"
                                    value={pricePerDrum}
                                    onChange={(e) => setPricePerDrum(e.target.value)}
                                    placeholder="0"
                                    min={0}
                                />
                                {Number(pricePerDrum) > 0 && perDrum > 0 ? (
                                    <p className="text-xs text-slate-500">
                                        ≈ ₨{" "}
                                        {computeVarnishUnitCostPerKg(Number(pricePerDrum), perDrum).toLocaleString(undefined, {
                                            maximumFractionDigits: 2,
                                        })}{" "}
                                        / kg stored for costing
                                    </p>
                                ) : null}
                            </div>
                        </>
                    ) : showPackingQty ? (
                        <>
                            <div className="space-y-2">
                                <Label>Quantity ({selectedItem?.unit ?? "Roll"})</Label>
                                <Input
                                    type="number"
                                    className="font-mono"
                                    value={qty}
                                    onChange={(e) => setQty(e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Unit cost {mode === "add" ? "(optional)" : "(PKR)"}</Label>
                                <Input
                                    type="number"
                                    className="font-mono"
                                    value={unitCost}
                                    onChange={(e) => setUnitCost(e.target.value)}
                                    placeholder="0"
                                    min={0}
                                />
                            </div>
                        </>
                    ) : null}

                    <div className="space-y-2">
                        <Label>Remarks (optional)</Label>
                        <Input
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            placeholder="Reason for change, batch, etc."
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                        {saving ? "Saving…" : mode === "set" ? "Save" : mode === "edit" ? "Save changes" : "Add stock"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
