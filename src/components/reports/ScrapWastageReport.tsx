import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportSectionTitle,
    ReportTable,
} from "./ReportPrintPage";
import {
    fetchFactoryScrapDispatchRegister,
    fetchMachineProductionReport,
    fetchMachineScrapLedger,
    fetchScrapWastage,
} from "@/lib/repositories/reportsRepo";
import type {
    FactoryScrapDispatchRegisterRow,
    MachineScrapLedgerRow,
} from "@/lib/api/scrap";
import type { MachineProductionSummaryRow } from "@/lib/api/production";
import { isErpLiveMode } from "@/lib/backendFlags";
import { useToast } from "@/components/ui/use-toast";

function reportDefaultRange() {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    return { from: firstOfMonth, to: endOfMonth };
}

type MachineSummaryRow = {
    machineId: string;
    department: string;
    machineCode: string;
    machineName: string;
    scrapItemCode: string;
    inputKg: number;
    outputKg: number;
    scrapKg: number;
    scrapPct: number;
    standardPct: number;
    overLimit: boolean;
};

type DispatchRow = {
    dispatchDate: string;
    dispatchNo: string;
    mode: string;
    vendorName: string;
    machines: string;
    departments: string;
    netWeight: number;
    unitRate: number;
    amount: number;
    expectedItemCode: string | null;
    returnedKg: number;
    expectedKg: number;
    obligationStatus: string | null;
};

type OtherMovementRow = {
    date: string;
    source: string;
    refNo: string;
    itemCode: string;
    scrapKg: number;
};

const DEMO_MACHINES: MachineSummaryRow[] = [
    {
        machineId: "1",
        department: "drawing",
        machineCode: "D1",
        machineName: "Drawing 1",
        scrapItemCode: "RM-SCP-DRAW",
        inputKg: 12000,
        outputKg: 11880,
        scrapKg: 120,
        scrapPct: 1.0,
        standardPct: 1,
        overLimit: false,
    },
    {
        machineId: "2",
        department: "enamel",
        machineCode: "E1",
        machineName: "Enamel 1",
        scrapItemCode: "RM-SCP-ENAM",
        inputKg: 8500,
        outputKg: 8330,
        scrapKg: 210,
        scrapPct: 2.47,
        standardPct: 2,
        overLimit: true,
    },
];

const DEMO_DISPATCHES: DispatchRow[] = [
    {
        dispatchDate: "2026-05-10",
        dispatchNo: "FSD-0001",
        mode: "toll",
        vendorName: "ABC Metals",
        machines: "D1, E1",
        departments: "drawing, enamel",
        netWeight: 330,
        unitRate: 0,
        amount: 0,
        expectedItemCode: "RM-W8-001",
        returnedKg: 0,
        expectedKg: 330,
        obligationStatus: "open",
    },
];

const DEMO_OTHER: OtherMovementRow[] = [
    { date: "2026-05-11", source: "scrap_trade", refNo: "SCRAP-2026-001", itemCode: "RM-SCP-001", scrapKg: 1500 },
];

function formatSourceLabel(source: string) {
    return source.replace(/_/g, " ");
}

function calculateScrapPct(scrapKg: number, inputKg: number) {
    if (inputKg <= 0) return 0;
    return Math.round((scrapKg / inputKg) * 10000) / 100;
}

export default function ScrapWastageReport() {
    const { toast } = useToast();
    const defaultRange = reportDefaultRange();
    const [dateFrom, setDateFrom] = useState(defaultRange.from);
    const [dateTo, setDateTo] = useState(defaultRange.to);
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(false);
    const [machineRows, setMachineRows] = useState<MachineSummaryRow[]>([]);
    const [dispatchRows, setDispatchRows] = useState<DispatchRow[]>([]);
    const [otherRows, setOtherRows] = useState<OtherMovementRow[]>([]);

    const totals = useMemo(() => {
        const factoryScrap = machineRows.reduce((s, r) => s + r.scrapKg, 0);
        const productionInput = machineRows.reduce((s, r) => s + r.inputKg, 0);
        const measuredScrap = machineRows.reduce(
            (s, r) => (r.inputKg > 0 ? s + r.scrapKg : s),
            0,
        );
        const unmeasuredScrap = factoryScrap - measuredScrap;
        const overLimit = machineRows.filter((r) => r.overLimit).length;
        const brokerKg = otherRows
            .filter((r) => r.source === "scrap_trade")
            .reduce((s, r) => s + r.scrapKg, 0);
        const returnKg = otherRows
            .filter((r) => r.source === "conversion_return")
            .reduce((s, r) => s + r.scrapKg, 0);
        const blendedPct = calculateScrapPct(measuredScrap, productionInput);
        const weightedStdNumerator = machineRows.reduce(
            (s, r) => (r.inputKg > 0 && r.standardPct > 0 ? s + r.inputKg * r.standardPct : s),
            0,
        );
        const weightedStdDenominator = machineRows.reduce(
            (s, r) => (r.inputKg > 0 && r.standardPct > 0 ? s + r.inputKg : s),
            0,
        );
        const weightedStandardPct =
            weightedStdDenominator > 0 ? weightedStdNumerator / weightedStdDenominator : 0;
        const noFactoryScrapDispatched = productionInput > 0 && factoryScrap <= 0;
        return {
            factoryScrap,
            productionInput,
            unmeasuredScrap,
            overLimit,
            brokerKg,
            returnKg,
            blendedPct,
            weightedStandardPct,
            noFactoryScrapDispatched,
        };
    }, [machineRows, otherRows]);

    const handleGenerate = async () => {
        setLoading(true);
        setShow(true);
        try {
            if (!isErpLiveMode()) {
                toast({
                    title: "Demo mode",
                    description: "Sign in with live ERP enabled to load posted factory scrap and production data.",
                    variant: "destructive",
                });
                setMachineRows([]);
                setDispatchRows([]);
                setOtherRows([]);
                return;
            }

            const [ledger, production, dispatches, scrapRows] = await Promise.all([
                fetchMachineScrapLedger({ from: dateFrom, to: dateTo }),
                fetchMachineProductionReport({ from: dateFrom, to: dateTo }),
                fetchFactoryScrapDispatchRegister(dateFrom, dateTo),
                fetchScrapWastage(dateFrom, dateTo),
            ]);

            const prodByMachine = new Map<string, MachineProductionSummaryRow>(
                production.map((p: MachineProductionSummaryRow) => [p.machine_id, p]),
            );

            const machines: MachineSummaryRow[] = ledger.map((l: MachineScrapLedgerRow) => {
                const prod = prodByMachine.get(l.machine_id);
                const inputKg = prod?.input_kg ?? 0;
                const scrapPct = calculateScrapPct(l.generated_kg, inputKg);
                return {
                    machineId: l.machine_id,
                    department: l.department,
                    machineCode: l.machine_code,
                    machineName: l.machine_name,
                    scrapItemCode: l.scrap_item_code,
                    inputKg,
                    outputKg: prod?.output_kg ?? 0,
                    scrapKg: l.generated_kg,
                    scrapPct,
                    standardPct: l.standard_pct,
                    overLimit: inputKg > 0 && l.standard_pct > 0 && scrapPct > l.standard_pct,
                };
            });

            for (const p of production) {
                if (machines.some((m) => m.machineId === p.machine_id)) continue;
                if (p.scrap_kg <= 0 && p.input_kg <= 0) continue;
                const scrapPct = calculateScrapPct(p.scrap_kg, p.input_kg);
                machines.push({
                    machineId: p.machine_id,
                    machineCode: p.machine_code,
                    machineName: p.machine_name,
                    department: p.department,
                    scrapItemCode: "—",
                    inputKg: p.input_kg,
                    outputKg: p.output_kg,
                    scrapKg: p.scrap_kg,
                    scrapPct,
                    standardPct: p.standard_pct,
                    overLimit: p.input_kg > 0 && p.standard_pct > 0 && scrapPct > p.standard_pct,
                });
            }

            machines.sort((a, b) => a.department.localeCompare(b.department) || a.machineCode.localeCompare(b.machineCode));

            setMachineRows(machines);
            setDispatchRows(
                dispatches
                    .filter((d: FactoryScrapDispatchRegisterRow) => d.status === "posted")
                    .map((d: FactoryScrapDispatchRegisterRow) => ({
                        dispatchDate: d.dispatch_date,
                        dispatchNo: d.dispatch_no,
                        mode: d.mode,
                        vendorName: d.vendor_name,
                        machines: d.machines,
                        departments: d.departments,
                        netWeight: d.net_weight,
                        unitRate: d.unit_rate,
                        amount: d.amount,
                        expectedItemCode: d.expected_item_code,
                        returnedKg: d.returned_kg,
                        expectedKg: d.expected_kg,
                        obligationStatus: d.obligation_status,
                    })),
            );

            const others: OtherMovementRow[] = [];
            for (const r of scrapRows as Array<{
                source?: string;
                posting_date?: string;
                item_code?: string;
                scrap_kg?: number;
                trade_no?: string;
            }>) {
                const source = String(r.source ?? "");
                if (source !== "scrap_trade" && source !== "conversion_return") continue;
                others.push({
                    date: String(r.posting_date ?? ""),
                    source,
                    refNo: String(r.trade_no ?? "—"),
                    itemCode: String(r.item_code ?? ""),
                    scrapKg: Number(r.scrap_kg ?? 0),
                });
            }
            setOtherRows(others);
        } catch (e) {
            toast({
                title: "Report failed",
                description: e instanceof Error ? e.message : "Could not load scrap wastage.",
                variant: "destructive",
            });
            setShow(false);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <ReportPrintControls className="flex-wrap">
                <div className="space-y-1">
                    <Label className="text-xs">From</Label>
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-sm w-36" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs">To</Label>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-sm w-36" />
                </div>
                <Button className="bg-blue-600 hover:bg-blue-700 h-8 text-sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
                {show && !loading && <ReportPrintButton />}
            </ReportPrintControls>

            {show && !loading && (
                <ReportPrintDocument
                    reportTitle="Scrap & Wastage Report"
                    subtitle="Factory scrap by machine, vendor dispatches, and broker movements"
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                >
                    <section className="mb-6">
                        {totals.noFactoryScrapDispatched && (
                            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 erp-no-print">
                                No factory scrap dispatched in this period — scrap kg on this report comes from
                                posted Factory Scrap dispatches only. Post scrap on the Factory Scrap screen to
                                populate scrap kg and over-limit status.
                            </div>
                        )}
                        {totals.unmeasuredScrap > 0 && (
                            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 erp-no-print">
                                {totals.unmeasuredScrap.toLocaleString()} kg of scrap has no recorded production input
                                for this period. It is excluded from the blended percentage.
                            </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm border border-slate-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 bg-amber-50 border-b sm:border-b-0 sm:border-r border-slate-200">
                                <p className="text-xs text-slate-500 uppercase tracking-wide">Factory scrap sent</p>
                                <p className="text-xl font-bold text-amber-900">{totals.factoryScrap.toLocaleString()} kg</p>
                            </div>
                            <div className="px-4 py-3 bg-slate-50 border-b lg:border-b-0 lg:border-r border-slate-200">
                                <p className="text-xs text-slate-500 uppercase tracking-wide">Production input</p>
                                <p className="text-xl font-bold text-slate-900">{totals.productionInput.toLocaleString()} kg</p>
                            </div>
                            <div className="px-4 py-3 bg-slate-50 border-b sm:border-b-0 sm:border-r border-slate-200">
                                <p className="text-xs text-slate-500 uppercase tracking-wide">Blended scrap %</p>
                                <p
                                    className={`text-xl font-bold ${
                                        totals.weightedStandardPct > 0 && totals.blendedPct > totals.weightedStandardPct
                                            ? "text-rose-700"
                                            : "text-emerald-700"
                                    }`}
                                >
                                    {totals.blendedPct.toFixed(2)}%
                                </p>
                                {totals.weightedStandardPct > 0 && (
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Weighted limit {totals.weightedStandardPct.toFixed(2)}%
                                    </p>
                                )}
                            </div>
                            <div className="px-4 py-3 bg-slate-50">
                                <p className="text-xs text-slate-500 uppercase tracking-wide">Machines over limit</p>
                                <p className={`text-xl font-bold ${totals.overLimit > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                                    {totals.overLimit}
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="mb-8">
                        <ReportSectionTitle>Machine scrap summary</ReportSectionTitle>
                        <p className="text-xs text-slate-500 mb-2 erp-no-print">
                            Scrap recorded on Factory Scrap screen vs production input for the period. Scrap is sent to
                            vendors immediately — not held in warehouse stock.
                        </p>
                        <ReportTable className="min-w-[800px]">
                            <thead>
                                <tr className="bg-slate-100 border-b-2 border-slate-800">
                                    <th className="py-2 px-2 text-left font-bold">Dept</th>
                                    <th className="py-2 px-2 text-left font-bold">Machine</th>
                                    <th className="py-2 px-2 text-left font-bold">Scrap SKU</th>
                                    <th className="py-2 px-2 text-right font-bold">Input kg</th>
                                    <th className="py-2 px-2 text-right font-bold">Output kg</th>
                                    <th className="py-2 px-2 text-right font-bold text-amber-700">Scrap sent</th>
                                    <th className="py-2 px-2 text-right font-bold">Scrap %</th>
                                    <th className="py-2 px-2 text-right font-bold text-slate-400">Std %</th>
                                    <th className="py-2 px-2 text-center font-bold">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {machineRows.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="py-4 text-center text-slate-500">
                                            No factory scrap or production for this period.
                                        </td>
                                    </tr>
                                )}
                                {machineRows.map((r) => (
                                    <tr
                                        key={r.machineId}
                                        className={`border-b ${r.overLimit ? "bg-rose-50/60" : "border-slate-100"}`}
                                    >
                                        <td className="py-1.5 px-2 capitalize text-xs">{r.department}</td>
                                        <td className="py-1.5 px-2">
                                            <span className="font-mono text-xs">{r.machineCode}</span>
                                            <span className="text-slate-500 text-xs"> — {r.machineName}</span>
                                        </td>
                                        <td className="py-1.5 px-2 font-mono text-xs">{r.scrapItemCode}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{r.inputKg.toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{r.outputKg.toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right font-mono text-amber-700">{r.scrapKg.toLocaleString()}</td>
                                        <td
                                            className={`py-1.5 px-2 text-right font-mono font-semibold ${
                                                r.overLimit ? "text-rose-700" : "text-slate-800"
                                            }`}
                                        >
                                            {r.inputKg > 0 ? `${r.scrapPct.toFixed(2)}%` : "N/A"}
                                        </td>
                                        <td className="py-1.5 px-2 text-right font-mono text-slate-400">{r.standardPct}%</td>
                                        <td className="py-1.5 px-2 text-center">
                                            {r.inputKg <= 0 && r.scrapKg > 0 ? (
                                                <span className="text-amber-700 font-semibold text-xs">No input</span>
                                            ) : r.inputKg <= 0 && r.scrapKg <= 0 ? (
                                                <span className="text-slate-400 text-xs">—</span>
                                            ) : r.overLimit ? (
                                                <span className="text-rose-700 font-semibold text-xs inline-flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    Over
                                                </span>
                                            ) : (
                                                <span className="text-emerald-700 text-xs inline-flex items-center gap-1">
                                                    <CheckCircle className="h-3 w-3" />
                                                    OK
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </ReportTable>
                        <p className="text-xs text-slate-500 mt-3 erp-no-print">
                            Production batch scrap lines are not included here — post scrap on the Factory Scrap screen
                            for wastage kg and over-limit checks.
                        </p>
                    </section>

                    <section className="mb-8">
                        <ReportSectionTitle>Factory scrap sent to vendors</ReportSectionTitle>
                        <p className="text-xs text-slate-500 mb-2 erp-no-print">
                            Posted dispatches — toll conversion (expect Wire/Rod back) or outright sale.
                        </p>
                        <ReportTable className="min-w-[900px]">
                            <thead>
                                <tr className="bg-slate-100 border-b-2 border-slate-800">
                                    <th className="py-2 px-2 text-left font-bold">Date</th>
                                    <th className="py-2 px-2 text-left font-bold">Dispatch</th>
                                    <th className="py-2 px-2 text-left font-bold">Mode</th>
                                    <th className="py-2 px-2 text-left font-bold">Vendor</th>
                                    <th className="py-2 px-2 text-left font-bold">Machines</th>
                                    <th className="py-2 px-2 text-right font-bold">Kg</th>
                                    <th className="py-2 px-2 text-right font-bold">Rate</th>
                                    <th className="py-2 px-2 text-right font-bold">Amount</th>
                                    <th className="py-2 px-2 text-left font-bold">Toll return</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dispatchRows.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="py-4 text-center text-slate-500">
                                            No factory scrap dispatches in range.
                                        </td>
                                    </tr>
                                )}
                                {dispatchRows.map((r) => (
                                    <tr key={r.dispatchNo} className="border-b border-slate-100">
                                        <td className="py-1.5 px-2 text-xs">{r.dispatchDate}</td>
                                        <td className="py-1.5 px-2 font-mono text-xs">{r.dispatchNo}</td>
                                        <td className="py-1.5 px-2 capitalize text-xs">{r.mode}</td>
                                        <td className="py-1.5 px-2 text-xs">{r.vendorName}</td>
                                        <td className="py-1.5 px-2 font-mono text-xs">{r.machines || "—"}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{r.netWeight.toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right font-mono text-xs">
                                            {r.unitRate > 0 ? r.unitRate.toLocaleString() : "—"}
                                        </td>
                                        <td className="py-1.5 px-2 text-right font-mono text-xs">
                                            {r.amount > 0 ? r.amount.toLocaleString() : "—"}
                                        </td>
                                        <td className="py-1.5 px-2 text-xs">
                                            {r.mode === "toll" ? (
                                                <span>
                                                    {r.returnedKg.toLocaleString()} / {r.expectedKg.toLocaleString()} kg
                                                    {r.expectedItemCode ? ` ${r.expectedItemCode}` : ""}
                                                    {r.obligationStatus ? ` (${r.obligationStatus})` : ""}
                                                </span>
                                            ) : (
                                                "—"
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </ReportTable>
                    </section>

                    <section>
                        <ReportSectionTitle>Broker scrap & toll returns</ReportSectionTitle>
                        <p className="text-xs text-slate-500 mb-2 erp-no-print">
                            Customer broker scrap trades and Wire/Rod received back from toll conversion.
                        </p>
                        <ReportTable className="min-w-[560px]">
                            <thead>
                                <tr className="bg-slate-100 border-b-2 border-slate-800">
                                    <th className="py-2 px-2 text-left font-bold">Date</th>
                                    <th className="py-2 px-2 text-left font-bold">Type</th>
                                    <th className="py-2 px-2 text-left font-bold">Ref No</th>
                                    <th className="py-2 px-2 text-left font-bold">Item</th>
                                    <th className="py-2 px-2 text-right font-bold">Kg</th>
                                </tr>
                            </thead>
                            <tbody>
                                {otherRows.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="py-4 text-center text-slate-500">
                                            No broker scrap trades or conversion returns in range.
                                        </td>
                                    </tr>
                                )}
                                {otherRows.map((r, i) => (
                                    <tr key={`${r.refNo}-${i}`} className="border-b border-slate-100">
                                        <td className="py-1.5 px-2 text-xs">{r.date}</td>
                                        <td className="py-1.5 px-2 capitalize text-xs">{formatSourceLabel(r.source)}</td>
                                        <td className="py-1.5 px-2 font-mono text-xs">{r.refNo}</td>
                                        <td className="py-1.5 px-2 font-mono text-xs">{r.itemCode}</td>
                                        <td className="py-1.5 px-2 text-right font-mono">{r.scrapKg.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </ReportTable>
                    </section>
                </ReportPrintDocument>
            )}
        </div>
    );
}
