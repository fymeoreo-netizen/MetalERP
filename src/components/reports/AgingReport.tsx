import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportTable,
    ReportKpiGrid,
} from "./ReportPrintPage";
import { ReportLoadState } from "./ReportLoadState";
import { differenceInDays, parseISO } from "date-fns";
import { fetchApAging, fetchArAging } from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";

const fmt = (n: number) => (n > 0 ? `₨ ${n.toLocaleString()}` : "—");

const AGING_DATA = [
    { party: "Alpha Cables (Customer)", invoices: [
        { ref: "SI-26-001", date: "2026-04-28", amount: 120000 },
        { ref: "SI-26-004", date: "2026-03-15", amount: 80000 },
        { ref: "SI-26-007", date: "2026-02-10", amount: 55000 },
    ]},
    { party: "Gateway Motors (Customer)", invoices: [
        { ref: "SI-26-003", date: "2026-05-01", amount: 200000 },
        { ref: "SI-26-005", date: "2026-03-28", amount: 95000 },
    ]},
    { party: "Gamma Scrap (Vendor)", invoices: [
        { ref: "PI-26-002", date: "2026-04-01", amount: 150000 },
        { ref: "PI-26-005", date: "2026-01-20", amount: 300000 },
    ]},
];

function bucketAmount(invoices: { date: string; amount: number }[], today: Date) {
    const buckets = { b30: 0, b60: 0, b90: 0, b90plus: 0, total: 0 };
    invoices.forEach(inv => {
        const age = differenceInDays(today, parseISO(inv.date));
        buckets.total += inv.amount;
        if (age <= 30) buckets.b30 += inv.amount;
        else if (age <= 60) buckets.b60 += inv.amount;
        else if (age <= 90) buckets.b90 += inv.amount;
        else buckets.b90plus += inv.amount;
    });
    return buckets;
}

export default function AgingReport() {
    const [show, setShow] = useState(false);
    const today = new Date();
    const [rows, setRows] = useState<{ party: string; b30: number; b60: number; b90: number; b90plus: number; total: number }[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const useMock = !isErpLiveMode();

    const fallbackRows = useMock ? AGING_DATA.map(p => ({ party: p.party, ...bucketAmount(p.invoices, today) })) : [];
    const effectiveRows = useMock ? (rows.length ? rows : fallbackRows) : rows;
    const totals = effectiveRows.reduce((acc, r) => ({
        b30: acc.b30 + r.b30, b60: acc.b60 + r.b60, b90: acc.b90 + r.b90, b90plus: acc.b90plus + r.b90plus, total: acc.total + r.total
    }), { b30: 0, b60: 0, b90: 0, b90plus: 0, total: 0 });

    const handleGenerate = async () => {
        setShow(true);
        setError(null);
        if (useMock) {
            setRows([]);
            return;
        }
        setLoading(true);
        try {
            const [ar, ap] = await Promise.all([fetchArAging(), fetchApAging()]);
            const bucketed: Record<string, { b30: number; b60: number; b90: number; b90plus: number; total: number }> = {};
            [...ar, ...ap].forEach((r: any) => {
                const key = r.party_name as string;
                if (!bucketed[key]) bucketed[key] = { b30: 0, b60: 0, b90: 0, b90plus: 0, total: 0 };
                const amt = Number(r.open_amount ?? 0);
                bucketed[key].total += amt;
                if (r.aging_bucket === "0_30") bucketed[key].b30 += amt;
                else if (r.aging_bucket === "31_60") bucketed[key].b60 += amt;
                else if (r.aging_bucket === "61_90") bucketed[key].b90 += amt;
                else bucketed[key].b90plus += amt;
            });
            setRows(Object.entries(bucketed).map(([party, v]) => ({ party, ...v })));
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load aging report.";
            setError(message);
            setRows([]);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const hasData = effectiveRows.length > 0;

    return (
        <div className="space-y-4">
            <ReportPrintControls
                actions={show && !loading && !error && hasData ? <ReportPrintButton /> : null}
            >
                <Button className="bg-blue-600 hover:bg-blue-700 h-8 text-sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? "Loading…" : "Generate Aging Report"}
                </Button>
            </ReportPrintControls>

            <ReportLoadState
                loading={show && loading}
                error={show && !loading ? error : null}
                empty={show && !loading && !error && !hasData}
                emptyMessage="No outstanding AR/AP balances to age."
            />

            {show && !loading && !error && hasData && (
                <ReportPrintDocument
                    reportTitle="Aging Report"
                    subtitle="Customer & Supplier Outstanding Analysis"
                    asOfDate={today.toISOString().split("T")[0]}
                    hierarchyLabel="Sub Accounts (Leaf)"
                    density="compact"
                >
                    <ReportKpiGrid
                        columns={4}
                        items={[
                            { label: "0–30 Days", value: fmt(totals.b30) },
                            { label: "31–60 Days", value: fmt(totals.b60) },
                            { label: "61–90 Days", value: fmt(totals.b90) },
                            { label: "90+ Days", value: fmt(totals.b90plus) },
                        ]}
                    />
                    <ReportTable compact className="min-w-[640px]">
                        <thead>
                            <tr>
                                <th>Party / Account</th>
                                <th className="text-right">0–30 Days</th>
                                <th className="text-right">31–60 Days</th>
                                <th className="text-right">61–90 Days</th>
                                <th className="text-right">90+ Days</th>
                                <th className="text-right">Total Outstanding</th>
                            </tr>
                        </thead>
                        <tbody>
                            {effectiveRows.map((r) => (
                                <tr key={r.party}>
                                    <td className="font-semibold">{r.party}</td>
                                    <td className="text-right">{fmt(r.b30)}</td>
                                    <td className="text-right">{fmt(r.b60)}</td>
                                    <td className="text-right">{fmt(r.b90)}</td>
                                    <td className="text-right font-semibold">{fmt(r.b90plus)}</td>
                                    <td className="text-right font-bold">₨ {r.total.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="report-row-total">
                                <td>TOTALS</td>
                                <td className="text-right">{fmt(totals.b30)}</td>
                                <td className="text-right">{fmt(totals.b60)}</td>
                                <td className="text-right">{fmt(totals.b90)}</td>
                                <td className="text-right">{fmt(totals.b90plus)}</td>
                                <td className="text-right">₨ {totals.total.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
