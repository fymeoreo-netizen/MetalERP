import { printHtmlElementInIframe } from "@/lib/reportPrintConfig";
import { buildPartyDocumentPdfBlob, type PartyDocumentPdfData, type PartyDocumentKind } from "@/lib/partyDocumentPdfBuilder";

export type { PartyDocumentKind, PartyDocumentPdfData };

const DOCUMENT_LABEL: Record<PartyDocumentKind, string> = {
    "sales-order": "Sales Order",
    "purchase-order": "Purchase Order",
    "dispatch-challan": "Dispatch Challan",
};

const DOCUMENT_SLUG: Record<PartyDocumentKind, string> = {
    "sales-order": "Sales-Order",
    "purchase-order": "Purchase-Order",
    "dispatch-challan": "Dispatch-Challan",
};

function slugifyFilenamePart(value: string, maxLen = 48): string {
    const slug = value
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    if (!slug) return "Party";
    return slug.length > maxLen ? slug.slice(0, maxLen).replace(/-$/, "") : slug;
}

export function getPartyDocumentLabel(kind: PartyDocumentKind): string {
    return DOCUMENT_LABEL[kind];
}

export function buildPartyDocumentPdfFilename(
    kind: PartyDocumentKind,
    documentNo: string,
    partyName: string,
): string {
    const type = DOCUMENT_SLUG[kind];
    const doc = slugifyFilenamePart(documentNo || "Document", 32);
    const party = slugifyFilenamePart(partyName || "Party", 40);
    return `${type}_${doc}_${party}.pdf`;
}

export function printPartyDocument(element: HTMLElement, _title?: string): void {
    printHtmlElementInIframe(element);
}

export function generatePartyDocumentPdf(pdfData: PartyDocumentPdfData): Blob {
    return buildPartyDocumentPdfBlob(pdfData);
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type SharePartyDocumentResult = "shared" | "downloaded";

export async function sharePartyDocumentPdf(options: {
    pdfData: PartyDocumentPdfData;
}): Promise<SharePartyDocumentResult> {
    const { pdfData } = options;
    const filename = buildPartyDocumentPdfFilename(pdfData.kind, pdfData.documentNo, pdfData.partyName);
    const label = getPartyDocumentLabel(pdfData.kind);
    const blob = generatePartyDocumentPdf(pdfData);

    if (!blob || blob.size < 100) {
        throw new Error("PDF file could not be created.");
    }

    const file = new File([blob], filename, { type: "application/pdf" });
    const shareText = `${label} ${pdfData.documentNo} — ${pdfData.partyName}`;

    if (typeof navigator.share === "function") {
        try {
            const sharePayload: ShareData = { title: filename, text: shareText, files: [file] };
            if (!navigator.canShare || navigator.canShare(sharePayload)) {
                await navigator.share(sharePayload);
                return "shared";
            }
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                throw err;
            }
        }
    }

    downloadBlob(blob, filename);

    const whatsappText = `${shareText}\n\nThe PDF "${filename}" has been downloaded. Please attach it in this chat (paperclip → Document).`;
    const opened = window.open(
        `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`,
        "_blank",
        "noopener,noreferrer",
    );
    if (!opened) {
        throw new Error(
            `PDF downloaded as "${filename}". Allow popups to open WhatsApp, or attach the file from your Downloads folder.`,
        );
    }

    return "downloaded";
}
