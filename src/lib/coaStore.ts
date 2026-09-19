import {
    deleteCoaAccountSafe,
    fetchCoaAccounts,
    updateCoaAccount,
    upsertCoaAccount,
    type DbCoaRow,
} from "@/lib/api/masters";
import { isErpLiveMode } from "@/lib/backendFlags";
import { clearReportCoaNameCache } from "@/lib/reportCoaEnrichment";

export type CoaNodeType = "group" | "leaf";

export interface CoaNode {
    id: string;
    name: string;
    type: CoaNodeType;
    isAnchor?: boolean;
    isPosting?: boolean;
    isActive?: boolean;
    accountType?: string;
    accountNature?: string;
    reportGroup?: string;
    children?: CoaNode[];
}

const STORAGE_KEY = "coppersync_coa_v1";

export const seedCoa: CoaNode[] = [
    {
        id: "10000",
        name: "ASSETS",
        type: "group",
        children: [
            {
                id: "11000",
                name: "Current Assets",
                type: "group",
                children: [
                    {
                        id: "11100",
                        name: "Cash & Bank",
                        type: "group",
                        children: [
                            { id: "11101", name: "Main Factory Cash Drawer", type: "leaf" },
                            { id: "11102", name: "Meezan Bank", type: "leaf" },
                            { id: "11103", name: "HBL", type: "leaf" },
                        ],
                    },
                    {
                        id: "11200",
                        name: "Trade Receivables",
                        type: "group",
                        children: [
                            { id: "11201", name: "Accounts Receivable - Customers", type: "group", isAnchor: true },
                            { id: "11202", name: "Parchi Receivables", type: "leaf" },
                            { id: "11203", name: "Advance Cash Given to Vendors", type: "leaf" },
                        ],
                    },
                ],
            },
            {
                id: "12000",
                name: "Inventory Assets",
                type: "group",
                children: [
                    {
                        id: "12100",
                        name: "Factory Stock Value",
                        type: "group",
                        children: [
                            { id: "12101", name: "Raw Material Value - Scrap/Cathode", type: "leaf" },
                            { id: "12102", name: "WIP Value - Wire No 8/Rod", type: "leaf" },
                            { id: "12103", name: "Finished Goods Value - Enameled Wire", type: "leaf" },
                        ],
                    },
                ],
            },
        ],
    },
    {
        id: "20000",
        name: "LIABILITIES",
        type: "group",
        children: [
            {
                id: "21000",
                name: "Current Liabilities",
                type: "group",
                children: [
                    {
                        id: "21100",
                        name: "Trade Payables",
                        type: "group",
                        children: [
                            { id: "21101", name: "Accounts Payable - Vendors", type: "group", isAnchor: true },
                            { id: "21102", name: "Vendor Mazdoori Payable", type: "leaf" },
                            { id: "21103", name: "Parchi Payables", type: "leaf" },
                            { id: "21104", name: "Advance Cash Received from Customers", type: "leaf" },
                        ],
                    },
                ],
            },
        ],
    },
    {
        id: "30000",
        name: "EQUITY",
        type: "group",
        children: [
            {
                id: "31000",
                name: "Capital Accounts",
                type: "group",
                children: [
                    { id: "31001", name: "Owner's Capital Investment", type: "leaf" },
                    { id: "31002", name: "Owner Drawings", type: "leaf" },
                ],
            },
            {
                id: "32000",
                name: "Retained Earnings",
                type: "group",
                children: [{ id: "32001", name: "Accumulated Factory Profits", type: "leaf" }],
            },
        ],
    },
    {
        id: "40000",
        name: "INCOME / REVENUE",
        type: "group",
        children: [
            {
                id: "41000",
                name: "Operating Revenue",
                type: "group",
                children: [
                    { id: "41001", name: "Direct Wire Sales", type: "leaf" },
                    { id: "41002", name: "Premium / Watta Income", type: "leaf" },
                    { id: "41003", name: "Scrap Sales", type: "leaf" },
                ],
            },
        ],
    },
    {
        id: "50000",
        name: "EXPENSES & COGS",
        type: "group",
        children: [
            {
                id: "51000",
                name: "Direct Cost of Goods Sold",
                type: "group",
                children: [
                    { id: "51001", name: "Raw Material Consumed", type: "leaf" },
                    { id: "51002", name: "Vendor Processing / Triangle Mazdoori", type: "leaf" },
                    { id: "51003", name: "Factory Furnace & Enamel Utilities", type: "leaf" },
                    { id: "51004", name: "Direct Factory Wages - Operators", type: "leaf" },
                ],
            },
            {
                id: "52000",
                name: "Operating & Admin Expenses",
                type: "group",
                children: [
                    { id: "52001", name: "Office / Gatekeeper Salaries", type: "leaf" },
                    { id: "52002", name: "Logistics, Freight & Unloading Labor", type: "leaf" },
                    { id: "52003", name: "Machine Maintenance & Spares", type: "leaf" },
                ],
            },
        ],
    },
];

const listeners = new Set<() => void>();

function loadCoa(): CoaNode[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as CoaNode[];
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch {
        /* seed */
    }
    return [...seedCoa];
}

let coaState: CoaNode[] = loadCoa();
let liveCoaLoaded = false;

function dbRowToNode(row: DbCoaRow): CoaNode {
    return {
        id: row.code,
        name: row.name,
        type: row.is_group ? "group" : "leaf",
        isAnchor: row.is_anchor,
        isPosting: row.is_posting,
        isActive: row.is_active !== false,
        accountType: row.account_type,
        accountNature: row.account_nature,
        reportGroup: row.report_group,
        children: row.is_group ? [] : undefined,
    };
}

function buildTreeFromDbRows(rows: DbCoaRow[]): CoaNode[] {
    const byCode = new Map<string, CoaNode & { _parent?: string | null }>();
    rows.forEach((r) => byCode.set(r.code, { ...dbRowToNode(r), _parent: r.parent_id ? rows.find((x) => x.id === r.parent_id)?.code ?? null : null }));
    const roots: CoaNode[] = [];
    byCode.forEach((node, code) => {
        const parentCode = node._parent;
        delete (node as { _parent?: string })._parent;
        if (parentCode && byCode.has(parentCode)) {
            const parent = byCode.get(parentCode)!;
            if (!parent.children) parent.children = [];
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    });
    if (roots.length === 0 && rows.length > 0) {
        return rows.filter((r) => !r.parent_id).map((r) => dbRowToNode(r));
    }
    return roots.length ? roots : [...seedCoa];
}

function inferAccountMeta(parentId: string): {
    account_type: string;
    account_nature: string;
    report_group: string;
} {
    const p = parentId.slice(0, 1);
    if (p === "1") return { account_type: "asset", account_nature: "debit", report_group: "current_assets" };
    if (p === "2") return { account_type: "liability", account_nature: "credit", report_group: "current_liabilities" };
    if (p === "3") return { account_type: "equity", account_nature: "credit", report_group: "equity" };
    if (p === "4") return { account_type: "income", account_nature: "credit", report_group: "operating_revenue" };
    return { account_type: "expense", account_nature: "debit", report_group: "cogs" };
}

let initCoaPromise: Promise<void> | null = null;

export async function initCoaCatalog(): Promise<void> {
    if (!isErpLiveMode()) return;
    if (initCoaPromise) return initCoaPromise;
    initCoaPromise = (async () => {
    const rows = await fetchCoaAccounts();
    if (rows.length > 0) {
        coaState = buildTreeFromDbRows(rows);
        liveCoaLoaded = true;
        clearReportCoaNameCache();
        listeners.forEach((fn) => fn());
    }
    })();
    await initCoaPromise;
}

export function isCoaLiveLoaded(): boolean {
    return liveCoaLoaded;
}

function saveCoa() {
    if (isErpLiveMode()) {
        listeners.forEach((fn) => fn());
        return;
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(coaState));
    } catch {
        /* ignore */
    }
    listeners.forEach((fn) => fn());
}

export function subscribeCoa(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getCoaTree(): CoaNode[] {
    return [...coaState];
}

function collectIds(nodes: CoaNode[]): string[] {
    const out: string[] = [];
    const visit = (n: CoaNode) => {
        out.push(n.id);
        (n.children ?? []).forEach(visit);
    };
    nodes.forEach(visit);
    return out;
}

function addChild(nodes: CoaNode[], parentId: string, child: CoaNode): CoaNode[] {
    return nodes.map((n) => {
        if (n.id === parentId) {
            return { ...n, children: [...(n.children ?? []), child] };
        }
        if (!n.children) return n;
        return { ...n, children: addChild(n.children, parentId, child) };
    });
}

export function getNextAccountCode(parentId: string): string {
    const parentPrefix = parentId.slice(0, 3);
    const ids = collectIds(coaState).filter((id) => id.startsWith(parentPrefix));
    const numeric = ids.map((id) => Number(id)).filter((n) => !Number.isNaN(n));
    const next = (numeric.length ? Math.max(...numeric) : Number(parentId)) + 1;
    return String(next).padStart(5, "0");
}

export function addStructuralAccount(input: {
    parentId: string;
    name: string;
    levelType: CoaNodeType;
    accountType?: string;
    accountNature?: string;
    reportGroup?: string;
}): CoaNode {
    const name = input.name.trim();
    if (!name) throw new Error("Account name is required");
    const nextCode = getNextAccountCode(input.parentId);
    if (collectIds(coaState).includes(nextCode)) {
        throw new Error("Could not allocate unique account code");
    }
    const inferred = inferAccountMeta(input.parentId);
    const node: CoaNode = {
        id: nextCode,
        name,
        type: input.levelType,
        accountType: input.accountType ?? inferred.account_type,
        accountNature: input.accountNature ?? inferred.account_nature,
        reportGroup: input.reportGroup ?? inferred.report_group,
        children: input.levelType === "group" ? [] : undefined,
    };
    coaState = addChild(coaState, input.parentId, node);
    saveCoa();

    if (isErpLiveMode()) {
        void upsertCoaAccount({
            code: nextCode,
            name,
            parent_id: null,
            is_group: input.levelType === "group",
            is_posting: input.levelType === "leaf",
            level: input.parentId.length >= 5 ? 3 : 2,
            account_type: input.accountType ?? inferred.account_type,
            account_nature: input.accountNature ?? inferred.account_nature,
            report_group: input.reportGroup ?? inferred.report_group,
        });
    }
    return node;
}

function findAndUpdateNode(
    nodes: CoaNode[],
    code: string,
    patch: Partial<CoaNode>,
): CoaNode[] {
    return nodes.map((n) => {
        if (n.id === code) return { ...n, ...patch };
        if (!n.children) return n;
        return { ...n, children: findAndUpdateNode(n.children, code, patch) };
    });
}

function removeNodeByCode(nodes: CoaNode[], code: string): CoaNode[] {
    const out: CoaNode[] = [];
    for (const n of nodes) {
        if (n.id === code) continue;
        if (n.children?.length) {
            out.push({ ...n, children: removeNodeByCode(n.children, code) });
        } else {
            out.push(n);
        }
    }
    return out;
}

export async function updateStructuralAccount(input: {
    code: string;
    name?: string;
    accountType?: string;
    accountNature?: string;
    reportGroup?: string;
}): Promise<void> {
    const trimmedName = input.name?.trim();
    if (input.name !== undefined && !trimmedName) {
        throw new Error("Account name is required");
    }
    coaState = findAndUpdateNode(coaState, input.code, {
        ...(trimmedName !== undefined ? { name: trimmedName } : {}),
        ...(input.accountType !== undefined ? { accountType: input.accountType } : {}),
        ...(input.accountNature !== undefined ? { accountNature: input.accountNature } : {}),
        ...(input.reportGroup !== undefined ? { reportGroup: input.reportGroup } : {}),
    });
    saveCoa();
    if (isErpLiveMode()) {
        const res = await updateCoaAccount({
            code: input.code,
            name: trimmedName,
            account_type: input.accountType,
            account_nature: input.accountNature,
            report_group: input.reportGroup,
        });
        if (!res.ok) throw new Error(res.error);
    }
}

export async function deactivateOrDeleteAccount(code: string): Promise<"deleted" | "deactivated"> {
    if (isErpLiveMode()) {
        const res = await deleteCoaAccountSafe(code);
        if (!res.ok) throw new Error(res.error);
        if (res.data.mode === "deleted") {
            coaState = removeNodeByCode(coaState, code);
        } else {
            coaState = findAndUpdateNode(coaState, code, { name: `${getNodeName(code) ?? code} (inactive)` });
        }
        saveCoa();
        return res.data.mode === "deleted" ? "deleted" : "deactivated";
    }
    coaState = removeNodeByCode(coaState, code);
    saveCoa();
    return "deleted";
}

function getNodeName(code: string): string | null {
    const walk = (nodes: CoaNode[]): string | null => {
        for (const n of nodes) {
            if (n.id === code) return n.name;
            if (n.children?.length) {
                const found = walk(n.children);
                if (found) return found;
            }
        }
        return null;
    };
    return walk(coaState);
}
