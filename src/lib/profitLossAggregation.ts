import { resolveReportGroup } from "./reportGroupInference.ts";

export type ProfitLossRow = {
    account_code?: string;
    account_type: string;
    report_group: string;
    amount: number;
};

export type ProfitLossTotals = {
    revenue: number;
    otherIncome: number;
    totalRevenue: number;
    cogs: number;
    grossProfit: number;
    sellingOpex: number;
    adminOpex: number;
    factoryOpex: number;
    totalOperatingOpex: number;
    operatingProfit: number;
    otherExpense: number;
    netProfit: number;
};

function sumAmount(rows: ProfitLossRow[]): number {
    return rows.reduce((s, r) => s + r.amount, 0);
}

function filterExpenseGroup(rows: ProfitLossRow[], reportGroup: string): ProfitLossRow[] {
    return rows.filter((r) => r.account_type === "expense" && r.report_group === reportGroup);
}

function normalizeRow(row: ProfitLossRow): ProfitLossRow {
    if (!row.account_code) return row;
    return {
        ...row,
        report_group: resolveReportGroup(row.account_code, row.account_type, row.report_group),
    };
}

/** Multi-step P&L totals from account-level fn_profit_loss rows (migration 116+). */
export function aggregateProfitLoss(rows: ProfitLossRow[]): ProfitLossTotals {
    const normalized = rows.map(normalizeRow);
    const incomeRows = normalized.filter((r) => r.account_type === "income");
    const otherIncomeRows = incomeRows.filter((r) => r.report_group === "other_income");
    const revenueRows = incomeRows.filter((r) => r.report_group !== "other_income");

    const cogsRows = normalized.filter((r) => r.report_group === "cogs");
    const sellingRows = filterExpenseGroup(normalized, "selling_expense");
    const adminRows = filterExpenseGroup(normalized, "admin_expense");
    const factoryRows = filterExpenseGroup(normalized, "factory_overhead");
    const otherExpenseRows = filterExpenseGroup(normalized, "other_expense");
    const uncategorizedOpex = normalized.filter(
        (r) =>
            r.account_type === "expense" &&
            r.report_group !== "cogs" &&
            !["selling_expense", "admin_expense", "factory_overhead", "other_expense"].includes(r.report_group),
    );

    const revenue = sumAmount(revenueRows);
    const otherIncome = sumAmount(otherIncomeRows);
    const cogs = sumAmount(cogsRows);
    const grossProfit = revenue - cogs;
    const sellingOpex = sumAmount(sellingRows);
    const adminOpex = sumAmount(adminRows);
    const factoryOpex = sumAmount(factoryRows);
    const otherExpense = sumAmount(otherExpenseRows) + sumAmount(uncategorizedOpex);
    const totalOperatingOpex = sellingOpex + adminOpex + factoryOpex;
    const operatingProfit = grossProfit - totalOperatingOpex;
    const netProfit = operatingProfit + otherIncome - otherExpense;
    const totalRevenue = revenue + otherIncome;

    return {
        revenue,
        otherIncome,
        totalRevenue,
        cogs,
        grossProfit,
        sellingOpex,
        adminOpex,
        factoryOpex,
        totalOperatingOpex,
        operatingProfit,
        otherExpense,
        netProfit,
    };
}
