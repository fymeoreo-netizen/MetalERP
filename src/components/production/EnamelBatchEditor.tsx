import { useEffect, useMemo, useRef, useState } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Edit, Factory, LayoutGrid, List, Plus, Save, Trash2 } from "lucide-react";
import {
    formatEnamelItemLabel,
    getEnamelProductionItemOptions,
    isStripItemCode,
} from "@/lib/enamelProduction";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { ItemCombobox, type ItemComboboxGroup } from "@/components/invoices/ItemCombobox";

export type EnamelProductionEntry = {
    entryId: string;
    lineId?: string;
    item: string;
    unitCount: string;
    grossWeight?: string;
    tareWeight?: string;
    netWeight: string;
    machineId: string;
};

export type EnamelMachineOption = {
    id: string;
    code: string;
    name: string;
};

type EnamelBatchEditorProps = {
    batchLabel: string;
    batchDate: string;
    onBatchDateChange: (date: string) => void;
    entries: EnamelProductionEntry[];
    onEntriesChange: (entries: EnamelProductionEntry[]) => void;
    onSave: () => void;
    saveLabel?: string;
    saving?: boolean;
    onSaveDraft?: () => void;
    catalogTick?: number;
    focusItemPickerToken?: number;
    machines: EnamelMachineOption[];
    machineId: string;
    onMachineChange: (id: string) => void;
};

type SectionGroup = {
    machineId: string;
    code: string;
    name: string;
    entries: EnamelProductionEntry[];
};

function clearFormFields(
    setters: {
        setSelectedItem: (v: string) => void;
        setUnitCount: (v: string) => void;
        setGrossWeight: (v: string) => void;
        setTareWeight: (v: string) => void;
        setNetWeight: (v: string) => void;
    },
) {
    setters.setSelectedItem("");
    setters.setUnitCount("");
    setters.setGrossWeight("");
    setters.setTareWeight("");
    setters.setNetWeight("");
}

export default function EnamelBatchEditor({
    batchLabel,
    batchDate,
    onBatchDateChange,
    entries,
    onEntriesChange,
    onSave,
    saveLabel = "Save Production Batch",
    saving = false,
    onSaveDraft,
    catalogTick = 0,
    focusItemPickerToken = 0,
    machines,
    machineId,
    onMachineChange,
}: EnamelBatchEditorProps) {
    const [selectedItem, setSelectedItem] = useState("");
    const itemPickerRef = useRef<HTMLButtonElement>(null);
    // Batch line grids stay far below 50 rows, so animating the tbody is safe.
    const [entriesRef] = useAutoAnimate<HTMLTableSectionElement>();
    const [unitCount, setUnitCount] = useState("");
    const [grossWeight, setGrossWeight] = useState("");
    const [tareWeight, setTareWeight] = useState("");
    const [netWeight, setNetWeight] = useState("");
    const [editingPendingId, setEditingPendingId] = useState<string | null>(null);

    const catalogItems = useMemo(() => getEnamelProductionItemOptions(), [catalogTick]);
    const itemGroups = useMemo<ItemComboboxGroup[]>(() => {
        const groups = new Map<string, ItemComboboxGroup["items"]>();
        for (const item of catalogItems) {
            const label = isStripItemCode(item.code)
                ? "Copper Strip"
                : item.category === "Copper Wire" || item.itemType === "Copper Wire"
                  ? "Copper Wire"
                  : "Enameled Wire";
            const items = groups.get(label) ?? [];
            items.push({ code: item.code, name: item.name, sizeSpec: item.sizeSpec });
            groups.set(label, items);
        }
        return Array.from(groups, ([label, items]) => ({ label, items }));
    }, [catalogItems]);
    const isStripSelected = selectedItem ? isStripItemCode(selectedItem) : false;

    const machineById = useMemo(() => {
        const map = new Map<string, EnamelMachineOption>();
        for (const m of machines) map.set(m.id, m);
        return map;
    }, [machines]);

    const sections = useMemo<SectionGroup[]>(() => {
        const order: string[] = [];
        const map = new Map<string, EnamelProductionEntry[]>();
        for (const entry of entries) {
            const key = entry.machineId || "";
            if (!map.has(key)) {
                order.push(key);
                map.set(key, []);
            }
            map.get(key)!.push(entry);
        }
        return order.map((key) => {
            const m = machineById.get(key);
            return {
                machineId: key,
                code: m?.code ?? "",
                name: m?.name ?? (key ? "Unknown machine" : "No machine"),
                entries: map.get(key)!,
            };
        });
    }, [entries, machineById]);

    useEffect(() => {
        if (isStripSelected) {
            const g = Number(grossWeight) || 0;
            const t = Number(tareWeight) || 0;
            if (g > 0) setNetWeight(Math.max(0, g - t).toFixed(2));
            else setNetWeight("");
        }
    }, [grossWeight, tareWeight, isStripSelected]);

    useEffect(() => {
        if (focusItemPickerToken > 0) {
            requestAnimationFrame(() => itemPickerRef.current?.focus());
        }
    }, [focusItemPickerToken]);

    const resetForm = (focusPicker = true) => {
        setEditingPendingId(null);
        clearFormFields({ setSelectedItem, setUnitCount, setGrossWeight, setTareWeight, setNetWeight });
        if (focusPicker) requestAnimationFrame(() => itemPickerRef.current?.focus());
    };

    /** Clear weights only on intentional product change — not when loading a line for edit. */
    const handleSelectItem = (code: string) => {
        setSelectedItem(code);
        setGrossWeight("");
        setTareWeight("");
        setNetWeight("");
    };

    const handleAddOrUpdateLine = () => {
        if (machines.length > 0 && !machineId) {
            toast.error("Please select a machine before adding a line.");
            return;
        }
        if (!selectedItem || !netWeight) {
            toast.error("Please select a product item and enter nett weight.");
            return;
        }
        const net = Number(netWeight);
        if (net <= 0) {
            toast.error("Nett weight must be greater than zero.");
            return;
        }
        if (isStripSelected) {
            const g = Number(grossWeight) || 0;
            const t = Number(tareWeight) || 0;
            if (g < t) {
                toast.error("Gross weight must be greater than or equal to tare.");
                return;
            }
        }

        const existingLine = editingPendingId
            ? entries.find((entry) => entry.entryId === editingPendingId)
            : undefined;
        const line: EnamelProductionEntry = {
            entryId: editingPendingId ?? Math.random().toString(36).slice(2, 11),
            lineId: existingLine?.lineId,
            item: selectedItem,
            unitCount,
            grossWeight: isStripSelected ? grossWeight : undefined,
            tareWeight: isStripSelected ? tareWeight : undefined,
            netWeight,
            machineId,
        };

        if (editingPendingId) {
            onEntriesChange(entries.map((e) => (e.entryId === editingPendingId ? line : e)));
            toast.success("Line updated in batch.");
        } else {
            onEntriesChange([...entries, line]);
        }
        resetForm();
    };

    const handleEditPending = (entry: EnamelProductionEntry) => {
        setEditingPendingId(entry.entryId);
        setSelectedItem(entry.item);
        setUnitCount(entry.unitCount);
        setGrossWeight(entry.grossWeight ?? "");
        setTareWeight(entry.tareWeight ?? "");
        setNetWeight(entry.netWeight);
        if (entry.machineId) onMachineChange(entry.machineId);
    };

    const handleRemovePending = (entryId: string) => {
        onEntriesChange(entries.filter((e) => e.entryId !== entryId));
        if (editingPendingId === entryId) resetForm();
    };

    return (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <Card className="xl:col-span-4 h-fit border-slate-200 shadow-sm xl:sticky xl:top-6">
                <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2">
                        <LayoutGrid className="h-5 w-5 text-black" />
                        <div>
                            <CardTitle className="text-lg font-semibold text-slate-800">
                                {editingPendingId ? "Edit Line" : "Add Entry"}
                            </CardTitle>
                            <CardDescription>
                                Production ID:{" "}
                                <span className="font-bold text-blue-600">{batchLabel}</span>
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-5 space-y-5">
                    <div className="grid gap-1.5">
                        <Label className="text-xs font-semibold text-slate-600 uppercase">Date</Label>
                        <Input
                            type="date"
                            value={batchDate}
                            onChange={(e) => onBatchDateChange(e.target.value)}
                            className="h-9"
                        />
                    </div>

                    {machines.length > 0 && (
                        <div className="grid gap-1.5">
                            <Label className="text-xs font-semibold text-slate-600 uppercase">
                                Machine for this entry
                            </Label>
                            <Select value={machineId} onValueChange={onMachineChange}>
                                <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select machine" />
                                </SelectTrigger>
                                <SelectContent>
                                    {machines.map((m) => (
                                        <SelectItem key={m.id} value={m.id}>
                                            {m.code ? `${m.code} — ${m.name}` : m.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[11px] text-slate-400">
                                Change the machine any time before adding the next item. Each item is
                                recorded under the machine selected here, all under one batch.
                            </p>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="grid gap-1.5">
                            <Label className="text-xs font-semibold text-slate-600 uppercase">Product Item</Label>
                            <ItemCombobox
                                ref={itemPickerRef}
                                value={selectedItem}
                                onSelect={handleSelectItem}
                                groups={itemGroups}
                                placeholder="Search item master"
                                searchPlaceholder="Search product name, size, or code…"
                                emptyMessage={
                                    catalogItems.length === 0
                                        ? "No production items in the catalog."
                                        : "No matching production item."
                                }
                            />
                        </div>

                        <div className="grid gap-1.5">
                            <Label className="text-xs font-semibold text-slate-600 uppercase">
                                {isStripSelected ? "Units" : "Units (goats)"}
                            </Label>
                            <Input
                                type="number"
                                min={0}
                                placeholder="0"
                                value={unitCount}
                                onChange={(e) => setUnitCount(e.target.value)}
                                className="h-9"
                            />
                        </div>

                        {selectedItem && (
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-4">
                                {isStripSelected ? (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs text-slate-500">Gross Wt (kg)</Label>
                                                <Input
                                                    type="number"
                                                    placeholder="0.00"
                                                    value={grossWeight}
                                                    onChange={(e) => setGrossWeight(e.target.value)}
                                                    className="font-mono h-9"
                                                />
                                            </div>
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs text-slate-500">Tare Wt (kg)</Label>
                                                <Input
                                                    type="number"
                                                    placeholder="0.00"
                                                    value={tareWeight}
                                                    onChange={(e) => setTareWeight(e.target.value)}
                                                    className="font-mono h-9"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs font-semibold text-slate-900">Nett Wt (kg)</Label>
                                            <Input
                                                type="number"
                                                readOnly
                                                placeholder="0.00"
                                                value={netWeight}
                                                className="font-mono h-9 bg-emerald-50 border-emerald-200 text-emerald-700 font-bold"
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs font-semibold text-slate-900">Nett Wt (kg)</Label>
                                        <Input
                                            type="number"
                                            placeholder="0.00"
                                            value={netWeight}
                                            onChange={(e) => setNetWeight(e.target.value)}
                                            className="font-mono h-9 border-blue-200 bg-blue-50/50"
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        <Button
                            onClick={handleAddOrUpdateLine}
                            className="w-full bg-slate-900 hover:bg-slate-800"
                            size="lg"
                        >
                            <Plus className="mr-2 h-5 w-5" />
                            {editingPendingId ? "Update line" : "Add to Batch"}
                        </Button>
                        {editingPendingId && (
                            <Button variant="outline" size="sm" onClick={() => resetForm()}>
                                Cancel edit
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card className="xl:col-span-8 border-slate-200 shadow-sm flex flex-col h-full min-h-[440px]">
                <CardHeader className="bg-white border-b border-slate-100 px-4 py-3 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                        <List className="h-5 w-5 text-slate-400" />
                        <div>
                            <CardTitle className="text-lg font-semibold text-slate-800">
                                Current Production Batch
                            </CardTitle>
                            <CardDescription>
                                Items to be saved under {batchLabel} · {sections.length} machine
                                {sections.length === 1 ? "" : "s"}
                            </CardDescription>
                        </div>
                    </div>
                    <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                        {entries.length} Items
                    </span>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-hidden">
                    {entries.length === 0 ? (
                        <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-slate-400">
                            <Factory className="h-8 w-8 text-slate-300 mb-4" />
                            <p className="text-lg font-medium text-slate-600">Batch is empty</p>
                            <p className="text-sm">Pick a machine, then add items using the form.</p>
                        </div>
                    ) : (
                        <TableScroller className="h-full">
                            <div className="divide-y divide-slate-200">
                                {sections.map((section) => (
                                    <div key={section.machineId || "none"} className="px-4 py-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-semibold uppercase text-slate-500">
                                                    Machine
                                                </span>
                                                <span className="text-sm font-semibold text-slate-800">
                                                    {section.code ? `${section.code} — ${section.name}` : section.name}
                                                </span>
                                                <span className="text-[11px] text-slate-400">
                                                    {section.entries.length} item
                                                    {section.entries.length === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-slate-500"
                                                onClick={() => onMachineChange(section.machineId)}
                                            >
                                                Add to this machine
                                            </Button>
                                        </div>
                                        <Table noWrapper className="text-sm">
                                            <TableHeader>
                                                <TableRow className="h-8 bg-slate-50">
                                                    <TableHead className="h-8">Item</TableHead>
                                                    <TableHead className="h-8 text-center">Units</TableHead>
                                                    <TableHead className="h-8 text-right">Gross</TableHead>
                                                    <TableHead className="h-8 text-right">Tare</TableHead>
                                                    <TableHead className="h-8 text-right font-bold">Nett</TableHead>
                                                    <TableHead className="h-8 w-[76px]" />
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody ref={entriesRef}>
                                                {section.entries.map((entry) => (
                                                    <TableRow
                                                        key={entry.entryId}
                                                        className={
                                                            editingPendingId === entry.entryId
                                                                ? "bg-blue-50/60"
                                                                : "hover:bg-slate-50/50"
                                                        }
                                                    >
                                                        <TableCell className="py-1.5 text-slate-700 text-sm">
                                                            {formatEnamelItemLabel(entry.item)}
                                                        </TableCell>
                                                        <TableCell className="py-1.5 text-center font-mono text-slate-600">
                                                            {entry.unitCount || "-"}
                                                        </TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono text-slate-500">
                                                            {entry.grossWeight ? `${entry.grossWeight} kg` : "-"}
                                                        </TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono text-slate-500">
                                                            {entry.tareWeight ? `${entry.tareWeight} kg` : "-"}
                                                        </TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono font-bold text-emerald-600">
                                                            {entry.netWeight} kg
                                                        </TableCell>
                                                        <TableCell className="py-1 text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() => handleEditPending(entry)}
                                                            >
                                                                <Edit className="h-4 w-4 text-black" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-rose-500"
                                                                onClick={() => handleRemovePending(entry.entryId)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                            <TableFooter>
                                                <TableRow className="h-8 bg-slate-100/80 hover:bg-slate-100/80">
                                                    <TableCell className="py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                        Machine total
                                                    </TableCell>
                                                    <TableCell className="py-1.5 text-center font-mono font-semibold text-slate-800">
                                                        {section.entries.reduce(
                                                            (s, e) => s + (Number(e.unitCount) || 0),
                                                            0,
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="py-1.5" />
                                                    <TableCell className="py-1.5" />
                                                    <TableCell className="py-1.5 text-right font-mono font-bold text-emerald-700">
                                                        {(
                                                            Math.round(
                                                                section.entries.reduce(
                                                                    (s, e) => s + (Number(e.netWeight) || 0),
                                                                    0,
                                                                ) * 1000,
                                                            ) / 1000
                                                        ).toLocaleString(undefined, {
                                                            maximumFractionDigits: 3,
                                                        })}{" "}
                                                        kg
                                                    </TableCell>
                                                    <TableCell className="py-1.5" />
                                                </TableRow>
                                            </TableFooter>
                                        </Table>
                                    </div>
                                ))}
                            </div>
                        </TableScroller>
                    )}
                </CardContent>
                <div className="p-3 border-t border-slate-100 bg-blue-50/50 flex flex-wrap gap-2 sm:justify-end">
                    <Button
                        onClick={onSave}
                        className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white"
                        size="lg"
                        disabled={entries.length === 0 || saving}
                    >
                        <Save className="mr-2 h-5 w-5" />
                        {saving ? "Saving…" : saveLabel}
                    </Button>
                    {onSaveDraft ? (
                        <Button
                            onClick={onSaveDraft}
                            variant="outline"
                            size="lg"
                            disabled={entries.length === 0 || saving}
                        >
                            <Save className="mr-2 h-5 w-5" />
                            Save Draft
                        </Button>
                    ) : null}
                </div>
            </Card>
        </div>
    );
}
