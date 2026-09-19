import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableScroller } from "@/components/ui/responsive-primitives";
import type { WattaMatrixRow } from "@/lib/scrapObligationTypes";
import { Pencil, Trash2 } from "lucide-react";

type Props = {
    rows: WattaMatrixRow[];
    direction: "sales" | "purchase";
    onEdit: (row: WattaMatrixRow) => void;
    onDelete: (row: WattaMatrixRow) => void;
};

function bandLabel(row: WattaMatrixRow, direction: "sales" | "purchase") {
    if (direction === "sales" && row.product_kind === "enamel") {
        return `${row.swg_min ?? "—"} – ${row.swg_max ?? "—"} SWG`;
    }
    if (row.product_kind === "wire8") return row.wire8_grade ?? "—";
    if (row.product_kind === "rod") return "Copper rod";
    return "—";
}

function productLabel(row: WattaMatrixRow) {
    if (row.product_kind === "enamel") return "Enamel";
    if (row.product_kind === "wire8") return "Wire No 8";
    return "Rod";
}

export function WattaMatrixTable({ rows, direction, onEdit, onDelete }: Props) {
    if (rows.length === 0) {
        return (
            <p className="text-sm text-zinc-500 py-8 text-center">
                No rows yet. Add a rate or use the standard enamel preset (sales tab).
            </p>
        );
    }

    const wire8 = rows.filter((r) => r.product_kind === "wire8");
    const rod = rows.filter((r) => r.product_kind === "rod");
    const other = rows.filter((r) => r.product_kind !== "wire8" && r.product_kind !== "rod");

    const renderTable = (sectionRows: WattaMatrixRow[], title?: string) => (
        <div className="space-y-2">
            {title ? <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{title}</p> : null}
            <TableScroller>
                <Table noWrapper className="min-w-[880px]">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Party</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead>{direction === "sales" ? "SWG band" : "Grade / type"}</TableHead>
                            <TableHead className="text-right">Base watta</TableHead>
                            {direction === "sales" ? (
                                <TableHead className="text-right">+/SWG</TableHead>
                            ) : null}
                            <TableHead>From</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sectionRows.map((m) => (
                            <TableRow key={m.id} className={!m.is_active ? "opacity-60" : undefined}>
                                <TableCell className="font-medium">{m.party_name ?? "Default"}</TableCell>
                                <TableCell>{productLabel(m)}</TableCell>
                                <TableCell>{bandLabel(m, direction)}</TableCell>
                                <TableCell className="text-right tabular-nums">{m.base_watta.toLocaleString()}</TableCell>
                                {direction === "sales" ? (
                                    <TableCell className="text-right tabular-nums">{m.increment_per_swg}</TableCell>
                                ) : null}
                                <TableCell>{m.effective_from}</TableCell>
                                <TableCell>
                                    <Badge variant={m.is_active ? "default" : "secondary"}>
                                        {m.is_active ? "Active" : "Inactive"}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-1 justify-end">
                                        <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(m)} aria-label="Edit">
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="text-rose-600 hover:text-rose-700"
                                            onClick={() => onDelete(m)}
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

    if (direction === "purchase") {
        return (
            <div className="space-y-6">
                {wire8.length > 0 ? renderTable(wire8, "Wire No 8") : null}
                {rod.length > 0 ? renderTable(rod, "Copper rod") : null}
                {other.length > 0 ? renderTable(other) : null}
                {wire8.length === 0 && rod.length === 0 && other.length === 0 ? (
                    <p className="text-sm text-zinc-500 py-8 text-center">No purchase watta rows.</p>
                ) : null}
            </div>
        );
    }

    return renderTable(rows);
}
