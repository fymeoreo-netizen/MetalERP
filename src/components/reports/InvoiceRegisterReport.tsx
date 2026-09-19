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
import {
    fetchPurchaseRegisterReport,
    fetchSalesRegisterReport,
    type InvoiceRegisterRow,
} from "@/lib/api/reports";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";

export type InvoiceRegisterKind = "sales" | "sales_return" | "purchase" | "purchase_return";

const KIND_META: Record<
    InvoiceRegisterKind,
    { title: string; emptyLabel: string; family: "sales" | "purchase"; docSide: "sale" | "return" }
> = {
    sales: {
        title: "Sales Register",
        emptyLabel: "sales",
        family: "sales",
        docSide: "sale",
    },
    sales_return: {
        title: "Sales Return Register",
        emptyLabel: "sales returns",
        family: "sales",
        docSide: "return",
    },
    purchase: {
        title: "Purchase Register",
        emptyLabel: "purchases",
        family: "purchase",
        docSide: "sale",
    },
    purchase_return: {
        title: "Purchase Return Register",
        emptyLabel: "purchase returns",
        family: "purchase",
        docSide: "return",
    },
};

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

function fmtNum(n: number, digits = 3): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function weightedAvgRate(amount: number, qtyKg: number): number {
    if (qtyKg <= 0) return 0;
    return Math.round((amount / qtyKg) * 100) / 100;
}

type SummaryRow = {
    key: string;
    item_code: string;
    item_name: string;
    size_spec: string | null;
    qty_kg: number;
    unit_count: number;
    line_amount: number;
    avg_rate: number;
};

function summarizeByItem(rows: InvoiceRegisterRow[]): SummaryRow[] {
    const map = new Map<string, SummaryRow>();
    for (const r of rows) {
        const key = `${r.item_code}||${r.size_spec ?? ""}`;
        const cur = map.get(key);
        if (!cur) {
            map.set(key, {
                key,
                item_code: r.item_code,
                item_name: r.item_name,
                size_spec: r.size_spec,
                qty_kg: r.qty_kg,
                unit_count: r.unit_count,
                line_amount: r.line_amount,
                avg_rate: 0,
            });
        } else {
            cur.qty_kg += r.qty_kg;
            cur.unit_count += r.unit_count;
            cur.line_amount += r.line_amount;
        }
    }
    return [...map.values()]
        .map((r) => ({ ...r, avg_rate: weightedAvgRate(r.line_amount, r.qty_kg) }))
        .sort((a, b) => a.item_code.localeCompare(b.item_code) || String(a.size_spec).localeCompare(String(b.size_spec)));
}

export default function InvoiceRegisterReport({ kind }: { kind: InvoiceRegisterKind }) {
    const { toast } = useToast();
    const meta = KIND_META[kind];
    const defaultRange = reportDefaultRange();
    const [dateFrom, setDateFrom] = useState(defaultRange.from);
    const [dateTo, setDateTo] = useState(defaultRange.to);
    const [view, setView] = useState<"detail" | "summary">("detail");
    const [show, setShow] = useState(false);
    const [rows, setRows] = useState<InvoiceRegisterRow[]>([]);
    const [loading, setLoading] = useState(false);

    const summaryRows = useMemo(() => summarizeByItem(rows), [rows]);

    const totals = useMemo(() => {
        const qty_kg = rows.reduce((s, r) => s + r.qty_kg, 0);
        const unit_count = rows.reduce((s, r) => s + r.unit_count, 0);
        const line_amount = rows.reduce((s, r) => s + r.line_amount, 0);
        return {
            qty_kg,
            unit_count,
            line_amount,
            avg_rate: weightedAvgRate(line_amount, qty_kg),
        };
    }, [rows]);

    const handleGenerate = async () => {
        setLoading(true);
        setShow(true);
        try {
            if (!isErpLiveMode()) {
                toast({
                    title: "Demo mode",
                    description: "Sign in with live ERP enabled to load posted documents.",
                    variant: "destructive",
                });
                setRows([]);
                return;
            }
            const fetchFn =
                meta.family === "sales" ? fetchSalesRegisterReport : fetchPurchaseRegisterReport;
            const data = await fetchFn({
                from: dateFrom,
                to: dateTo,
                docSide: meta.docSide,
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
                <ReportFilterField label="View">
                    <Select value={view} onValueChange={(v) => setView(v as "detail" | "summary")}>
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
                    No posted {meta.emptyLabel} for this period.
                </div>
            )}

            {show && !loading && rows.length > 0 && view === "detail" && (
                <ReportPrintDocument
                    reportTitle={meta.title}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    groupedBy="Line detail"
                >
                    <ReportTable className="min-w-[900px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left">Date</th>
                                <th className="py-2 px-2 text-left">Doc #</th>
                                <th className="py-2 px-2 text-left">Party</th>
                                <th className="py-2 px-2 text-left">Item</th>
                                <th className="py-2 px-2 text-left">Size</th>
                                <th className="py-2 px-2 text-right">Qty kg</th>
                                <th className="py-2 px-2 text-right">Units</th>
                                <th className="py-2 px-2 text-right">Rate</th>
                                <th className="py-2 px-2 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, idx) => (
                                <tr
                                    key={`${r.doc_no}-${r.item_code}-${idx}`}
                                    className="border-b border-slate-100"
                                >
                                    <td className="py-1.5 px-2 whitespace-nowrap">
                                        {formatDisplayDate(r.doc_date)}
                                    </td>
                                    <td className="py-1.5 px-2 font-mono text-[13px]">{r.doc_no}</td>
                                    <td className="py-1.5 px-2">
                                        <span className="font-mono text-slate-500">{r.party_code}</span>{" "}
                                        {r.party_name}
                                    </td>
                                    <td className="py-1.5 px-2">
                                        <span className="font-mono text-slate-500">{r.item_code}</span>{" "}
                                        {r.item_name}
                                    </td>
                                    <td className="py-1.5 px-2 text-slate-600">{r.size_spec || "—"}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{fmtNum(r.qty_kg)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">
                                        {r.unit_count > 0 ? fmtNum(r.unit_count, 0) : "—"}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono">{fmtNum(r.unit_price, 2)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono font-medium">
                                        {fmtNum(r.line_amount, 2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-800 text-white font-bold">
                                <td className="py-2 px-2" colSpan={5}>
                                    Period totals
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{fmtNum(totals.qty_kg)}</td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {totals.unit_count > 0 ? fmtNum(totals.unit_count, 0) : "—"}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">
                                    Avg {fmtNum(totals.avg_rate, 2)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{fmtNum(totals.line_amount, 2)}</td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}

            {show && !loading && rows.length > 0 && view === "summary" && (
                <ReportPrintDocument
                    reportTitle={`${meta.title} — Summary`}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    groupedBy="Item"
                >
                    <ReportTable className="min-w-[720px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left">Item</th>
                                <th className="py-2 px-2 text-left">Size</th>
                                <th className="py-2 px-2 text-right">Qty kg</th>
                                <th className="py-2 px-2 text-right">Units</th>
                                <th className="py-2 px-2 text-right">Avg rate</th>
                                <th className="py-2 px-2 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaryRows.map((r) => (
                                <tr key={r.key} className="border-b border-slate-100">
                                    <td className="py-1.5 px-2">
                                        <span className="font-mono text-slate-500">{r.item_code}</span>{" "}
                                        {r.item_name}
                                    </td>
                                    <td className="py-1.5 px-2 text-slate-600">{r.size_spec || "—"}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{fmtNum(r.qty_kg)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">
                                        {r.unit_count > 0 ? fmtNum(r.unit_count, 0) : "—"}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono font-medium">
                                        {fmtNum(r.avg_rate, 2)}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono font-medium">
                                        {fmtNum(r.line_amount, 2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-800 text-white font-bold">
                                <td className="py-2 px-2" colSpan={2}>
                                    Period totals
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{fmtNum(totals.qty_kg)}</td>
                                <td className="py-2 px-2 text-right font-mono">
                                    {totals.unit_count > 0 ? fmtNum(totals.unit_count, 0) : "—"}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">
                                    Avg {fmtNum(totals.avg_rate, 2)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono">{fmtNum(totals.line_amount, 2)}</td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
