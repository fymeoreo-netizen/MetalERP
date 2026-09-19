import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { ItemCombobox, type ItemComboboxGroup } from "@/components/invoices/ItemCombobox";
import { useToast } from "@/components/ui/use-toast";
import { useInventory, useInventoryActions } from "@/contexts/InventoryContext";
import { useBackendLiveMode } from "@/lib/backendFlags";
import {
    deleteInventoryAdjustment,
    fetchInventoryAdjustments,
    postInventoryAdjustment,
    type InventoryAdjustmentRow,
} from "@/lib/api/inventory";
import {
    getItemCatalog,
    getManagedCategoryForItem,
    getWarehouseLabel,
    getWarehouseType,
    itemTracksUnitCount,
    type ItemMasterRecord,
    type WarehouseType,
} from "@/lib/itemCatalog";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ArrowLeft, Loader2, Scale, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";

const CARD = "shadow-soft border-slate-100 bg-white";

const WAREHOUSE_OPTIONS: { value: WarehouseType; label: string }[] = [
    { value: "finished_goods", label: "Finished Goods" },
    { value: "raw_material", label: "Raw Material" },
    { value: "packing_material", label: "Packing Material" },
    { value: "varnish", label: "Varnish / Chemicals" },
];

type AdjustmentFormValues = {
    adjustmentDate: string;
    itemCode: string;
    warehouseType: WarehouseType;
    direction: "in" | "out";
    qtyKg: string;
    unitCount: string;
    remarks: string;
};

function formatPkr(n: number): string {
    return `₨ ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function buildItemGroups(items: ItemMasterRecord[]): ItemComboboxGroup[] {
    const groups = new Map<string, ItemComboboxGroup["items"]>();
    for (const item of items) {
        const label = getManagedCategoryForItem(item);
        const bucket = groups.get(label) ?? [];
        bucket.push({ code: item.code, name: item.name, sizeSpec: item.sizeSpec });
        groups.set(label, bucket);
    }
    return Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, groupItems]) => ({
            label,
            items: groupItems.sort((a, b) => a.name.localeCompare(b.name)),
        }));
}

export default function StockAdjustments() {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const { getBalance, getUnitBalance, getAvgUnitCost } = useInventory();
    const { refresh } = useInventoryActions();

    const [history, setHistory] = useState<InventoryAdjustmentRow[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [posting, setPosting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const activeItems = useMemo(() => getItemCatalog(), []);
    const itemGroups = useMemo(() => buildItemGroups(activeItems), [activeItems]);
    const itemByCode = useMemo(() => {
        const map = new Map<string, ItemMasterRecord>();
        for (const item of activeItems) map.set(item.code, item);
        return map;
    }, [activeItems]);

    const form = useForm<AdjustmentFormValues>({
        defaultValues: {
            adjustmentDate: format(new Date(), "yyyy-MM-dd"),
            itemCode: "",
            warehouseType: "finished_goods",
            direction: "out",
            qtyKg: "",
            unitCount: "",
            remarks: "",
        },
    });

    const watchItemCode = form.watch("itemCode");
    const watchWarehouse = form.watch("warehouseType");
    const watchDirection = form.watch("direction");
    const watchQty = form.watch("qtyKg");

    const selectedItem = watchItemCode ? itemByCode.get(watchItemCode) : undefined;
    const tracksUnits = selectedItem
        ? itemTracksUnitCount(selectedItem) || watchWarehouse === "packing_material"
        : false;

    const onHandKg = watchItemCode ? getBalance(watchItemCode) : 0;
    const onHandUnits = watchItemCode ? getUnitBalance(watchItemCode) : 0;
    const bookWac = watchItemCode ? (getAvgUnitCost(watchItemCode) ?? 0) : 0;
    const qtyNum = Number(watchQty) || 0;
    const estimatedValue = qtyNum > 0 && bookWac > 0 ? Math.round(qtyNum * bookWac * 1000) / 1000 : 0;

    const loadHistory = useCallback(async () => {
        if (!liveMode) {
            setHistory([]);
            return;
        }
        setHistoryLoading(true);
        try {
            const rows = await fetchInventoryAdjustments(100);
            setHistory(rows);
        } catch (e) {
            toast({
                title: "Could not load adjustments",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setHistoryLoading(false);
        }
    }, [liveMode, toast]);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    useEffect(() => {
        if (!selectedItem) return;
        form.setValue("warehouseType", getWarehouseType(selectedItem));
    }, [selectedItem, form]);

    const handleItemSelect = (code: string) => {
        form.setValue("itemCode", code, { shouldDirty: true });
        const item = itemByCode.get(code);
        if (item) {
            form.setValue("warehouseType", getWarehouseType(item));
        }
    };

    const onSubmit = form.handleSubmit(async (values) => {
        if (!liveMode) {
            toast({
                title: "Live ERP required",
                description: "Stock adjustments post to the database and general ledger in live mode only.",
                variant: "destructive",
            });
            return;
        }

        const qtyKg = Number(values.qtyKg);
        if (!values.itemCode) {
            toast({ title: "Select an item", variant: "destructive" });
            return;
        }
        if (!qtyKg || qtyKg <= 0) {
            toast({ title: "Enter a quantity greater than zero", variant: "destructive" });
            return;
        }

        const unitCount = values.unitCount.trim() ? Number(values.unitCount) : undefined;
        if (tracksUnits && unitCount != null && unitCount < 0) {
            toast({ title: "Unit count cannot be negative", variant: "destructive" });
            return;
        }

        setPosting(true);
        try {
            const result = await postInventoryAdjustment({
                itemCode: values.itemCode,
                warehouseType: values.warehouseType,
                adjustmentDate: values.adjustmentDate,
                direction: values.direction,
                qtyKg,
                unitCount,
                remarks: values.remarks.trim() || undefined,
            });

            if (!result.ok) {
                toast({
                    title: "Adjustment failed",
                    description: result.error,
                    variant: "destructive",
                });
                return;
            }

            toast({
                title: "Stock adjustment posted",
                description: `${result.data.adjustmentNo} · ${formatPkr(result.data.valueAmount)} at ${result.data.unitCost.toLocaleString()}/kg`,
            });

            form.reset({
                adjustmentDate: values.adjustmentDate,
                itemCode: "",
                warehouseType: "finished_goods",
                direction: values.direction,
                qtyKg: "",
                unitCount: "",
                remarks: "",
            });

            void refresh();
            await loadHistory();
        } finally {
            setPosting(false);
        }
    });

    const handleDelete = async (row: InventoryAdjustmentRow) => {
        if (!liveMode) return;
        if (!window.confirm(`Delete adjustment ${row.adjustmentNo}? Inventory and GL will be reversed.`)) return;

        setDeletingId(row.id);
        try {
            const result = await deleteInventoryAdjustment(row.id);
            if (!result.ok) {
                toast({ title: "Delete failed", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Adjustment deleted", description: row.adjustmentNo });
            void refresh();
            await loadHistory();
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-6xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <Link
                            to="/inventory"
                            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-2"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to inventory
                        </Link>
                        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Stock Adjustments</h1>
                        <p className="text-sm text-slate-500 mt-1">
                            Correct physical stock without purchase or sales invoices. Posts to inventory and GL at book WAC.
                        </p>
                    </div>
                </div>

                {!liveMode ? (
                    <Card className={cn(CARD, "border-amber-200 bg-amber-50/50")}>
                        <CardContent className="py-4 text-sm text-amber-900">
                            Connect to live ERP to post stock adjustments. Demo mode cannot write inventory movements or journal entries.
                        </CardContent>
                    </Card>
                ) : null}

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <Card className={cn(CARD, "lg:col-span-2")}>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Scale className="h-5 w-5 text-indigo-600" />
                                New adjustment
                            </CardTitle>
                            <CardDescription>Shortage/loss reduces stock; found/gain increases stock.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={onSubmit} className="space-y-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="adjustmentDate">Date</Label>
                                    <Input
                                        id="adjustmentDate"
                                        type="date"
                                        {...form.register("adjustmentDate", { required: true })}
                                    />
                                </div>

                                <div className="grid gap-2">
                                    <Label>Item</Label>
                                    <ItemCombobox
                                        value={watchItemCode}
                                        onSelect={handleItemSelect}
                                        groups={itemGroups}
                                        placeholder="Search active items…"
                                    />
                                </div>

                                <div className="grid gap-2">
                                    <Label>Warehouse</Label>
                                    <Select
                                        value={watchWarehouse}
                                        onValueChange={(v) =>
                                            form.setValue("warehouseType", v as WarehouseType, { shouldDirty: true })
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select warehouse" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {WAREHOUSE_OPTIONS.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {selectedItem ? (
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
                                        <p>
                                            On hand: <span className="font-mono font-semibold text-slate-900">{onHandKg.toLocaleString()} kg</span>
                                            {tracksUnits ? (
                                                <span className="ml-2">
                                                    · <span className="font-mono font-semibold">{onHandUnits.toLocaleString()} units</span>
                                                </span>
                                            ) : null}
                                        </p>
                                        <p>
                                            Book WAC:{" "}
                                            <span className="font-mono font-semibold text-slate-900">
                                                {bookWac > 0 ? `${bookWac.toLocaleString()}/kg` : "—"}
                                            </span>
                                        </p>
                                    </div>
                                ) : null}

                                <div className="grid gap-2">
                                    <Label>Adjustment type</Label>
                                    <RadioGroup
                                        value={watchDirection}
                                        onValueChange={(v) =>
                                            form.setValue("direction", v as "in" | "out", { shouldDirty: true })
                                        }
                                        className="grid grid-cols-1 gap-2"
                                    >
                                        <label
                                            className={cn(
                                                "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                                                watchDirection === "out"
                                                    ? "border-rose-300 bg-rose-50/60"
                                                    : "border-slate-200 hover:bg-slate-50",
                                            )}
                                        >
                                            <RadioGroupItem value="out" className="mt-0.5" />
                                            <div>
                                                <span className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
                                                    <TrendingDown className="h-4 w-4 text-rose-600" />
                                                    Reduce stock (shortage / loss)
                                                </span>
                                                <p className="text-xs text-slate-500 mt-0.5">Dr wastage · Cr inventory asset</p>
                                            </div>
                                        </label>
                                        <label
                                            className={cn(
                                                "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                                                watchDirection === "in"
                                                    ? "border-emerald-300 bg-emerald-50/60"
                                                    : "border-slate-200 hover:bg-slate-50",
                                            )}
                                        >
                                            <RadioGroupItem value="in" className="mt-0.5" />
                                            <div>
                                                <span className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
                                                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                                                    Increase stock (found / gain)
                                                </span>
                                                <p className="text-xs text-slate-500 mt-0.5">Dr inventory asset · Cr inventory gain</p>
                                            </div>
                                        </label>
                                    </RadioGroup>
                                </div>

                                <div className="grid gap-2">
                                    <Label htmlFor="qtyKg">Quantity (kg)</Label>
                                    <Input
                                        id="qtyKg"
                                        type="number"
                                        min="0"
                                        step="0.001"
                                        placeholder="0.000"
                                        {...form.register("qtyKg", { required: true })}
                                    />
                                    {qtyNum > 0 && bookWac > 0 ? (
                                        <p className="text-xs text-slate-500">
                                            Estimated value at book WAC: <span className="font-mono">{formatPkr(estimatedValue)}</span>
                                        </p>
                                    ) : null}
                                </div>

                                {tracksUnits ? (
                                    <div className="grid gap-2">
                                        <Label htmlFor="unitCount">Units (optional)</Label>
                                        <Input
                                            id="unitCount"
                                            type="number"
                                            min="0"
                                            step="1"
                                            placeholder="Coils / drums / units"
                                            {...form.register("unitCount")}
                                        />
                                    </div>
                                ) : null}

                                <div className="grid gap-2">
                                    <Label htmlFor="remarks">Reason / remarks</Label>
                                    <Textarea
                                        id="remarks"
                                        rows={3}
                                        placeholder="e.g. Sunday audit scale difference"
                                        {...form.register("remarks")}
                                    />
                                </div>

                                <Button
                                    type="submit"
                                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                                    disabled={posting || !liveMode}
                                >
                                    {posting ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Posting…
                                        </>
                                    ) : (
                                        "Post adjustment"
                                    )}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    <Card className={cn(CARD, "lg:col-span-3")}>
                        <CardHeader>
                            <CardTitle className="text-lg">Adjustment history</CardTitle>
                            <CardDescription>Posted corrections — delete reverses stock and journal entries.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <TableScroller>
                                <Table noWrapper className="min-w-[720px]">
                                    <TableHeader>
                                        <TableRow className="bg-slate-50">
                                            <TableHead>Adj #</TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Item</TableHead>
                                            <TableHead>Warehouse</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead className="text-right">Qty (kg)</TableHead>
                                            <TableHead className="text-right">Value</TableHead>
                                            <TableHead className="w-[52px]" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {historyLoading ? (
                                            <TableRow>
                                                <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-500">
                                                    Loading…
                                                </TableCell>
                                            </TableRow>
                                        ) : history.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-500">
                                                    {liveMode ? "No stock adjustments yet." : "History appears in live ERP mode."}
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            history.map((row) => (
                                                <TableRow key={row.id}>
                                                    <TableCell className="font-mono text-xs text-indigo-700">{row.adjustmentNo}</TableCell>
                                                    <TableCell className="text-sm">{row.postingDate}</TableCell>
                                                    <TableCell>
                                                        <div className="text-sm font-medium text-slate-900">{row.itemName}</div>
                                                        <div className="text-xs text-slate-400 font-mono">{row.itemCode}</div>
                                                        {row.remarks ? (
                                                            <div className="text-xs text-slate-500 mt-0.5 max-w-[200px] truncate" title={row.remarks}>
                                                                {row.remarks}
                                                            </div>
                                                        ) : null}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-slate-600">
                                                        {getWarehouseLabel(row.warehouseType as WarehouseType)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <span
                                                            className={cn(
                                                                "inline-flex text-xs font-medium px-2 py-0.5 rounded-full",
                                                                row.direction === "out"
                                                                    ? "bg-rose-100 text-rose-700"
                                                                    : "bg-emerald-100 text-emerald-700",
                                                            )}
                                                        >
                                                            {row.direction === "out" ? "Reduce" : "Increase"}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-sm">{row.qtyKg.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right font-mono text-sm">{formatPkr(row.valueAmount)}</TableCell>
                                                    <TableCell>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                                                            disabled={deletingId === row.id || !liveMode}
                                                            onClick={() => void handleDelete(row)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </TableScroller>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
