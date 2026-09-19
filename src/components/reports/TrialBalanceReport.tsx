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
    ReportTable,
    ReportFilterField,
    ReportAmount,
} from "./ReportPrintPage";
import { ReportLoadState } from "./ReportLoadState";
import { fetchTrialBalance } from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import { isReportBalanced, reportBalanceVariance } from "@/lib/reportBalance";
import { formatAccountRowLabel } from "@/lib/reportAccountDisplay";

const TRIAL_ACCOUNTS = [
    { code: "11101", name: "Main Factory Cash Drawer", debit: 125000, credit: 0 },
    { code: "11102", name: "Meezan Bank", debit: 1340000, credit: 0 },
    { code: "11201", name: "A/R - Customers (Anchor)", debit: 2100000, credit: 0 },
    { code: "21101", name: "A/P - Vendors (Anchor)", debit: 0, credit: 1450000 },
    { code: "41001", name: "Direct Wire Sales", debit: 0, credit: 8500000 },
    { code: "51001", name: "Raw Material Consumed", debit: 5200000, credit: 0 },
];

export default function TrialBalanceReport() {
    const today = new Date().toISOString().split("T")[0];
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    const [dateFrom, setDateFrom] = useState(firstOfMonth);
    const [dateTo, setDateTo] = useState(today);
    const [show, setShow] = useState(false);
    const useMock = !isErpLiveMode();
    const [rows, setRows] = useState(useMock ? TRIAL_ACCOUNTS : []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const totalDebits = rows.reduce((s, a) => s + a.debit, 0);
    const totalCredits = rows.reduce((s, a) => s + a.credit, 0);
    const balanceVariance = reportBalanceVariance(totalDebits, totalCredits);
    const balanced = isReportBalanced(totalDebits, totalCredits);
    const hasData = useMock ? rows.length > 0 : rows.length > 0;

    const handleGenerate = async () => {
        setShow(true);
        setError(null);
        if (useMock) {
            setRows(TRIAL_ACCOUNTS);
            return;
        }
        setLoading(true);
        try {
            const live = await fetchTrialBalance(dateFrom, dateTo);
            setRows(
                live.map((r: Record<string, unknown>) => ({
                    code: String(r.account_code ?? ""),
                    name: formatAccountRowLabel(String(r.account_name ?? ""), String(r.account_code ?? "")),
                    debit: Number(r.total_debit ?? 0),
                    credit: Number(r.total_credit ?? 0),
                })),
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load trial balance.";
            setError(message);
            setRows([]);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <ReportPrintControls
                actions={show && !loading && !error && hasData ? <ReportPrintButton /> : null}
            >
                <ReportFilterField label="From">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-sm w-36" />
                </ReportFilterField>
                <ReportFilterField label="To">
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-sm w-36" />
                </ReportFilterField>
                <Button className="bg-blue-600 hover:bg-blue-700 h-8 text-sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? "Loading…" : "Generate Trial Balance"}
                </Button>
            </ReportPrintControls>

            <ReportLoadState
                loading={show && loading}
                error={show && !loading ? error : null}
                empty={show && !loading && !error && !hasData}
                emptyMessage="No GL postings in this period."
            />

            {show && !loading && !error && hasData && (
                <ReportPrintDocument
                    reportTitle="Trial Balance"
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    hierarchyLabel="Sub Accounts (Leaf)"
                    density="compact"
                >
                    <ReportPrintBanner tone={balanced ? "success" : "error"}>
                        {balanced ? (
                            <>
                                <CheckCircle className="h-4 w-4 shrink-0" />
                                Trial Balance checks out. Total Debits = Total Credits
                            </>
                        ) : (
                            <>
                                <XCircle className="h-4 w-4 shrink-0" />
                                Imbalance — variance ₨ {Math.abs(balanceVariance).toLocaleString()} (tolerance ±0.5)
                            </>
                        )}
                    </ReportPrintBanner>
                    <ReportTable compact className="min-w-[640px]">
                        <thead>
                            <tr>
                                <th>Code</th>
                                <th>Account Name</th>
                                <th className="text-right">Debit (₨)</th>
                                <th className="text-right">Credit (₨)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((acc) => (
                                <tr key={acc.code}>
                                    <td className="font-mono text-slate-600">{acc.code}</td>
                                    <td>{acc.name}</td>
                                    <td className="text-right"><ReportAmount value={acc.debit} showZero /></td>
                                    <td className="text-right"><ReportAmount value={acc.credit} showZero /></td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="report-row-total">
                                <td colSpan={2}>TOTALS</td>
                                <td className="text-right"><ReportAmount value={totalDebits} showZero /></td>
                                <td className="text-right"><ReportAmount value={totalCredits} showZero /></td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
