/** PostgREST RPC argument aliases and migration hints for posting flows. */
export const POST_RPC_ALT_ARG: Record<string, string> = {
    post_scrap_receipt: "p_doc_id",
    post_drawing_weekly_wage_sheet: "p_sheet_id",
    hard_delete_scrap_trade: "p_doc_id",
    hard_delete_scrap_receipt: "p_doc_id",
};

export const POST_RPC_MIGRATION_HINT: Partial<Record<string, string>> = {
    post_scrap_receipt: "Apply Supabase migrations 76 and 81 (post_scrap_receipt), then run: notify pgrst, 'reload schema';",
    post_scrap_trade:
        "Duplicate scrap payable lot (SPL-…): apply migration 165_scrap_payable_lot_duplicate_repair.sql. Missing GL maps: run 99_repair_scrap_trade_posting_map.sql.",
    post_purchase_invoice:
        "Apply migrations 87–88 on Supabase, then: select * from erp.fn_post_purchase_invoice_deploy_check(); notify pgrst, 'reload schema';",
    post_sales_invoice:
        "Run migrations 96–97 and repair_all_posting_maps.sql. Use Dashboard → Posting health while logged in.",
};
