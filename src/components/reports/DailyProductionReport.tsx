import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportTable,
    ReportFilterField,
} from "./ReportPrintPage";
import { fetchDailyProductionDetail } from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import {
    buildDailyProductionReportModel,
    buildDemoDailyProductionReportModel,
    type ReportModel,
    type ReportWeightTotals,
} from "@/lib/dailyProductionReport";

function formatDisplayDate(dateStr: string): string {
    try {
        return format(parseISO(dateStr), "dd MMM yyyy");
    } catch {
        return dateStr;
    }
}

function fmtKg(n: number): string {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
}

function yieldPct(totals: ReportWeightTotals): string {
    if (totals.consumed <= 0) return "0";
    return ((totals.net / totals.consumed) * 100).toFixed(1);
}

export default function DailyProductionReport() {
    const today = new Date().toISOString().split("T")[0];
    const [dateFrom, setDateFrom] = useState(today);
    const [dateTo, setDateTo] = useState(today);
    const [processType, setProcessType] = useState<"enamel" | "workshop">("enamel");
    const [show, setShow] = useState(false);
    const [model, setModel] = useState<ReportModel | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const liveMode = isErpLiveMode();

    const handleGenerate = async () => {
        setShow(true);
        setLoading(true);
        setError(null);

        try {
            if (!liveMode) {
                setModel(buildDemoDailyProductionReportModel());
                return;
            }

            const rows = await fetchDailyProductionDetail(dateFrom, dateTo, processType);
            setModel(buildDailyProductionReportModel(rows));
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load daily production report.";
            setError(message);
            setModel(null);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const hasData = model && model.days.length > 0;

    return (
        <div className="space-y-4">
            <ReportPrintControls
                actions={show && !loading && !error && hasData ? <ReportPrintButton /> : null}
            >
                <ReportFilterField label="From">
                    <Input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="h-8 text-sm w-36"
                    />
                </ReportFilterField>
                <ReportFilterField label="To">
                    <Input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="h-8 text-sm w-36"
                    />
                </ReportFilterField>
                <ReportFilterField label="Process">
                    <Select value={processType} onValueChange={(v) => setProcessType(v as "enamel" | "workshop")}>
                        <SelectTrigger className="h-8 text-sm w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="enamel">Enamel</SelectItem>
                            <SelectItem value="workshop">Workshop</SelectItem>
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <Button
                    className="bg-blue-600 hover:bg-blue-700 h-8 text-sm"
                    onClick={() => void handleGenerate()}
                    disabled={loading}
                >
                    {loading ? (
                        <>
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            Loading…
                        </>
                    ) : (
                        "Generate Report"
                    )}
                </Button>
            </ReportPrintControls>

            {show && !loading && error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 print:hidden">
                    {error}
                    <p className="mt-1 text-xs text-rose-600">
                        Apply migration 71 in Supabase if the detail report function is missing.
                    </p>
                </div>
            )}

            {show && !loading && !error && !hasData && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 print:hidden">
                    No posted {processType} production in this period.
                </div>
            )}

            {show && !loading && hasData && model && (
                <ReportPrintDocument
                    reportTitle="Daily Production Report"
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    groupedBy={`Production Batch (${processType.charAt(0).toUpperCase() + processType.slice(1)})`}
                >
                    <ReportTable className="min-w-[640px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left font-bold text-slate-800">Item</th>
                                <th className="py-2 px-2 text-center font-bold text-slate-800">Units</th>
                                <th className="py-2 px-2 text-right font-bold text-slate-800">Gross (kg)</th>
                                <th className="py-2 px-2 text-right font-bold text-slate-800">Tare (kg)</th>
                                <th className="py-2 px-2 text-right font-bold text-emerald-700">Net (kg)</th>
                                <th className="py-2 px-2 text-right font-bold text-blue-800">Input (kg)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {model.days.map((day) => (
                                <Fragment key={day.date}>
                                    <tr key={day.date} className="report-group-header">
                                        <td colSpan={6} className="py-2 px-2 font-bold text-slate-900 uppercase tracking-wide">
                                            {formatDisplayDate(day.date)}
                                        </td>
                                    </tr>
                                    {day.batches.map((batch) => (
                                        <Fragment key={`${day.date}-${batch.batchNo}`}>
                                            <tr className="bg-slate-100">
                                                <td colSpan={6} className="py-1.5 px-2 font-semibold text-slate-800">
                                                    {batch.batchNo} — {batch.process}
                                                </td>
                                            </tr>
                                            {batch.lines.map((line, lineIdx) => (
                                                <tr
                                                    key={`${batch.batchNo}-line-${lineIdx}`}
                                                    className="border-b border-slate-100"
                                                >
                                                    <td className="py-1.5 px-2 pl-4 text-slate-700">
                                                        {line.itemName}
                                                        <span className="text-slate-400 ml-1">({line.itemCode})</span>
                                                        {line.category === "Strip" && (
                                                            <span className="ml-1 text-xs text-amber-700">Strip</span>
                                                        )}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-center font-mono">
                                                        {line.units > 0 ? line.units.toLocaleString() : "—"}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right font-mono text-slate-600">
                                                        {line.gross > 0 ? fmtKg(line.gross) : "—"}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right font-mono text-slate-600">
                                                        {line.tare > 0 ? fmtKg(line.tare) : "—"}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right font-mono font-medium text-emerald-700">
                                                        {fmtKg(line.net)}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right font-mono text-blue-800">
                                                        {line.inputKg > 0 ? fmtKg(line.inputKg) : "—"}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr className="bg-slate-50 font-semibold border-b border-slate-300">
                                                <td className="py-1.5 px-2 pl-4">Batch total</td>
                                                <td className="py-1.5 px-2 text-center font-mono">
                                                    {batch.totals.units > 0
                                                        ? batch.totals.units.toLocaleString()
                                                        : "—"}
                                                </td>
                                                <td className="py-1.5 px-2 text-right font-mono">
                                                    {batch.totals.gross > 0 ? fmtKg(batch.totals.gross) : "—"}
                                                </td>
                                                <td className="py-1.5 px-2 text-right font-mono">
                                                    {batch.totals.tare > 0 ? fmtKg(batch.totals.tare) : "—"}
                                                </td>
                                                <td className="py-1.5 px-2 text-right font-mono text-emerald-700">
                                                    {fmtKg(batch.totals.net)}
                                                </td>
                                                <td className="py-1.5 px-2 text-right font-mono text-blue-900">
                                                    {fmtKg(batch.totals.consumed)}
                                                    <span className="text-slate-500 font-normal ml-1">
                                                        ({yieldPct(batch.totals)}% yield)
                                                    </span>
                                                </td>
                                            </tr>
                                        </Fragment>
                                    ))}
                                    <tr className="bg-slate-100 font-bold border-b-2 border-slate-400">
                                        <td className="py-2 px-2 pl-4">Day total — {formatDisplayDate(day.date)}</td>
                                        <td className="py-2 px-2 text-center font-mono">
                                            {day.totals.units > 0 ? day.totals.units.toLocaleString() : "—"}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono">
                                            {day.totals.gross > 0 ? fmtKg(day.totals.gross) : "—"}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono">
                                            {day.totals.tare > 0 ? fmtKg(day.totals.tare) : "—"}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono text-emerald-800">
                                            {fmtKg(day.totals.net)}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono text-blue-900">
                                            {fmtKg(day.totals.consumed)}
                                        </td>
                                </tr>
                                </Fragment>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-800 text-white font-bold">
                                <td className="py-2 px-2">GRAND TOTAL</td>
                                <td className="py-2 px-2 text-center font-mono">
                                    {model.grandTotals.units > 0
                                        ? model.grandTotals.units.toLocaleString()
                                        : "—"}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {model.grandTotals.gross > 0 ? fmtKg(model.grandTotals.gross) : "—"}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {model.grandTotals.tare > 0 ? fmtKg(model.grandTotals.tare) : "—"}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {fmtKg(model.grandTotals.net)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {fmtKg(model.grandTotals.consumed)}
                                    <span className="font-normal ml-1 opacity-80">
                                        ({yieldPct(model.grandTotals)}%)
                                    </span>
                                </td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
