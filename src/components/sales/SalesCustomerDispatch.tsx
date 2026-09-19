import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { format, subDays, subMonths, startOfMonth, endOfMonth } from "date-fns";
import {
    getCustomerDispatchSummaries,
    getDefaultMonthFilters,
    getLiveCustomerDispatchSummaries,
    mapPartyStockMovementRows,
    formatQty,
    type LivePartyStockRow,
    type PartyMovementFilters,
} from "@/lib/partyMovementReport";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { useInventoryMovements } from "@/contexts/InventoryContext";
import { fetchPartyStockMovement } from "@/lib/repositories/reportsRepo";
import { initItemCatalog } from "@/lib/itemCatalog";
import { initPartyCatalog, parseDocDate } from "@/lib/partyCatalog";

export function SalesCustomerDispatch() {
    const liveMode = useBackendLiveMode();
    const demoMovements = useInventoryMovements({ limit: 300 });
    const defaults = getDefaultMonthFilters();
    const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
    const [dateTo, setDateTo] = useState(defaults.dateTo);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [liveRows, setLiveRows] = useState<LivePartyStockRow[] | null>(null);
    const [loading, setLoading] = useState(false);

    const filters: PartyMovementFilters = useMemo(
        () => ({ dateFrom, dateTo, materialGroup: "fg_all" }),
        [dateFrom, dateTo],
    );

    useEffect(() => {
        if (!liveMode) {
            setLiveRows(null);
            return;
        }
        const load = () => {
            setLoading(true);
            void (async () => {
                try {
                    await Promise.all([initPartyCatalog(), initItemCatalog()]);
                    const rows = await fetchPartyStockMovement(dateFrom, dateTo);
                    setLiveRows(mapPartyStockMovementRows(rows as Record<string, unknown>[]));
                } catch {
                    setLiveRows([]);
                } finally {
                    setLoading(false);
                }
            })();
        };
        load();
        const onInvoiceUpdated = () => load();
        window.addEventListener("erp:invoice-updated", onInvoiceUpdated);
        return () => window.removeEventListener("erp:invoice-updated", onInvoiceUpdated);
    }, [liveMode, dateFrom, dateTo]);

    const summaries = useMemo(() => {
        if (liveMode && liveRows) return getLiveCustomerDispatchSummaries(liveRows, filters);
        return getCustomerDispatchSummaries(filters);
    }, [filters, liveMode, liveRows, demoMovements]);
    const grandTotal = summaries.reduce((s, r) => s + r.totalKg, 0);

    const applyPreset = (preset: "this_month" | "last_month" | "last_7") => {
        const now = new Date();
        if (preset === "this_month") {
            setDateFrom(format(startOfMonth(now), "yyyy-MM-dd"));
            setDateTo(format(endOfMonth(now), "yyyy-MM-dd"));
        } else if (preset === "last_month") {
            const prev = subMonths(now, 1);
            setDateFrom(format(startOfMonth(prev), "yyyy-MM-dd"));
            setDateTo(format(endOfMonth(prev), "yyyy-MM-dd"));
        } else {
            setDateFrom(format(subDays(now, 6), "yyyy-MM-dd"));
            setDateTo(format(now, "yyyy-MM-dd"));
        }
    };

    const reportLink = `/reports?report=party-stock&from=${dateFrom}&to=${dateTo}`;

    return (
        <Card className="shadow-soft border-slate-100 border-l-4 border-l-emerald-500">
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                        <CardTitle>Finished goods sent to customers</CardTitle>
                        <CardDescription>
                            All parties that received FG from posted sales invoices in the selected period
                            (net of restock returns).
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                        <Link to={reportLink}>
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Full party report
                        </Link>
                    </Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("this_month")}>
                        This month
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("last_month")}>
                        Last month
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("last_7")}>
                        Last 7 days
                    </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 max-w-md pt-2">
                    <div className="space-y-1">
                        <Label className="text-xs">From</Label>
                        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">To</Label>
                        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-6 text-sm">
                    <div>
                        <p className="text-slate-500">Customers with dispatches</p>
                        <p className="text-2xl font-bold">{summaries.length}</p>
                    </div>
                    <div>
                        <p className="text-slate-500">Total FG dispatched</p>
                        <p className="text-2xl font-bold text-emerald-700">{formatQty(grandTotal)}</p>
                    </div>
                </div>

                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right">Total sent</TableHead>
                            <TableHead className="text-right">Enameled wire</TableHead>
                            <TableHead className="text-right">Copper strip</TableHead>
                            <TableHead className="text-right">Invoices</TableHead>
                            <TableHead>Last dispatch</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {summaries.map((row) => {
                            const isOpen = expanded === row.partyId;
                            return (
                                <Fragment key={row.partyId}>
                                    <TableRow
                                        className="cursor-pointer hover:bg-slate-50"
                                        onClick={() => setExpanded(isOpen ? null : row.partyId)}
                                    >
                                        <TableCell>
                                            {isOpen ? (
                                                <ChevronDown className="h-4 w-4 text-slate-400" />
                                            ) : (
                                                <ChevronRight className="h-4 w-4 text-slate-400" />
                                            )}
                                        </TableCell>
                                        <TableCell className="font-medium">{row.partyName}</TableCell>
                                        <TableCell className="text-right font-mono font-semibold">
                                            {formatQty(row.totalKg)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-blue-700">
                                            {row.enameledKg > 0 ? formatQty(row.enameledKg) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-amber-700">
                                            {row.stripKg > 0 ? formatQty(row.stripKg) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right">{row.docCount}</TableCell>
                                        <TableCell>{format(parseDocDate(row.lastDate), "dd/MM/yyyy")}</TableCell>
                                    </TableRow>
                                    {isOpen &&
                                        row.lines.map((line) => (
                                            <TableRow key={line.id} className="bg-slate-50/80">
                                                <TableCell />
                                                <TableCell colSpan={2} className="text-xs pl-8">
                                                    <span className="font-mono text-slate-600">{line.docId}</span>
                                                    {" · "}
                                                    {line.itemName} ({line.sizeSpec})
                                                    <Badge variant="outline" className="ml-2 text-[10px]">
                                                        {line.materialLabel}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell colSpan={2} className="text-right text-xs font-mono">
                                                    {formatQty(line.qty, line.unit)}
                                                </TableCell>
                                                <TableCell className="text-right text-xs">
                                                    {format(parseDocDate(line.date), "dd/MM/yyyy")}
                                                </TableCell>
                                                <TableCell />
                                            </TableRow>
                                        ))}
                                </Fragment>
                            );
                        })}
                        {summaries.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center text-slate-500 py-10">
                                    {loading
                                        ? "Loading dispatch data…"
                                        : "No finished goods dispatched in this period. Post a sales invoice with FG lines to see customers here."}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
