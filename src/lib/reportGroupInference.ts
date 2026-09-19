/** Resolve P&L report_group from COA master, RPC value, or standard account-code bands (COA 37). */
export function inferReportGroupFromCode(
    accountCode: string,
    accountType?: string | null,
): string | null {
    const code = (accountCode ?? "").trim();
    if (!code || code.includes("_")) return null;

    const type = (accountType ?? "").trim();
    if (type === "income" || code.startsWith("4")) {
        if (code.startsWith("42")) return "other_income";
        if (code.startsWith("40") || code.startsWith("41")) return "operating_revenue";
        return null;
    }
    if (type === "expense" || /^[567]/.test(code)) {
        if (code.startsWith("50") || code.startsWith("51")) return "cogs";
        if (code.startsWith("61")) return "selling_expense";
        if (code.startsWith("62")) return "admin_expense";
        if (code.startsWith("63")) return "factory_overhead";
        if (code.startsWith("70") || code.startsWith("71")) return "other_expense";
    }
    return null;
}

export function resolveReportGroup(
    accountCode: string,
    accountType: string,
    rpcGroup?: string | null,
    coaGroup?: string | null,
): string {
    const fromCoa = (coaGroup ?? "").trim();
    if (fromCoa && fromCoa !== "other") return fromCoa;

    const fromRpc = (rpcGroup ?? "").trim();
    if (fromRpc && fromRpc !== "other") return fromRpc;

    const inferred = inferReportGroupFromCode(accountCode, accountType);
    if (inferred) return inferred;

    return fromRpc || fromCoa || "other";
}

export function isCogsRow(row: { report_group?: string }): boolean {
    return row.report_group === "cogs";
}
