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
    getSupplierReceiptSummaries,
    getLiveSupplierReceiptSummaries,
    getDefaultMonthFilters,
    mapPartyStockMovementRows,
    formatQty,
    type LivePartyStockRow,
    type PartyMovementFilters,
} from "@/lib/partyMovementReport";
import { useBackendLiveMode } from "@/lib/backendFlags";
import { useInventoryPeriodTotals } from "@/contexts/InventoryContext";
import { fetchPartyStockMovement } from "@/lib/repositories/reportsRepo";
import { initItemCatalog } from "@/lib/itemCatalog";
import { initPartyCatalog } from "@/lib/partyCatalog";

export function PurchaseSupplierReceipt() {
    const liveMode = useBackendLiveMode();
    const periodTotals = useInventoryPeriodTotals();
    const defaults = getDefaultMonthFilters();
    const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
    const [dateTo, setDateTo] = useState(defaults.dateTo);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [liveRows, setLiveRows] = useState<LivePartyStockRow[] | null>(null);
    const [loading, setLoading] = useState(false);

    const filters: PartyMovementFilters = useMemo(
        () => ({ dateFrom, dateTo, materialGroup: "all" }),
        [dateFrom, dateTo, periodTotals],
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
        if (liveMode && liveRows) return getLiveSupplierReceiptSummaries(liveRows, filters);
        return getSupplierReceiptSummaries(filters);
    }, [filters, liveMode, liveRows]);
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
        <Card className="shadow-soft border-slate-100 border-l-4 border-l-blue-500">
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                        <CardTitle>Raw material received from suppliers</CardTitle>
                        <CardDescription>
                            All parties that supplied scrap, wire no 8, or copper rod via posted purchase
                            invoices in the selected period (net of stock returns).
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
                    <div>
                        <Label htmlFor="receipt-from">From</Label>
                        <Input
                            id="receipt-from"
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                        />
                    </div>
                    <div>
                        <Label htmlFor="receipt-to">To</Label>
                        <Input
                            id="receipt-to"
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                        />
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <p className="text-sm text-muted-foreground py-4">Loading supplier receipts…</p>
                ) : summaries.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No supplier receipts in this period.</p>
                ) : (
                    <>
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm text-muted-foreground">
                                {summaries.length} supplier{summaries.length !== 1 ? "s" : ""} ·{" "}
                                <span className="font-medium text-foreground">{formatQty(grandTotal)} kg total</span>
                            </p>
                        </div>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-8" />
                                    <TableHead>Supplier</TableHead>
                                    <TableHead className="text-right">Scrap</TableHead>
                                    <TableHead className="text-right">Wire 8</TableHead>
                                    <TableHead className="text-right">Rod</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Docs</TableHead>
                                    <TableHead>Last</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {summaries.map((row) => (
                                    <Fragment key={row.partyId}>
                                        <TableRow
                                            className="cursor-pointer hover:bg-muted/50"
                                            onClick={() =>
                                                setExpanded(expanded === row.partyId ? null : row.partyId)
                                            }
                                        >
                                            <TableCell>
                                                {expanded === row.partyId ? (
                                                    <ChevronDown className="h-4 w-4" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4" />
                                                )}
                                            </TableCell>
                                            <TableCell className="font-medium">{row.partyName}</TableCell>
                                            <TableCell className="text-right">{formatQty(row.scrapKg)}</TableCell>
                                            <TableCell className="text-right">{formatQty(row.wire8Kg)}</TableCell>
                                            <TableCell className="text-right">{formatQty(row.rodKg)}</TableCell>
                                            <TableCell className="text-right font-medium">
                                                {formatQty(row.totalKg)}
                                            </TableCell>
                                            <TableCell className="text-right">{row.docCount}</TableCell>
                                            <TableCell>{row.lastDate}</TableCell>
                                        </TableRow>
                                        {expanded === row.partyId && (
                                            <TableRow>
                                                <TableCell colSpan={8} className="bg-muted/30 p-0">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead>Date</TableHead>
                                                                <TableHead>Doc</TableHead>
                                                                <TableHead>Item</TableHead>
                                                                <TableHead>Material</TableHead>
                                                                <TableHead className="text-right">Qty (kg)</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {row.lines.map((line) => (
                                                                <TableRow key={line.id}>
                                                                    <TableCell>{line.date}</TableCell>
                                                                    <TableCell>
                                                                        <Badge variant="outline">{line.docId}</Badge>
                                                                    </TableCell>
                                                                    <TableCell>{line.itemName}</TableCell>
                                                                    <TableCell>{line.materialLabel}</TableCell>
                                                                    <TableCell className="text-right">
                                                                        {formatQty(line.qty)}
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                ))}
                            </TableBody>
                        </Table>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
