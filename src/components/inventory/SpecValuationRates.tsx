import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableScroller } from "@/components/ui/responsive-primitives";
import type { InventoryValuationRateRow } from "@/lib/api/inventoryValuation";
import { formatValuationSpecKeyLabel } from "@/lib/inventoryValuationValidation";
import { Pencil, Trash2 } from "lucide-react";

type Props = {
    rows: InventoryValuationRateRow[];
    onEdit: (row: InventoryValuationRateRow) => void;
    onDelete: (row: InventoryValuationRateRow) => void;
};

export function SpecValuationRates({ rows, onEdit, onDelete }: Props) {
    const copper = rows.filter((r) => r.product_kind === "copper_wire");
    const strip = rows.filter((r) => r.product_kind === "strip");

    if (copper.length === 0 && strip.length === 0) {
        return (
            <p className="text-sm text-zinc-500 py-6 text-center">
                No copper wire or strip spec rates yet. Add rates for mm sizes, thousand gauge, or strip dimensions.
            </p>
        );
    }

    const renderTable = (sectionRows: InventoryValuationRateRow[], title: string) => (
        <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{title}</p>
            <TableScroller>
                <Table noWrapper className="min-w-[560px]">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Spec key</TableHead>
                            <TableHead className="text-right">Rate (PKR/kg)</TableHead>
                            <TableHead>From</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sectionRows.map((r) => (
                            <TableRow key={r.id} className={!r.is_active ? "opacity-60" : undefined}>
                                <TableCell className="font-mono text-sm">
                                    {r.spec_key ? formatValuationSpecKeyLabel(r.spec_key) : "—"}
                                    <span className="block text-xs text-slate-400 font-normal">{r.spec_key}</span>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{r.unit_rate.toLocaleString()}</TableCell>
                                <TableCell>{r.effective_from}</TableCell>
                                <TableCell>
                                    <Badge variant={r.is_active ? "default" : "secondary"}>
                                        {r.is_active ? "Active" : "Inactive"}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-1 justify-end">
                                        <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(r)} aria-label="Edit">
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="text-rose-600 hover:text-rose-700"
                                            onClick={() => onDelete(r)}
                                            aria-label="Delete"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableScroller>
        </div>
    );

    return (
        <div className="space-y-6">
            {copper.length > 0 ? renderTable(copper, "Copper wire (mm / thousand)") : null}
            {strip.length > 0 ? renderTable(strip, "Strip (dimensions)") : null}
        </div>
    );
}
