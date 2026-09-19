import { jsPDF } from "jspdf";
import {
    formatLetterheadContactLine,
    getDefaultPartyDocumentLetterhead,
    type PartyDocumentLetterhead,
} from "@/lib/partyDocumentLetterhead";
import type { SalesDispatchChallanData } from "@/lib/salesDispatchChallan";

export type PartyDocumentKind = "sales-order" | "purchase-order" | "dispatch-challan";

const DOCUMENT_LABEL: Record<PartyDocumentKind, string> = {
    "sales-order": "Sales Order",
    "purchase-order": "Purchase Order",
    "dispatch-challan": "Dispatch Challan",
};

function getDocumentTitle(kind: PartyDocumentKind): string {
    return DOCUMENT_LABEL[kind];
}

export type PartyDocumentPdfLine = {
    lineNo?: number;
    description: string;
    middle: string;
    rate: string;
    amount: string;
};

export type PartyDocumentPdfData = {
    kind: PartyDocumentKind;
    documentNo: string;
    partyName: string;
    partyLabel: string;
    date: string;
    status?: string;
    vehicleNo?: string;
    driverName?: string;
    remarks?: string;
    middleHeader: string;
    lines: PartyDocumentPdfLine[];
    totalMiddle?: string;
    totalAmount: string;
    footerNote: string;
    letterhead?: PartyDocumentLetterhead;
};

const MARGIN = 14;
const ROW_H = 6;
const HEADER_H = 7;

function fmtMoney(n: number): string {
    return `Rs ${n.toLocaleString()}`;
}

function fmtKg(n: number): string {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
}

function ensurePage(pdf: jsPDF, y: number, need: number): number {
    const pageHeight = pdf.internal.pageSize.getHeight();
    if (y + need <= pageHeight - MARGIN) return y;
    pdf.addPage();
    return MARGIN;
}

function drawTableHeader(pdf: jsPDF, y: number, middleHeader: string): number {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const w = pageWidth - MARGIN * 2;
    const colNo = 8;
    const colMid = 28;
    const colRate = 28;
    const colAmt = 28;
    const colDesc = w - colNo - colMid - colRate - colAmt;

    pdf.setFillColor(15, 23, 42);
    pdf.rect(MARGIN, y - 4, w, HEADER_H, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    let x = MARGIN + 1;
    pdf.text("#", x, y);
    x += colNo;
    pdf.text("Item", x, y);
    x += colDesc;
    pdf.text(middleHeader, x + colMid - 2, y, { align: "right" });
    x += colMid;
    pdf.text("Rate", x + colRate - 2, y, { align: "right" });
    x += colRate;
    pdf.text("Amount", x + colAmt - 2, y, { align: "right" });
    pdf.setTextColor(0, 0, 0);
    return y + HEADER_H;
}

function drawTableRow(
    pdf: jsPDF,
    y: number,
    line: PartyDocumentPdfLine,
    middleHeader: string,
): number {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const w = pageWidth - MARGIN * 2;
    const colNo = 8;
    const colMid = 28;
    const colRate = 28;
    const colAmt = 28;
    const colDesc = w - colNo - colMid - colRate - colAmt;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    const descLines = pdf.splitTextToSize(line.description, colDesc - 2);
    const rowHeight = Math.max(ROW_H, descLines.length * 4.5);

    y = ensurePage(pdf, y, rowHeight + 2);

    let x = MARGIN + 1;
    pdf.text(String(line.lineNo ?? ""), x, y);
    x += colNo;
    pdf.text(descLines, x, y);
    x += colDesc;
    pdf.text(line.middle, x + colMid - 2, y, { align: "right" });
    x += colMid;
    pdf.text(line.rate, x + colRate - 2, y, { align: "right" });
    x += colRate;
    pdf.text(line.amount, x + colAmt - 2, y, { align: "right" });

    pdf.setDrawColor(226, 232, 240);
    pdf.line(MARGIN, y + 2, MARGIN + w, y + 2);

    return y + rowHeight;
}

export function buildPartyDocumentPdfBlob(data: PartyDocumentPdfData): Blob {
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const title = getDocumentTitle(data.kind);
    const letterhead = data.letterhead ?? getDefaultPartyDocumentLetterhead();
    const contactLine = formatLetterheadContactLine(letterhead);

    let y = MARGIN;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text(letterhead.name || "—", MARGIN, y);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text(title.toUpperCase(), pageWidth - MARGIN, y, { align: "right" });
    y += 6;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.text(letterhead.addressLine || "—", MARGIN, y);
    pdf.text(data.documentNo, pageWidth - MARGIN, y, { align: "right" });
    y += 4;
    if (contactLine) {
        pdf.text(contactLine, MARGIN, y);
    }
    pdf.text(data.date, pageWidth - MARGIN, y, { align: "right" });
    y += 8;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(data.partyLabel.toUpperCase(), MARGIN, y);
    y += 4;
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(11);
    pdf.text(data.partyName, MARGIN, y);
    y += 6;

    if (data.status) {
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Status: ${data.status}`, MARGIN, y);
        y += 5;
    }

    if (data.vehicleNo || data.driverName) {
        pdf.setFontSize(9);
        const parts = [
            data.vehicleNo ? `Vehicle: ${data.vehicleNo}` : null,
            data.driverName ? `Driver: ${data.driverName}` : null,
        ].filter(Boolean);
        pdf.text(parts.join("  ·  "), MARGIN, y);
        y += 5;
    }

    y += 2;
    y = drawTableHeader(pdf, y, data.middleHeader);

    if (data.lines.length === 0) {
        pdf.setFont("helvetica", "italic");
        pdf.setFontSize(9);
        pdf.text("No line items", MARGIN, y + 4);
        y += 10;
    } else {
        for (const line of data.lines) {
            y = drawTableRow(pdf, y + 4, line, data.middleHeader);
        }
    }

    y = ensurePage(pdf, y, 14);
    y += 6;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("Totals", pageWidth - MARGIN - 60, y);
    if (data.totalMiddle) {
        pdf.text(data.totalMiddle, pageWidth - MARGIN - 32, y, { align: "right" });
    }
    pdf.setTextColor(29, 78, 216);
    pdf.text(data.totalAmount, pageWidth - MARGIN, y, { align: "right" });
    pdf.setTextColor(0, 0, 0);

    if (data.remarks?.trim()) {
        y += 8;
        y = ensurePage(pdf, y, 12);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        const remarkLines = pdf.splitTextToSize(`Remarks: ${data.remarks.trim()}`, pageWidth - MARGIN * 2);
        pdf.text(remarkLines, MARGIN, y);
        y += remarkLines.length * 4.5;
    }

    y += 8;
    y = ensurePage(pdf, y, 20);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    const footerLines = pdf.splitTextToSize(data.footerNote, pageWidth - MARGIN * 2);
    pdf.text(footerLines, MARGIN, y);

    const blob = pdf.output("blob");
    if (!blob || blob.size < 100) {
        throw new Error("PDF generation produced an empty file.");
    }
    return blob;
}

export function salesOrderToPdfData(order: {
    id: string;
    customer: string;
    date: string;
    status?: string;
    items?: Array<{ item?: string; qty?: number; rate?: number }>;
}): PartyDocumentPdfData {
    const lines = (order.items ?? []).map((item, idx) => {
        const qty = Number(item.qty || 0);
        const rate = Number(item.rate || 0);
        return {
            lineNo: idx + 1,
            description: item.item || "Item",
            middle: qty.toLocaleString(),
            rate: rate.toLocaleString(),
            amount: (qty * rate).toLocaleString(),
        };
    });
    const total = (order.items ?? []).reduce((s, i) => s + Number(i.qty || 0) * Number(i.rate || 0), 0);
    return {
        kind: "sales-order",
        documentNo: order.id,
        partyName: order.customer,
        partyLabel: "Customer",
        date: order.date,
        status: order.status,
        middleHeader: "Qty",
        lines,
        totalAmount: fmtMoney(total),
        footerNote: "This sales order is shared with the customer for confirmation. It is not a tax invoice.",
    };
}

export function purchaseOrderToPdfData(order: {
    id: string;
    supplier: string;
    date: string;
    status?: string;
    amount?: number;
    items?: Array<{ item?: string; qty?: number; rate?: number }> | string;
}): PartyDocumentPdfData {
    const items = Array.isArray(order.items) ? order.items : [];
    const lines = items.map((item, idx) => {
        const qty = Number(item.qty || 0);
        const rate = Number(item.rate || 0);
        return {
            lineNo: idx + 1,
            description: item.item || "Item",
            middle: qty.toLocaleString(),
            rate: rate.toLocaleString(),
            amount: (qty * rate).toLocaleString(),
        };
    });
    const total = order.amount
        ? Number(order.amount)
        : items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.rate || 0), 0);
    return {
        kind: "purchase-order",
        documentNo: order.id,
        partyName: order.supplier,
        partyLabel: "Vendor",
        date: order.date,
        status: order.status,
        middleHeader: "Qty",
        lines,
        totalAmount: fmtMoney(total),
        footerNote: "Supply as per specification. Invoice must reference this purchase order number.",
    };
}

export function dispatchChallanToPdfData(data: SalesDispatchChallanData): PartyDocumentPdfData {
    return {
        kind: "dispatch-challan",
        documentNo: data.invoiceNo,
        partyName: data.partyName,
        partyLabel: "Deliver to",
        date: data.invoiceDate,
        vehicleNo: data.vehicleNo,
        driverName: data.driverName,
        remarks: data.remarks,
        middleHeader: "Net wt",
        lines: data.lines.map((l) => ({
            lineNo: l.lineNo,
            description: l.description,
            middle: fmtKg(l.netWeightKg),
            rate: fmtMoney(l.rate),
            amount: fmtMoney(l.amount),
        })),
        totalMiddle: fmtKg(data.totalWeightKg),
        totalAmount: fmtMoney(data.totalAmount),
        footerNote:
            "This dispatch challan confirms goods sent against the referenced sales invoice. It is for party acknowledgment only and is not a sales tax invoice.",
    };
}
