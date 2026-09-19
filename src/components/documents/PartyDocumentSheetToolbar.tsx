import { useMemo } from "react";
import type { RefObject } from "react";
import { PartyDocumentActions } from "@/components/documents/PartyDocumentActions";
import { PartyDocumentLetterheadEditor } from "@/components/documents/PartyDocumentLetterheadEditor";
import type { PartyDocumentPdfData } from "@/lib/partyDocumentPdfBuilder";
import { withLetterhead, type PartyDocumentLetterhead } from "@/lib/partyDocumentLetterhead";

type PartyDocumentSheetToolbarProps = {
    title: string;
    subtitle?: string;
    printRef: RefObject<HTMLElement | null>;
    pdfData: PartyDocumentPdfData;
    letterhead: PartyDocumentLetterhead;
    onLetterheadChange: (letterhead: PartyDocumentLetterhead) => void;
    disabled?: boolean;
};

export function PartyDocumentSheetToolbar({
    title,
    subtitle,
    printRef,
    pdfData,
    letterhead,
    onLetterheadChange,
    disabled = false,
}: PartyDocumentSheetToolbarProps) {
    const pdfDataWithLetterhead = useMemo(
        () => withLetterhead(pdfData, letterhead),
        [pdfData, letterhead],
    );

    return (
        <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
                </div>
                <PartyDocumentActions
                    printRef={printRef}
                    pdfData={pdfDataWithLetterhead}
                    disabled={disabled}
                    className="shrink-0"
                />
            </div>
            <PartyDocumentLetterheadEditor letterhead={letterhead} onChange={onLetterheadChange} />
        </div>
    );
}

export { usePartyDocumentLetterhead, PartyDocumentLetterheadPreview } from "@/components/documents/PartyDocumentLetterheadEditor";
