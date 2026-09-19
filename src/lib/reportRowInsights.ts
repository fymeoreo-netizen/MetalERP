import type { ProfitLossTotals } from "@/lib/profitLossAggregation";
import type { UnitEconomicsReport } from "@/lib/api/reports";

export type ReportRowInsight = {
    title: string;
    lines: string[];
    warning?: string;
};

export type CategoryAmountRow = {
    category_code: string;
    category_name: string;
    amount: number;
    kg: number;
};

export function fmtInsightPkr(n: number, digits = 0): string {
    if (!Number.isFinite(n)) return "—";
    return `₨ ${n.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    })}`;
}

export function fmtInsightKg(n: number): string {
    if (!Number.isFinite(n)) return "—";
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

export function buildCategoryMarginInsight(
    categoryName: string,
    revenue: number,
    cogs: number,
    revenueKg = 0,
    cogsKg = 0,
): ReportRowInsight {
    const gap = cogs - revenue;
    const kg = cogsKg > 0 ? cogsKg : revenueKg;
    const revPerKg = revenueKg > 0 ? revenue / revenueKg : null;
    const cogsPerKg = cogsKg > 0 ? cogs / cogsKg : null;
    const lines = [
        `Revenue (${categoryName}): ${fmtInsightPkr(revenue)}`,
        `Sales COGS (${categoryName}): ${fmtInsightPkr(cogs)}`,
        `Gap (COGS − Revenue): ${fmtInsightPkr(gap)}`,
    ];
    if (revPerKg != null) lines.push(`Revenue / kg: ${fmtInsightPkr(revPerKg, 2)}`);
    if (cogsPerKg != null) lines.push(`COGS / kg: ${fmtInsightPkr(cogsPerKg, 2)}`);
    if (kg > 0 && gap !== 0) {
        lines.push(`Gap / kg: ${fmtInsightPkr(gap / kg, 2)}`);
    } else if (revenue > 0 && gap !== 0) {
        lines.push(`Gap as % of revenue: ${((gap / revenue) * 100).toFixed(1)}%`);
    }

    if (gap > 0.5) {
        return {
            title: `${categoryName} — COGS above revenue`,
            lines,
            warning:
                "Book cost (WAC/PAC inventory out) exceeds selling revenue for this product family. " +
                "Usually underpricing vs cost, mix of low-rate SKUs, or pending/stale rates — not a report arithmetic bug.",
        };
    }
    if (gap < -0.5) {
        return {
            title: `${categoryName} — margin positive`,
            lines: [...lines, `Contribution: ${fmtInsightPkr(-gap)}`],
        };
    }
    return {
        title: `${categoryName} — roughly break-even`,
        lines,
    };
}

function findCategory(
    rows: CategoryAmountRow[],
    categoryCode: string,
): CategoryAmountRow | undefined {
    return rows.find((r) => r.category_code === categoryCode);
}

export function buildPlAccountInsight(
    accountCode: string,
    accountName: string,
    amount: number,
): ReportRowInsight {
    const code = accountCode.trim();
    const base = {
        title: `[${code}] ${accountName}`,
        lines: [`Period amount: ${fmtInsightPkr(amount)}`],
    };

    const extras: Record<string, string[]> = {
        "41001": [
            "Operating sales revenue from posted sales invoices (and related adjustments).",
            "When category rows are shown, they already split this control total by product family.",
        ],
        "51001": [
            "COGS – Clearing: remainder so copper + varnish + packing + absorbed OH equals inventory credit.",
            "Inventory out uses qty × WAC/PAC; component buckets are a split of that total.",
            "Any unlabeled leftover lands here so GL still matches stock leaving the warehouse.",
        ],
        "51010": [
            "Sales COGS – Copper component from sales_out.cost_copper (FG PAC/WAC copper share × qty).",
        ],
        "51011": ["Sales COGS – Varnish component from sales_out.cost_varnish."],
        "51012": ["Sales COGS – Packing component from sales_out.cost_packing."],
        "51013": [
            "Sales COGS – Absorbed overhead released when FG is sold (embedded OH in inventory).",
            "Pairs with production credits to 51999 when OH was absorbed into FG.",
        ],
        "51006": [
            "Wastage / write-down when production RM issue value exceeds FG receipt value.",
            "Bridge: Dr 51006 (+ Dr FG) / Cr RM for the shortfall.",
        ],
        "51999": [
            "Absorbed Factory Overhead: production bridge when FG value > RM value.",
            "Formula per batch: FG receipt value − RM issue value.",
            "Credit shows as a negative expense on P&L (not a cash loss).",
        ],
        "42005": [
            "Inventory gain / surplus (other income), shown near wastage for ADJ pairing.",
        ],
    };

    const genericExpense =
        code.startsWith("51") || code.startsWith("61") || code.startsWith("62") || code.startsWith("63") || code.startsWith("50")
            ? ["GL expense/income amount for the selected period (debit − credit for expenses)."]
            : ["GL amount for the selected period."];

    return {
        ...base,
        lines: [...base.lines, ...(extras[code] ?? genericExpense)],
    };
}

function categoryFamilyLabel(category: CategoryAmountRow): string {
    const name = category.category_name
        .replace(/^COGS\s*[-–]\s*/i, "")
        .replace(/^Sales\s*[-–]\s*/i, "")
        .trim();
    return name || category.category_code;
}

export function buildPlCategoryInsight(
    side: "revenue" | "cogs",
    category: CategoryAmountRow,
    peerRows: CategoryAmountRow[],
): ReportRowInsight {
    const peer = findCategory(peerRows, category.category_code);
    const rev = side === "revenue" ? category.amount : (peer?.amount ?? 0);
    const cogs = side === "cogs" ? category.amount : (peer?.amount ?? 0);
    const revKg = side === "revenue" ? category.kg : (peer?.kg ?? 0);
    const cogsKg = side === "cogs" ? category.kg : (peer?.kg ?? 0);
    const family = categoryFamilyLabel(category);

    const formula =
        side === "revenue"
            ? [
                  `Source: posted sales (less returns) line amounts for ${family}.`,
                  `Amount: ${fmtInsightPkr(category.amount)}`,
                  category.kg > 0 ? `Volume: ${fmtInsightKg(category.kg)}` : "Volume: n/a",
              ]
            : [
                  `Source: Σ sales_out.value_amount (book WAC/PAC) for ${family}.`,
                  `Amount: ${fmtInsightPkr(category.amount)}`,
                  category.kg > 0 ? `Volume: ${fmtInsightKg(category.kg)}` : "Volume: n/a",
              ];

    if (!peer) {
        return {
            title: category.category_name,
            lines: formula,
        };
    }

    const margin = buildCategoryMarginInsight(family, rev, cogs, revKg, cogsKg);
    return {
        title: margin.title,
        lines: [...formula, "", ...margin.lines],
        warning: margin.warning,
    };
}

export function buildPlTotalInsight(
    key:
        | "operating_revenue"
        | "other_income"
        | "sales_cogs_subtotal"
        | "total_cogs"
        | "gross_profit"
        | "selling"
        | "admin"
        | "factory"
        | "total_opex"
        | "operating_profit"
        | "other_expense"
        | "net_profit"
        | "band_sales_cogs"
        | "band_period_cash"
        | "band_wastage"
        | "band_absorption",
    totals: ProfitLossTotals,
    extras?: { salesCogsSubtotal?: number; absorption?: number },
): ReportRowInsight {
    const t = totals;
    const salesCogs = extras?.salesCogsSubtotal;
    switch (key) {
        case "operating_revenue":
            return {
                title: "Total Operating Revenue",
                lines: [
                    `Sum of operating income lines (excl. other income).`,
                    `= ${fmtInsightPkr(t.revenue)}`,
                ],
            };
        case "other_income":
            return {
                title: "Total Other Income",
                lines: [`Sum of other_income group.`, `= ${fmtInsightPkr(t.otherIncome)}`],
            };
        case "band_sales_cogs":
            return {
                title: "Sales COGS band",
                lines: [
                    "Cost of finished goods sold: accounts 51001 + 51010–51013.",
                    "Equals Σ sales_out.value_amount for the period (inventory credit).",
                ],
            };
        case "band_period_cash":
            return {
                title: "Period factory cash in COGS",
                lines: [
                    "Cash / voucher factory spend booked in 51xxx (utilities, wages, packing cash, etc.).",
                    "Not the inventory backflush of FG sold.",
                ],
            };
        case "band_wastage":
            return {
                title: "Wastage / write-down",
                lines: ["Account 51006 — production bridge when RM cost exceeds FG receipt value."],
            };
        case "band_absorption":
            return {
                title: "Absorption / Unabsorbed (51999)",
                lines: [
                    "Production absorption clearing (FG − RM).",
                    extras?.absorption != null
                        ? `Period amount: ${fmtInsightPkr(extras.absorption)}`
                        : "Credit shows negative on P&L.",
                ],
            };
        case "sales_cogs_subtotal":
            return {
                title: "Subtotal Sales COGS",
                lines: [
                    "Sum of category Sales COGS (or 51001+51010–13).",
                    salesCogs != null ? `= ${fmtInsightPkr(salesCogs)}` : "See category / account rows above.",
                ],
            };
        case "total_cogs":
            return {
                title: "Total COGS",
                lines: [
                    "All P&L COGS report_group accounts: Sales COGS + period cash + wastage + absorption.",
                    `= ${fmtInsightPkr(t.cogs)}`,
                    "Note: broader than UE Sales COGS (which uses only 51001+51010–13).",
                ],
            };
        case "gross_profit":
            return {
                title: "Gross Profit",
                lines: [
                    "Operating Revenue − Total COGS",
                    `${fmtInsightPkr(t.revenue)} − ${fmtInsightPkr(t.cogs)} = ${fmtInsightPkr(t.grossProfit)}`,
                ],
                warning:
                    t.grossProfit < 0
                        ? "Negative GP: book COGS (incl. period cash / wastage / absorption) exceeds operating revenue."
                        : undefined,
            };
        case "selling":
            return {
                title: "Selling expenses",
                lines: [`Sum of selling_expense group.`, `= ${fmtInsightPkr(t.sellingOpex)}`],
            };
        case "admin":
            return {
                title: "Administrative expenses",
                lines: [`Sum of admin_expense group.`, `= ${fmtInsightPkr(t.adminOpex)}`],
            };
        case "factory":
            return {
                title: "Factory overhead",
                lines: [`Sum of factory_overhead group (e.g. 63xxx).`, `= ${fmtInsightPkr(t.factoryOpex)}`],
            };
        case "total_opex":
            return {
                title: "Total Operating Expenses",
                lines: [
                    "Selling + Admin + Factory overhead",
                    `${fmtInsightPkr(t.sellingOpex)} + ${fmtInsightPkr(t.adminOpex)} + ${fmtInsightPkr(t.factoryOpex)} = ${fmtInsightPkr(t.totalOperatingOpex)}`,
                ],
            };
        case "operating_profit":
            return {
                title: "Operating Profit",
                lines: [
                    "Gross Profit − Total Operating Expenses",
                    `${fmtInsightPkr(t.grossProfit)} − ${fmtInsightPkr(t.totalOperatingOpex)} = ${fmtInsightPkr(t.operatingProfit)}`,
                ],
            };
        case "other_expense":
            return {
                title: "Total Other Expense",
                lines: [`Below-the-line expenses (tax, zakat, building, etc.).`, `= ${fmtInsightPkr(t.otherExpense)}`],
            };
        case "net_profit":
            return {
                title: "Net Profit / (Loss)",
                lines: [
                    "Operating Profit + Other Income − Other Expense",
                    `${fmtInsightPkr(t.operatingProfit)} + ${fmtInsightPkr(t.otherIncome)} − ${fmtInsightPkr(t.otherExpense)} = ${fmtInsightPkr(t.netProfit)}`,
                ],
            };
    }
}

const UE_BUCKET_FORMULAS: Record<string, string[]> = {
    direct_rm: [
        "Sales COGS book cost: GL 51001 + 51010 + 51011 + 51012 + 51013.",
        "Equals inventory value leaving on sales (Σ sales_out.value_amount).",
    ],
    direct_conversion: [
        "Period factory cash in COGS (wages, utilities, packing cash, varnish cash…).",
        "Excluded from L2 Sales landed (already partly in FG via 51013).",
    ],
    factory_overhead: ["Factory overhead accounts (typically 63xxx) for the period."],
    wastage: [
        "51006 inventory write-down / wastage.",
        "Shown separately; excluded from L1/L2 conversion rates.",
    ],
    unabsorbed: [
        "51999 absorbed / unabsorbed production clearing.",
        "Excluded from pricing rates; credit = FG value − RM value at production.",
    ],
    varnish: ["Varnish consumed from inventory issues at WAC (ops view)."],
    selling: ["Selling expenses (61xxx)."],
    admin: ["Admin expenses (62xxx)."],
};

export function buildUeExpenseLineInsight(
    code: string,
    name: string,
    bucket: string,
    amount: number,
): ReportRowInsight {
    const account = buildPlAccountInsight(code, name, amount);
    return {
        title: account.title,
        lines: [...account.lines, ...(UE_BUCKET_FORMULAS[bucket] ?? [`UE bucket: ${bucket}`])],
    };
}

export function buildUeRateInsight(
    key: string,
    report: UnitEconomicsReport,
): ReportRowInsight {
    const { totals: t, volumes: v, layers } = report;
    const l1 = layers.l1Conversion;
    const l2Sales = layers.l2SalesCogs;
    const l2Cash = layers.l2CashPeriod;
    const l3 = layers.l3Margin;
    const sold = v.soldKg;
    const prod = v.productionKg;
    const salesCogsPerKg = l2Sales?.salesCogsPerKgSold ?? layers.l2Landed.rmPerKgSold;
    const revPerKg = l3.revenuePerKg;

    const div = (num: number, den: number, label: string): string[] => [
        `${label} = ${fmtInsightPkr(num)} ÷ ${fmtInsightKg(den)}`,
        den > 0 ? `= ${fmtInsightPkr(num / den, 2)} / kg` : "Denominator is zero — rate unavailable.",
    ];

    switch (key) {
        case "production_kg":
            return {
                title: "Production kg",
                lines: [`FG output from posted production batches: ${fmtInsightKg(prod)}`],
            };
        case "sold_kg":
            return {
                title: "Sold kg",
                lines: [`Σ sales_out qty in period: ${fmtInsightKg(sold)}`],
            };
        case "yield":
            return {
                title: "Yield",
                lines: [
                    v.yieldPct != null ? `Yield: ${v.yieldPct}%` : "Yield unavailable.",
                    `Scrap: ${fmtInsightKg(v.scrapKg)}`,
                ],
            };
        case "varnish_used":
            return {
                title: "Varnish used",
                lines: [
                    `Consumed: ${fmtInsightKg(v.varnishConsumedKg)}`,
                    `Drums: ${v.varnishDrumsConsumed.toLocaleString(undefined, { maximumFractionDigits: 2 })} @ ${v.varnishDrumWeightKg} kg`,
                ],
            };
        case "revenue_total":
            return {
                title: "Revenue",
                lines: [
                    `Operating revenue: ${fmtInsightPkr(t.revenue)}`,
                    `Gross profit (UE): ${fmtInsightPkr(t.grossProfit)}`,
                    "UE GP uses Sales COGS (51001+51010–13), not full P&L COGS.",
                ],
            };
        case "break_even_watta":
            return {
                title: "Break-even watta",
                lines: [
                    "Conversion / kg produced + Commercial / kg sold (excl. copper).",
                    `${fmtInsightPkr(l1.conversionBurdenPerKgProduced ?? 0, 2)} + ${fmtInsightPkr(l1.commercialBurdenPerKgSold ?? 0, 2)} = ${fmtInsightPkr(l1.breakEvenWattaPkrPerKg ?? 0, 2)} / kg`,
                ],
            };
        case "l1_direct_conversion":
            return {
                title: "Direct conversion / kg produced",
                lines: div(t.directConversion, prod, "direct_conversion"),
            };
        case "l1_factory_oh":
            return {
                title: "Factory overhead / kg produced",
                lines: div(t.factoryOverhead, prod, "factory_overhead"),
            };
        case "l1_conversion_total":
            return {
                title: "Total conversion / kg produced",
                lines: [
                    "Direct conversion + factory overhead per kg produced.",
                    `= ${fmtInsightPkr(l1.conversionBurdenPerKgProduced ?? 0, 2)} / kg`,
                ],
            };
        case "l1_admin":
            return { title: "Admin / kg sold", lines: div(t.admin, sold, "admin") };
        case "l1_selling":
            return { title: "Selling / kg sold", lines: div(t.selling, sold, "selling") };
        case "l1_commercial":
            return {
                title: "Total commercial / kg sold",
                lines: [
                    "Admin + Selling per kg sold.",
                    `= ${fmtInsightPkr(l1.commercialBurdenPerKgSold ?? 0, 2)} / kg`,
                ],
            };
        case "l2_sales_cogs": {
            const insight: ReportRowInsight = {
                title: "Sales COGS / kg sold",
                lines: [
                    ...div(t.directRm, sold, "Sales COGS (51001+51010–13)"),
                    "Book inventory cost of goods sold — not purchase invoice rate.",
                ],
            };
            if (
                revPerKg != null &&
                salesCogsPerKg != null &&
                salesCogsPerKg > revPerKg + 0.5
            ) {
                insight.warning =
                    `Sales COGS/kg (${fmtInsightPkr(salesCogsPerKg, 2)}) exceeds revenue/kg (${fmtInsightPkr(revPerKg, 2)}). ` +
                    "Average selling price is below book cost — check underpriced categories (e.g. copper strip).";
            }
            return insight;
        }
        case "l2_sales_commercial":
            return {
                title: "Commercial / kg sold (L2 Sales)",
                lines: [
                    `= ${fmtInsightPkr(l2Sales?.commercialPerKgSold ?? l1.commercialBurdenPerKgSold ?? 0, 2)} / kg`,
                ],
            };
        case "l2_sales_landed":
            return {
                title: "Sales landed / kg sold",
                lines: [
                    "Sales COGS/kg + Commercial/kg (period conversion not added — OH already in 51013).",
                    `= ${fmtInsightPkr(l2Sales?.totalSalesLandedPerKgSold ?? 0, 2)} / kg`,
                ],
            };
        case "l2_cash_sales_cogs":
            return {
                title: "Sales COGS / kg sold (cash view)",
                lines: div(t.directRm, sold, "Sales COGS"),
            };
        case "l2_cash_conversion":
            return {
                title: "Period conversion / kg produced",
                lines: [
                    `= ${fmtInsightPkr(l2Cash?.periodConversionPerKgProduced ?? l1.conversionBurdenPerKgProduced ?? 0, 2)} / kg`,
                    "Optics only — may double-count OH vs sales COGS.",
                ],
            };
        case "l2_cash_commercial":
            return {
                title: "Commercial / kg sold (cash view)",
                lines: [
                    `= ${fmtInsightPkr(l2Cash?.commercialPerKgSold ?? l1.commercialBurdenPerKgSold ?? 0, 2)} / kg`,
                ],
            };
        case "l2_cash_landed":
            return {
                title: "Cash landed (mixed denom.)",
                lines: [
                    `= ${fmtInsightPkr(l2Cash?.totalCashLandedPerKg ?? 0, 2)}`,
                    "Mixed sold/produced denominators — for cash close review, not GP.",
                ],
            };
        case "unabsorbed":
            return {
                title: "Unabsorbed 51999",
                lines: [
                    `Period 51999: ${fmtInsightPkr(t.unabsorbed ?? 0)}`,
                    "Excluded from L1/L2 rates. Credit = absorption when FG > RM.",
                ],
            };
        case "wastage":
            return {
                title: "Wastage 51006",
                lines: [
                    `Period 51006: ${fmtInsightPkr(t.wastage ?? 0)}`,
                    "Excluded from conversion burden rates.",
                ],
            };
        case "l3_revenue":
            return {
                title: "Revenue / kg",
                lines: div(t.revenue, sold, "operating revenue"),
            };
        case "l3_gross":
            return {
                title: "Gross margin / kg",
                lines: [
                    "(Revenue − Sales COGS) / kg sold",
                    `(${fmtInsightPkr(t.revenue)} − ${fmtInsightPkr(t.directRm)}) ÷ ${fmtInsightKg(sold)}`,
                    `= ${fmtInsightPkr(l3.grossMarginPerKg ?? 0, 2)} / kg`,
                ],
                warning:
                    (l3.grossMarginPerKg ?? 0) < 0
                        ? "Negative gross/kg: average book COGS exceeds average selling price."
                        : undefined,
            };
        case "l3_net":
            return {
                title: "Net margin / kg",
                lines: [
                    "Commercial manufacturing margin / kg (revenue − sales COGS − conversion − factory OH − selling − admin − wastage) / sold kg.",
                    `= ${fmtInsightPkr(l3.netMarginPerKg ?? 0, 2)} / kg`,
                    "Does not equal statutory Net Profit / kg from full P&L.",
                ],
            };
        default:
            return { title: key, lines: ["No formula registered for this row."] };
    }
}

/** Underwater product families for a compact UE summary tip. */
export function buildUeCategoryUnderpricingSummary(
    revenueCats: CategoryAmountRow[],
    cogsCats: CategoryAmountRow[],
): ReportRowInsight | null {
    const warnings: string[] = [];
    for (const cogs of cogsCats) {
        const rev = findCategory(revenueCats, cogs.category_code);
        if (!rev) continue;
        if (cogs.amount > rev.amount + 0.5) {
            const gap = cogs.amount - rev.amount;
            const kg = cogs.kg > 0 ? cogs.kg : rev.kg;
            const perKg = kg > 0 ? ` (${fmtInsightPkr(gap / kg, 2)}/kg)` : "";
            warnings.push(
                `${categoryFamilyLabel(cogs)}: COGS ${fmtInsightPkr(cogs.amount)} > revenue ${fmtInsightPkr(rev.amount)} by ${fmtInsightPkr(gap)}${perKg}`,
            );
        }
    }
    if (!warnings.length) return null;
    return {
        title: "Categories where COGS exceeds revenue",
        lines: warnings,
        warning:
            "Book cost exceeds selling revenue for these families — typically underpricing vs WAC/PAC, not a formula error.",
    };
}
