import type { DbCoaRow } from "@/lib/api/masters";

export type CoaSelectContext =
    | "cashbook_counter"
    | "cashbook_expense"
    | "cashbook_income"
    | "cashbook_cash_bank"
    | "ledger_cash_bank"
    | "ledger_revenue"
    | "ledger_expenses"
    | "ledger_liabilities"
    | "ledger_equity"
    | "ledger_inventory_assets"
    | "ledger_all";

export function isPostableLeaf(row: DbCoaRow): boolean {
    return row.is_active !== false && row.is_posting === true && row.is_group !== true;
}

export function isCashBankLeaf(row: DbCoaRow): boolean {
    if (!isPostableLeaf(row)) return false;
    return isCashBankAccountCode(row.code);
}

/** Cash drawer / main cash (factory & petty) — excludes bank GL accounts. */
export function isCashDrawerAccountCode(code: string): boolean {
    return code === "11101" || code === "11102";
}

/** Bank current / recon accounts only. */
export function isBankGlAccountCode(code: string): boolean {
    return /^1111[1-4]$/.test(code);
}

/** Cash drawer, main cash, and bank current accounts (11101, 11102, 11111–11114). */
export function isCashBankAccountCode(code: string): boolean {
    return isCashDrawerAccountCode(code) || isBankGlAccountCode(code);
}

/** GL counterpart on cashbook — any postable leaf (parties remain selectable separately). */
export function isCashbookCounterLeaf(row: DbCoaRow): boolean {
    return isPostableLeaf(row);
}

export function isCashbookExpenseLeaf(row: DbCoaRow): boolean {
    return isPostableLeaf(row) && row.account_type === "expense";
}

export function isCashbookIncomeLeaf(row: DbCoaRow): boolean {
    return isPostableLeaf(row) && row.account_type === "income";
}

/** Non-cash asset leaves (AR, inventory, fixed assets, prepaids, etc.). */
export function isInventoryAssetLeaf(row: DbCoaRow): boolean {
    if (!isPostableLeaf(row) || row.account_type !== "asset") return false;
    if (isCashBankLeaf(row)) return false;
    return true;
}

export type LedgerTabLabel =
    | "Cash & Bank"
    | "Revenue"
    | "Expenses"
    | "Liabilities"
    | "Equity"
    | "Inventory & Assets";

export function inferLedgerTab(row: DbCoaRow): LedgerTabLabel {
    if (isCashBankLeaf(row)) return "Cash & Bank";
    if (row.account_type === "income") return "Revenue";
    if (row.account_type === "expense") return "Expenses";
    if (row.account_type === "liability") return "Liabilities";
    if (row.account_type === "equity") return "Equity";
    if (row.account_type === "asset") return "Inventory & Assets";
    return "Expenses";
}

export function filterCoaForContext(rows: DbCoaRow[], ctx: CoaSelectContext): DbCoaRow[] {
    const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));
    switch (ctx) {
        case "cashbook_counter":
            return sorted.filter(isCashbookCounterLeaf);
        case "cashbook_cash_bank":
        case "ledger_cash_bank":
            return sorted.filter(isCashBankLeaf);
        case "cashbook_expense":
        case "ledger_expenses":
            return sorted.filter(isCashbookExpenseLeaf);
        case "cashbook_income":
        case "ledger_revenue":
            return sorted.filter(isCashbookIncomeLeaf);
        case "ledger_liabilities":
            return sorted.filter((r) => isPostableLeaf(r) && r.account_type === "liability");
        case "ledger_equity":
            return sorted.filter((r) => isPostableLeaf(r) && r.account_type === "equity");
        case "ledger_inventory_assets":
            return sorted.filter(isInventoryAssetLeaf);
        case "ledger_all":
            return sorted.filter(isPostableLeaf);
        default:
            return sorted.filter(isPostableLeaf);
    }
}

export function toCoaPickerOptions(rows: DbCoaRow[]): { id: string; name: string; code: string }[] {
    return rows.map((r) => ({
        id: r.code,
        code: r.code,
        name: `[${r.code}] ${r.name}`,
    }));
}

export function buildCoaNameMap(rows: DbCoaRow[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const r of rows) map[r.code] = r.name;
    return map;
}

export type PaymentEntryKind = "party_receipt" | "party_payment" | "gl_receipt" | "gl_payment" | "party_settlement";

export type CashbookAccountOption = {
    id: string;
    name: string;
    kind: "party" | "gl";
    accountType?: string;
};

export function resolveCashbookEntryKind(
    paymentType: "receipt" | "payment",
    isParty: boolean
): PaymentEntryKind {
    if (isParty) return paymentType === "receipt" ? "party_receipt" : "party_payment";
    return paymentType === "receipt" ? "gl_receipt" : "gl_payment";
}

export function buildCashbookAccountOptions(
    parties: { id: string; name: string }[],
    /** Full COA from fetchCoaAccounts() — every postable leaf (same set as ledger "All"). */
    coaRows: DbCoaRow[]
): CashbookAccountOption[] {
    const glLeaves = [...coaRows].sort((a, b) => a.code.localeCompare(b.code)).filter(isPostableLeaf);
    const glOptions = glLeaves.map((r) => ({
        id: r.code,
        name: `[${r.code}] ${r.name}`,
        kind: "gl" as const,
        accountType: r.account_type,
    }));
    const partyOptions = parties.map((p) => ({
        id: p.id,
        name: p.name,
        kind: "party" as const,
    }));
    return [...partyOptions, ...glOptions];
}

export function isPartyAccountSelection(
    selectedAccount: string,
    parties: { id: string; name: string }[]
): boolean {
    return parties.some((p) => p.id === selectedAccount);
}
