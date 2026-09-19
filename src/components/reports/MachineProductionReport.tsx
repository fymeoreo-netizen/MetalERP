import { Fragment, lazy, Suspense, useMemo, useState } from "react";
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
import { format, parseISO } from "date-fns";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportTable,
    ReportFilterField,
} from "./ReportPrintPage";
import {
    fetchMachineProductionDaily,
    type MachineProductionDailyRow,
} from "@/lib/api/production";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";

function reportDefaultRange() {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    return { from: firstOfMonth, to: endOfMonth };
}

function formatDisplayDate(dateStr: string): string {
    try {
        return format(parseISO(dateStr), "dd MMM yyyy");
    } catch {
        return dateStr;
    }
}

function fmtKg(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function scrapPct(scrap: number, input: number): number {
    if (input <= 0) return 0;
    return Math.round((scrap / input) * 10000) / 100;
}

type DayGroup = {
    date: string;
    rows: MachineProductionDailyRow[];
    batch_count: number;
    input_kg: number;
    output_kg: number;
    scrap_kg: number;
};

function groupByDate(rows: MachineProductionDailyRow[]): DayGroup[] {
    const map = new Map<string, MachineProductionDailyRow[]>();
    for (const r of rows) {
        const list = map.get(r.prod_date) ?? [];
        list.push(r);
        map.set(r.prod_date, list);
    }
    return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dayRows]) => ({
            date,
            rows: dayRows,
            batch_count: dayRows.reduce((s, r) => s + r.batch_count, 0),
            input_kg: dayRows.reduce((s, r) => s + r.input_kg, 0),
            output_kg: dayRows.reduce((s, r) => s + r.output_kg, 0),
            scrap_kg: dayRows.reduce((s, r) => s + r.scrap_kg, 0),
        }));
}

const LazyDailyChart = lazy(() =>
    import("recharts").then((mod) => ({
        default: function DailyMachineChart({
            data,
        }: {
            data: { name: string; output: number; scrap: number }[];
        }) {
            const {
                BarChart,
                Bar,
                XAxis,
                YAxis,
                CartesianGrid,
                Tooltip,
                Legend,
                ResponsiveContainer,
            } = mod;
            return (
                <ResponsiveContainer width="100%" height={260} minWidth={0}>
                    <BarChart data={data} barGap={2} barCategoryGap="20%">
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis
                            stroke="#94a3b8"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => `${v}`}
                        />
                        <Tooltip
                            contentStyle={{
                                borderRadius: "10px",
                                border: "1px solid #e2e8f0",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                                fontSize: 12,
                            }}
                            formatter={(value) => [`${Number(value ?? 0).toLocaleString()} kg`, undefined]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="output" name="Output" fill="#059669" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="scrap" name="Scrap" fill="#e11d48" radius={[3, 3, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            );
        },
    })),
);

export default function MachineProductionReport() {
    const { toast } = useToast();
    const defaultRange = reportDefaultRange();
    const [dateFrom, setDateFrom] = useState(defaultRange.from);
    const [dateTo, setDateTo] = useState(defaultRange.to);
    const [department, setDepartment] = useState<string>("all");
    const [show, setShow] = useState(false);
    const [rows, setRows] = useState<MachineProductionDailyRow[]>([]);
    const [loading, setLoading] = useState(false);

    const days = useMemo(() => groupByDate(rows), [rows]);

    const periodTotals = useMemo(() => {
        const batch_count = rows.reduce((s, r) => s + r.batch_count, 0);
        const input_kg = rows.reduce((s, r) => s + r.input_kg, 0);
        const output_kg = rows.reduce((s, r) => s + r.output_kg, 0);
        const scrap_kg = rows.reduce((s, r) => s + r.scrap_kg, 0);
        return {
            batch_count,
            input_kg,
            output_kg,
            scrap_kg,
            scrap_pct: scrapPct(scrap_kg, input_kg),
        };
    }, [rows]);

    const chartData = useMemo(
        () =>
            days.map((d) => ({
                name: format(parseISO(d.date), "dd MMM"),
                output: Math.round(d.output_kg * 1000) / 1000,
                scrap: Math.round(d.scrap_kg * 1000) / 1000,
            })),
        [days],
    );

    const handleGenerate = async () => {
        setLoading(true);
        setShow(true);
        try {
            if (!isErpLiveMode()) {
                toast({
                    title: "Demo mode",
                    description: "Sign in with live ERP enabled to load posted production data.",
                    variant: "destructive",
                });
                setRows([]);
                return;
            }
            const data = await fetchMachineProductionDaily({
                from: dateFrom,
                to: dateTo,
                department: department === "all" ? undefined : department,
            });
            setRows(data);
        } catch (e) {
            toast({
                title: "Report failed",
                description: e instanceof Error ? e.message : "Unknown error",
                variant: "destructive",
            });
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <ReportPrintControls actions={show && !loading && rows.length > 0 ? <ReportPrintButton /> : null}>
                <ReportFilterField label="From">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36" />
                </ReportFilterField>
                <ReportFilterField label="To">
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36" />
                </ReportFilterField>
                <ReportFilterField label="Dept">
                    <Select value={department} onValueChange={setDepartment}>
                        <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="enamel">Enamel</SelectItem>
                            <SelectItem value="workshop">Workshop</SelectItem>
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <Button size="sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
            </ReportPrintControls>

            {show && !loading && rows.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                    No posted production for this period.
                </div>
            )}

            {show && !loading && rows.length > 0 && (
                <>
                    <div className="rounded-lg border border-slate-200 bg-white p-4 print:hidden">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                            Daily output / scrap
                        </p>
                        <Suspense
                            fallback={<div className="h-[260px] animate-pulse rounded-lg bg-slate-50" />}
                        >
                            <LazyDailyChart data={chartData} />
                        </Suspense>
                    </div>

                    <ReportPrintDocument
                        reportTitle="Machine-wise Production (Date-wise)"
                        dateFrom={dateFrom}
                        dateTo={dateTo}
                        groupedBy="Date → Machine"
                    >
                        <ReportTable className="min-w-[700px]">
                            <thead>
                                <tr className="bg-slate-100 border-b-2 border-slate-800">
                                    <th className="py-2 px-2 text-left">Dept</th>
                                    <th className="py-2 px-2 text-left">Machine</th>
                                    <th className="py-2 px-2 text-right">Batches</th>
                                    <th className="py-2 px-2 text-right">Output kg</th>
                                    <th className="py-2 px-2 text-right">Scrap sent kg</th>
                                    <th className="py-2 px-2 text-right">Scrap %</th>
                                    <th className="py-2 px-2 text-right">Std %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {days.map((day) => (
                                    <Fragment key={day.date}>
                                        <tr className="report-group-header">
                                            <td
                                                colSpan={7}
                                                className="py-2 px-2 font-bold uppercase tracking-wide text-slate-900"
                                            >
                                                {formatDisplayDate(day.date)}
                                            </td>
                                        </tr>
                                        {day.rows.map((r) => (
                                            <tr key={`${day.date}-${r.machine_id}`} className="border-b border-slate-100">
                                                <td className="py-1.5 px-2 capitalize">{r.department}</td>
                                                <td className="py-1.5 px-2">
                                                    <span className="font-mono">{r.machine_code}</span> —{" "}
                                                    {r.machine_name}
                                                </td>
                                                <td className="py-1.5 px-2 text-right font-mono">{r.batch_count}</td>
                                                <td className="py-1.5 px-2 text-right font-mono">{fmtKg(r.output_kg)}</td>
                                                <td className="py-1.5 px-2 text-right font-mono text-blue-700">
                                                    {fmtKg(r.scrap_kg)}
                                                </td>
                                                <td
                                                    className={`py-1.5 px-2 text-right font-mono font-medium ${
                                                        r.scrap_pct > r.standard_pct
                                                            ? "text-rose-700"
                                                            : "text-emerald-700"
                                                    }`}
                                                >
                                                    {r.scrap_pct}%
                                                </td>
                                                <td className="py-1.5 px-2 text-right font-mono text-slate-500">
                                                    {r.standard_pct}%
                                                </td>
                                            </tr>
                                        ))}
                                        <tr className="bg-slate-50 font-semibold border-b border-slate-300">
                                            <td className="py-1.5 px-2" colSpan={2}>
                                                Day total — {formatDisplayDate(day.date)}
                                            </td>
                                            <td className="py-1.5 px-2 text-right font-mono">{day.batch_count}</td>
                                            <td className="py-1.5 px-2 text-right font-mono">{fmtKg(day.output_kg)}</td>
                                            <td className="py-1.5 px-2 text-right font-mono text-blue-800">
                                                {fmtKg(day.scrap_kg)}
                                            </td>
                                            <td className="py-1.5 px-2 text-right font-mono">
                                                {scrapPct(day.scrap_kg, day.input_kg)}%
                                            </td>
                                            <td className="py-1.5 px-2" />
                                        </tr>
                                    </Fragment>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-slate-800 text-white font-bold">
                                    <td className="py-2 px-2" colSpan={2}>
                                        Period totals
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono">{periodTotals.batch_count}</td>
                                    <td className="py-2 px-2 text-right font-mono">{fmtKg(periodTotals.output_kg)}</td>
                                    <td className="py-2 px-2 text-right font-mono">{fmtKg(periodTotals.scrap_kg)}</td>
                                    <td className="py-2 px-2 text-right font-mono">{periodTotals.scrap_pct}%</td>
                                    <td className="py-2 px-2" />
                                </tr>
                            </tfoot>
                        </ReportTable>
                    </ReportPrintDocument>
                </>
            )}
        </div>
    );
}
