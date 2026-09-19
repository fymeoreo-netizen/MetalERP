/**
 * Canonical COGS presentation bands shared by P&L / Unit Economics UI.
 * Server reference: migrations 251 (sales split), 276 (UE buckets), 285 (dual L2).
 */

export type CogsBand =
    | "sales_cogs"
    | "period_cash"
    | "wastage"
    | "absorption"
    | "other_cogs";

const SALES_COGS_CODES = new Set(["51001", "51010", "51011", "51012", "51013"]);
const PERIOD_CASH_CODES = new Set([
    "51002",
    "51003",
    "51004",
    "51005",
    "51007",
    "51008",
    "51009",
]);

export function cogsBandForAccount(accountCode: string): CogsBand {
    const code = (accountCode || "").trim();
    if (SALES_COGS_CODES.has(code)) return "sales_cogs";
    if (code === "51006") return "wastage";
    if (code === "51999") return "absorption";
    if (PERIOD_CASH_CODES.has(code)) return "period_cash";
    if (code.startsWith("51")) return "other_cogs";
    return "other_cogs";
}

export const COGS_BAND_LABELS: Record<CogsBand, string> = {
    sales_cogs: "Sales COGS (51001 + 51010–13)",
    period_cash: "Period factory cash in COGS",
    wastage: "Wastage / write-down (51006)",
    absorption: "Absorption / Unabsorbed (51999)",
    other_cogs: "Other COGS (51xxx)",
};

/** Material 51999 debit share of total COGS — warn when FG cost / PAC final is missing. */
export function unabsorbedDominatesCogs(
    unabsorbedDrOrNet: number,
    totalCogs: number,
    threshold = 0.05,
): boolean {
    if (!(totalCogs > 0) || !(unabsorbedDrOrNet > 0)) return false;
    return unabsorbedDrOrNet / totalCogs >= threshold;
}
