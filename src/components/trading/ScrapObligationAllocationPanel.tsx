import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { ScrapObligationRow } from "@/lib/scrapObligationTypes";
import {
    allocationShortfallKg,
    computeReceivableAllocation,
    lineAllocationAmount,
    sortObligationsFifo,
    suggestObligationIdsFifo,
    totalAllocationAmount,
    type ScrapReceivableAllocationLine,
} from "@/lib/scrapReceivableAllocation";
import { cn } from "@/lib/utils";
import { TableScroller } from "@/components/ui/responsive-primitives";

type Props = {
    obligations: ScrapObligationRow[];
    netKg: number;
    selectedIds: string[];
    onChangeSelectedIds: (ids: string[]) => void;
    allocationLines: ScrapReceivableAllocationLine[];
    allocationError?: string;
};

export function ScrapObligationAllocationPanel({
    obligations,
    netKg,
    selectedIds,
    onChangeSelectedIds,
    allocationLines,
    allocationError,
}: Props) {
    const fifoSorted = useMemo(() => sortObligationsFifo(obligations), [obligations]);
    const available = useMemo(
        () => fifoSorted.filter((o) => !selectedIds.includes(o.obligation_id)),
        [fifoSorted, selectedIds],
    );

    const shortfall = useMemo(
        () => (netKg > 0 && selectedIds.length ? allocationShortfallKg(netKg, selectedIds, obligations) : 0),
        [netKg, selectedIds, obligations],
    );

    const needsMore = netKg > 0 && shortfall > 0.001;

    const applyFifo = () => {
        onChangeSelectedIds(suggestObligationIdsFifo(netKg, obligations));
    };

    const addInvoice = (obligationId: string) => {
        if (selectedIds.includes(obligationId)) return;
        onChangeSelectedIds([...selectedIds, obligationId]);
    };

    const removeInvoice = (obligationId: string) => {
        onChangeSelectedIds(selectedIds.filter((id) => id !== obligationId));
    };

    const moveUp = (index: number) => {
        if (index <= 0) return;
        const next = [...selectedIds];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        onChangeSelectedIds(next);
    };

    const moveDown = (index: number) => {
        if (index >= selectedIds.length - 1) return;
        const next = [...selectedIds];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        onChangeSelectedIds(next);
    };

    const preview = allocationLines.length > 0 ? allocationLines : null;
    const previewTotal = preview ? totalAllocationAmount(preview) : 0;
    const computePreview = netKg > 0 && selectedIds.length > 0 && !preview;
    const previewError = computePreview ? computeReceivableAllocation(netKg, selectedIds, obligations).error : undefined;

    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                {selectedIds.length === 0 ? (
                    <p className="text-sm text-zinc-600">
                        No invoices linked — enter trade rate below, or add invoices / apply FIFO.
                    </p>
                ) : (
                    <p className="text-sm text-zinc-600">
                        {selectedIds.length} invoice{selectedIds.length === 1 ? "" : "s"} linked
                    </p>
                )}
                <div className="flex items-center gap-2 shrink-0">
                    {netKg > 0 && selectedIds.length === 0 && (
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={applyFifo}>
                            Apply FIFO suggestion
                        </Button>
                    )}
                    {selectedIds.length > 0 && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-zinc-600 hover:text-rose-700"
                            onClick={() => onChangeSelectedIds([])}
                        >
                            Clear all
                        </Button>
                    )}
                </div>
            </div>

            {needsMore && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                            {netKg.toLocaleString()} kg needs {shortfall.toLocaleString()} kg more — add invoice(s) below.
                        </span>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="shrink-0 h-8" onClick={applyFifo}>
                        Apply FIFO suggestion
                    </Button>
                </div>
            )}

            {(allocationError || previewError) && (
                <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    {allocationError ?? previewError}
                </p>
            )}

            {selectedIds.length > 0 && (
                <TableScroller className="rounded-lg border border-zinc-200 bg-white">
                    <Table noWrapper className="text-sm min-w-[640px]">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-8">#</TableHead>
                                <TableHead className="min-w-[7rem]">Invoice</TableHead>
                                <TableHead className="text-right min-w-[5rem]">Open kg</TableHead>
                                <TableHead className="text-right min-w-[5rem]">Applied kg</TableHead>
                                <TableHead className="text-right min-w-[4.5rem]">Rate</TableHead>
                                <TableHead className="text-right min-w-[5.5rem]">Amount</TableHead>
                                <TableHead className="text-right min-w-[5rem]">Remaining</TableHead>
                                <TableHead className="w-24" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(preview ?? []).map((line, idx) => (
                                <TableRow key={line.obligationId}>
                                    <TableCell className="text-zinc-500 tabular-nums">{line.lineSeq}</TableCell>
                                    <TableCell className="font-mono text-sm">{line.salesInvoiceNo}</TableCell>
                                    <TableCell className="text-right tabular-nums">{line.openKg.toLocaleString()}</TableCell>
                                    <TableCell className="text-right tabular-nums font-medium">
                                        {line.allocatedKg.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums text-zinc-700">
                                        {line.refScrapRate.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums font-medium">
                                        {lineAllocationAmount(line).toLocaleString()}
                                    </TableCell>
                                    <TableCell
                                        className={cn(
                                            "text-right tabular-nums",
                                            line.remainingOpenKg > 0.001 && "font-semibold text-emerald-700",
                                        )}
                                    >
                                        {line.remainingOpenKg.toLocaleString()}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-0.5 justify-end">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                disabled={idx === 0}
                                                onClick={() => moveUp(idx)}
                                            >
                                                <ArrowUp className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                disabled={idx === selectedIds.length - 1}
                                                onClick={() => moveDown(idx)}
                                            >
                                                <ArrowDown className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-zinc-400 hover:text-rose-600"
                                                onClick={() => removeInvoice(line.obligationId)}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {preview && preview.length > 0 && (
                                <TableRow className="bg-zinc-50/80 hover:bg-zinc-50/80">
                                    <TableCell colSpan={3} className="text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                                        Total
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums font-semibold">
                                        {preview.reduce((s, l) => s + l.allocatedKg, 0).toLocaleString()}
                                    </TableCell>
                                    <TableCell />
                                    <TableCell className="text-right tabular-nums font-semibold text-zinc-900">
                                        {previewTotal.toLocaleString()}
                                    </TableCell>
                                    <TableCell colSpan={2} />
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableScroller>
            )}

            {available.length > 0 && (
                <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Add invoice</p>
                    <ul className="grid gap-2 sm:grid-cols-2">
                        {available.map((o) => (
                            <li key={o.obligation_id}>
                                <button
                                    type="button"
                                    onClick={() => addInvoice(o.obligation_id)}
                                    className="w-full text-left rounded-lg border border-dashed border-zinc-200 bg-white px-3 py-2 hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors"
                                >
                                    <div className="flex justify-between items-baseline gap-2">
                                        <span className="font-mono text-sm text-zinc-900 truncate">{o.sales_invoice_no}</span>
                                        <Plus className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                    </div>
                                    <p className="text-[11px] text-zinc-500 mt-0.5">
                                        {o.open_kg.toLocaleString()} kg open · ref {o.ref_scrap_rate.toLocaleString()}
                                        {o.invoice_date ? ` · ${o.invoice_date}` : ""}
                                    </p>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export function useScrapReceivableAllocation(
    netKg: number,
    selectedIds: string[],
    obligations: ScrapObligationRow[],
): { lines: ScrapReceivableAllocationLine[]; error?: string; weightedRate: number } {
    return useMemo(() => {
        if (netKg <= 0 || !selectedIds.length) {
            return { lines: [], weightedRate: 0 };
        }
        const { lines, error } = computeReceivableAllocation(netKg, selectedIds, obligations);
        if (error) return { lines: [], error, weightedRate: 0 };
        const weightedRate =
            lines.length > 0
                ? lines.reduce((s, l) => s + l.allocatedKg * l.refScrapRate, 0) /
                  lines.reduce((s, l) => s + l.allocatedKg, 0)
                : 0;
        return { lines, weightedRate: Math.round(weightedRate * 1000) / 1000 };
    }, [netKg, selectedIds, obligations]);
}
