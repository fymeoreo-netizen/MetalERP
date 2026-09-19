import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { fetchScrapPayableLots, resolveWatta } from "@/lib/repositories/scrapRepo";
import type { ScrapPayableLotRow } from "@/lib/scrapObligationTypes";
import {
    allocateScrapToWireLines,
    groupLotsByRate,
    lotsToBuckets,
    summarizeAllocationByRate,
    summarizeLineAllocation,
    type AllocationSegment,
    type WireLineForAllocation,
} from "@/lib/premiumScrapAllocation";
import { isWire8ItemCode, parseWire8Grade } from "@/lib/productionWire8Settings";
import { isErpLiveMode } from "@/lib/backendFlags";

export type PremiumAllocationPayload = {
    segments: AllocationSegment[];
    totalScrapUsed?: number;
    scrapRemainingKg?: number;
};

type LineRow = {
    id: string;
    itemCode: string;
    itemName?: string;
    netWeight: number;
    wire8Grade?: "Fail" | "Pass" | "Special";
};

type Props = {
    supplierCode: string;
    lines: LineRow[];
    onAllocationChange: (payload: PremiumAllocationPayload | null, error?: string, warning?: string) => void;
    /** Reports the cheapest selected open scrap lot rate (PKR/kg) so the parent
     *  can auto-fill the entry-form rate as scrap rate + watta. null = no lots. */
    onFirstLotRate?: (rate: number | null) => void;
};

function sourceLabel(type: string | undefined): string {
    if (type === "factory_scrap_dispatch") return "Factory toll";
    if (type === "scrap_trade") return "Toll-drop";
    return type ?? "—";
}

export function PremiumScrapPurchasePanel({ supplierCode, lines, onAllocationChange, onFirstLotRate }: Props) {
    const [lots, setLots] = useState<ScrapPayableLotRow[]>([]);
    const [selectedLotIds, setSelectedLotIds] = useState<Set<string>>(new Set());
    const [allocResult, setAllocResult] = useState<PremiumAllocationPayload | null>(null);

    useEffect(() => {
        if (!supplierCode || !isErpLiveMode()) {
            setLots([]);
            setSelectedLotIds(new Set());
            return;
        }
        void fetchScrapPayableLots(supplierCode, true)
            .then((rows) => {
                setLots(rows);
                setSelectedLotIds(new Set(rows.map((r) => r.lot_id)));
            })
            .catch(() => {
                setLots([]);
                setSelectedLotIds(new Set());
            });
    }, [supplierCode]);

    const wireLines = useMemo((): WireLineForAllocation[] => {
        return lines
            .filter((l) => l.netWeight > 0)
            .map((l) => ({
                lineKey: l.id,
                itemCode: l.itemCode,
                itemName: l.itemName,
                netWeight: l.netWeight,
                wire8Grade: isWire8ItemCode(l.itemCode)
                    ? parseWire8Grade(l.wire8Grade ?? "Pass")
                    : undefined,
            }));
    }, [lines]);

    const selectedLots = useMemo(
        () => lots.filter((l) => selectedLotIds.has(l.lot_id)),
        [lots, selectedLotIds],
    );

    const grouped = useMemo(() => groupLotsByRate(selectedLots), [selectedLots]);

    const rateSummary = useMemo(
        () => (allocResult?.segments ? summarizeAllocationByRate(allocResult.segments, selectedLots) : []),
        [allocResult, selectedLots],
    );

    const lineSummary = useMemo(
        () => (allocResult?.segments ? summarizeLineAllocation(allocResult.segments, wireLines) : []),
        [allocResult, wireLines],
    );

    const onAllocationChangeRef = useRef(onAllocationChange);
    onAllocationChangeRef.current = onAllocationChange;
    const onFirstLotRateRef = useRef(onFirstLotRate);
    onFirstLotRateRef.current = onFirstLotRate;

    useEffect(() => {
        if (!supplierCode || wireLines.length === 0 || selectedLots.length === 0) {
            setAllocResult(null);
            onAllocationChangeRef.current(null);
            return;
        }

        let cancelled = false;
        void (async () => {
            const wattaMap: Record<string, number> = {};
            for (const wl of wireLines) {
                wattaMap[wl.lineKey] = await resolveWatta({
                    partyCode: supplierCode,
                    itemCode: wl.itemCode,
                    direction: "purchase",
                    wire8Grade: wl.wire8Grade ?? null,
                });
            }
            if (cancelled) return;

            const result = allocateScrapToWireLines(
                lotsToBuckets(selectedLots),
                wireLines,
                (wl) => wattaMap[wl.lineKey] ?? 0,
            );
            if (result.error) {
                setAllocResult(null);
                onAllocationChangeRef.current(null, result.error);
                return;
            }

            const payload: PremiumAllocationPayload = {
                segments: result.segments,
                totalScrapUsed: result.totalScrapUsed,
                scrapRemainingKg: result.scrapRemainingKg,
            };
            setAllocResult(payload);

            let warning: string | undefined;
            if (result.scrapRemainingKg > 0.001) {
                warning = `${result.scrapRemainingKg.toLocaleString()} kg scrap will remain pending wire8 at this vendor after this invoice.`;
            }

            onAllocationChangeRef.current(payload, undefined, warning);
        })();

        return () => {
            cancelled = true;
        };
    }, [supplierCode, wireLines, selectedLots]);

    // Report the cheapest selected open lot rate so the parent can auto-fill
    // rate = scrap rate + watta. Fires on supplier/lot selection changes.
    useEffect(() => {
        const grouped = groupLotsByRate(selectedLots);
        onFirstLotRateRef.current?.(grouped.length > 0 ? grouped[0].rate : null);
    }, [selectedLots]);

    if (!supplierCode) {
        return <p className="text-xs text-slate-500">Select supplier to load pending scrap lots.</p>;
    }

    return (
        <div className="space-y-4 rounded-lg border border-rose-100 bg-rose-50/30 p-3">
            <div>
                <Label className="text-sm font-semibold text-rose-900">Premium — scrap against wire/rod</Label>
                <p className="text-[11px] text-slate-600 mt-1">
                    Scrap at vendor (toll-drop + factory toll) grouped by rate. Wire line rate = scrap rate + watta (FIFO
                    by rate). Partial receipt is allowed — surplus wire rolls to the next rate pool.
                </p>
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead />
                        <TableHead>Scrap @ rate</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Open kg</TableHead>
                        <TableHead className="text-right">This PI</TableHead>
                        <TableHead className="text-right">After PI</TableHead>
                        <TableHead>Refs</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {grouped.map((g) => {
                        const groupLotIds = new Set(g.lotIds);
                        const allSelected = g.lotIds.every((id) => selectedLotIds.has(id));
                        const someSelected = g.lotIds.some((id) => selectedLotIds.has(id));
                        const summary = rateSummary.find((r) => r.rate === g.rate);
                        const refs = lots
                            .filter((l) => groupLotIds.has(l.lot_id))
                            .map((l) => `${l.source_doc_no || l.lot_no} (${sourceLabel(l.source_doc_type)})`);
                        return (
                            <TableRow key={`rate-${g.rate}`}>
                                <TableCell>
                                    <Checkbox
                                        checked={allSelected}
                                        data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                                        onCheckedChange={(c) => {
                                            const next = new Set(selectedLotIds);
                                            for (const id of g.lotIds) {
                                                if (c) next.add(id);
                                                else next.delete(id);
                                            }
                                            setSelectedLotIds(next);
                                        }}
                                    />
                                </TableCell>
                                <TableCell className="text-xs text-slate-600">Premium scrap pool</TableCell>
                                <TableCell className="text-right font-mono">{g.rate.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{g.openKg.toLocaleString()}</TableCell>
                                <TableCell className="text-right text-emerald-700">
                                    {(summary?.allocatingKg ?? 0).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right text-amber-700">
                                    {(summary?.afterPiKg ?? g.openKg).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-[10px] text-slate-500 max-w-[140px] truncate" title={refs.join(", ")}>
                                    {refs.join(", ")}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                    {lots.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={7} className="text-center text-slate-500 py-4">
                                No open scrap at this vendor. Post toll-drop or factory toll scrap dispatch first.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>

            {lineSummary.length > 0 && (
                <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Wire allocation preview</Label>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Line</TableHead>
                                <TableHead className="text-right">Wire kg</TableHead>
                                <TableHead className="text-right">Scrap kg</TableHead>
                                <TableHead>Scrap rates</TableHead>
                                <TableHead className="text-right">Derived rate</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {lineSummary.map((row) => (
                                <TableRow key={row.lineKey}>
                                    <TableCell className="text-xs">
                                        {row.itemName ?? row.itemCode}
                                    </TableCell>
                                    <TableCell className="text-right">{row.wireKg.toLocaleString()}</TableCell>
                                    <TableCell className="text-right">{row.scrapKg.toLocaleString()}</TableCell>
                                    <TableCell className="text-[10px] text-slate-600">{row.detail}</TableCell>
                                    <TableCell className="text-right font-mono">
                                        {row.derivedRate > 0 ? row.derivedRate.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {allocResult?.scrapRemainingKg != null && allocResult.scrapRemainingKg > 0.001 && (
                <p className="text-xs text-amber-700">
                    Pending wire8: {allocResult.scrapRemainingKg.toLocaleString()} kg scrap still open at this vendor after
                    this invoice.
                </p>
            )}
        </div>
    );
}

