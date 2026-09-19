import { REPORT_COMPANY } from "@/lib/reportPrintConfig";

export type PartyDocumentLetterhead = {
    name: string;
    addressLine: string;
    phone: string;
    ntn: string;
};

const STORAGE_KEY = "erp.party_document_letterhead";

export function getDefaultPartyDocumentLetterhead(): PartyDocumentLetterhead {
    return {
        name: REPORT_COMPANY.name,
        addressLine: REPORT_COMPANY.addressLine,
        phone: "+92 300 1234567",
        ntn: "1234567-8",
    };
}

export function formatLetterheadContactLine(letterhead: PartyDocumentLetterhead): string {
    const parts: string[] = [];
    if (letterhead.phone.trim()) parts.push(`Phone: ${letterhead.phone.trim()}`);
    if (letterhead.ntn.trim()) parts.push(`NTN: ${letterhead.ntn.trim()}`);
    return parts.join(" | ");
}

export function loadPartyDocumentLetterhead(): PartyDocumentLetterhead {
    if (typeof window === "undefined") return getDefaultPartyDocumentLetterhead();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return getDefaultPartyDocumentLetterhead();
        const parsed = JSON.parse(raw) as Partial<PartyDocumentLetterhead>;
        return { ...getDefaultPartyDocumentLetterhead(), ...parsed };
    } catch {
        return getDefaultPartyDocumentLetterhead();
    }
}

export function savePartyDocumentLetterhead(letterhead: PartyDocumentLetterhead): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(letterhead));
}

export function withLetterhead<T extends { letterhead?: PartyDocumentLetterhead }>(
    data: T,
    letterhead: PartyDocumentLetterhead,
): T & { letterhead: PartyDocumentLetterhead } {
    return { ...data, letterhead };
}
