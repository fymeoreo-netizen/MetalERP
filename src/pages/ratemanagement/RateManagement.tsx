import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, History, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMarketLatestQuotes, type MarketQuoteRow } from "@/lib/repositories/marketRepo";
import { formatChangePct, formatQuoteValue } from "@/hooks/useMarketData";
import { RateFixingModal } from "@/components/financials/RateFixingModal";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { fetchPendingRateItemsOrEmpty } from "@/lib/api/ratePending";
import type { PendingRateItemRow } from "@/lib/ratePending";
import { docTypeLabel } from "@/lib/ratePending";
import { PendingReasonBadge } from "@/components/shared/PendingReasonSelect";
import { useToast } from "@/components/ui/use-toast";
import { useBackendLiveMode } from "@/lib/backendFlags";

export default function RateManagement() {
    const { toast } = useToast();
    const liveMode = useBackendLiveMode();
    const [items, setItems] = useState<PendingRateItemRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [modalOpen, setModalOpen] = useState(false);
    const [marketQuotes, setMarketQuotes] = useState<MarketQuoteRow[]>([]);

    const loadItems = useCallback(async () => {
        if (!liveMode) {
            setItems([]);
            return;
        }
        setLoading(true);
        try {
            const rows = await fetchPendingRateItemsOrEmpty({ openOnly: true });
            setItems(rows);
            setSelected((prev) => prev.filter((id) => rows.some((r) => r.id === id)));
        } catch (e) {
            toast({
                title: "Could not load pending rates",
                description: e instanceof Error ? e.message : "Check console.",
                variant: "destructive",
            });
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [liveMode, toast]);

    useEffect(() => {
        void loadItems();
        void fetchMarketLatestQuotes().then(setMarketQuotes).catch(() => setMarketQuotes([]));
    }, [loadItems]);

    const copper = marketQuotes.find((q) => q.code === "LME_COPPER_USD_T");
    const fx = marketQuotes.find((q) => q.code === "USD_PKR");
    const copperChg = formatChangePct(copper?.change_1d_pct);
    const fxChg = formatChangePct(fx?.change_1d_pct);

    const selectedItems = items.filter((c) => selected.includes(c.id));
    const selectedParty = selectedItems[0]?.partyCode ?? null;
    const partyMismatch =
        selectedItems.length > 1 && new Set(selectedItems.map((i) => i.partyCode)).size > 1;

    const toggleSelect = (id: string) => {
        setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const toggleAll = () => {
        if (selected.length === items.length) setSelected([]);
        else setSelected(items.map((c) => c.id));
    };

    const selectedWeight = selectedItems.reduce((sum, c) => sum + c.qty, 0);

    const totalOpenKg = useMemo(() => items.reduce((s, i) => s + i.qty, 0), [items]);

    const openByParty = useMemo(() => {
        const map = new Map<string, { name: string; kg: number; count: number }>();
        for (const row of items) {
            const cur = map.get(row.partyCode) ?? { name: row.partyName, kg: 0, count: 0 };
            cur.kg += row.qty;
            cur.count += 1;
            map.set(row.partyCode, cur);
        }
        return Array.from(map.entries()).sort((a, b) => b[1].kg - a[1].kg);
    }, [items]);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Rate Management</h1>
                        <p className="text-slate-500">Fix rates for pending inventory and clear financial khata.</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" className="shadow-sm" onClick={() => void loadItems()} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                        <Button variant="outline" className="shadow-sm" disabled>
                            <History className="h-4 w-4 mr-2" />
                            Rate History
                        </Button>
                    </div>
                </div>

                <RateFixingModal
                    open={modalOpen}
                    onOpenChange={setModalOpen}
                    items={selectedItems}
                    onFixed={() => void loadItems()}
                />

                <div className="grid gap-6 md:grid-cols-3">
                    <Card className="md:col-span-2 shadow-soft border-slate-100">
                        <CardHeader>
                            <CardTitle>Pending challans</CardTitle>
                            <CardDescription>Select lines to fix rate (same party per batch).</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            {!liveMode ? (
                                <p className="p-6 text-sm text-slate-500">Enable live mode to load pending rate items.</p>
                            ) : items.length === 0 && !loading ? (
                                <p className="p-6 text-sm text-slate-500">No open pending-rate items.</p>
                            ) : (
                                <TableScroller>
                                    <Table noWrapper>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-10">
                                                    <Checkbox
                                                        checked={items.length > 0 && selected.length === items.length}
                                                        onCheckedChange={toggleAll}
                                                    />
                                                </TableHead>
                                                <TableHead>Ref</TableHead>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Party</TableHead>
                                                <TableHead>Item</TableHead>
                                                <TableHead>Pending</TableHead>
                                                <TableHead className="text-right">Kg</TableHead>
                                                <TableHead className="text-right">Days</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {items.map((row) => (
                                                <TableRow key={row.id}>
                                                    <TableCell>
                                                        <Checkbox
                                                            checked={selected.includes(row.id)}
                                                            onCheckedChange={() => toggleSelect(row.id)}
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-mono text-xs text-blue-600">{row.sourceDocNo}</div>
                                                        <div className="text-[10px] text-slate-400">{docTypeLabel(row.sourceDocType)}</div>
                                                    </TableCell>
                                                    <TableCell className="text-xs">{row.originalPostingDate}</TableCell>
                                                    <TableCell className="text-sm">{row.partyName}</TableCell>
                                                    <TableCell className="text-sm">{row.itemName ?? "—"}</TableCell>
                                                    <TableCell>
                                                        <PendingReasonBadge reason={row.pendingReason} />
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">{row.qty.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Badge variant={row.daysPending >= 3 ? "destructive" : "secondary"}>
                                                            {row.daysPending}d
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableScroller>
                            )}
                        </CardContent>
                        <CardFooter className="flex justify-between border-t bg-slate-50/50 py-4">
                            <div className="text-sm text-slate-500">
                                {selected.length} selected · {selectedWeight.toLocaleString()} kg
                                {partyMismatch && (
                                    <span className="text-rose-600 ml-2">Select one party only</span>
                                )}
                            </div>
                            <Button
                                disabled={selected.length === 0 || partyMismatch}
                                onClick={() => setModalOpen(true)}
                            >
                                Fix Rate
                            </Button>
                        </CardFooter>
                    </Card>

                    <div className="space-y-6">
                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle className="text-base">Open liability (qty)</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-3xl font-bold font-mono text-slate-900">{totalOpenKg.toLocaleString()} kg</p>
                                <p className="text-xs text-slate-500 mt-1">{items.length} open line(s)</p>
                            </CardContent>
                        </Card>

                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle className="text-base">By party</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {openByParty.slice(0, 6).map(([code, v]) => (
                                    <div key={code} className="flex justify-between text-sm">
                                        <span className="text-slate-700 truncate">{v.name}</span>
                                        <span className="font-mono text-slate-900 shrink-0 ml-2">{v.kg.toLocaleString()} kg</span>
                                    </div>
                                ))}
                                {!openByParty.length && <p className="text-xs text-slate-400">No pending items</p>}
                            </CardContent>
                        </Card>

                        <Card className="shadow-soft border-slate-100">
                            <CardHeader>
                                <CardTitle className="text-base">Market reference</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">LME Copper</span>
                                    <span className="font-mono">
                                        {formatQuoteValue(copper)} <span className="text-xs text-slate-400">{copperChg.text}</span>
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">USD/PKR</span>
                                    <span className="font-mono">
                                        {formatQuoteValue(fx)} <span className="text-xs text-slate-400">{fxChg.text}</span>
                                    </span>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg text-amber-800 text-xs">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <p>
                                Fixing posts financial entries on the <strong>original document date</strong> and rebuilds inventory valuation.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
