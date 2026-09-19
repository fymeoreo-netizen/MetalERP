import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportTable,
    ReportFilterField,
} from "./ReportPrintPage";
import { fetchScrapTradeRegister } from "@/lib/repositories/scrapRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";
import type { ScrapTradeRegisterRow } from "@/lib/scrapTradeTypes";

const DEMO_ROWS: ScrapTradeRegisterRow[] = [
    {
        trade_no: "SCRAP-2026-001",
        trade_date: "2026-05-11",
        source_name: "Gateway Motors",
        dest_name: "Gamma Scrap Traders",
        item_code: "RM-SCP-001",
        bilty_no: "BL-1249",
        vehicle_no: "LEA-991",
        net_weight: 1500,
        unit_rate: 2400,
        amount: 3600000,
        source_ap_amount: 3600000,
        dest_ar_amount: 3600000,
        settlement_mode: "triangle",
    },
];

type ViewMode = "detail" | "summary";
type SummaryGroup = "item" | "source" | "destination";

function normalizeSettlementMode(raw: unknown): "triangle" | "cash" {
    return String(raw ?? "").toLowerCase() === "cash" ? "cash" : "triangle";
}

function weightedAvgRate(amount: number, qtyKg: number): number {
    if (qtyKg <= 0) return 0;
    return Math.round((amount / qtyKg) * 100) / 100;
}

function fmtNum(n: number, digits = 2): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

type SummaryRow = {
    key: string;
    label: string;
    trade_count: number;
    net_weight: number;
    amount: number;
    avg_rate: number;
    source_ap_amount: number;
    dest_ar_amount: number;
};

function summarizeRows(rows: ScrapTradeRegisterRow[], groupBy: SummaryGroup): SummaryRow[] {
    const map = new Map<string, SummaryRow>();
    for (const r of rows) {
        const key =
            groupBy === "item"
                ? r.item_code || "—"
                : groupBy === "source"
                  ? r.source_name || "—"
                  : r.dest_name || "—";
        const cur = map.get(key);
        if (!cur) {
            map.set(key, {
                key,
                label: key,
                trade_count: 1,
                net_weight: r.net_weight,
                amount: r.amount,
                avg_rate: 0,
                source_ap_amount: Number(r.source_ap_amount ?? 0),
                dest_ar_amount: Number(r.dest_ar_amount ?? 0),
            });
        } else {
            cur.trade_count += 1;
            cur.net_weight += r.net_weight;
            cur.amount += r.amount;
            cur.source_ap_amount += Number(r.source_ap_amount ?? 0);
            cur.dest_ar_amount += Number(r.dest_ar_amount ?? 0);
        }
    }
    return [...map.values()]
        .map((r) => ({ ...r, avg_rate: weightedAvgRate(r.amount, r.net_weight) }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export default function ScrapTradeRegisterReport() {
    const { toast } = useToast();
    const today = new Date().toISOString().split("T")[0];
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString()
        .split("T")[0];
    const [dateFrom, setDateFrom] = useState(firstOfMonth);
    const [dateTo, setDateTo] = useState(today);
    const [view, setView] = useState<ViewMode>("detail");
    const [summaryGroup, setSummaryGroup] = useState<SummaryGroup>("item");
    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [destFilter, setDestFilter] = useState<string>("all");
    const [show, setShow] = useState(false);
    const [rows, setRows] = useState<ScrapTradeRegisterRow[]>([]);
    const [loading, setLoading] = useState(false);

    const sourceOptions = useMemo(() => {
        const set = new Set(rows.map((r) => r.source_name).filter(Boolean));
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [rows]);

    const destOptions = useMemo(() => {
        const set = new Set(rows.map((r) => r.dest_name).filter(Boolean));
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [rows]);

    const filteredRows = useMemo(() => {
        return rows.filter((r) => {
            if (sourceFilter !== "all" && r.source_name !== sourceFilter) return false;
            if (destFilter !== "all" && r.dest_name !== destFilter) return false;
            return true;
        });
    }, [rows, sourceFilter, destFilter]);

    const summaryRows = useMemo(
        () => summarizeRows(filteredRows, summaryGroup),
        [filteredRows, summaryGroup],
    );

    const totals = useMemo(() => {
        const net_weight = filteredRows.reduce((s, r) => s + r.net_weight, 0);
        const amount = filteredRows.reduce((s, r) => s + r.amount, 0);
        const source_ap_amount = filteredRows.reduce((s, r) => s + Number(r.source_ap_amount ?? 0), 0);
        const dest_ar_amount = filteredRows.reduce((s, r) => s + Number(r.dest_ar_amount ?? 0), 0);
        return {
            trade_count: filteredRows.length,
            net_weight,
            amount,
            avg_rate: weightedAvgRate(amount, net_weight),
            source_ap_amount,
            dest_ar_amount,
        };
    }, [filteredRows]);

    const handleGenerate = async () => {
        setLoading(true);
        setShow(true);
        setSourceFilter("all");
        setDestFilter("all");
        try {
            if (!isErpLiveMode()) {
                setRows(DEMO_ROWS);
                return;
            }
            const data = await fetchScrapTradeRegister(dateFrom, dateTo);
            setRows(
                (data as ScrapTradeRegisterRow[]).map((r) => {
                    const settlementMode = normalizeSettlementMode(r.settlement_mode);
                    const sourceAp = Number(r.source_ap_amount ?? 0);
                    const destAr = settlementMode === "cash" ? 0 : Number(r.dest_ar_amount ?? 0);
                    return {
                        trade_no: String(r.trade_no ?? ""),
                        trade_date: String(r.trade_date ?? ""),
                        source_name: String(r.source_name ?? ""),
                        dest_name: String(r.dest_name ?? ""),
                        item_code: String(r.item_code ?? ""),
                        bilty_no: r.bilty_no ?? null,
                        vehicle_no: r.vehicle_no ?? null,
                        net_weight: Number(r.net_weight ?? 0),
                        unit_rate: Number(r.unit_rate ?? 0),
                        amount: Number(r.amount ?? 0),
                        source_ap_amount: sourceAp,
                        dest_ar_amount: destAr,
                        settlement_mode: settlementMode,
                    };
                }),
            );
        } catch (e) {
            toast({
                title: "Report failed",
                description: e instanceof Error ? e.message : "Could not load scrap trade register.",
                variant: "destructive",
            });
            setShow(false);
        } finally {
            setLoading(false);
        }
    };

    const filterSubtitle = [
        sourceFilter !== "all" ? `Source: ${sourceFilter}` : null,
        destFilter !== "all" ? `Destination: ${destFilter}` : null,
    ]
        .filter(Boolean)
        .join(" · ");

    const summaryGroupLabel =
        summaryGroup === "item" ? "Item" : summaryGroup === "source" ? "Source" : "Destination";

    return (
        <div className="space-y-4">
            <ReportPrintControls
                actions={show && !loading && filteredRows.length > 0 ? <ReportPrintButton /> : null}
            >
                <ReportFilterField label="From">
                    <Input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="h-8 w-36"
                    />
                </ReportFilterField>
                <ReportFilterField label="To">
                    <Input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="h-8 w-36"
                    />
                </ReportFilterField>
                <ReportFilterField label="View">
                    <Select value={view} onValueChange={(v) => setView(v as ViewMode)}>
                        <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="detail">Detail</SelectItem>
                            <SelectItem value="summary">Summary</SelectItem>
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                {view === "summary" && (
                    <ReportFilterField label="Group by">
                        <Select
                            value={summaryGroup}
                            onValueChange={(v) => setSummaryGroup(v as SummaryGroup)}
                        >
                            <SelectTrigger className="h-8 w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="item">Item</SelectItem>
                                <SelectItem value="source">Source</SelectItem>
                                <SelectItem value="destination">Destination</SelectItem>
                            </SelectContent>
                        </Select>
                    </ReportFilterField>
                )}
                <ReportFilterField label="Source">
                    <Select value={sourceFilter} onValueChange={setSourceFilter}>
                        <SelectTrigger className="h-8 w-44">
                            <SelectValue placeholder="All sources" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All sources</SelectItem>
                            {sourceOptions.map((name) => (
                                <SelectItem key={name} value={name}>
                                    {name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <ReportFilterField label="Destination">
                    <Select value={destFilter} onValueChange={setDestFilter}>
                        <SelectTrigger className="h-8 w-44">
                            <SelectValue placeholder="All destinations" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All destinations</SelectItem>
                            {destOptions.map((name) => (
                                <SelectItem key={name} value={name}>
                                    {name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <Button size="sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
            </ReportPrintControls>

            {show && !loading && filteredRows.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                    No posted scrap trades for this period
                    {sourceFilter !== "all" || destFilter !== "all" ? " / filter" : ""}.
                </div>
            )}

            {show && !loading && filteredRows.length > 0 && view === "detail" && (
                <ReportPrintDocument
                    reportTitle="Scrap Trade Register"
                    subtitle={filterSubtitle || "Posted scrap trades"}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    groupedBy="Line detail"
                >
                    <ReportTable className="min-w-[960px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left font-bold">Date</th>
                                <th className="py-2 px-2 text-left font-bold">Trade No</th>
                                <th className="py-2 px-2 text-left font-bold">Mode</th>
                                <th className="py-2 px-2 text-left font-bold">Source</th>
                                <th className="py-2 px-2 text-left font-bold">Destination</th>
                                <th className="py-2 px-2 text-left font-bold">Item</th>
                                <th className="py-2 px-2 text-left font-bold">Bilty</th>
                                <th className="py-2 px-2 text-left font-bold">Vehicle</th>
                                <th className="py-2 px-2 text-right font-bold">Net kg</th>
                                <th className="py-2 px-2 text-right font-bold">Rate</th>
                                <th className="py-2 px-2 text-right font-bold">Amount</th>
                                <th className="py-2 px-2 text-right font-bold">Source AP</th>
                                <th className="py-2 px-2 text-right font-bold">Dest AR</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRows.map((r, i) => {
                                const isCash = r.settlement_mode === "cash";
                                return (
                                    <tr
                                        key={`${r.trade_no}-${i}`}
                                        className={`border-b ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}
                                    >
                                        <td className="py-1.5 px-2">{r.trade_date}</td>
                                        <td className="py-1.5 px-2 font-mono text-blue-700">{r.trade_no}</td>
                                        <td className="py-1.5 px-2 capitalize">
                                            {isCash ? "Cash" : "Triangle"}
                                        </td>
                                        <td className="py-1.5 px-2">{r.source_name}</td>
                                        <td className="py-1.5 px-2">{r.dest_name}</td>
                                        <td className="py-1.5 px-2 font-mono">{r.item_code}</td>
                                        <td className="py-1.5 px-2 font-mono text-slate-500">
                                            {r.bilty_no ?? "—"}
                                        </td>
                                        <td className="py-1.5 px-2 font-mono text-slate-500">
                                            {r.vehicle_no ?? "—"}
                                        </td>
                                        <td className="py-1.5 px-2 text-right">
                                            {r.net_weight.toLocaleString()}
                                        </td>
                                        <td className="py-1.5 px-2 text-right">
                                            {r.unit_rate.toLocaleString()}
                                        </td>
                                        <td className="py-1.5 px-2 text-right font-semibold">
                                            {r.amount.toLocaleString()}
                                        </td>
                                        <td className="py-1.5 px-2 text-right text-rose-700">
                                            {Number(r.source_ap_amount ?? 0).toLocaleString()}
                                        </td>
                                        <td className="py-1.5 px-2 text-right text-emerald-700">
                                            {isCash
                                                ? "—"
                                                : Number(r.dest_ar_amount ?? 0).toLocaleString()}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-800 text-white font-bold">
                                <td colSpan={8} className="py-2 px-2 text-right">
                                    Totals ({totals.trade_count} trades)
                                </td>
                                <td className="py-2 px-2 text-right">
                                    {fmtNum(totals.net_weight, 3)} kg
                                </td>
                                <td className="py-2 px-2 text-right">Avg {fmtNum(totals.avg_rate)}</td>
                                <td className="py-2 px-2 text-right">{fmtNum(totals.amount)}</td>
                                <td className="py-2 px-2 text-right">{fmtNum(totals.source_ap_amount)}</td>
                                <td className="py-2 px-2 text-right">{fmtNum(totals.dest_ar_amount)}</td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}

            {show && !loading && filteredRows.length > 0 && view === "summary" && (
                <ReportPrintDocument
                    reportTitle="Scrap Trade Register — Summary"
                    subtitle={
                        [filterSubtitle, `By ${summaryGroupLabel}`].filter(Boolean).join(" · ") ||
                        `By ${summaryGroupLabel}`
                    }
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    groupedBy={summaryGroupLabel}
                >
                    <ReportTable className="min-w-[720px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left font-bold">{summaryGroupLabel}</th>
                                <th className="py-2 px-2 text-right font-bold">Trades</th>
                                <th className="py-2 px-2 text-right font-bold">Net kg</th>
                                <th className="py-2 px-2 text-right font-bold">Avg rate</th>
                                <th className="py-2 px-2 text-right font-bold">Amount</th>
                                <th className="py-2 px-2 text-right font-bold">Source AP</th>
                                <th className="py-2 px-2 text-right font-bold">Dest AR</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaryRows.map((r) => (
                                <tr key={r.key} className="border-b border-slate-100">
                                    <td className="py-1.5 px-2 font-medium">{r.label}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{r.trade_count}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">
                                        {fmtNum(r.net_weight, 3)}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono font-medium">
                                        {fmtNum(r.avg_rate)}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono font-medium">
                                        {fmtNum(r.amount)}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono">
                                        {fmtNum(r.source_ap_amount)}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono">
                                        {fmtNum(r.dest_ar_amount)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-800 text-white font-bold">
                                <td className="py-2 px-2">Period totals</td>
                                <td className="py-2 px-2 text-right font-mono">{totals.trade_count}</td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {fmtNum(totals.net_weight, 3)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">
                                    Avg {fmtNum(totals.avg_rate)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{fmtNum(totals.amount)}</td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {fmtNum(totals.source_ap_amount)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {fmtNum(totals.dest_ar_amount)}
                                </td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
