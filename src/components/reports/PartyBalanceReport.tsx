import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Download, Scale } from "lucide-react";
import { toast } from "sonner";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportFilterField,
    ReportKpiGrid,
} from "./ReportPrintPage";
import { ReportLoadState } from "./ReportLoadState";
import { fetchPartyBalanceSnapshot } from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import { TableScroller } from "@/components/ui/responsive-primitives";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SnapshotRow = {
    party_code: string;
    party_name: string;
    party_type: string;
    fin_balance_pkr: number;
    status: string;
};

type PartyTypeFilter = "all" | "customer" | "vendor" | "both";
type StatusFilter = "all" | "Receivable" | "Payable" | "Settled";

type BalanceSection = {
    label: string;
    rows: SnapshotRow[];
};

const fmtAmount = (n: number) => Math.round(Math.abs(n)).toLocaleString();

const fmtNetBalance = (receivable: number, payable: number) => {
    const net = receivable - payable;
    return net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function sectionTotals(rows: SnapshotRow[]) {
    return rows.reduce(
        (acc, r) => {
            const fin = Number(r.fin_balance_pkr ?? 0);
            if (fin > 0) acc.receivable += fin;
            if (fin < 0) acc.payable += Math.abs(fin);
            return acc;
        },
        { receivable: 0, payable: 0 },
    );
}

function buildSections(rows: SnapshotRow[], partyType: PartyTypeFilter): BalanceSection[] {
    const saleTypes = new Set(["customer", "both"]);
    const purchaseTypes = new Set(["vendor"]);

    const saleRows = rows
        .filter((r) => saleTypes.has(r.party_type))
        .sort((a, b) => a.party_name.localeCompare(b.party_name));
    const purchaseRows = rows
        .filter((r) => purchaseTypes.has(r.party_type))
        .sort((a, b) => a.party_name.localeCompare(b.party_name));

    if (partyType === "customer") return [{ label: "Sale Party", rows: saleRows }];
    if (partyType === "vendor") return [{ label: "Purchase Party", rows: purchaseRows }];
    if (partyType === "both") {
        return [
            {
                label: "Sale & Purchase Party",
                rows: [...rows].sort((a, b) => a.party_name.localeCompare(b.party_name)),
            },
        ];
    }

    const sections: BalanceSection[] = [];
    if (saleRows.length > 0) sections.push({ label: "Sale Party", rows: saleRows });
    if (purchaseRows.length > 0) sections.push({ label: "Purchase Party", rows: purchaseRows });
    return sections;
}

function PartyBalanceColgroup() {
    return (
        <colgroup>
            <col className="col-sn" />
            <col className="col-party" />
            <col className="col-amount" />
            <col className="col-amount" />
        </colgroup>
    );
}

function PartyBalanceTable({
    rows,
    onRowClick,
}: {
    rows: SnapshotRow[];
    onRowClick?: (code: string) => void;
}) {
    const totals = sectionTotals(rows);

    return (
        <div className="report-party-balance-block w-full min-w-[520px]">
            {/* Data table only — no tfoot (browsers repeat tfoot on every printed page). */}
            <TableScroller className="w-full">
                <Table noWrapper className="report-table report-table--compact report-party-balance-table w-full">
                    <PartyBalanceColgroup />
                    <thead>
                        <tr>
                            <th className="col-sn">S#</th>
                            <th className="col-party">Party</th>
                            <th className="col-amount text-right">Receivable (Dr.)</th>
                            <th className="col-amount text-right">Payable (Cr.)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => {
                            const fin = Number(r.fin_balance_pkr ?? 0);
                            const receivable = fin > 0 ? fin : 0;
                            const payable = fin < 0 ? Math.abs(fin) : 0;
                            return (
                                <tr
                                    key={r.party_code}
                                    className={cn(onRowClick && "cursor-pointer")}
                                    onClick={onRowClick ? () => onRowClick(r.party_code) : undefined}
                                >
                                    <td className="col-sn text-slate-500 tabular-nums">{i + 1}</td>
                                    <td className="col-party font-medium text-slate-800">{r.party_name}</td>
                                    <td className="col-amount text-right tabular-nums text-slate-800">
                                        {receivable > 0 ? fmtAmount(receivable) : "—"}
                                    </td>
                                    <td className="col-amount text-right tabular-nums text-slate-800">
                                        {payable > 0 ? fmtAmount(payable) : "—"}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            </TableScroller>

            {/* Separate summary table (2 rows) — cannot paginate/repeat as a page footer. */}
            <Table noWrapper className="report-table report-table--compact report-party-balance-table report-party-balance-summary w-full">
                <PartyBalanceColgroup />
                <tbody>
                    <tr className="report-party-balance-total">
                        <td className="col-sn" />
                        <td className="col-party font-bold uppercase tracking-wide text-slate-900">Total</td>
                        <td className="col-amount text-right font-bold tabular-nums text-slate-900">
                            {fmtAmount(totals.receivable)}
                        </td>
                        <td className="col-amount text-right font-bold tabular-nums text-slate-900">
                            {fmtAmount(totals.payable)}
                        </td>
                    </tr>
                    <tr className="report-party-balance-net">
                        <td className="col-sn" />
                        <td className="col-party font-semibold text-slate-700">Net balance</td>
                        <td className="col-amount text-right font-bold tabular-nums text-blue-800" colSpan={2}>
                            ₨ {fmtNetBalance(totals.receivable, totals.payable)}
                        </td>
                    </tr>
                </tbody>
            </Table>
        </div>
    );
}

export default function PartyBalanceReport() {
    const navigate = useNavigate();
    const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
    const [partyType, setPartyType] = useState<PartyTypeFilter>("all");
    const [status, setStatus] = useState<StatusFilter>("all");
    const [search, setSearch] = useState("");
    const [rows, setRows] = useState<SnapshotRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shown, setShown] = useState(false);
    const liveMode = isErpLiveMode();

    const refresh = async () => {
        setShown(true);
        setError(null);
        if (!liveMode) {
            setRows([]);
            return;
        }
        setLoading(true);
        try {
            const data = await fetchPartyBalanceSnapshot(asOf);
            setRows((data as SnapshotRow[]) ?? []);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load party balance snapshot.";
            setError(message);
            setRows([]);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (liveMode) void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveMode]);

    const filtered = useMemo(() => {
        return rows.filter((r) => {
            if (partyType !== "all" && r.party_type !== partyType) return false;
            if (status !== "all" && r.status !== status) return false;
            if (search) {
                const q = search.toLowerCase();
                if (!r.party_code.toLowerCase().includes(q) && !r.party_name.toLowerCase().includes(q)) return false;
            }
            const fin = Number(r.fin_balance_pkr ?? 0);
            if (status === "all" && Math.abs(fin) < 0.005) return false;
            return true;
        });
    }, [rows, partyType, status, search]);

    const sections = useMemo(() => buildSections(filtered, partyType), [filtered, partyType]);

    const grandTotals = useMemo(() => sectionTotals(filtered), [filtered]);

    const hasReportData = sections.some((s) => s.rows.length > 0);

    const handleExportCsv = () => {
        const lines: string[] = ["Section,S#,Party,Receiveable(Dr.),Payable(Cr.)"];
        for (const section of sections) {
            const totals = sectionTotals(section.rows);
            section.rows.forEach((r, i) => {
                const fin = Number(r.fin_balance_pkr ?? 0);
                const receivable = fin > 0 ? Math.round(fin) : "";
                const payable = fin < 0 ? Math.round(Math.abs(fin)) : "";
                lines.push(
                    [
                        `"${section.label}"`,
                        i + 1,
                        `"${(r.party_name ?? "").replace(/"/g, '""')}"`,
                        receivable,
                        payable,
                    ].join(","),
                );
            });
            lines.push(
                [
                    `"${section.label}"`,
                    "",
                    "TOTAL",
                    Math.round(totals.receivable),
                    Math.round(totals.payable),
                ].join(","),
            );
            lines.push(
                [
                    `"${section.label}"`,
                    "",
                    "NET BALANCE",
                    "",
                    fmtNetBalance(totals.receivable, totals.payable),
                ].join(","),
            );
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `parties_balance_${asOf}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const openLedger = (code: string) => {
        navigate(`/reports?report=unified-ledgers&party=${encodeURIComponent(code)}`);
    };

    return (
        <div className="space-y-4">
            <ReportPrintControls
                className="flex-wrap"
                actions={
                    shown && hasReportData ? (
                        <>
                            <Button variant="outline" className="h-8 text-sm" onClick={handleExportCsv}>
                                <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                            </Button>
                            <ReportPrintButton />
                        </>
                    ) : null
                }
            >
                <ReportFilterField label="As of">
                    <Input
                        type="date"
                        value={asOf}
                        onChange={(e) => setAsOf(e.target.value)}
                        className="h-8 w-40 text-sm"
                    />
                </ReportFilterField>
                <ReportFilterField label="Party Type">
                    <Select value={partyType} onValueChange={(v) => setPartyType(v as PartyTypeFilter)}>
                        <SelectTrigger className="h-8 w-36 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="customer">Customer</SelectItem>
                            <SelectItem value="vendor">Vendor</SelectItem>
                            <SelectItem value="both">Both</SelectItem>
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <ReportFilterField label="Status">
                    <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                        <SelectTrigger className="h-8 w-36 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="Receivable">Receivable</SelectItem>
                            <SelectItem value="Payable">Payable</SelectItem>
                            <SelectItem value="Settled">Settled</SelectItem>
                        </SelectContent>
                    </Select>
                </ReportFilterField>
                <ReportFilterField label="Search" className="flex-1 min-w-[200px]">
                    <Input
                        placeholder="Code or name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 text-sm"
                    />
                </ReportFilterField>
                <Button
                    onClick={() => void refresh()}
                    className="bg-blue-600 hover:bg-blue-700 h-8 text-sm"
                    disabled={loading}
                >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                    {loading ? "Loading..." : "Generate"}
                </Button>
            </ReportPrintControls>

            {!liveMode && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Live ERP mode is not active. Party balance snapshot requires a Supabase backend session.
                </div>
            )}

            <ReportLoadState
                loading={shown && loading}
                error={shown && !loading && liveMode ? error : null}
                empty={shown && !loading && !error && liveMode && !hasReportData}
                emptyMessage="No parties with outstanding balances match the selected filters."
            />

            {shown && !loading && !error && hasReportData && (
                <ReportPrintDocument
                    reportTitle="Parties Balance Report"
                    subtitle="Outstanding receivable and payable by party"
                    asOfDate={asOf}
                    density="compact"
                    className="report-party-balance-doc"
                >
                    <ReportKpiGrid
                        columns={3}
                        items={[
                            {
                                label: "Receivable (Dr.)",
                                value: `₨ ${fmtAmount(grandTotals.receivable)}`,
                            },
                            {
                                label: "Payable (Cr.)",
                                value: `₨ ${fmtAmount(grandTotals.payable)}`,
                            },
                            {
                                label: "Net balance",
                                value: `₨ ${fmtNetBalance(grandTotals.receivable, grandTotals.payable)}`,
                            },
                        ]}
                    />

                    {sections.map((section) => (
                        <section key={section.label} className="report-party-balance-section mb-8 print:mb-5">
                            <div className="mb-3 flex items-end justify-between gap-3 print:mb-1.5">
                                <h3 className="inline-block border-b-2 border-blue-800 pb-0.5 text-sm font-bold uppercase tracking-wide text-slate-800 print:border-black print:text-[10pt]">
                                    {section.label}
                                </h3>
                                <span className="text-[11px] tabular-nums text-slate-500 print:text-[8pt]">
                                    {section.rows.length} part{section.rows.length === 1 ? "y" : "ies"}
                                </span>
                            </div>
                            <PartyBalanceTable rows={section.rows} onRowClick={openLedger} />
                        </section>
                    ))}

                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 erp-no-print">
                        <Scale className="h-3.5 w-3.5" />
                        Click any row to open the party ledger. As of{" "}
                        {format(new Date(asOf), "dd MMM yyyy")}.
                    </p>
                </ReportPrintDocument>
            )}
        </div>
    );
}
