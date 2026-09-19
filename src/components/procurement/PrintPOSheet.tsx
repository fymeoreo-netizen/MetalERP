import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useMemo, useRef } from "react";
import {
    PartyDocumentLetterheadPreview,
    PartyDocumentSheetToolbar,
    usePartyDocumentLetterhead,
} from "@/components/documents/PartyDocumentSheetToolbar";
import { purchaseOrderToPdfData } from "@/lib/partyDocumentPdfBuilder";

interface PrintPOSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    order: {
        id: string;
        supplier: string;
        date: string;
        status?: string;
        amount?: number;
        items?: Array<{ item?: string; qty?: number; rate?: number }> | string;
    } | null;
}

export function PrintPOSheet({ open, onOpenChange, order }: PrintPOSheetProps) {
    const printRef = useRef<HTMLDivElement>(null);
    const { letterhead, replaceLetterhead } = usePartyDocumentLetterhead();

    const pdfData = useMemo(
        () => (order ? purchaseOrderToPdfData(order) : null),
        [order],
    );

    if (!order || !pdfData) return null;

    const items = Array.isArray(order.items) ? order.items : [];
    const totalAmount = order.amount
        ? Number(order.amount)
        : items.reduce((sum, i) => sum + Number(i.qty || 0) * Number(i.rate || 0), 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 gap-0">
                <DialogTitle className="sr-only">Purchase order {order.id}</DialogTitle>

                <PartyDocumentSheetToolbar
                    title="Purchase order"
                    subtitle={order.id}
                    printRef={printRef}
                    pdfData={pdfData}
                    letterhead={letterhead}
                    onLetterheadChange={replaceLetterhead}
                />

                <div className="p-4 sm:p-6">
                    <div
                        ref={printRef}
                        className="party-document-root bg-white p-6 sm:p-8 border border-slate-200 print:border-none print:shadow-none"
                    >
                        <div className="flex justify-between items-start border-b pb-6 mb-6">
                            <PartyDocumentLetterheadPreview letterhead={letterhead} />
                            <div className="text-right">
                                <h2 className="text-lg font-bold text-slate-900 uppercase">Purchase Order</h2>
                                <p className="text-sm text-slate-500 mt-1">Vendor copy</p>
                                <p className="font-mono text-sm font-semibold text-slate-800 mt-3">{order.id}</p>
                                <p className="text-sm text-slate-600 mt-1">{order.date}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8">
                            <div>
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                    Vendor
                                </h3>
                                <div className="text-slate-900 font-semibold">{order.supplier}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                        Date
                                    </h3>
                                    <div className="text-slate-900">{order.date}</div>
                                </div>
                                <div>
                                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                        Status
                                    </h3>
                                    <div className="text-slate-900">{order.status ?? "—"}</div>
                                </div>
                            </div>
                        </div>

                        <table className="w-full mb-8 text-sm">
                            <thead>
                                <tr className="border-b-2 border-slate-900">
                                    <th className="text-left py-2 text-[11px] font-bold text-slate-900 uppercase">
                                        Item
                                    </th>
                                    <th className="text-right py-2 text-[11px] font-bold text-slate-900 uppercase w-28">
                                        Qty
                                    </th>
                                    <th className="text-right py-2 text-[11px] font-bold text-slate-900 uppercase w-28">
                                        Rate
                                    </th>
                                    <th className="text-right py-2 text-[11px] font-bold text-slate-900 uppercase w-32">
                                        Amount
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length > 0 ? (
                                    items.map((item, index) => (
                                        <tr key={index} className="border-b border-slate-100">
                                            <td className="py-2 text-slate-900">{item.item || "Unknown Item"}</td>
                                            <td className="py-2 text-right font-mono tabular-nums text-slate-600">
                                                {item.qty || 0}
                                            </td>
                                            <td className="py-2 text-right font-mono tabular-nums text-slate-600">
                                                {Number(item.rate || 0).toLocaleString()}
                                            </td>
                                            <td className="py-2 text-right font-mono font-medium tabular-nums text-slate-900">
                                                {(Number(item.qty || 0) * Number(item.rate || 0)).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={4} className="py-4 text-center text-slate-500 italic">
                                            {typeof order.items === "string" ? order.items : "No items listed"}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colSpan={3} className="pt-4 text-right text-sm font-bold text-slate-900">
                                        Total amount
                                    </td>
                                    <td className="pt-4 text-right text-lg font-bold text-blue-700 font-mono tabular-nums">
                                        ₨ {totalAmount.toLocaleString()}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>

                        <div className="grid grid-cols-2 gap-8 mt-8 pt-8 border-t border-slate-200">
                            <p className="text-xs text-slate-500">
                                Supply as per specification. Invoice must reference this purchase order number.
                            </p>
                            <div className="text-center">
                                <div className="border-t border-slate-400 w-40 mx-auto mb-2" />
                                <p className="text-[10px] uppercase tracking-wide text-slate-500">Authorized signature</p>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
