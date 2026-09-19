import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportTable,
} from "./ReportPrintPage";
import { fetchParchis } from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";

type ParchiRow = {
    id: string;
    party: string;
    issued: string;
    due: string;
    total: number;
    cleared: number;
    balance: number;
    status: string;
};

const MOCK_ROWS: ParchiRow[] = [
    { id: "P-105", party: "Alpha Cables (Customer)", issued: "2026-05-01", due: "2026-05-15", total: 500000, cleared: 200000, balance: 300000, status: "Pending" },
    { id: "P-106", party: "Alpha Cables (Customer)", issued: "2026-05-02", due: "2026-05-20", total: 100000, cleared: 0, balance: 100000, status: "Pending" },
];

const statusBadge = (s: string) => {
    if (s === "Cleared") return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">Cleared</Badge>;
    if (s === "Pending") return <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">Pending</Badge>;
    return <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">Partially Cleared</Badge>;
};

function mapParchiStatus(status: string): string {
    if (status === "cleared") return "Cleared";
    if (status === "partial") return "Partially Cleared";
    return "Pending";
}

export default function ParchiLedgerReport() {
    const [statusFilter, setStatusFilter] = useState("All");
    const [show, setShow] = useState(false);
    const [rows, setRows] = useState<ParchiRow[]>([]);
    const [loading, setLoading] = useState(false);

    const handleGenerate = async () => {
        setLoading(true);
        setShow(true);
        try {
            if (isErpLiveMode()) {
                const live = await fetchParchis();
                setRows(
                    live.map((p: any) => ({
                        id: p.parchi_no,
                        party: p.parties?.name ?? "Unknown",
                        issued: p.issue_date,
                        due: p.due_date ?? "—",
                        total: Number(p.total_amount ?? 0),
                        cleared: Number(p.cleared_amount ?? 0),
                        balance: Number(p.open_amount ?? 0),
                        status: mapParchiStatus(String(p.status ?? "open")),
                    }))
                );
            } else {
                setRows(MOCK_ROWS);
            }
        } finally {
            setLoading(false);
        }
    };

    const filtered = rows.filter((p) => statusFilter === "All" || p.status === statusFilter);
    const totalBalance = filtered.reduce((s, p) => s + p.balance, 0);

    return (
        <div className="space-y-4">
            <ReportPrintControls>
                <div className="space-y-1">
                    <Label className="text-xs">Filter by Status</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="h-8 text-sm w-48 bg-white">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="All">All Parchis</SelectItem>
                            <SelectItem value="Pending">Pending Only</SelectItem>
                            <SelectItem value="Partially Cleared">Partially Cleared Only</SelectItem>
                            <SelectItem value="Cleared">Cleared Only</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Button className="bg-blue-600 hover:bg-blue-700 h-8 text-sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? "Loading..." : "Generate Parchi Ledger"}
                </Button>
                {show && <ReportPrintButton />}
            </ReportPrintControls>

            {show && (
                <ReportPrintDocument
                    reportTitle="Parchi Ledger"
                    subtitle={`Status filter: ${statusFilter}`}
                    hierarchyLabel="Sub Accounts (Leaf)"
                >
                    <ReportTable className="min-w-[720px]">
                        <thead>
                            <tr className="bg-slate-100 border-b-2 border-slate-800">
                                <th className="py-2 px-2 text-left font-bold text-slate-800">Parchi ID</th>
                                <th className="py-2 px-2 text-left font-bold text-slate-800">Party</th>
                                <th className="py-2 px-2 text-center font-bold text-slate-800">Issue Date</th>
                                <th className="py-2 px-2 text-center font-bold text-slate-800">Due Date</th>
                                <th className="py-2 px-2 text-right font-bold text-slate-800">Total Amt</th>
                                <th className="py-2 px-2 text-right font-bold text-slate-800">Cleared</th>
                                <th className="py-2 px-2 text-right font-bold text-slate-800">Avail Balance</th>
                                <th className="py-2 px-2 text-center font-bold text-slate-800">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((p, i) => (
                                <tr key={p.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
                                    <td className="py-1.5 px-2 font-mono font-semibold text-slate-700">{p.id}</td>
                                    <td className="py-1.5 px-2 font-medium text-slate-800">{p.party}</td>
                                    <td className="py-1.5 px-2 text-center text-slate-600">{p.issued}</td>
                                    <td className="py-1.5 px-2 text-center text-slate-600">{p.due}</td>
                                    <td className="py-1.5 px-2 text-right text-slate-800">₨ {p.total.toLocaleString()}</td>
                                    <td className="py-1.5 px-2 text-right text-emerald-600">₨ {p.cleared.toLocaleString()}</td>
                                    <td className="py-1.5 px-2 text-right font-bold text-blue-800">₨ {p.balance.toLocaleString()}</td>
                                    <td className="py-1.5 px-2 text-center">{statusBadge(p.status)}</td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="py-8 text-center text-slate-500">
                                        No parchi records found for this filter.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-100 border-t-2 border-slate-800 font-bold print:bg-transparent">
                                <td colSpan={6} className="py-2 px-2 uppercase tracking-wider text-right">
                                    Total Outstanding Balance:
                                </td>
                                <td className="py-2 px-2 text-right text-blue-900">₨ {totalBalance.toLocaleString()}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </ReportTable>
                </ReportPrintDocument>
            )}
        </div>
    );
}
