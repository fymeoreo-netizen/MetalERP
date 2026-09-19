import { useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, Printer } from "lucide-react";
import {
    buildPartyDocumentPdfFilename,
    getPartyDocumentLabel,
    printPartyDocument,
    sharePartyDocumentPdf,
} from "@/lib/partyDocumentPdf";
import type { PartyDocumentPdfData } from "@/lib/partyDocumentPdfBuilder";
import { useToast } from "@/components/ui/use-toast";

type PartyDocumentActionsProps = {
    printRef: RefObject<HTMLElement | null>;
    pdfData: PartyDocumentPdfData;
    disabled?: boolean;
    className?: string;
};

export function PartyDocumentActions({
    printRef,
    pdfData,
    disabled = false,
    className,
}: PartyDocumentActionsProps) {
    const { toast } = useToast();
    const [sharing, setSharing] = useState(false);
    const [printing, setPrinting] = useState(false);
    const label = getPartyDocumentLabel(pdfData.kind);
    const pdfFilename = buildPartyDocumentPdfFilename(pdfData.kind, pdfData.documentNo, pdfData.partyName);

    const resolvePrintElement = (): HTMLElement | null => {
        const el = printRef.current;
        if (!el) {
            toast({
                title: "Document not ready",
                description: "Wait for the preview to load, then try again.",
                variant: "destructive",
            });
            return null;
        }
        return el;
    };

    const handlePrint = () => {
        const el = resolvePrintElement();
        if (!el) return;
        setPrinting(true);
        try {
            printPartyDocument(el, pdfFilename.replace(/\.pdf$/i, ""));
        } catch (e) {
            toast({
                title: "Print failed",
                description: e instanceof Error ? e.message : "Could not open the print dialog.",
                variant: "destructive",
            });
        } finally {
            setPrinting(false);
        }
    };

    const handleWhatsAppPdf = async () => {
        setSharing(true);
        try {
            const result = await sharePartyDocumentPdf({ pdfData });
            toast({
                title: result === "shared" ? "Shared to WhatsApp" : "PDF downloaded",
                description:
                    result === "shared"
                        ? `${label} PDF shared — pick WhatsApp if prompted.`
                        : `${pdfFilename} saved. WhatsApp opened — tap attach (📎) and select the PDF from Downloads.`,
                duration: 8000,
            });
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return;
            toast({
                title: "Could not share PDF",
                description: e instanceof Error ? e.message : "Try Print instead.",
                variant: "destructive",
                duration: 10000,
            });
        } finally {
            setSharing(false);
        }
    };

    return (
        <div className={className}>
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleWhatsAppPdf()}
                    disabled={disabled || sharing || printing}
                    className="text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                >
                    {sharing ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                        <MessageCircle className="h-4 w-4 mr-1.5" />
                    )}
                    WhatsApp PDF
                </Button>
                <Button
                    type="button"
                    size="sm"
                    onClick={handlePrint}
                    disabled={disabled || sharing || printing}
                    className="bg-blue-600 hover:bg-blue-700"
                >
                    {printing ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                        <Printer className="h-4 w-4 mr-1.5" />
                    )}
                    Print
                </Button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 font-mono truncate" title={pdfFilename}>
                PDF: {pdfFilename}
            </p>
        </div>
    );
}
