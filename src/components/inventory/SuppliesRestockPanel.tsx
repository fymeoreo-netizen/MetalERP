import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { fetchSuppliesRestockHistory } from "@/lib/api/posting";
import { getCatalogItem } from "@/lib/itemCatalog";
import {
    defaultDrumWeightKg,
    deriveVarnishRestockFields,
    formatVarnishDrums,
    summarizeSuppliesRestockTotals,
    suppliesStockUnit,
    type SuppliesRestockKind,
    type SuppliesRestockRow,
} from "@/lib/suppliesRestock";
import { RestockSuppliesDialog } from "@/components/inventory/RestockSuppliesDialog";
import { cn } from "@/lib/utils";

type Props = {
    kind: SuppliesRestockKind;
    refreshKey?: number;
    onStockChanged?: () => void;
};

const KIND_META: Record<
    SuppliesRestockKind,
    {
        empty: string;
        description: string;
        totalsClass: string;
        accentClass: string;
    }
> = {
    varnish: {
        empty: "No varnish restocks yet. Use Restock varnish to add drums.",
        description: "All varnish drum receipts — edit item, qty, price, or date; WAC recalculates.",
        totalsClass: "bg-purple-50/60 border-purple-100 text-purple-900",
        accentClass: "text-purple-800",
    },
    packing: {
        empty: "No packing restocks yet. Use Restock packing to add stock.",
        description: "All packing receipts — edit item, qty, unit cost, or date; balances recalculate.",
        totalsClass: "bg-amber-50/60 border-amber-100 text-amber-900",
        accentClass: "text-amber-800",
    },
};

function formatPkr(n: number): string {
    return `₨ ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function SuppliesRestockPanel({ kind, refreshKey = 0, onStockChanged }: Props) {
    const meta = KIND_META[kind];
    const [rows, setRows] = useState<SuppliesRestockRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [editRow, setEditRow] = useState<SuppliesRestockRow | undefined>();

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchSuppliesRestockHistory(kind);
            setRows(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load restock history.");
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [kind]);

    useEffect(() => {
        void load();
    }, [load, refreshKey]);

    const totals = useMemo(() => summarizeSuppliesRestockTotals(rows), [rows]);

    const openEdit = (row: SuppliesRestockRow) => {
        setEditRow(row);
        setEditOpen(true);
    };

    const handleSaved = async () => {
        await load();
        onStockChanged?.();
    };

    return (
        <div className="space-y-3">
            <div>
                <h3 className="text-sm font-semibold text-slate-900">Restock history</h3>
                <p className="text-xs text-slate-500">{meta.description}</p>
            </div>

            {loading ? (
                <p className="text-sm text-slate-500 py-6 text-center">Loading restocks…</p>
            ) : error ? (
                <p className="text-sm text-rose-600 py-6 text-center">{error}</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-200 bg-slate-50/40">
                    {meta.empty}
                </p>
            ) : (
                <TableScroller>
                    <Table noWrapper className={cn("text-sm", kind === "varnish" ? "min-w-[880px]" : "min-w-[760px]")}>
                        <TableHeader>
                            <TableRow className="border-slate-100">
                                <TableHead className="text-slate-500">Date</TableHead>
                                <TableHead className="text-slate-500">Item</TableHead>
                                {kind === "varnish" ? (
                                    <>
                                        <TableHead className="text-right text-slate-500">Drums</TableHead>
                                        <TableHead className="text-right text-slate-500">Kg</TableHead>
                                        <TableHead className="text-right text-slate-500">Price / drum</TableHead>
                                        <TableHead className="text-right text-slate-500">Avg / kg</TableHead>
                                    </>
                                ) : (
                                    <>
                                        <TableHead className="text-right text-slate-500">Qty</TableHead>
                                        <TableHead className="text-slate-500">UOM</TableHead>
                                        <TableHead className="text-right text-slate-500">Unit cost</TableHead>
                                    </>
                                )}
                                <TableHead className="text-right text-slate-500">Value</TableHead>
                                <TableHead className="text-slate-500">Remarks</TableHead>
                                <TableHead className="w-10" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row) => {
                                const item = getCatalogItem(row.itemCode);
                                if (kind === "varnish") {
                                    const drumWeight = defaultDrumWeightKg(item);
                                    const derived = deriveVarnishRestockFields(row, drumWeight);
                                    return (
                                        <TableRow key={row.id} className="border-slate-50">
                                            <TableCell className="py-2 tabular-nums whitespace-nowrap">
                                                {row.postingDate
                                                    ? format(parseISO(row.postingDate), "dd MMM yyyy")
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="py-2">
                                                <p className="font-medium text-slate-800">{row.itemName}</p>
                                                <p className="text-[11px] font-mono text-slate-400">{row.itemCode}</p>
                                            </TableCell>
                                            <TableCell className="py-2 text-right tabular-nums">
                                                {derived.drumCount.toLocaleString(undefined, {
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className="py-2 text-right tabular-nums font-medium">
                                                {row.qtyKg.toLocaleString()}
                                            </TableCell>
                                            <TableCell className="py-2 text-right tabular-nums">
                                                {derived.pricePerDrum > 0 ? formatPkr(derived.pricePerDrum) : "—"}
                                            </TableCell>
                                            <TableCell className={cn("py-2 text-right tabular-nums", meta.accentClass)}>
                                                {row.unitCostPerKg > 0
                                                    ? `₨ ${row.unitCostPerKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="py-2 text-right tabular-nums font-medium">
                                                {formatPkr(row.totalValue)}
                                            </TableCell>
                                            <TableCell className="py-2 text-xs text-slate-500 max-w-[180px] truncate">
                                                {row.remarks || "—"}
                                            </TableCell>
                                            <TableCell className="py-2 text-right">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-slate-500 hover:text-slate-900"
                                                    onClick={() => openEdit(row)}
                                                    title="Edit restock"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                }

                                const uom = suppliesStockUnit("packing", item);
                                return (
                                    <TableRow key={row.id} className="border-slate-50">
                                        <TableCell className="py-2 tabular-nums whitespace-nowrap">
                                            {row.postingDate
                                                ? format(parseISO(row.postingDate), "dd MMM yyyy")
                                                : "—"}
                                        </TableCell>
                                        <TableCell className="py-2">
                                            <p className="font-medium text-slate-800">{row.itemName}</p>
                                            <p className="text-[11px] font-mono text-slate-400">{row.itemCode}</p>
                                        </TableCell>
                                        <TableCell className="py-2 text-right tabular-nums font-medium">
                                            {row.qtyKg.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="py-2 text-slate-500 text-xs">{uom}</TableCell>
                                        <TableCell className={cn("py-2 text-right tabular-nums", meta.accentClass)}>
                                            {row.unitCostPerKg > 0
                                                ? `₨ ${row.unitCostPerKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                                : "—"}
                                        </TableCell>
                                        <TableCell className="py-2 text-right tabular-nums font-medium">
                                            {formatPkr(row.totalValue)}
                                        </TableCell>
                                        <TableCell className="py-2 text-xs text-slate-500 max-w-[180px] truncate">
                                            {row.remarks || "—"}
                                        </TableCell>
                                        <TableCell className="py-2 text-right">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-slate-500 hover:text-slate-900"
                                                onClick={() => openEdit(row)}
                                                title="Edit restock"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            <TableRow className={cn("border-t-2 font-semibold", meta.totalsClass)}>
                                <TableCell colSpan={2} className="py-2.5">
                                    Totals ({totals.lineCount} restock{totals.lineCount === 1 ? "" : "s"})
                                </TableCell>
                                {kind === "varnish" ? (
                                    <>
                                        <TableCell className="py-2.5 text-right tabular-nums">
                                            {formatVarnishDrums(
                                                totals.totalKg,
                                                defaultDrumWeightKg(getCatalogItem(rows[0]?.itemCode ?? "")),
                                            )}
                                        </TableCell>
                                        <TableCell className="py-2.5 text-right tabular-nums">
                                            {totals.totalKg.toLocaleString()} kg
                                        </TableCell>
                                        <TableCell />
                                        <TableCell className="py-2.5 text-right tabular-nums">
                                            {totals.avgUnitCostPerKg != null
                                                ? `₨ ${totals.avgUnitCostPerKg.toLocaleString(undefined, { maximumFractionDigits: 2 })} / kg`
                                                : "—"}
                                        </TableCell>
                                    </>
                                ) : (
                                    <>
                                        <TableCell className="py-2.5 text-right tabular-nums">
                                            {totals.totalKg.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="py-2.5 text-xs opacity-80">mixed UOM</TableCell>
                                        <TableCell className="py-2.5 text-right tabular-nums">
                                            {totals.avgUnitCostPerKg != null
                                                ? `₨ ${totals.avgUnitCostPerKg.toLocaleString(undefined, { maximumFractionDigits: 2 })} avg`
                                                : "—"}
                                        </TableCell>
                                    </>
                                )}
                                <TableCell className="py-2.5 text-right tabular-nums">
                                    {formatPkr(totals.totalValue)}
                                </TableCell>
                                <TableCell colSpan={2} />
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableScroller>
            )}

            <RestockSuppliesDialog
                open={editOpen}
                onOpenChange={(open) => {
                    setEditOpen(open);
                    if (!open) setEditRow(undefined);
                }}
                kind={kind}
                mode="edit"
                editRow={editRow}
                onSaved={handleSaved}
            />
        </div>
    );
}

/** @deprecated Use SuppliesRestockPanel with kind="varnish" */
export function VarnishRestockPanel(props: Omit<Props, "kind">) {
    return <SuppliesRestockPanel kind="varnish" {...props} />;
}
