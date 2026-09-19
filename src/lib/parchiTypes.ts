export type ParchiTypeLabel = "Company Parchi" | "Bank Cheque";
export type ParchiDirectionLabel = "Received" | "Issued";
export type ParchiStatusLabel = "Pending" | "Partially Cleared" | "Cleared";

export interface ParchiRegisterRow {
    id: string;
    dbId?: string;
    parchi_type: ParchiTypeLabel;
    date: string;
    due_date: string;
    party: string;
    partyCode?: string;
    total_amount: number;
    cleared_amount: number;
    available_balance: number;
    status: ParchiStatusLabel;
    bank?: string;
    cheque_no?: string;
    guarantor?: string;
    narration?: string;
    direction?: ParchiDirectionLabel;
}

export interface ParchiFormValues {
    party: string;
    amount: string;
    dueDate: string;
    date: string;
    direction: ParchiDirectionLabel;
    guarantor: string;
    narration: string;
    bank: string;
    parchiType: ParchiTypeLabel;
    chequeNo: string;
}

export function formatParchiAmount(n: number): string {
    return `₨ ${n.toLocaleString("en-PK")}`;
}
