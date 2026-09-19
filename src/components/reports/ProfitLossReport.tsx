import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
    ReportPrintButton,
    ReportPrintControls,
    ReportPrintDocument,
    ReportSectionTitle,
    ReportTable,
    ReportAmount,
    ReportFilterField,
} from "./ReportPrintPage";
import { ReportLoadState } from "./ReportLoadState";
import { ReportInsightLabel } from "./ReportRowInsightTip";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetchProfitLoss, fetchProfitLossRevenueByCategory, fetchProfitLossSalesCogsByCategory } from "@/lib/repositories/reportsRepo";
import type {
    ProfitLossRevenueCategoryRow,
    ProfitLossSalesCogsCategoryRow,
} from "@/lib/repositories/reportsRepo";
import { isErpLiveMode } from "@/lib/backendFlags";
import { formatAccountRowLabel } from "@/lib/reportAccountDisplay";
import { aggregateProfitLoss, type ProfitLossRow } from "@/lib/profitLossAggregation";
import { resolveReportGroup } from "@/lib/reportGroupInference";
import {
    COGS_BAND_LABELS,
    cogsBandForAccount,
    unabsorbedDominatesCogs,
    type CogsBand,
} from "@/lib/cogsBands";
import {
    buildPlAccountInsight,
    buildPlCategoryInsight,
    buildPlTotalInsight,
    type ReportRowInsight,
} from "@/lib/reportRowInsights";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";

const PL_DATA = {
    revenue: [
        { code: "41001", name: "Direct Wire Sales", amount: 8500000 },
        { code: "41002", name: "Premium / Watta Income", amount: 450000 },
        { code: "41003", name: "Scrap Sales", amount: 120000 },
    ],
    openingInventory: 1200000,
    purchases: [
        { code: "51001", name: "Raw Material Consumed (Scrap/Cathode)", amount: 5200000 },
        { code: "51002", name: "Vendor Processing / Triangle Mazdoori", amount: 380000 },
    ],
    closingInventory: 980000,
    selling: [{ code: "61001", name: "Freight Outward", amount: 45000 }],
    admin: [
        { code: "62001", name: "Office / Gatekeeper Salaries", amount: 95000 },
        { code: "62002", name: "Logistics, Freight & Unloading Labor", amount: 72000 },
    ],
    factory: [
        { code: "51003", name: "Factory Furnace & Enamel Utilities", amount: 320000 },
        { code: "51004", name: "Direct Factory Wages - Operators", amount: 280000 },
        { code: "63002", name: "Machine Maintenance & Spares", amount: 48000 },
    ],
};

type PlLiveRow = ProfitLossRow & {
    account_code: string;
    account_name: string;
};

function PLRow({
    label,
    amount,
    bold,
    indent,
    highlight,
    insight,
}: {
    label: string;
    amount: number | null;
    bold?: boolean;
    indent?: number;
    highlight?: "positive" | "negative" | "neutral";
    insight?: ReportRowInsight | null;
}) {
    const rowClass = cn(
        bold && "report-row-total",
        highlight === "positive" && "report-row-highlight",
        highlight === "negative" && "report-row-highlight--negative",
    );
    return (
        <tr className={rowClass}>
            <td
                className={cn(bold && "font-bold")}
                style={{ paddingLeft: indent ? `${indent * 16 + 8}px` : "8px" }}
            >
                <ReportInsightLabel insight={insight} className={bold ? "font-bold" : undefined}>
                {label}
                </ReportInsightLabel>
            </td>
            <td className={cn("text-right", bold && "font-bold")}>
                {amount !== null ? <ReportAmount value={amount} showZero /> : ""}
            </td>
        </tr>
    );
}

function PLSectionHeader({ label }: { label: string }) {
    return (
        <tr className="report-group-header">
            <td colSpan={2}>
                <ReportSectionTitle>{label}</ReportSectionTitle>
            </td>
        </tr>
    );
}

function plAccountLabel(code: string, name: string): string {
    const display = formatAccountRowLabel(name, code);
    return `[${code}] ${display}`;
}

function rowsForGroup(rows: PlLiveRow[], reportGroup: string): PlLiveRow[] {
    return rows.filter(
        (r) =>
            r.account_type === "expense" &&
            resolveReportGroup(r.account_code, r.account_type, r.report_group) === reportGroup,
    );
}

function resolvedGroup(row: PlLiveRow): string {
    return resolveReportGroup(row.account_code, row.account_type, row.report_group);
}

export default function ProfitLossReport() {
    const today = new Date().toISOString().split("T")[0];
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    const [dateFrom, setDateFrom] = useState(firstOfMonth);
    const [dateTo, setDateTo] = useState(today);
    const [show, setShow] = useState(false);
    const [liveRows, setLiveRows] = useState<PlLiveRow[]>([]);
    const [revenueCategories, setRevenueCategories] = useState<ProfitLossRevenueCategoryRow[]>([]);
    const [salesCogsCategories, setSalesCogsCategories] = useState<ProfitLossSalesCogsCategoryRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const useMock = !isErpLiveMode();

    const totals = useMemo(() => {
        if (liveRows.length) return aggregateProfitLoss(liveRows);
        const revenue = PL_DATA.revenue.reduce((s, r) => s + r.amount, 0);
    const totalPurchases = PL_DATA.purchases.reduce((s, p) => s + p.amount, 0);
    const cogs = PL_DATA.openingInventory + totalPurchases - PL_DATA.closingInventory;
        const sellingOpex = PL_DATA.selling.reduce((s, r) => s + r.amount, 0);
        const adminOpex = PL_DATA.admin.reduce((s, r) => s + r.amount, 0);
        const factoryOpex = PL_DATA.factory.reduce((s, r) => s + r.amount, 0);
        const totalOperatingOpex = sellingOpex + adminOpex + factoryOpex;
        const grossProfit = revenue - cogs;
        const operatingProfit = grossProfit - totalOperatingOpex;
        return {
            revenue,
            otherIncome: 0,
            totalRevenue: revenue,
            cogs,
            grossProfit,
            sellingOpex,
            adminOpex,
            factoryOpex,
            totalOperatingOpex,
            operatingProfit,
            otherExpense: 0,
            netProfit: operatingProfit,
        };
    }, [liveRows]);

    const liveRevenueRows = liveRows.filter(
        (r) => r.account_type === "income" && r.report_group !== "other_income",
    );
    const showRevenueCategories = !useMock && revenueCategories.length > 0;
    // When category expansion is available, hide the mixed 41001 control line —
    // categories already reconcile to operating revenue.
    const liveRevenueAccountRows = showRevenueCategories
        ? liveRevenueRows.filter((r) => r.account_code !== "41001")
        : liveRevenueRows;
    const liveOtherIncomeRows = liveRows.filter((r) => r.report_group === "other_income");
    const liveCogsRows = liveRows.filter((r) => resolvedGroup(r) === "cogs");
    const cogsByBand = (band: CogsBand) =>
        liveCogsRows.filter((r) => cogsBandForAccount(r.account_code) === band);
    const liveSalesCogsRows = cogsByBand("sales_cogs");
    const liveSalesVarnishCogsRows = liveSalesCogsRows.filter((r) => r.account_code === "51011");
    const showSalesCogsCategories = !useMock && salesCogsCategories.length > 0;
    const salesCogsCategoryTotal = salesCogsCategories.reduce((s, r) => s + r.amount, 0);
    const livePeriodCashCogsRows = [...cogsByBand("period_cash"), ...cogsByBand("other_cogs")];
    const liveWastageCogsRows = cogsByBand("wastage");
    const liveAbsorptionCogsRows = cogsByBand("absorption");
    const absorptionAmount = liveAbsorptionCogsRows.reduce((s, r) => s + r.amount, 0);
    const showUnabsorbedWarning = unabsorbedDominatesCogs(absorptionAmount, totals.cogs);
    const inventoryGainRows = liveOtherIncomeRows.filter((r) => r.account_code === "42005");
    const liveSellingRows = rowsForGroup(liveRows, "selling_expense");
    const liveAdminRows = rowsForGroup(liveRows, "admin_expense");
    const liveFactoryRows = rowsForGroup(liveRows, "factory_overhead");
    const liveOtherExpenseRows = liveRows.filter(
        (r) =>
            r.account_type === "expense" &&
            resolvedGroup(r) !== "cogs" &&
            !["selling_expense", "admin_expense", "factory_overhead"].includes(resolvedGroup(r)),
    );
    const liveDirectVarnishExpenseRows = liveOtherExpenseRows.filter((r) => r.account_code === "51009");
    const liveGeneralOtherExpenseRows = liveOtherExpenseRows.filter((r) => r.account_code !== "51009");
    const directVarnishExpenseAmount = liveDirectVarnishExpenseRows.reduce((sum, row) => sum + row.amount, 0);

    const hasData = useMock ? true : liveRows.length > 0;

    const handleGenerate = async () => {
        setShow(true);
        setError(null);
        if (useMock) {
            setLiveRows([]);
            setRevenueCategories([]);
            setSalesCogsCategories([]);
            return;
        }
        setLoading(true);
        try {
            const [live, categories, cogsCategories] = await Promise.all([
                fetchProfitLoss(dateFrom, dateTo),
                fetchProfitLossRevenueByCategory(dateFrom, dateTo).catch(() => []),
                fetchProfitLossSalesCogsByCategory(dateFrom, dateTo).catch(() => []),
            ]);
            setLiveRows(
                live.map((r: Record<string, unknown>) => ({
                    account_code: String(r.account_code ?? ""),
                    account_name: String(r.account_name ?? r.account_code ?? ""),
                    account_type: String(r.account_type ?? ""),
                    report_group: String(r.report_group ?? "other"),
                    amount: Number(r.amount ?? 0),
                })),
            );
            setRevenueCategories(categories);
            setSalesCogsCategories(cogsCategories);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load profit & loss report.";
            setError(message);
            setLiveRows([]);
            setRevenueCategories([]);
            setSalesCogsCategories([]);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const renderAccountRows = (rows: PlLiveRow[], indent = 1) =>
        rows.map((r) => (
            <PLRow
                key={r.account_code}
                label={plAccountLabel(r.account_code, r.account_name)}
                amount={r.amount}
                indent={indent}
                insight={buildPlAccountInsight(r.account_code, r.account_name, r.amount)}
            />
        ));

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
                    {loading ? "Loading…" : "Generate P&L"}
                    </Button>
            </ReportPrintControls>

            <ReportLoadState
                loading={show && loading}
                error={show && !loading ? error : null}
                empty={show && !loading && !error && !hasData}
                emptyMessage="No income or expense postings in this period."
            />

            {show && !loading && !error && hasData && !useMock && liveRows.length > 0 && totals.revenue > 0 && totals.cogs === 0 ? (
                <Alert className="print:hidden border-amber-200 bg-amber-50">
                    <Info className="h-4 w-4 text-amber-700" />
                    <AlertTitle className="text-amber-900">No COGS in this period</AlertTitle>
                    <AlertDescription className="text-amber-800 text-sm">
                        Live P&L COGS comes from GL postings (typically Dr 51001 on posted sales invoices:
                        qty × inventory WAC). Production and purchases alone do not create COGS until FG is sold.
                        If you expect COGS, check that sales invoices are posted and inventory has a non-zero average cost.
                    </AlertDescription>
                </Alert>
            ) : null}

            {show && !loading && !error && hasData && !useMock && showUnabsorbedWarning ? (
                <Alert className="print:hidden border-rose-200 bg-rose-50">
                    <AlertTriangle className="h-4 w-4 text-rose-700" />
                    <AlertTitle className="text-rose-900">Unabsorbed production cost dominates COGS</AlertTitle>
                    <AlertDescription className="text-rose-800 text-sm">
                        Account 51999 is {absorptionAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} PKR
                        ({((absorptionAmount / Math.max(totals.cogs, 1)) * 100).toFixed(1)}% of COGS). Often means FG was
                        valued at zero or PAC final (with production GL rebuild) has not run. Do not use Gross for pricing
                        until 51999 clears.
                    </AlertDescription>
                </Alert>
            ) : null}

            {show && !loading && !error && hasData && (
                <ReportPrintDocument
                        reportTitle="Profit & Loss Statement"
                    subtitle={
                        useMock && !liveRows.length
                            ? "Demo layout (inventory COGS method — live mode uses GL COGS postings)"
                            : "Income Statement — multi-step (IAS 1 style)"
                    }
                        dateFrom={dateFrom}
                        dateTo={dateTo}
                    hierarchyLabel={liveRows.length ? "Account level (GL)" : "Demo accounts"}
                >
                    <TooltipProvider delayDuration={200}>
                    <ReportTable className="min-w-[480px]">
                        <tbody>
                            <PLSectionHeader label="1. Operating Revenue" />
                            {liveRows.length ? (
                                <>
                                    {showRevenueCategories &&
                                        revenueCategories.map((r) => (
                                            <PLRow
                                                key={r.category_code}
                                                label={r.category_name}
                                                amount={r.amount}
                                                indent={1}
                                                insight={buildPlCategoryInsight("revenue", r, salesCogsCategories)}
                                            />
                                        ))}
                                    {renderAccountRows(liveRevenueAccountRows)}
                                </>
                            ) : (
                                PL_DATA.revenue.map((r) => (
                                    <PLRow
                                        key={r.code}
                                        label={`[${r.code}] ${r.name}`}
                                        amount={r.amount}
                                        indent={1}
                                        insight={buildPlAccountInsight(r.code, r.name, r.amount)}
                                    />
                                ))
                            )}
                            <PLRow
                                label="Total Operating Revenue"
                                amount={totals.revenue}
                                bold
                                insight={buildPlTotalInsight("operating_revenue", totals)}
                            />

                            {(liveRows.length ? liveOtherIncomeRows.length > 0 : false) && (
                                <>
                                    <PLSectionHeader label="Other Income" />
                                    {renderAccountRows(liveOtherIncomeRows)}
                                    <PLRow
                                        label="Total Other Income"
                                        amount={totals.otherIncome}
                                        bold
                                        insight={buildPlTotalInsight("other_income", totals)}
                                    />
                                </>
                            )}

                            <PLSectionHeader label="2. Cost of Goods Sold (COGS)" />
                            {liveRows.length ? (
                                <>
                                    {liveSalesCogsRows.length > 0 && (
                                        <>
                                            <PLRow
                                                label={COGS_BAND_LABELS.sales_cogs}
                                                amount={null}
                                                indent={1}
                                                insight={buildPlTotalInsight("band_sales_cogs", totals)}
                                            />
                                            {showSalesCogsCategories ? (
                                                <>
                                                    {salesCogsCategories.map((r) => (
                                                        <PLRow
                                                            key={r.category_code}
                                                            label={r.category_name}
                                                            amount={r.amount}
                                                            indent={2}
                                                            insight={buildPlCategoryInsight("cogs", r, revenueCategories)}
                                                        />
                                                    ))}
                                                    <PLRow
                                                        label="Subtotal Sales COGS"
                                                        amount={salesCogsCategoryTotal}
                                                        bold
                                                        indent={1}
                                                        insight={buildPlTotalInsight("sales_cogs_subtotal", totals, {
                                                            salesCogsSubtotal: salesCogsCategoryTotal,
                                                        })}
                                                    />
                                                    {liveSalesVarnishCogsRows.map((r) => (
                                                        <PLRow
                                                            key={`included-${r.account_code}`}
                                                            label={`Of which: ${plAccountLabel(r.account_code, r.account_name)} (included above)`}
                                                            amount={r.amount}
                                                            indent={2}
                                                            insight={buildPlAccountInsight(r.account_code, r.account_name, r.amount)}
                                                        />
                                                    ))}
                                                </>
                                            ) : (
                                                renderAccountRows(liveSalesCogsRows)
                                            )}
                                        </>
                                    )}
                                    {livePeriodCashCogsRows.length > 0 && (
                                        <>
                                            <PLRow
                                                label={COGS_BAND_LABELS.period_cash}
                                                amount={null}
                                                indent={1}
                                                insight={buildPlTotalInsight("band_period_cash", totals)}
                                            />
                                            {renderAccountRows(livePeriodCashCogsRows)}
                                        </>
                                    )}
                                    {liveWastageCogsRows.length > 0 && (
                                        <>
                                            <PLRow
                                                label={COGS_BAND_LABELS.wastage}
                                                amount={null}
                                                indent={1}
                                                insight={buildPlTotalInsight("band_wastage", totals)}
                                            />
                                            {renderAccountRows(liveWastageCogsRows)}
                                            {inventoryGainRows.length > 0 && (
                                                <>
                                                    <PLRow
                                                        label="Inventory gain (42005 — other income, shown for ADJ pairing)"
                                                        amount={null}
                                                        indent={1}
                                                        insight={buildPlAccountInsight(
                                                            "42005",
                                                            "Inventory Gain / Surplus",
                                                            inventoryGainRows.reduce((s, r) => s + r.amount, 0),
                                                        )}
                                                    />
                                                    {renderAccountRows(inventoryGainRows)}
                                                </>
                                            )}
                                        </>
                                    )}
                                    {liveAbsorptionCogsRows.length > 0 && (
                                        <>
                                            <PLRow
                                                label={COGS_BAND_LABELS.absorption}
                                                amount={null}
                                                indent={1}
                                                insight={buildPlTotalInsight("band_absorption", totals, {
                                                    absorption: absorptionAmount,
                                                })}
                                            />
                                            {renderAccountRows(liveAbsorptionCogsRows)}
                                        </>
                                    )}
                                    {liveCogsRows.length === 0 && (
                                        <PLRow label="No COGS GL postings in period" amount={null} indent={1} />
                                    )}
                                    <PLRow
                                        label="Total COGS"
                                        amount={totals.cogs}
                                        bold
                                        insight={buildPlTotalInsight("total_cogs", totals)}
                                    />
                                </>
                            ) : (
                                <>
                                    <PLRow label="Opening Inventory Value (demo)" amount={PL_DATA.openingInventory} indent={1} />
                                    {PL_DATA.purchases.map((p) => (
                                        <PLRow
                                            key={p.code}
                                            label={`[${p.code}] ${p.name}`}
                                            amount={p.amount}
                                            indent={1}
                                            insight={buildPlAccountInsight(p.code, p.name, p.amount)}
                                        />
                                    ))}
                                    <PLRow label="Less: Closing Inventory Value (demo)" amount={-PL_DATA.closingInventory} indent={1} />
                                    <PLRow
                                        label="Total COGS"
                                        amount={totals.cogs}
                                        bold
                                        insight={buildPlTotalInsight("total_cogs", totals)}
                                    />
                                </>
                            )}

                            <PLRow
                                label="GROSS PROFIT"
                                amount={totals.grossProfit}
                                bold
                                highlight={totals.grossProfit >= 0 ? "positive" : "negative"}
                                insight={buildPlTotalInsight("gross_profit", totals)}
                            />

                            <PLSectionHeader label="3. Operating Expenses" />
                            {liveRows.length ? (
                                <>
                                    {liveSellingRows.length > 0 && (
                                        <>
                                            <PLRow
                                                label="Selling expenses"
                                                amount={null}
                                                indent={1}
                                                insight={buildPlTotalInsight("selling", totals)}
                                            />
                                            {renderAccountRows(liveSellingRows)}
                                        </>
                                    )}
                                    {liveAdminRows.length > 0 && (
                                        <>
                                            <PLRow
                                                label="Administrative expenses"
                                                amount={null}
                                                indent={1}
                                                insight={buildPlTotalInsight("admin", totals)}
                                            />
                                            {renderAccountRows(liveAdminRows)}
                                        </>
                                    )}
                                    {liveFactoryRows.length > 0 && (
                                        <>
                                            <PLRow
                                                label="Factory overhead"
                                                amount={null}
                                                indent={1}
                                                insight={buildPlTotalInsight("factory", totals)}
                                            />
                                            {renderAccountRows(liveFactoryRows)}
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    {PL_DATA.selling.map((e) => (
                                        <PLRow
                                            key={e.code}
                                            label={`[${e.code}] ${e.name}`}
                                            amount={e.amount}
                                            indent={1}
                                            insight={buildPlAccountInsight(e.code, e.name, e.amount)}
                                        />
                                    ))}
                                    {PL_DATA.admin.map((e) => (
                                        <PLRow
                                            key={e.code}
                                            label={`[${e.code}] ${e.name}`}
                                            amount={e.amount}
                                            indent={1}
                                            insight={buildPlAccountInsight(e.code, e.name, e.amount)}
                                        />
                                    ))}
                                    {PL_DATA.factory.map((e) => (
                                        <PLRow
                                            key={e.code}
                                            label={`[${e.code}] ${e.name}`}
                                            amount={e.amount}
                                            indent={1}
                                            insight={buildPlAccountInsight(e.code, e.name, e.amount)}
                                        />
                                    ))}
                                </>
                            )}
                            <PLRow
                                label="Total Operating Expenses"
                                amount={totals.totalOperatingOpex}
                                bold
                                insight={buildPlTotalInsight("total_opex", totals)}
                            />
                            <PLRow
                                label="OPERATING PROFIT"
                                amount={totals.operatingProfit}
                                bold
                                highlight={totals.operatingProfit >= 0 ? "positive" : "negative"}
                                insight={buildPlTotalInsight("operating_profit", totals)}
                            />

                            {liveRows.length && liveOtherExpenseRows.length > 0 ? (
                                <>
                                    <PLSectionHeader label="4. Other Expense" />
                                    {liveDirectVarnishExpenseRows.length > 0 && (
                                        <>
                                            <PLRow label="Direct varnish expenses" amount={null} indent={1} />
                                            {renderAccountRows(liveDirectVarnishExpenseRows, 2)}
                                            <PLRow
                                                label="Subtotal Direct Varnish Expense"
                                                amount={directVarnishExpenseAmount}
                                                bold
                                                indent={1}
                                            />
                                        </>
                                    )}
                                    {liveGeneralOtherExpenseRows.length > 0 && (
                                        <>
                                            <PLRow label="Other expenses" amount={null} indent={1} />
                                            {renderAccountRows(liveGeneralOtherExpenseRows, 2)}
                                        </>
                                    )}
                                    <PLRow
                                        label="Total Other Expense"
                                        amount={totals.otherExpense}
                                        bold
                                        insight={buildPlTotalInsight("other_expense", totals)}
                                    />
                                </>
                            ) : null}

                            <PLSectionHeader label={liveOtherExpenseRows.length ? "5. Bottom Line" : "4. Bottom Line"} />
                            <PLRow
                                label="NET PROFIT / (LOSS)"
                                amount={totals.netProfit}
                                bold
                                highlight={totals.netProfit >= 0 ? "positive" : "negative"}
                                insight={buildPlTotalInsight("net_profit", totals)}
                            />
                        </tbody>
                    </ReportTable>
                    </TooltipProvider>
                </ReportPrintDocument>
            )}
        </div>
    );
}
