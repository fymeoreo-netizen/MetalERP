import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import type { PartyScrapCreditRow } from "@/lib/scrapObligationTypes";
import {
    computeCreditAllocations,
    totalCreditAllocatedKg,
    type ScrapCreditAllocationLine,
} from "@/lib/scrapReceivableAllocation";
import { PendingReasonBadge } from "@/components/shared/PendingReasonSelect";
import { cn } from "@/lib/utils";

type Props = {
    credits: PartyScrapCreditRow[];
    physicalKg: number;
    selectedIds: string[];
    onChangeSelectedIds: (ids: string[]) => void;
    allocationLines: ScrapCreditAllocationLine[];
    onApplySelection?: (kg: number) => void;
};

export function ScrapAdvanceCreditPanel({
    credits,
    physicalKg,
    selectedIds,
    onChangeSelectedIds,
    allocationLines,
    onApplySelection,
}: Props) {
    const openCredits = useMemo(
        () => credits.filter((c) => c.open_kg > 0.001),
        [credits],
    );

    const preview = useMemo(() => {
        if (!selectedIds.length || physicalKg <= 0) return { lines: [] as ScrapCreditAllocationLine[] };
        return computeCreditAllocations(
            physicalKg,
            selectedIds,
            openCredits.map((c) => ({
                credit_id: c.credit_id,
                trade_no: c.trade_no,
                open_kg: c.open_kg,
            })),
        );
    }, [physicalKg, selectedIds, openCredits]);

    const totalSelected = allocationLines.length
        ? totalCreditAllocatedKg(allocationLines)
        : totalCreditAllocatedKg(preview.lines);

    const toggle = (id: string) => {
        const next = selectedIds.includes(id)
            ? selectedIds.filter((x) => x !== id)
            : [...selectedIds, id];
        onChangeSelectedIds(next);
        if (onApplySelection && !selectedIds.includes(id)) {
            const credit = openCredits.find((c) => c.credit_id === id);
            if (credit) onApplySelection(credit.open_kg);
        }
    };

    if (!openCredits.length) {
        return (
            <p className="text-sm text-zinc-500 rounded-lg border border-dashed border-zinc-200 bg-white px-3 py-2.5">
                No advance scrap on hand for this party.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            <p className="text-sm text-zinc-600">
                Select pending toll-drops sent earlier — they reduce invoice allocation on this trade.
            </p>
            <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-zinc-50/80">
                            <TableHead className="w-10" />
                            <TableHead>Trade</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Pending</TableHead>
                            <TableHead className="text-right">Open kg</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {openCredits.map((row) => {
                            const checked = selectedIds.includes(row.credit_id);
                            const line = allocationLines.find((l) => l.scrapCreditId === row.credit_id);
                            return (
                                <TableRow
                                    key={row.credit_id}
                                    className={cn(checked && "bg-amber-50/40")}
                                >
                                    <TableCell>
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => toggle(row.credit_id)}
                                        />
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{row.trade_no}</TableCell>
                                    <TableCell className="text-xs">{row.trade_date}</TableCell>
                                    <TableCell>
                                        <PendingReasonBadge reason={row.pending_reason} />
                                    </TableCell>
                                    <TableCell className="text-right font-mono tabular-nums">
                                        {row.open_kg.toLocaleString()}
                                        {line && (
                                            <span className="block text-[10px] text-emerald-700">
                                                −{line.allocatedKg.toLocaleString()} applied
                                            </span>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            {selectedIds.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600">
                        {totalSelected.toLocaleString()} kg advance selected
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-zinc-600"
                        onClick={() => onChangeSelectedIds([])}
                    >
                        Clear
                    </Button>
                </div>
            )}
        </div>
    );
}
