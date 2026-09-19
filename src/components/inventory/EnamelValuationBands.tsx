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

export function EnamelValuationBands({ rows, onEdit, onDelete }: Props) {
    const enamel = rows.filter((r) => r.product_kind === "enamel");

    if (enamel.length === 0) {
        return (
            <p className="text-sm text-zinc-500 py-6 text-center">
                No enamel SWG bands yet. Add a band or apply the default preset.
            </p>
        );
    }

    return (
        <TableScroller>
            <Table noWrapper className="min-w-[640px]">
                <TableHeader>
                    <TableRow>
                        <TableHead>SWG band</TableHead>
                        <TableHead className="text-right">Rate (PKR/kg)</TableHead>
                        <TableHead>Effective from</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[100px]" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {enamel.map((r) => (
                        <TableRow key={r.id} className={!r.is_active ? "opacity-60" : undefined}>
                            <TableCell className="font-medium">
                                {r.swg_min} – {r.swg_max} SWG
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
    );
}
