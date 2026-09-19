export type CashbookVoucherType = "CRV" | "CPV";
export type CashbookClearanceMode = "Cash" | "Clear Parchi";
export type CashbookEntryMode = "standard" | "cross_party";
export type CashbookLedgerViewMode = "date" | "page";
export type CashbookVirtualLeg = "settlement_payment" | "settlement_receipt";

export type CashbookLedgerRow = {
    id: string;
    dbId?: string;
    sourcePaymentNo?: string;
    sourceRemarks?: string;
    groupSourceId?: string;
    virtualLeg?: CashbookVirtualLeg;
    partyCode?: string;
    counterPartyCode?: string;
    entryKind?: string;
    amount?: number;
    counterAccountCode?: string;
    bankAccountCode?: string;
    pageNo: string;
    date: string;
    account: string;
    voucherType: string;
    mode: string;
    desc: string;
    debit: number;
    credit: number;
    balance: number;
};

export type ParchiCommitmentRow = {
    parchi_id: string;
    dbId?: string;
    party_id: string;
    party_name: string;
    total_amount: number;
    cleared_amount: number;
    available_balance: number;
    status: string;
};

export function formatPkr(n: number): string {
    return `₨ ${n.toLocaleString("en-PK")}`;
}
