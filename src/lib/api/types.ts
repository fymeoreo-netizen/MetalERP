/** Shared API result envelope. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Default page size for sales/purchase invoice & return lists in the UI. */
export const ERP_DOC_LIST_PAGE_SIZE = 50;

export type PaginatedRows<T> = {
    rows: T[];
    total: number;
    hasMore: boolean;
};

/** Returned by invoice modal save/post handlers so the modal can retain dbId after a failed post. */
export type DocActionResult = { ok: boolean; dbId?: string; error?: string };

export type InventoryBalancesSnapshot = {
    balancesByCode: Record<string, number>;
    /** On-hand unit count (coils/pieces) from erp.inventory_balances.on_hand_units. */
    unitsByCode: Record<string, number>;
    /** Weighted-average unit cost (PKR per kg) from erp.inventory_balances. */
    avgUnitCostByCode: Record<string, number>;
};

export type InventorySnapshot = InventoryBalancesSnapshot & {
    movements: Array<{
        id: string;
        type: string;
        itemCode: string;
        qty: number;
        unit: string;
        refDocId: string;
        refDocType: string;
        at: string;
        docDate?: string;
    }>;
};

export type PostingDiagnosticRow = {
    check_name: string;
    status: "OK" | "FAIL" | "WARN";
    detail: string;
};

export type PostingDiagnostics = {
    liveMode: boolean;
    sessionUserId: string | null;
    erpAccess: Record<string, unknown> | null;
    rows: PostingDiagnosticRow[];
    rawJson: string;
};

export type StockCheckFailure = { itemCode: string; requested: number; available: number };

export type DocListPageOpts = {
    offset?: number;
    limit?: number;
    search?: string;
};
