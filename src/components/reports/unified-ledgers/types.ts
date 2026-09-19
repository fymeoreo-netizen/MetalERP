import type { CoaSelectContext } from "@/lib/coaSelectors";

export const LEDGER_TABS = [
    "Party",
    "Cash & Bank",
    "Revenue",
    "Expenses",
    "Liabilities",
    "Equity",
    "Inventory & Assets",
] as const;

export type LedgerAccountTab = (typeof LEDGER_TABS)[number];
export type AccountTypeFilter = "All" | LedgerAccountTab;

export type LedgerAccountOption = {
    id: string;
    name: string;
    kind: "party" | "gl";
    tab: LedgerAccountTab;
};

export const LEDGER_TAB_CONTEXT: Partial<Record<LedgerAccountTab, CoaSelectContext>> = {
    "Cash & Bank": "ledger_cash_bank",
    Revenue: "ledger_revenue",
    Expenses: "ledger_expenses",
    Liabilities: "ledger_liabilities",
    Equity: "ledger_equity",
    "Inventory & Assets": "ledger_inventory_assets",
};

export type UnifiedLedgersPanelProps = {
    embedded?: boolean;
    initialPartyCode?: string;
    initialShowParchi?: boolean;
    /** When set, limit account type filter and picker (e.g. accountant: Party + Cash & Bank). */
    allowedAccountTabs?: readonly LedgerAccountTab[];
};

export type FinancialLedgerDisplayRow = {
    id: string;
    date: string;
    ref: string;
    desc: string;
    particulars: string;
    weight: number | null;
    rate: number | null;
    debit: number;
    credit: number;
    isOpening: boolean;
    /** Prior closing used when Dr/Cr are 0 on the B/F row. */
    startingBal?: number | null;
    runningBalance: number;
    runningBalanceFromBackend?: number | null;
    sourceDocType?: string | null;
    sourceDocId?: string | null;
    postedByName?: string | null;
    postedAt?: string | null;
    sortIndex: number;
};

export type MetalLedgerDisplayRow = {
    id: string;
    date: string;
    ref: string;
    material: string;
    desc: string;
    weightIn: number;
    weightOut: number;
    isOpening: boolean;
    runningBalance: number;
    sourceDocType?: string | null;
    runningKgFromBackend?: number | null;
};

export const MOCK_ACCOUNTS: Record<LedgerAccountTab, { id: string; name: string }[]> = {
    Party: [
        { id: "P-01", name: "Alpha Cables (Customer)" },
        { id: "P-02", name: "Gamma Scrap (Vendor)" },
    ],
    "Cash & Bank": [
        { id: "11102", name: "[11102] Main Cash" },
        { id: "11111", name: "[11111] Meezan Bank" },
    ],
    Revenue: [
        { id: "41001", name: "[41001] Sales Revenue" },
        { id: "42002", name: "[42002] Interest Received" },
    ],
    Expenses: [
        { id: "62001", name: "[62001] Office Salaries" },
        { id: "62002", name: "[62002] Office Rent & Utilities" },
    ],
    Liabilities: [{ id: "21102", name: "[21102] Vendor Mazdoori Payable" }],
    Equity: [{ id: "31002", name: "[31002] Owner Capital" }],
    "Inventory & Assets": [{ id: "12104", name: "[12104] Raw Material - Other" }],
};

export const MOCK_FINANCIAL_TRANSACTIONS = [
    { id: "TX-1", date: "2026-04-10", ref: "OB", desc: "Opening Balance", particulars: "-", weight: null, rate: null, debit: 0, credit: 0, type: "Party", accId: "P-01", isOpening: true, startingBal: 500000 },
    { id: "TX-2", date: "2026-04-11", ref: "SI-26-001", desc: "Sale", particulars: "28 SWG Enameled Wire", weight: 50, rate: 2400, debit: 120000, credit: 0, type: "Party", accId: "P-01" },
    { id: "TX-3", date: "2026-04-12", ref: "CV-26-008", desc: "Cash Received", particulars: "Bank Transfer", weight: null, rate: null, debit: 0, credit: 50000, type: "Party", accId: "P-01" },
    { id: "TX-4", date: "2026-04-13", ref: "SI-26-002", desc: "Sale", particulars: "30 SWG Fine Wire", weight: 30, rate: 2666.67, debit: 80000, credit: 0, type: "Party", accId: "P-01" },
    { id: "TX-5", date: "2026-04-10", ref: "OB", desc: "Opening Balance", particulars: "-", weight: null, rate: null, debit: 0, credit: 0, type: "Cash & Bank", accId: "11102", isOpening: true, startingBal: 1200000 },
    { id: "TX-6", date: "2026-04-12", ref: "CV-26-008", desc: "Cash Deposit", particulars: "Alpha Cables", weight: null, rate: null, debit: 50000, credit: 0, type: "Cash & Bank", accId: "11102" },
    { id: "TX-7", date: "2026-04-14", ref: "CV-26-009", desc: "Factory Rent", particulars: "Bank Transfer", weight: null, rate: null, debit: 0, credit: 35000, type: "Cash & Bank", accId: "11102" },
    { id: "TX-8", date: "2026-04-10", ref: "OB", desc: "Opening Balance", particulars: "-", weight: null, rate: null, debit: 0, credit: 0, type: "Party", accId: "P-02", isOpening: true, startingBal: -200000 },
    { id: "TX-9", date: "2026-04-13", ref: "PI-26-003", desc: "Purchase Invoice", particulars: "Wire No 8 Raw", weight: 50, rate: 3000, debit: 0, credit: 150000, type: "Party", accId: "P-02" },
];

export const MOCK_METAL_TRANSACTIONS = [
    { id: "MX-1", date: "2026-04-10", ref: "OB", material: "N/A", desc: "Opening Metal Balance", weightIn: 0, weightOut: 0, type: "Party", accId: "P-01", isOpening: true, startingBal: 150 },
    { id: "MX-2", date: "2026-04-11", ref: "SI-26-001", material: "Copper Scrap", desc: "Scrap Allocated against Sale", weightIn: 0, weightOut: 50, type: "Party", accId: "P-01" },
    { id: "MX-3", date: "2026-04-10", ref: "OB", material: "N/A", desc: "Opening Metal Balance", weightIn: 0, weightOut: 0, type: "Party", accId: "P-02", isOpening: true, startingBal: -800 },
    { id: "MX-4", date: "2026-04-12", ref: "VR-26-002", material: "Wire No 8", desc: "Vendor Settlement Receipt", weightIn: 500, weightOut: 0, type: "Party", accId: "P-02" },
];

export const MOCK_PARCHIS: Record<string, Array<Record<string, unknown>>> = {
    "P-01": [
        {
            parchi_no: "PR-26-001",
            parchi_type: "company_parchi",
            direction: "received",
            issue_date: "2026-04-11",
            due_date: "2026-05-11",
            total_amount: 120000,
            cleared_amount: 0,
            open_amount: 120000,
            status: "open",
        },
    ],
};
