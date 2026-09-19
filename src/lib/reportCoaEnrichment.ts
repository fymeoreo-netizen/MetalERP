import { fetchCoaAccounts } from "@/lib/api/masters";
import { buildCoaNameMap } from "@/lib/coaSelectors";
import { resolveReportGroup } from "@/lib/reportGroupInference";

let cachedNameMap: Record<string, string> | null = null;
let cachedGroupMap: Record<string, string> | null = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

async function getCoaMaps(): Promise<{ names: Record<string, string>; groups: Record<string, string> }> {
    const now = Date.now();
    if (cachedNameMap && cachedGroupMap && now - cacheAt < CACHE_MS) {
        return { names: cachedNameMap, groups: cachedGroupMap };
    }
    const rows = await fetchCoaAccounts();
    cachedNameMap = buildCoaNameMap(rows);
    cachedGroupMap = Object.fromEntries(rows.map((r) => [r.code, r.report_group ?? ""]));
    cacheAt = now;
    return { names: cachedNameMap, groups: cachedGroupMap };
}

async function getCoaNameMap(): Promise<Record<string, string>> {
    const { names } = await getCoaMaps();
    return names;
}

export function clearReportCoaNameCache(): void {
    cachedNameMap = null;
    cachedGroupMap = null;
    cacheAt = 0;
}

/** Prefer COA master name when RPC/journal still has code-as-name. */
export function resolveAccountDisplayName(
    code: string,
    rpcName: string | null | undefined,
    nameMap: Record<string, string>,
): string {
    const c = (code ?? "").trim();
    const fromCoa = nameMap[c]?.trim();
    if (fromCoa && fromCoa !== c) return fromCoa;
    const fromRpc = (rpcName ?? "").trim();
    if (fromRpc && fromRpc !== c) return fromRpc;
    return fromCoa || fromRpc || c || "—";
}

export async function enrichTrialBalanceRows<T extends { account_code?: string; account_name?: string }>(
    rows: T[],
): Promise<T[]> {
    const map = await getCoaNameMap();
    return rows.map((r) => {
        const code = String(r.account_code ?? "");
        return {
            ...r,
            account_name: resolveAccountDisplayName(code, r.account_name, map),
        };
    });
}

export async function enrichBalanceSheetRows(
    rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
    const map = await getCoaNameMap();
    return rows.map((r) => {
        const code = String(r.account_code ?? r.report_group ?? "");
        const legacyGrouped = !r.account_code && r.report_group;
        const accountType = String(r.account_type ?? "");
        const closing = Number(r.closing_balance ?? 0);
        if (legacyGrouped) {
            return {
                account_code: code,
                account_name: String(r.report_group ?? code).replace(/_/g, " "),
                account_type: accountType,
                report_group: String(r.report_group ?? "other"),
                closing_balance: closing,
            };
        }
        return {
            ...r,
            account_code: code,
            account_name: resolveAccountDisplayName(code, String(r.account_name ?? ""), map),
            account_type: accountType,
            report_group: String(r.report_group ?? "other"),
            closing_balance: closing,
        };
    });
}

export async function enrichProfitLossRows(
    rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
    const { names, groups } = await getCoaMaps();
    return rows.map((r) => {
        const code = String(r.account_code ?? r.report_group ?? "");
        const accountType = String(r.account_type ?? "");
        const amount = Number(r.amount ?? 0);
        if (!r.account_code && r.report_group) {
            return {
                account_code: code,
                account_name: String(r.report_group).replace(/_/g, " "),
                account_type: accountType,
                report_group: String(r.report_group),
                amount,
            };
        }
        const reportGroup = resolveReportGroup(
            code,
            accountType,
            String(r.report_group ?? ""),
            groups[code],
        );
        return {
            ...r,
            account_code: code,
            account_name: resolveAccountDisplayName(code, String(r.account_name ?? ""), names),
            account_type: accountType,
            report_group: reportGroup,
            amount,
        };
    });
}
