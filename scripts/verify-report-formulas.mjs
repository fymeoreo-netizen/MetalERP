/**
 * Client-side report formula checks + artifact presence.
 * SQL cross-checks: run supabase/scripts/report_formula_audit.sql in Supabase SQL Editor.
 *
 * Usage: npm run verify:reports
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReportGroup, inferReportGroupFromCode } from "../src/lib/reportGroupInference.ts";
import { aggregateProfitLoss } from "../src/lib/profitLossAggregation.ts";
import {
    isReportBalanced,
    reportBalanceVariance,
    REPORT_BALANCE_TOLERANCE,
} from "../src/lib/reportBalance.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function approx(a, b, tol = 0.01) {
    return Math.abs(a - b) <= tol;
}

// --- reportBalance ---
assert(isReportBalanced(100, 100.4), "balanced within tolerance");
assert(!isReportBalanced(100, 100.6), "imbalanced beyond tolerance");
assert(reportBalanceVariance(100, 99) === 1, "variance sign");
assert(REPORT_BALANCE_TOLERANCE === 0.5, "tolerance matches reconciliation RPC");

assert(inferReportGroupFromCode("51001", "expense") === "cogs", "51xxx infers cogs");
assert(
    resolveReportGroup("51001", "expense", "other", null) === "cogs",
    "resolveReportGroup prefers code band over other",
);

// --- aggregateProfitLoss (IAS-style multi-step) ---
const sampleRows = [
    { account_type: "income", report_group: "revenue", amount: 1_000_000 },
    { account_type: "income", report_group: "other_income", amount: 50_000 },
    { account_type: "expense", report_group: "cogs", amount: 600_000 },
    { account_type: "expense", report_group: "selling_expense", amount: 80_000 },
    { account_type: "expense", report_group: "admin_expense", amount: 40_000 },
    { account_type: "expense", report_group: "factory_overhead", amount: 120_000 },
    { account_type: "expense", report_group: "other_expense", amount: 10_000 },
];

const totals = aggregateProfitLoss(sampleRows);
assert(totals.revenue === 1_000_000, `revenue: ${totals.revenue}`);
assert(totals.otherIncome === 50_000, `otherIncome: ${totals.otherIncome}`);
assert(totals.cogs === 600_000, `cogs: ${totals.cogs}`);
assert(totals.grossProfit === 400_000, `grossProfit: ${totals.grossProfit}`);
assert(totals.totalOperatingOpex === 240_000, `opex: ${totals.totalOperatingOpex}`);
assert(totals.operatingProfit === 160_000, `operatingProfit: ${totals.operatingProfit}`);
assert(totals.netProfit === 200_000, `netProfit: ${totals.netProfit}`);

// net = income - expense (RPC-level identity)
const incomeSum = sampleRows
    .filter((r) => r.account_type === "income")
    .reduce((s, r) => s + r.amount, 0);
const expenseSum = sampleRows
    .filter((r) => r.account_type === "expense")
    .reduce((s, r) => s + r.amount, 0);
assert(
    approx(totals.netProfit, incomeSum - expenseSum),
    `net matches income-expense: ${totals.netProfit} vs ${incomeSum - expenseSum}`,
);

// uncategorized expense rolls into otherExpense
const withMisc = aggregateProfitLoss([
    ...sampleRows,
    { account_type: "expense", report_group: "legacy_bucket", amount: 5_000 },
]);
assert(withMisc.otherExpense === 15_000, `uncategorized opex: ${withMisc.otherExpense}`);
assert(withMisc.netProfit === 195_000, `net with misc: ${withMisc.netProfit}`);

// --- required audit artifacts ---
const required = [
    "docs/report-matrix.md",
    "docs/report-formulas.md",
    "supabase/scripts/report_formula_audit.sql",
    "supabase/scripts/scale_safety_verification.sql",
    "supabase/migrations/223_scale_indexes_and_inventory_totals.sql",
    "src/lib/profitLossAggregation.ts",
    "src/lib/reportBalance.ts",
];

for (const rel of required) {
    const path = join(root, rel);
    assert(existsSync(path), `missing artifact: ${rel}`);
}

const auditSql = readFileSync(join(root, "supabase/scripts/report_formula_audit.sql"), "utf8");
for (const token of [
    "TB_PERIOD_BALANCE",
    "BS_EQUATION",
    "PL_BS_YTD_BRIDGE",
    "UE_BREAK_EVEN_WATTA",
    "fn_reconciliation_checks",
]) {
    assert(auditSql.includes(token), `audit SQL missing check: ${token}`);
}

const formulasMd = readFileSync(join(root, "docs/report-formulas.md"), "utf8");
assert(
    formulasMd.includes("account_code") || formulasMd.includes("account-level"),
    "report-formulas.md should document account-level P&L (migration 116)",
);

const scaleSql = readFileSync(join(root, "supabase/scripts/scale_safety_verification.sql"), "utf8");
for (const token of [
    "idx_im_movement_type_posting_date",
    "idx_im_production_receipt_date",
    "idx_je_source_doc",
    "idx_jl_account_journal",
    "idx_production_batches_batch_date",
    "fn_inventory_movement_totals",
]) {
    assert(scaleSql.includes(token), `scale safety SQL missing check: ${token}`);
}

console.log("verify:reports — all client checks passed.");
console.log("  Next: run supabase/scripts/report_formula_audit.sql on live Supabase for RPC cross-checks.");
