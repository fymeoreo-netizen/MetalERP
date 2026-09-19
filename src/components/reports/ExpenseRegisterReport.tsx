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
import { format, parseISO } from "date-fns";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportTable,
    ReportFilterField,
} from "./ReportPrintPage";
import { fetchExpenseRegisterReport, type ExpenseRegisterRow } from "@/lib/api/reports";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";

type ViewMode = "detail" | "summary";
type GroupFilter =
    | "all"
    | "factory_overhead"
    | "admin_expense"
    | "selling_expense"
    | "other_expense"
    | "cogs_cash";

const GROUP_LABELS: Record<GroupFilter, string> = {
    all: "All expenses",
    factory_overhead: "Factory overhead",
    admin_expense: "Admin",
    selling_expense: "Selling",
    other_expense: "Other",
    cogs_cash: "Factory cash (COGS)",
};

function reportDefaultRange() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    return { from, to };
}

function formatDisplayDate(dateStr: string): string {
    try {
        return format(parseISO(dateStr), "dd MMM yyyy");
    } catch {
        return dateStr;
    }
}

function fmtNum(n: number, digits = 2): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function groupLabel(rg: string): string {
    return (
        {
            factory_overhead: "Factory OH",
            admin_expense: "Admin",
            selling_expense: "Selling",
            other_expense: "Other",
            cogs: "Factory cash",
        }[rg] ?? rg
    );
}

type SummaryRow = {
    key: string;
    account_code: string;
    account_name: string;
    report_group: string;
    line_count: number;
    net_amount: number;
};

function summarizeByAccount(rows: ExpenseRegisterRow[]): SummaryRow[] {
    const map = new Map<string, SummaryRow>();
    for (const r of rows) {
        const cur = map.get(r.account_code);
        if (!cur) {
            map.set(r.account_code, {
                key: r.account_code,
                account_code: r.account_code,
                account_name: r.account_name,
                report_group: r.report_group,
                line_count: 1,
                net_amount: r.net_amount,
            });
        } else {
            cur.line_count += 1;
            cur.net_amount += r.net_amount;
        }
    }
    return [...map.values()].sort((a, b) => a.account_code.localeCompare(b.account_code));
}

export default function ExpenseRegisterReport() {
    const { toast } = useToast();
    const defaultRange = reportDefaultRange();
    const [dateFrom, setDateFrom] = useState(defaultRange.from);
    const [dateTo, setDateTo] = useState(defaultRange.to);
    const [view, setView] = useState<ViewMode>("detail");
    const [group, setGroup] = useState<GroupFilter>("all");
    const [show, setShow] = useState(false);
    const [rows, setRows] = useState<ExpenseRegisterRow[]>([]);
    const [loading, setLoading] = useState(false);

    const summaryRows = useMemo(() => summarizeByAccount(rows), [rows]);
    const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.net_amount, 0), [rows]);

    const handleGenerate = async () => {
        setLoading(true);
        setShow(true);
        try {
            if (!isErpLiveMode()) {
                toast({
                    title: "Demo mode",
                    description: "Sign in with live ERP enabled to load posted expenses.",
                    variant: "destructive",
                });
                setRows([]);
                return;
            }
            const data = await fetchExpenseRegisterReport({
                from: dateFrom,
                to: dateTo,
                reportGroup: group,
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
                <ReportFilterField label="Category">
                    <Select value={group} onValueChange={(v) => setGroup(v as GroupFilter)}>
                        <SelectTrigger className="h-8 w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(Object.keys(GROUP_LABELS) as GroupFilter[]).map((k) => (
                                <SelectItem key={k} value={k}>
                                    {GROUP_LABELS[k]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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
                <Button size="sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
            </ReportPrintControls>

            {show && !loading && rows.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                    No posted expenses for this period.
                </div>
            )}

            {show && !loading && rows.length > 0 && view === "detail" && (
                <ReportPrintDocument
                    reportTitle="Expense Register"
                    subtitle={GROUP_LABELS[group]}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    groupedBy="Line detail"
                >
                    <ReportTable className="min-w-[960px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left">Date</th>
                                <th className="py-2 px-2 text-left">Voucher</th>
                                <th className="py-2 px-2 text-left">Account</th>
                                <th className="py-2 px-2 text-left">Group</th>
                                <th className="py-2 px-2 text-left">Party</th>
                                <th className="py-2 px-2 text-left">Narration</th>
                                <th className="py-2 px-2 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, idx) => (
                                <tr
                                    key={`${r.voucher_no}-${r.account_code}-${idx}`}
                                    className="border-b border-slate-100"
                                >
                                    <td className="py-1.5 px-2 whitespace-nowrap">
                                        {formatDisplayDate(r.posting_date)}
                                    </td>
                                    <td className="py-1.5 px-2 font-mono text-[13px]">{r.voucher_no || "—"}</td>
                                    <td className="py-1.5 px-2">
                                        <span className="font-mono text-slate-500">{r.account_code}</span>{" "}
                                        {r.account_name}
                                    </td>
                                    <td className="py-1.5 px-2 text-slate-600">
                                        {groupLabel(r.report_group)}
                                    </td>
                                    <td className="py-1.5 px-2">{r.party_name || "—"}</td>
                                    <td className="py-1.5 px-2 text-slate-600 max-w-[220px] truncate">
                                        {r.narration || "—"}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono font-medium">
                                        {fmtNum(r.net_amount)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-800 text-white font-bold">
                                <td className="py-2 px-2" colSpan={6}>
                                    Period totals ({rows.length} lines)
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{fmtNum(totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}

            {show && !loading && rows.length > 0 && view === "summary" && (
                <ReportPrintDocument
                    reportTitle="Expense Register — Summary"
                    subtitle={GROUP_LABELS[group]}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    groupedBy="Account"
                >
                    <ReportTable className="min-w-[720px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left">Account</th>
                                <th className="py-2 px-2 text-left">Group</th>
                                <th className="py-2 px-2 text-right">Lines</th>
                                <th className="py-2 px-2 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaryRows.map((r) => (
                                <tr key={r.key} className="border-b border-slate-100">
                                    <td className="py-1.5 px-2">
                                        <span className="font-mono text-slate-500">{r.account_code}</span>{" "}
                                        {r.account_name}
                                    </td>
                                    <td className="py-1.5 px-2 text-slate-600">
                                        {groupLabel(r.report_group)}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono">{r.line_count}</td>
                                    <td className="py-1.5 px-2 text-right font-mono font-medium">
                                        {fmtNum(r.net_amount)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-800 text-white font-bold">
                                <td className="py-2 px-2" colSpan={2}>
                                    Period totals ({summaryRows.length} accounts)
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{rows.length}</td>
                                <td className="py-2 px-2 text-right font-mono">{fmtNum(totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
