import { Fragment, useEffect, useMemo, useState } from "react";
import { PartyCombobox, toPartyComboboxOptions } from "@/components/masters/PartyCombobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { ReportPrintButton, ReportPrintDocument, ReportSectionTitle, ReportKpiGrid } from "./ReportPrintPage";
import { format, subDays, subMonths, startOfMonth, endOfMonth } from "date-fns";
import {
    getDefaultMonthFilters,
    getPartiesForReportTab,
    getPartyMaterialSummaries,
    getPartyMovementLines,
    getPeriodTotals,
    getLivePartyMaterialSummaries,
    getLivePartyMovementLines,
    getLivePeriodTotals,
    getLivePartiesForReportTab,
    mapPartyStockMovementRows,
    formatQty,
    type MaterialGroup,
    type PartyReportTab,
    type PartyMovementFilters,
    type LivePartyStockRow,
} from "@/lib/partyMovementReport";
import { useSearchParams } from "react-router-dom";
import { fetchPartyStockMovement } from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import { initItemCatalog } from "@/lib/itemCatalog";
import { initPartyCatalog } from "@/lib/partyCatalog";
import { toast } from "sonner";
import { ReportLoadState } from "./ReportLoadState";

function SummaryTable({
    tab,
    filters,
    show,
    liveRows,
}: {
    tab: PartyReportTab;
    filters: PartyMovementFilters;
    show: boolean;
    liveRows: LivePartyStockRow[] | null;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const summaries = useMemo(() => {
        if (!show) return [];
        if (liveRows) return getLivePartyMaterialSummaries(tab, liveRows, filters);
        return getPartyMaterialSummaries(tab, filters);
    }, [tab, filters, show, liveRows]);

    if (!show) return null;

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Party</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Docs</TableHead>
                    <TableHead>Last date</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {summaries.map((row) => {
                    const key = `${row.partyId}|${row.materialGroup}`;
                    const isOpen = expanded === key;
                    return (
                        <Fragment key={key}>
                            <TableRow
                                className="cursor-pointer hover:bg-slate-50"
                                onClick={() => setExpanded(isOpen ? null : key)}
                            >
                                <TableCell>
                                    {isOpen ? (
                                        <ChevronDown className="h-4 w-4 text-slate-400" />
                                    ) : (
                                        <ChevronRight className="h-4 w-4 text-slate-400" />
                                    )}
                                </TableCell>
                                <TableCell className="font-medium">{row.partyName}</TableCell>
                                <TableCell>{row.materialLabel}</TableCell>
                                <TableCell className="text-right font-mono font-semibold">
                                    {formatQty(row.totalQty)}
                                </TableCell>
                                <TableCell className="text-right">{row.docCount}</TableCell>
                                <TableCell>{new Date(row.lastDate).toLocaleDateString()}</TableCell>
                            </TableRow>
                            {isOpen &&
                                row.lines.map((line) => (
                                    <TableRow key={line.id} className="bg-slate-50/80">
                                        <TableCell />
                                        <TableCell colSpan={2} className="text-xs text-slate-600 pl-8">
                                            <span className="font-mono">{line.docId}</span>
                                            {" · "}
                                            {line.itemName} ({line.sizeSpec})
                                            {line.purchaseMode && (
                                                <Badge variant="outline" className="ml-2 text-[10px] capitalize">
                                                    {line.purchaseMode}
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right text-xs font-mono">
                                            {formatQty(line.qty, line.unit)}
                                        </TableCell>
                                        <TableCell className="text-right text-xs">
                                            {new Date(line.date).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell />
                                    </TableRow>
                                ))}
                        </Fragment>
                    );
                })}
                {summaries.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500 py-10">
                            No movements for this period and filters.
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
}

export default function PartyStockMovementReport() {
    const [searchParams] = useSearchParams();
    const initialFrom = searchParams.get("from");
    const initialTo = searchParams.get("to");
    const initialParty = searchParams.get("party") ?? "";

    const defaults = getDefaultMonthFilters();
    const [dateFrom, setDateFrom] = useState(initialFrom ?? defaults.dateFrom);
    const [dateTo, setDateTo] = useState(initialTo ?? defaults.dateTo);
    const [partyId, setPartyId] = useState(initialParty || "all");
    const [materialGroup, setMaterialGroup] = useState<MaterialGroup>("all");
    const [activeTab, setActiveTab] = useState<PartyReportTab>("received");
    const [show, setShow] = useState(!!initialFrom || !!initialParty);
    const [liveRows, setLiveRows] = useState<LivePartyStockRow[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const useLive = isErpLiveMode();

    const filters: PartyMovementFilters = useMemo(
        () => ({
            dateFrom,
            dateTo,
            partyId: partyId === "all" ? undefined : partyId,
            materialGroup,
        }),
        [dateFrom, dateTo, partyId, materialGroup]
    );

    const totals = useMemo(() => {
        if (!show) return null;
        if (liveRows) return getLivePeriodTotals(liveRows, filters);
        return getPeriodTotals(filters);
    }, [filters, show, liveRows]);
    const parties = useMemo(() => {
        if (liveRows) return getLivePartiesForReportTab(activeTab, liveRows);
        return getPartiesForReportTab(activeTab);
    }, [activeTab, liveRows]);
    const partyFilterOptions = useMemo(() => toPartyComboboxOptions(parties), [parties]);

    const handleGenerate = async () => {
        setShow(true);
        setError(null);
        if (useLive) {
            setLoading(true);
            try {
                await Promise.all([initPartyCatalog(), initItemCatalog()]);
                const rows = await fetchPartyStockMovement(dateFrom, dateTo);
                setLiveRows(mapPartyStockMovementRows(rows as Record<string, unknown>[]));
            } catch (e) {
                const message = e instanceof Error ? e.message : "Failed to load party stock movement.";
                setError(message);
                setLiveRows([]);
                toast.error(message);
            } finally {
                setLoading(false);
            }
        } else {
            setLiveRows(null);
        }
    };

    useEffect(() => {
        if (!useLive || !show) return;
        void handleGenerate();
        const onInvoiceUpdated = () => void handleGenerate();
        window.addEventListener("erp:invoice-updated", onInvoiceUpdated);
        return () => window.removeEventListener("erp:invoice-updated", onInvoiceUpdated);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when filter range changes
    }, [useLive, show, dateFrom, dateTo]);

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

    const lineCount = show
        ? liveRows
            ? getLivePartyMovementLines(activeTab, liveRows, filters).length
            : getPartyMovementLines(activeTab, filters).length
        : 0;

    return (
        <div className="space-y-4">
            <Card className="shadow-soft border-slate-100 print:hidden">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Party Stock Movement</CardTitle>
                    <CardDescription>
                        Raw material received from suppliers, finished goods sold to customers, and scrap sent to vendors.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
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
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="space-y-2">
                            <Label>From</Label>
                            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>To</Label>
                            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Party</Label>
                            <PartyCombobox
                                value={partyId}
                                onValueChange={setPartyId}
                                options={partyFilterOptions}
                                placeholder="All parties"
                                leadingOptions={[{ value: "all", label: "All parties" }]}
                                showCode
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Material</Label>
                            <Select
                                value={materialGroup}
                                onValueChange={(v) => setMaterialGroup(v as MaterialGroup)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All materials</SelectItem>
                                    <SelectItem value="rm_scrap">Scrap</SelectItem>
                                    <SelectItem value="rm_wire8">Wire No 8</SelectItem>
                                    <SelectItem value="rm_rod">Copper Rod</SelectItem>
                                    <SelectItem value="fg_all">All finished goods</SelectItem>
                                    <SelectItem value="fg_enameled">FG Enameled</SelectItem>
                                    <SelectItem value="fg_strip">FG Strip</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleGenerate()} disabled={loading}>
                            <Search className="h-4 w-4 mr-2" />
                            {loading ? "Loading…" : "Generate report"}
                        </Button>
                        {show && !loading && !error && lineCount > 0 && <ReportPrintButton />}
                    </div>

                    <ReportLoadState
                        loading={show && loading}
                        error={show && !loading ? error : null}
                        empty={show && !loading && !error && lineCount === 0}
                        emptyMessage="No stock movements for this period and filters."
                    />
                </CardContent>
            </Card>

            {show && !loading && !error && (
                <ReportPrintDocument
                    reportTitle="Party Stock Movement"
                    subtitle="RM received, FG sold, and scrap sent by party"
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    density="compact"
                    meta={[
                        {
                            label: "Party",
                            value:
                                partyId === "all"
                                    ? "All parties"
                                    : (partyFilterOptions.find((p) => p.id === partyId)?.name ?? partyId),
                        },
                        {
                            label: "Material",
                            value:
                                materialGroup === "all"
                                    ? "All materials"
                                    : materialGroup.replace(/_/g, " "),
                        },
                    ]}
                >
            {totals && (
                <ReportKpiGrid
                    columns={3}
                    items={[
                        { label: "Scrap received", value: formatQty(totals.scrapReceived) },
                        { label: "Wire No 8 received", value: formatQty(totals.wire8Received) },
                        { label: "Rod received", value: formatQty(totals.rodReceived) },
                        { label: "FG Enameled sold", value: formatQty(totals.fgEnameledSold) },
                        { label: "FG Strip sold", value: formatQty(totals.fgStripSold) },
                        { label: "Scrap sent", value: formatQty(totals.scrapSent) },
                    ]}
                />
            )}

                    <div className="border-t border-slate-200 pt-4">
                        <p className="text-sm font-semibold text-slate-800 mb-3 erp-no-print">
                            Detail by party ({lineCount} lines)
                        </p>
                        <Tabs
                            value={activeTab}
                            onValueChange={(v) => setActiveTab(v as PartyReportTab)}
                            className="report-print-tabs"
                        >
                            <TabsList className="mb-4 erp-no-print">
                                <TabsTrigger value="received">Received from parties</TabsTrigger>
                                <TabsTrigger value="sold">Sold to parties</TabsTrigger>
                                <TabsTrigger value="scrap_sent">Scrap sent</TabsTrigger>
                            </TabsList>
                            <TabsContent value="received">
                                <ReportSectionTitle>Received from parties</ReportSectionTitle>
                                <SummaryTable tab="received" filters={filters} show={show} liveRows={liveRows} />
                            </TabsContent>
                            <TabsContent value="sold">
                                <ReportSectionTitle>Sold to parties</ReportSectionTitle>
                                <SummaryTable tab="sold" filters={filters} show={show} liveRows={liveRows} />
                            </TabsContent>
                            <TabsContent value="scrap_sent">
                                <ReportSectionTitle>Scrap sent</ReportSectionTitle>
                                <SummaryTable tab="scrap_sent" filters={filters} show={show} liveRows={liveRows} />
                            </TabsContent>
                        </Tabs>
                    </div>
                </ReportPrintDocument>
            )}
        </div>
    );
}
