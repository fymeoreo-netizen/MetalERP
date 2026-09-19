import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableScroller } from "@/components/ui/responsive-primitives";
import type { InventoryValuationRateRow } from "@/lib/api/inventoryValuation";
import { Pencil, Trash2 } from "lucide-react";

type Props = {
    rows: InventoryValuationRateRow[];
    onEdit: (row: InventoryValuationRateRow) => void;
    onDelete: (row: InventoryValuationRateRow) => void;
};

function bandLabel(row: InventoryValuationRateRow): string {
    if (row.product_kind === "wire8") return row.wire8_grade ?? "—";
    if (row.product_kind === "scrap") {
        const labels: Record<string, string> = {
            drawing: "Drawing scrap",
            enamel: "Enamel scrap",
            workshop: "Workshop scrap",
            feed: "Copper feed scrap",
        };
        return labels[row.scrap_kind ?? ""] ?? row.scrap_kind ?? "—";
    }
    if (row.product_kind === "rod") return "Copper rod";
    return "—";
}

function productLabel(row: InventoryValuationRateRow): string {
    if (row.product_kind === "wire8") return "Wire No 8";
    if (row.product_kind === "scrap") return "Scrap";
    return "Rod";
}

export function FlatValuationRates({ rows, onEdit, onDelete }: Props) {
    const flat = rows.filter((r) => !["enamel", "copper_wire", "strip"].includes(r.product_kind));

    if (flat.length === 0) {
        return (
            <p className="text-sm text-zinc-500 py-6 text-center">
                No wire, rod, or scrap rates yet. Add rows for each grade or scrap category.
            </p>
        );
    }

    const wire8 = flat.filter((r) => r.product_kind === "wire8");
    const rod = flat.filter((r) => r.product_kind === "rod");
    const scrap = flat.filter((r) => r.product_kind === "scrap");

    const renderTable = (sectionRows: InventoryValuationRateRow[], title?: string) => (
        <div className="space-y-2">
            {title ? <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{title}</p> : null}
            <TableScroller>
                <Table noWrapper className="min-w-[560px]">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>Grade / type</TableHead>
                            <TableHead className="text-right">Rate (PKR/kg)</TableHead>
                            <TableHead>From</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sectionRows.map((r) => (
                            <TableRow key={r.id} className={!r.is_active ? "opacity-60" : undefined}>
                                <TableCell>{productLabel(r)}</TableCell>
                                <TableCell className="font-medium">{bandLabel(r)}</TableCell>
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
            {wire8.length > 0 ? renderTable(wire8, "Wire No 8") : null}
            {rod.length > 0 ? renderTable(rod, "Copper rod") : null}
            {scrap.length > 0 ? renderTable(scrap, "Scrap") : null}
        </div>
    );
}
