import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportSectionTitle,
    ReportKpiGrid,
    ReportPanel,
    ReportFilterField,
} from "./ReportPrintPage";
import { ReportInsightLabel } from "./ReportRowInsightTip";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
    fetchUnitEconomics,
    fetchProfitLossRevenueByCategory,
    fetchProfitLossSalesCogsByCategory,
    type ProfitLossRevenueCategoryRow,
    type ProfitLossSalesCogsCategoryRow,
    type UnitEconomicsReport,
} from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import {
    buildUeCategoryUnderpricingSummary,
    buildUeExpenseLineInsight,
    buildUeRateInsight,
    type ReportRowInsight,
} from "@/lib/reportRowInsights";

const MOCK: UnitEconomicsReport = {
    period: { from: "", to: "" },
    pacStatus: { status: "none", periodCode: null },
    volumes: {
        productionKg: 52400,
        soldKg: 49800,
        scrapKg: 1200,
        purchasedRmKg: 55000,
        varnishConsumedKg: 1415,
        varnishDrumsConsumed: 7.075,
        varnishDrumWeightKg: 200,
        yieldPct: 97.7,
        warnings: [],
    },
    totals: {
        directRm: 5200000,
        directConversion: 648000,
        factoryOverhead: 48000,
        varnishCost: 566000,
        selling: 45000,
        admin: 167000,
        totalCogs: 5848000,
        revenue: 9070000,
        otherIncome: 0,
        revenueTotal: 9070000,
        totalExpense: 6112000,
        grossProfit: 3222000,
    },
    expenseLines: [
        { code: "VAR-INV", name: "Varnish consumed (inventory WAC)", bucket: "varnish", amount: 566000 },
        { code: "51003", name: "Factory Utilities (Gas/Electricity)", bucket: "direct_conversion", amount: 320000 },
        { code: "51004", name: "Direct Factory Wages", bucket: "direct_conversion", amount: 280000 },
        { code: "63002", name: "Machine Maintenance & Spares", bucket: "factory_overhead", amount: 48000 },
        { code: "62001", name: "Office Salaries", bucket: "admin", amount: 95000 },
        { code: "62002", name: "Office Rent & Utilities", bucket: "admin", amount: 72000 },
        { code: "61001", name: "Freight Outward", bucket: "selling", amount: 45000 },
    ],
    layers: {
        l1Conversion: {
            directConversionPerKg: 12.37,
            factoryOverheadPerKg: 0.92,
            varnishPerKgProduced: 10.8,
            conversionBurdenPerKgProduced: 13.29,
            adminPerKgSold: 3.35,
            sellingPerKgSold: 0.9,
            commercialBurdenPerKgSold: 4.26,
            breakEvenWattaPkrPerKg: 17.55,
        },
        l2Landed: {
            rmPerKgSold: 104.42,
            varnishPerKgSold: 11.32,
            rmBurdenPerKgSold: 115.74,
            conversionPerKgProduced: 13.29,
            commercialPerKgSold: 4.26,
            totalLandedPerKgSold: 133.29,
        },
        l3Margin: {
            revenuePerKg: 182.13,
            grossMarginPerKg: 64.7,
            netMarginPerKg: 59.4,
        },
    },
};

const BUCKET_LABELS: Record<string, string> = {
    direct_rm: "Sales COGS (51001 + 51010–13)",
    direct_conversion: "Period factory cash (wages / packing / varnish cash…)",
    factory_overhead: "Factory overhead (63xxx)",
    wastage: "Wastage / write-down (51006)",
    unabsorbed: "Unabsorbed production (51999 — excluded from rates)",
    varnish: "Varnish consumed (ops — not added to landed)",
    selling: "Selling (61xxx)",
    admin: "Admin (62xxx)",
};

const WARNING_LABELS: Record<string, string> = {
    no_production_in_period: "No posted production in this period — production-side rates are unavailable.",
    no_sales_in_period: "No sales outflows in this period — commercial and margin rates are unavailable.",
    sold_exceeds_production_inventory_drawdown: "Sold kg exceeds produced kg — you may be drawing from inventory.",
    varnish_consumed_without_unit_cost: "Varnish was consumed in production but restock unit cost may be missing — per-kg varnish cost may be understated.",
    unabsorbed_production_cost_excluded:
        "51999 unabsorbed production cost is excluded from conversion rates (often zero-cost FG / PAC draft). Run PAC final close to clear it.",
    wastage_excluded_from_conversion: "Inventory write-down / wastage (51006) is shown separately and excluded from conversion burden.",
    no_locked_pac_for_range: "No locked PAC period covers this date range — inventory stamps may still be draft/provisional.",
    do_not_use_for_pricing: "Unabsorbed (51999) is material vs sales COGS — do not use these rates for pricing until PAC final clears it.",
};

function fmtPkr(n: number | null | undefined, digits = 2): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    return `₨ ${n.toFixed(digits)}`;
}

function fmtKg(n: number): string {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg`;
}

function UeRateRow({
    label,
    value,
    insight,
    className,
}: {
    label: string;
    value: string;
    insight?: ReportRowInsight | null;
    className?: string;
}) {
    return (
        <tr className={className}>
            <td className="py-0.5">
                <ReportInsightLabel insight={insight}>{label}</ReportInsightLabel>
            </td>
            <td className="text-right font-medium">{value}</td>
        </tr>
    );
}

function ExpenseTable({ title, lines, accent }: { title: string; lines: UnitEconomicsReport["expenseLines"]; accent: string }) {
    const total = lines.reduce((s, l) => s + l.amount, 0);
    if (!lines.length) return null;
    return (
        <div>
            <h4 className={`text-xs font-bold uppercase tracking-wider border-b-2 ${accent} pb-0.5 mb-2 text-slate-700`}>{title}</h4>
            <table className="w-full text-[11px]">
                <tbody>
                    {lines.map((e, i) => (
                        <tr key={`${e.bucket}-${e.code}-${i}`} className="border-b border-slate-100">
                            <td className="py-1 px-2 text-slate-600">
                                <ReportInsightLabel
                                    insight={buildUeExpenseLineInsight(e.code, e.name, e.bucket, e.amount)}
                                >
                                    [{e.code}] {e.name}
                                </ReportInsightLabel>
                            </td>
                            <td className="py-1 px-2 text-right font-medium">₨ {e.amount.toLocaleString()}</td>
                        </tr>
                    ))}
                    <tr className="font-bold border-t-2 border-slate-300">
                        <td className="py-1.5 px-2">Total</td>
                        <td className="py-1.5 px-2 text-right">₨ {total.toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

/** Local calendar date as YYYY-MM-DD (avoids UTC shift from toISOString). */
function localISODate(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export default function TrueExpenseReport() {
    const now = new Date();
    const [dateFrom, setDateFrom] = useState(localISODate(new Date(now.getFullYear(), now.getMonth(), 1)));
    const [dateTo, setDateTo] = useState(localISODate());
    const [show, setShow] = useState(false);
    const [data, setData] = useState<UnitEconomicsReport | null>(null);
    const [revenueCategories, setRevenueCategories] = useState<ProfitLossRevenueCategoryRow[]>([]);
    const [salesCogsCategories, setSalesCogsCategories] = useState<ProfitLossSalesCogsCategoryRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        setShow(true);
        try {
            if (isErpLiveMode()) {
                const [live, revCats, cogsCats] = await Promise.all([
                    fetchUnitEconomics(dateFrom, dateTo),
                    fetchProfitLossRevenueByCategory(dateFrom, dateTo).catch(() => []),
                    fetchProfitLossSalesCogsByCategory(dateFrom, dateTo).catch(() => []),
                ]);
                setData(live);
                setRevenueCategories(revCats);
                setSalesCogsCategories(cogsCats);
            } else {
                setData({ ...MOCK, period: { from: dateFrom, to: dateTo } });
                setRevenueCategories([]);
                setSalesCogsCategories([]);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load unit economics.");
            setData(null);
            setRevenueCategories([]);
            setSalesCogsCategories([]);
        } finally {
            setLoading(false);
        }
    };

    const report = data ?? MOCK;
    const { l1, l2, l3 } = {
        l1: report.layers.l1Conversion,
        l2: report.layers.l2Landed,
        l3: report.layers.l3Margin,
    };
    const l2Sales = report.layers.l2SalesCogs;
    const l2Cash = report.layers.l2CashPeriod;
    const pacStatus = report.pacStatus?.status ?? "none";
    const blockPricing =
        report.volumes.warnings.includes("do_not_use_for_pricing") ||
        (Number(report.totals.unabsorbed ?? 0) > 0 && pacStatus !== "locked");

    const factoryLines = report.expenseLines.filter((l) =>
        ["direct_conversion", "factory_overhead", "varnish"].includes(l.bucket)
    );
    const commercialLines = report.expenseLines.filter((l) =>
        ["admin", "selling"].includes(l.bucket)
    );
    const wastageLines = report.expenseLines.filter((l) => l.bucket === "wastage");
    const unabsorbedLines = report.expenseLines.filter((l) => l.bucket === "unabsorbed");
    const categoryUnderpricing = buildUeCategoryUnderpricingSummary(revenueCategories, salesCogsCategories);
    const salesCogsInsight = (() => {
        const base = buildUeRateInsight("l2_sales_cogs", report);
        if (!categoryUnderpricing) return base;
        return {
            ...base,
            lines: [...base.lines, "", ...categoryUnderpricing.lines],
            warning: base.warning ?? categoryUnderpricing.warning,
        };
    })();
    const tip = (key: string) => buildUeRateInsight(key, report);

    return (
        <div className="space-y-4">
            <ReportPrintControls>
                <ReportFilterField label="From">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-sm w-36" />
                </ReportFilterField>
                <ReportFilterField label="To">
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-sm w-36" />
                </ReportFilterField>
                <Button className="bg-emerald-600 hover:bg-emerald-700 h-8 text-sm" onClick={() => void handleGenerate()} disabled={loading}>
                    {loading ? "Loading..." : "Generate Report"}
                </Button>
                {show && data !== null && <ReportPrintButton />}
            </ReportPrintControls>

            {error ? (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Report failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            {show && data !== null && (
                <ReportPrintDocument
                    reportTitle="Unit Economics Report"
                    subtitle="Sales COGS landed for GP · cash period view separate · 51999/wastage excluded from rates"
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    hierarchyLabel="Sub Accounts (Leaf)"
                    className="space-y-6"
                >
                    <TooltipProvider delayDuration={200}>
                    <div className="print:hidden flex flex-wrap gap-2 text-xs text-slate-600">
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                            PAC: <span className="font-semibold">{pacStatus}</span>
                            {report.pacStatus?.periodCode ? ` (${report.pacStatus.periodCode})` : ""}
                        </span>
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                            Range {dateFrom} → {dateTo}
                        </span>
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                            Prod {fmtKg(report.volumes.productionKg)} · Sold {fmtKg(report.volumes.soldKg)}
                        </span>
                    </div>

                    {blockPricing ? (
                        <Alert className="print:hidden border-rose-200 bg-rose-50">
                            <AlertTriangle className="h-4 w-4 text-rose-700" />
                            <AlertTitle className="text-rose-900">Do not use for pricing</AlertTitle>
                            <AlertDescription className="text-rose-800 text-sm">
                                Unabsorbed production cost and/or missing locked PAC for this range. Run Period Costing
                                final close, then regenerate.
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    {report.expenseLines.length === 0 &&
                    (report.volumes.productionKg > 0 || report.volumes.soldKg > 0) ? (
                        <Alert className="print:hidden border-amber-200 bg-amber-50">
                            <AlertTriangle className="h-4 w-4 text-amber-700" />
                            <AlertTitle className="text-amber-900">No expense GL lines in period</AlertTitle>
                            <AlertDescription className="text-amber-800 text-sm">
                                Volumes exist but trial balance has no bucketed factory/commercial expenses. COGS (51001)
                                posts on sales invoices; conversion accounts (51003–51008) and factory overhead (63xxx)
                                require manual journals or cashbook — production batches do not auto-post them.
                                See <span className="font-mono">docs/report-pl-ue-analysis.md</span>.
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    {report.volumes.warnings.length > 0 ? (
                        <Alert className="print:hidden border-amber-200 bg-amber-50">
                            <AlertTriangle className="h-4 w-4 text-amber-700" />
                            <AlertTitle className="text-amber-900">Data notes</AlertTitle>
                            <AlertDescription className="text-amber-800 text-sm">
                                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                                    {report.volumes.warnings.map((w) => (
                                        <li key={w}>{WARNING_LABELS[w] ?? w}</li>
                                    ))}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    {categoryUnderpricing ? (
                        <Alert className="print:hidden border-amber-200 bg-amber-50">
                            <AlertTriangle className="h-4 w-4 text-amber-700" />
                            <AlertTitle className="text-amber-900">Category underpricing</AlertTitle>
                            <AlertDescription className="text-amber-800 text-sm">
                                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                                    {categoryUnderpricing.lines.map((line) => (
                                        <li key={line}>{line}</li>
                                    ))}
                                </ul>
                                <p className="mt-1">{categoryUnderpricing.warning}</p>
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    <ReportKpiGrid
                        columns={4}
                        items={[
                            {
                                label: "Production",
                                value: fmtKg(report.volumes.productionKg),
                                sub: "FG output (posted batches)",
                                insightLabel: (
                                    <ReportInsightLabel insight={tip("production_kg")}>Production</ReportInsightLabel>
                                ),
                            },
                            {
                                label: "Sold",
                                value: fmtKg(report.volumes.soldKg),
                                sub: "sales_out movements",
                                insightLabel: (
                                    <ReportInsightLabel insight={tip("sold_kg")}>Sold</ReportInsightLabel>
                                ),
                            },
                            {
                                label: "Yield",
                                value: report.volumes.yieldPct != null ? `${report.volumes.yieldPct}%` : "—",
                                sub: `Scrap ${fmtKg(report.volumes.scrapKg)}`,
                                insightLabel: (
                                    <ReportInsightLabel insight={tip("yield")}>Yield</ReportInsightLabel>
                                ),
                            },
                            {
                                label: "Varnish used",
                                value: fmtKg(report.volumes.varnishConsumedKg),
                                sub:
                                    report.volumes.varnishDrumsConsumed > 0
                                        ? `${report.volumes.varnishDrumsConsumed.toLocaleString(undefined, { maximumFractionDigits: 2 })} drums @ ${report.volumes.varnishDrumWeightKg} kg`
                                        : "Enamel production issues",
                                insightLabel: (
                                    <ReportInsightLabel insight={tip("varnish_used")}>Varnish used</ReportInsightLabel>
                                ),
                            },
                            {
                                label: "Revenue",
                                value: fmtPkr(report.totals.revenueTotal, 0),
                                sub: `Gross profit ${fmtPkr(report.totals.grossProfit, 0)}`,
                                insightLabel: (
                                    <ReportInsightLabel insight={tip("revenue_total")}>Revenue</ReportInsightLabel>
                                ),
                            },
                        ]}
                    />

                    {report.totals.varnishCost > 0 ? (
                        <ReportPanel title="Varnish cost (inventory)" className="mb-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                                <div>
                                    <p className="text-[10px] uppercase text-slate-500">Period cost</p>
                                    <p className="font-semibold tabular-nums">{fmtPkr(report.totals.varnishCost, 0)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase text-slate-500">Per kg produced</p>
                                    <p className="font-semibold tabular-nums">{fmtPkr(l1.varnishPerKgProduced)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase text-slate-500">Drums consumed</p>
                                    <p className="font-semibold tabular-nums">
                                        {report.volumes.varnishDrumsConsumed.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        <span className="text-xs font-normal text-slate-500 ml-1">
                                            ({report.volumes.varnishConsumedKg.toLocaleString()} kg)
                                        </span>
                                    </p>
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-2">
                                From enamel production varnish issues at WAC. Restock with drum count and price per drum in Inventory → Varnish.
                            </p>
                        </ReportPanel>
                    ) : null}

                    <ReportSectionTitle>L1 — Break-even watta (excl. copper)</ReportSectionTitle>
                    <div className="report-panel text-center mb-4">
                        <p className="text-xs uppercase tracking-widest font-semibold text-slate-600">
                            <ReportInsightLabel insight={tip("break_even_watta")}>
                                L1 — Break-even watta (conversion + commercial, excl. copper)
                            </ReportInsightLabel>
                        </p>
                        <p className="text-3xl font-bold mt-1 text-slate-900">{fmtPkr(l1.breakEvenWattaPkrPerKg)} / kg</p>
                        <p className="text-[11px] mt-2 text-slate-600">
                            Conversion {fmtPkr(l1.conversionBurdenPerKgProduced)}/kg produced + Commercial {fmtPkr(l1.commercialBurdenPerKgSold)}/kg sold
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
                        <ReportPanel title="L1 — Conversion burden">
                            <table className="report-table w-full">
                                <tbody>
                                    <UeRateRow label="Direct conversion / kg produced" value={fmtPkr(l1.directConversionPerKg)} insight={tip("l1_direct_conversion")} />
                                    <UeRateRow label="Factory overhead / kg produced" value={fmtPkr(l1.factoryOverheadPerKg)} insight={tip("l1_factory_oh")} />
                                    <UeRateRow label="Total conversion / kg produced" value={fmtPkr(l1.conversionBurdenPerKgProduced)} insight={tip("l1_conversion_total")} className="border-t font-semibold" />
                                    <UeRateRow label="Admin / kg sold" value={fmtPkr(l1.adminPerKgSold)} insight={tip("l1_admin")} className="pt-2" />
                                    <UeRateRow label="Selling / kg sold" value={fmtPkr(l1.sellingPerKgSold)} insight={tip("l1_selling")} />
                                    <UeRateRow label="Total commercial / kg sold" value={fmtPkr(l1.commercialBurdenPerKgSold)} insight={tip("l1_commercial")} className="border-t font-semibold" />
                                </tbody>
                            </table>
                        </ReportPanel>
                        <ReportPanel title="L2 — Sales COGS landed (for GP / pricing)">
                            <table className="report-table w-full">
                                <tbody>
                                    <UeRateRow
                                        label="Sales COGS (51001+51010–13) / kg sold"
                                        value={fmtPkr(l2Sales?.salesCogsPerKgSold ?? l2.rmPerKgSold)}
                                        insight={salesCogsInsight}
                                    />
                                    <UeRateRow
                                        label="Commercial / kg sold"
                                        value={fmtPkr(l2Sales?.commercialPerKgSold ?? l2.commercialPerKgSold)}
                                        insight={tip("l2_sales_commercial")}
                                    />
                                    <UeRateRow
                                        label="Sales landed / kg sold"
                                        value={fmtPkr(l2Sales?.totalSalesLandedPerKgSold ?? l2.totalLandedPerKgSold)}
                                        insight={tip("l2_sales_landed")}
                                        className="border-t font-bold text-sm"
                                    />
                                </tbody>
                            </table>
                            <p className="text-[10px] text-slate-500 mt-2">
                                {l2Sales?.note ?? l2.note ?? "Sales COGS already embeds absorbed OH in 51013 — period conversion is not added."}
                            </p>
                        </ReportPanel>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px] mt-4">
                        <ReportPanel title="L2 — Cash period cost (optics only)">
                            <table className="report-table w-full">
                                <tbody>
                                    <UeRateRow label="Sales COGS / kg sold" value={fmtPkr(l2Cash?.salesCogsPerKgSold ?? l2.rmPerKgSold)} insight={tip("l2_cash_sales_cogs")} />
                                    <UeRateRow label="Period conversion / kg produced" value={fmtPkr(l2Cash?.periodConversionPerKgProduced ?? l1.conversionBurdenPerKgProduced)} insight={tip("l2_cash_conversion")} />
                                    <UeRateRow label="Commercial / kg sold" value={fmtPkr(l2Cash?.commercialPerKgSold ?? l2.commercialPerKgSold)} insight={tip("l2_cash_commercial")} />
                                    <UeRateRow label="Cash landed (mixed denom.)" value={fmtPkr(l2Cash?.totalCashLandedPerKg)} insight={tip("l2_cash_landed")} className="border-t font-bold text-sm" />
                                </tbody>
                            </table>
                            <p className="text-[10px] text-slate-500 mt-2">
                                {l2Cash?.note ?? "May double-count OH vs sales COGS — use for cash close review, not GP."}
                            </p>
                        </ReportPanel>
                        <ReportPanel title="Non-rate warnings (excluded from L1/L2 rates)">
                            <table className="report-table w-full">
                                <tbody>
                                    <UeRateRow label="Unabsorbed 51999" value={fmtPkr(report.totals.unabsorbed, 0)} insight={tip("unabsorbed")} />
                                    <UeRateRow label="Wastage 51006" value={fmtPkr(report.totals.wastage, 0)} insight={tip("wastage")} />
                                </tbody>
                            </table>
                            {(unabsorbedLines.length > 0 || wastageLines.length > 0) && (
                                <div className="mt-2 space-y-2">
                                    <ExpenseTable title="51999" lines={unabsorbedLines} accent="border-rose-400" />
                                    <ExpenseTable title="51006" lines={wastageLines} accent="border-amber-400" />
                                </div>
                            )}
                        </ReportPanel>
                    </div>

                    <ReportPanel title="L3 — Margin per kg sold" className="mt-4">
                        <div className="grid grid-cols-3 gap-3 text-center">
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase">
                                    <ReportInsightLabel insight={tip("l3_revenue")}>Revenue / kg</ReportInsightLabel>
                                </p>
                                <p className="text-lg font-bold text-slate-900">{fmtPkr(l3.revenuePerKg)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase">
                                    <ReportInsightLabel insight={tip("l3_gross")}>Gross margin / kg</ReportInsightLabel>
                                </p>
                                <p className="text-lg font-bold text-emerald-700">{fmtPkr(l3.grossMarginPerKg)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase">
                                    <ReportInsightLabel insight={tip("l3_net")}>Net margin / kg</ReportInsightLabel>
                                </p>
                                <p className="text-lg font-bold text-emerald-800">{fmtPkr(l3.netMarginPerKg)}</p>
                            </div>
                        </div>
                    </ReportPanel>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <ExpenseTable title="Factory-side expenses" lines={factoryLines} accent="border-amber-700" />
                        <ExpenseTable title="Commercial expenses" lines={commercialLines} accent="border-slate-700" />
                    </div>

                    {report.expenseLines.some((l) => l.bucket === "direct_rm") ? (
                        <ExpenseTable
                            title="Sales COGS (book)"
                            lines={report.expenseLines.filter((l) => l.bucket === "direct_rm")}
                            accent="border-blue-700"
                        />
                    ) : null}

                    {report.expenseLines.some((l) => l.bucket === "wastage" || l.bucket === "unabsorbed") ? (
                        <ExpenseTable
                            title="Excluded from conversion rates"
                            lines={report.expenseLines.filter(
                                (l) => l.bucket === "wastage" || l.bucket === "unabsorbed",
                            )}
                            accent="border-rose-700"
                        />
                    ) : null}

                    <div className="text-[10px] text-slate-400 print:text-slate-600 border-t pt-2 erp-no-print">
                        Buckets: {Object.entries(BUCKET_LABELS).map(([k, v]) => `${k}=${v}`).join(" · ")} · Hover dotted labels for formulas
                    </div>
                    </TooltipProvider>
                </ReportPrintDocument>
            )}
        </div>
    );
}
