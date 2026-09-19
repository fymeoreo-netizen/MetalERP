/** Client-side catalog of ERP assistant tools (see supabase/functions/erp-assistant/tools.ts). */

export type AssistantToolName =
    | "get_party_ledger"
    | "get_party_metal_ledger"
    | "get_party_balance"
    | "get_ar_aging"
    | "get_ap_aging"
    | "get_pending_rate_register"
    | "get_stock_valuation"
    | "get_sales_invoice"
    | "get_purchase_invoice"
    | "get_party_context"
    | "get_document_context"
    | "search_documents"
    | "search_parties"
    | "resolve_entity"
    | "get_recent_sales_invoices"
    | "get_sales_summary"
    | "get_posting_health"
    | "get_reconciliation_checks"
    | "get_sales_invoice_deploy_check"
    | "get_purchase_invoice_deploy_check"
    | "get_trial_balance"
    | "get_profit_loss"
    | "get_balance_sheet"
    | "get_unit_economics"
    | "get_daily_production"
    | "get_scrap_wastage"
    | "get_transaction_history"
    | "get_cashbook_payment"
    | "get_scrap_trade"
    | "get_document_attribution"
    | "get_parchi"
    | "get_sales_return"
    | "get_purchase_return";

export type AssistantTask = "parchi_overdue_summary";

export type AssistantContext = {
    page?: string;
    party_code?: string;
    doc_no?: string;
    doc_type?:
        | "sales_invoice"
        | "purchase_invoice"
        | "payment"
        | "scrap_trade"
        | "parchi"
        | "sales_return"
        | "purchase_return";
    /** Structured UI task (e.g. generate overdue parchi follow-up). */
    task?: AssistantTask;
    /**
     * Authoritative numbers from the open screen.
     * Edge function treats these like verified tool data — the model must not invent amounts.
     */
    facts?: Record<string, unknown>;
};

export type AssistantResolveCandidate = {
    kind?: string;
    code?: string;
    name?: string;
    score?: number;
};

export const ASSISTANT_TOOL_LABELS: Record<AssistantToolName, string> = {
    get_party_ledger: "Party ledger (PKR)",
    get_party_metal_ledger: "Party metal ledger (kg)",
    get_party_balance: "Party balance snapshot",
    get_ar_aging: "AR aging",
    get_ap_aging: "AP aging",
    get_pending_rate_register: "Pending rate register",
    get_stock_valuation: "Stock valuation",
    get_sales_invoice: "Sales invoice lookup",
    get_purchase_invoice: "Purchase invoice lookup",
    get_party_context: "Party deep context",
    get_document_context: "Document context",
    search_documents: "Document search",
    search_parties: "Party search by name",
    resolve_entity: "Entity resolution",
    get_recent_sales_invoices: "Recent sales invoices",
    get_sales_summary: "Sales summary (totals)",
    get_posting_health: "Posting map health",
    get_reconciliation_checks: "Reconciliation checks",
    get_sales_invoice_deploy_check: "Sales post diagnostics",
    get_purchase_invoice_deploy_check: "Purchase post diagnostics",
    get_trial_balance: "Trial balance",
    get_profit_loss: "Profit & loss",
    get_balance_sheet: "Balance sheet",
    get_unit_economics: "Unit economics",
    get_daily_production: "Daily production",
    get_scrap_wastage: "Scrap & wastage",
    get_transaction_history: "Transaction history (admin)",
    get_cashbook_payment: "Cashbook payment",
    get_scrap_trade: "Scrap trade lookup",
    get_document_attribution: "Document attribution",
    get_parchi: "Parchi lookup",
    get_sales_return: "Sales return lookup",
    get_purchase_return: "Purchase return lookup",
};

/** Base examples; UI filters by allowed tools where possible. */
export const EXAMPLE_QUESTIONS: { text: string; tools?: AssistantToolName[] }[] = [
    { text: "What is A one washing machine's payable?", tools: ["resolve_entity", "get_party_balance", "get_ap_aging"] },
    { text: "Who posted SI-2026-014?", tools: ["get_document_attribution"] },
    { text: "Show cashbook PAY-2026-042", tools: ["get_cashbook_payment"] },
    { text: "Who changed scrap trade SCRAP-2026-003?", tools: ["get_scrap_trade", "get_document_attribution"] },
    { text: "What was the amount of the last sales invoice?", tools: ["get_recent_sales_invoices"] },
    { text: "Total sales summary this month", tools: ["get_sales_summary"] },
    { text: "Show open pending rate items", tools: ["get_pending_rate_register"] },
    { text: "Trial balance this month", tools: ["get_trial_balance"] },
    { text: "Daily production last week", tools: ["get_daily_production"] },
];

export function filterExamplesForTools(allowed: string[]): string[] {
    const set = new Set(allowed);
    const matched = EXAMPLE_QUESTIONS.filter(
        (q) => !q.tools?.length || q.tools.every((t) => set.has(t)),
    );
    const pool = matched.length ? matched : EXAMPLE_QUESTIONS.filter((q) => !q.tools?.length);
    return pool.map((q) => q.text);
}
