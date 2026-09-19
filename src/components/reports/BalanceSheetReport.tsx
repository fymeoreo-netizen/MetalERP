import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
    ReportPrintBanner,
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportFilterField,
} from "./ReportPrintPage";
import { ReportLoadState } from "./ReportLoadState";
import { fetchBalanceSheet } from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import { formatAccountRowLabel, groupByReportGroup, humanizeReportGroup } from "@/lib/reportAccountDisplay";
import { isReportBalanced, reportBalanceVariance } from "@/lib/reportBalance";

// --- MOCK BALANCE SHEET DATA ---
const BS_DATA = {
    assets: {
        cashBank: [
            { code: "11101", name: "Main Factory Cash Drawer", amount: 125000 },
            { code: "11102", name: "Meezan Bank", amount: 1340000 },
            { code: "11103", name: "HBL", amount: 480000 },
        ],
        receivables: [
            { code: "11201", name: "Accounts Receivable - Customers (A/R Anchor)", amount: 2100000 },
            { code: "11202", name: "Parchi Receivables", amount: 300000 },
            { code: "11203", name: "Advance Cash Given to Vendors", amount: 150000 },
        ],
        inventory: [
            { code: "12101", name: "Raw Material Value - Scrap/Cathode", amount: 580000 },
            { code: "12102", name: "WIP Value - Wire No 8/Rod", amount: 230000 },
            { code: "12103", name: "Finished Goods Value - Enameled Wire", amount: 170000 },
        ],
    },
    liabilities: [
        { code: "21101", name: "Accounts Payable - Vendors (A/P Anchor)", amount: 1450000 },
        { code: "21102", name: "Vendor Mazdoori Payable", amount: 120000 },
        { code: "21103", name: "Parchi Payables", amount: 400000 },
        { code: "21104", name: "Advance Cash Received from Customers", amount: 180000 },
    ],
    equity: [
        { code: "31001", name: "Owner's Capital Investment", amount: 3000000 },
        { code: "31002", name: "Owner Drawings", amount: -420000 },
        { code: "32001", name: "Accumulated Factory Profits (Prior)", amount: 455000 },
    ],
    netProfitCurrentPeriod: 380000,
};

type BsAccountRow = { code: string; name: string; amount: number };

type BsLiveRow = {
    account_code: string;
    account_name: string;
    account_type: string;
    report_group: string;
    closing_balance: number;
};

const fmt = (n: number) => `₨ ${Math.abs(n).toLocaleString()}`;

function BSSection({ title, items, total, color = "blue" }: { title: string; items: BsAccountRow[]; total: number; color?: string }) {
    const borderColor = color === "blue" ? "border-blue-800" : color === "rose" ? "border-rose-800" : "border-emerald-800";
    const bgColor = color === "blue" ? "bg-blue-50" : color === "rose" ? "bg-rose-50" : "bg-emerald-50";
    return (
        <div className="mb-4">
            <h4 className={`text-xs font-bold uppercase tracking-wider border-b-2 ${borderColor} pb-0.5 mb-2 text-slate-700 print:text-slate-900`}>{title}</h4>
            <table className="report-table w-full text-[11px]">
                <tbody>
                    {items.map((item) => (
                        <tr key={item.code} className="border-b border-slate-100">
                            <td className="py-1 pl-1 font-mono text-slate-500 w-16">{item.code}</td>
                            <td className="py-1 text-slate-700">{item.name}</td>
                            <td className={`py-1 text-right pr-2 font-medium w-28 ${item.amount < 0 ? "text-rose-600" : "text-slate-800"}`}>
                                {item.amount < 0 ? `(${fmt(item.amount)})` : fmt(item.amount)}
                            </td>
                        </tr>
                    ))}
                    <tr className={`${bgColor} print:bg-transparent font-bold border-t-2 border-slate-300`}>
                        <td colSpan={2} className="py-1.5 pl-3 text-slate-800">
                            Total {title}
                        </td>
                        <td className="py-1.5 text-right pr-2 text-slate-900">{fmt(total)}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

function liveRowsToSections(rows: BsLiveRow[], accountType: string) {
    const filtered = rows.filter((r) => r.account_type === accountType);
    const grouped = groupByReportGroup(
        filtered.map((r) => ({
            code: r.account_code,
            name: formatAccountRowLabel(r.account_name, r.account_code),
            amount: r.closing_balance,
            reportGroup: r.report_group,
        })),
    );
    return grouped.map((g) => ({
        title: humanizeReportGroup(g.group),
        items: g.items.map((i) => ({ code: i.code, name: i.name, amount: i.amount })),
        total: g.items.reduce((s, i) => s + i.amount, 0),
    }));
}

export default function BalanceSheetReport() {
    const today = new Date().toISOString().split("T")[0];
    const [asOfDate, setAsOfDate] = useState(today);
    const [show, setShow] = useState(false);
    const [liveRows, setLiveRows] = useState<BsLiveRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const useMock = !isErpLiveMode();

    const cashBankTotal = BS_DATA.assets.cashBank.reduce((s, i) => s + i.amount, 0);
    const receivablesTotal = BS_DATA.assets.receivables.reduce((s, i) => s + i.amount, 0);
    const inventoryTotal = BS_DATA.assets.inventory.reduce((s, i) => s + i.amount, 0);
    const totalAssets = liveRows.length
        ? liveRows.filter((r) => r.account_type === "asset").reduce((s, r) => s + r.closing_balance, 0)
        : useMock
          ? cashBankTotal + receivablesTotal + inventoryTotal
          : 0;

    const totalLiabilities = liveRows.length
        ? liveRows.filter((r) => r.account_type === "liability").reduce((s, r) => s + r.closing_balance, 0)
        : useMock
          ? BS_DATA.liabilities.reduce((s, i) => s + i.amount, 0)
          : 0;
    const totalEquity = liveRows.length
        ? liveRows.filter((r) => r.account_type === "equity").reduce((s, r) => s + r.closing_balance, 0)
        : useMock
          ? BS_DATA.equity.reduce((s, i) => s + i.amount, 0) + BS_DATA.netProfitCurrentPeriod
          : 0;
    const totalLiabEquity = totalLiabilities + totalEquity;
    const balanceVariance = reportBalanceVariance(totalAssets, totalLiabEquity);
    const balanced = isReportBalanced(totalAssets, totalLiabEquity);

    const assetSections = liveRows.length ? liveRowsToSections(liveRows, "asset") : [];
    const liabilitySections = liveRows.length ? liveRowsToSections(liveRows, "liability") : [];
    const equitySections = liveRows.length ? liveRowsToSections(liveRows, "equity") : [];

    const handleGenerate = async () => {
        setShow(true);
        setError(null);
        if (useMock) {
            setLiveRows([]);
            return;
        }
        setLoading(true);
        try {
            const live = await fetchBalanceSheet(asOfDate);
            setLiveRows(
                live.map((r: Record<string, unknown>) => ({
                    account_code: String(r.account_code ?? ""),
                    account_name: String(r.account_name ?? r.account_code ?? ""),
                    account_type: String(r.account_type ?? ""),
                    report_group: String(r.report_group ?? "other"),
                    closing_balance: Number(r.closing_balance ?? 0),
                })),
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load balance sheet.";
            setError(message);
            setLiveRows([]);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const hasData = useMock || liveRows.length > 0;

    return (
        <div className="space-y-4">
            <ReportPrintControls
                actions={show && !loading && !error && hasData ? <ReportPrintButton /> : null}
            >
                <ReportFilterField label="As of Date">
                    <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="h-8 text-sm w-36" />
                </ReportFilterField>
                <Button className="bg-blue-600 hover:bg-blue-700 h-8 text-sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? "Loading…" : "Generate Balance Sheet"}
                </Button>
            </ReportPrintControls>

            <ReportLoadState
                loading={show && loading}
                error={show && !loading ? error : null}
                empty={show && !loading && !error && !hasData}
                emptyMessage="No balance sheet accounts with balances as of this date."
            />

            {show && !loading && !error && hasData && (
                <ReportPrintDocument
                    reportTitle="Balance Sheet"
                    subtitle="Statement of Financial Position"
                    asOfDate={asOfDate}
                    hierarchyLabel={liveRows.length ? "Sub Accounts (Leaf)" : "Master Account (Groups)"}
                >
                    <ReportPrintBanner tone={balanced ? "success" : "error"}>
                        {balanced ? (
                            <>
                                <CheckCircle className="h-4 w-4 shrink-0" />
                                Balance Sheet is balanced. Assets = Liabilities + Equity
                            </>
                        ) : (
                            <>
                                <XCircle className="h-4 w-4 shrink-0" />
                                Imbalance detected — variance ₨ {Math.abs(balanceVariance).toLocaleString()} (tolerance ±0.5)
                            </>
                        )}
                    </ReportPrintBanner>

                    <div className="report-print-two-col grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="border-r border-slate-200 pr-6">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3 border-b-2 border-slate-800 pb-1">Assets</h3>
                            {liveRows.length ? (
                                assetSections.map((sec) => (
                                    <BSSection key={sec.title} title={sec.title} items={sec.items} total={sec.total} color="blue" />
                                ))
                            ) : useMock ? (
                                <>
                                    <BSSection title="Cash & Bank (11100)" items={BS_DATA.assets.cashBank} total={cashBankTotal} color="blue" />
                                    <BSSection title="Trade Receivables (11200)" items={BS_DATA.assets.receivables} total={receivablesTotal} color="blue" />
                                    <BSSection title="Inventory Assets (12000)" items={BS_DATA.assets.inventory} total={inventoryTotal} color="blue" />
                                </>
                            ) : null}
                            <div className="mt-3 pt-2 border-t-2 border-slate-800 flex justify-between font-bold text-sm">
                                <span>TOTAL ASSETS</span>
                                <span className="text-blue-800">{fmt(totalAssets)}</span>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3 border-b-2 border-slate-800 pb-1">Liabilities & Equity</h3>
                            {liveRows.length ? (
                                <>
                                    {liabilitySections.map((sec) => (
                                        <BSSection key={`l-${sec.title}`} title={sec.title} items={sec.items} total={sec.total} color="rose" />
                                    ))}
                                    {equitySections.map((sec) => (
                                        <BSSection key={`e-${sec.title}`} title={sec.title} items={sec.items} total={sec.total} color="emerald" />
                                    ))}
                                </>
                            ) : useMock ? (
                                <>
                                    <BSSection title="Trade Payables (21100)" items={BS_DATA.liabilities} total={totalLiabilities} color="rose" />
                                    <BSSection
                                        title="Capital & Equity (30000)"
                                        items={[
                                            ...BS_DATA.equity,
                                            { code: "32002", name: "Net Profit — Current Period", amount: BS_DATA.netProfitCurrentPeriod },
                                        ]}
                                        total={totalEquity}
                                        color="emerald"
                                    />
                                </>
                            ) : null}
                            <div className="mt-3 pt-2 border-t-2 border-slate-800 flex justify-between font-bold text-sm">
                                <span>TOTAL LIAB. + EQUITY</span>
                                <span className={balanced ? "text-emerald-700" : "text-rose-700"}>{fmt(totalLiabEquity)}</span>
                            </div>
                        </div>
                    </div>
                </ReportPrintDocument>
            )}
        </div>
    );
}
