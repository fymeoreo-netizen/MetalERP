export type ScrapObligationRow = {
    obligation_id: string;
    obligation_no: string;
    sales_invoice_id: string;
    sales_invoice_no: string;
    invoice_date: string;
    ref_scrap_rate: number;
    expected_kg: number;
    received_kg: number;
    open_kg: number;
    status: string;
};

export type PartyScrapExpectationRow = {
    party_code: string;
    party_name: string;
    obligation_no: string;
    sales_invoice_no: string;
    invoice_date: string;
    ref_scrap_rate: number;
    expected_kg: number;
    received_kg: number;
    open_kg: number;
    status: string;
    obligation_source?: string;
};

export type PartyScrapCreditRow = {
    credit_id: string;
    trade_no: string;
    trade_date: string;
    credit_kg: number;
    consumed_kg: number;
    open_kg: number;
    pending_reason: string;
    status: string;
    ref_scrap_rate: number | null;
    source_doc_id: string;
};

export type ScrapPayableLotRow = {
    lot_id: string;
    lot_no: string;
    source_doc_type?: string;
    source_doc_no: string;
    lot_date: string;
    unit_rate: number;
    original_kg: number;
    allocated_kg: number;
    open_kg: number;
    status: string;
};

export type WattaMatrixRow = {
    id: string;
    party_id: string | null;
    party_code?: string | null;
    party_name?: string | null;
    direction: "sales" | "purchase";
    product_kind: "enamel" | "wire8" | "rod";
    wire8_grade: "Fail" | "Pass" | "Special" | null;
    swg_min: number | null;
    swg_max: number | null;
    base_watta: number;
    increment_per_swg: number;
    effective_from: string;
    is_active: boolean;
    remarks: string | null;
};

export type ScrapAllocationLine = {
    purchaseInvoiceLineId?: string;
    lineSeq: number;
    scrapLotId: string;
    allocatedKg: number;
    scrapRate: number;
    wattaRate: number;
    derivedUnitRate: number;
    isMazdooriPending: boolean;
};
