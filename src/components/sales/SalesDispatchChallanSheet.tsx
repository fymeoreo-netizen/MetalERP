import { useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import {
    PartyDocumentLetterheadPreview,
    PartyDocumentSheetToolbar,
    usePartyDocumentLetterhead,
} from "@/components/documents/PartyDocumentSheetToolbar";
import { dispatchChallanToPdfData } from "@/lib/partyDocumentPdfBuilder";
import type { SalesDispatchChallanData } from "@/lib/salesDispatchChallan";

type SalesDispatchChallanSheetProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    data: SalesDispatchChallanData | null;
    loading?: boolean;
};

function formatKg(n: number): string {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
}

function formatAmount(n: number): string {
    return `₨ ${n.toLocaleString()}`;
}

export function SalesDispatchChallanSheet({
    open,
    onOpenChange,
    data,
    loading = false,
}: SalesDispatchChallanSheetProps) {
    const printRef = useRef<HTMLDivElement>(null);
    const { letterhead, replaceLetterhead } = usePartyDocumentLetterhead();

    const pdfData = useMemo(
        () => (data ? dispatchChallanToPdfData(data) : null),
        [data],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 gap-0">
                <DialogTitle className="sr-only">Sales dispatch challan</DialogTitle>

                {pdfData && !loading ? (
                    <PartyDocumentSheetToolbar
                        title="Dispatch challan"
                        subtitle="For party sharing only — not a tax invoice"
                        printRef={printRef}
                        pdfData={pdfData}
                        letterhead={letterhead}
                        onLetterheadChange={replaceLetterhead}
                    />
                ) : (
                    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
                        <p className="text-sm font-semibold text-slate-900">Dispatch challan</p>
                        <p className="text-xs text-slate-500">For party sharing only — not a tax invoice</p>
                    </div>
                )}

                {loading ? (
                    <div className="flex min-h-[280px] items-center justify-center text-slate-500">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        Loading challan…
                    </div>
                ) : !data ? (
                    <div className="flex min-h-[280px] items-center justify-center text-sm text-slate-500 px-6 text-center">
                        Could not load dispatch challan for this invoice.
                    </div>
                ) : (
                    <div className="p-4 sm:p-6">
                        <div
                            ref={printRef}
                            className="party-document-root bg-white border border-slate-200 p-6 sm:p-8 print:border-none print:shadow-none"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 border-b-2 border-slate-900 pb-6 mb-6">
                                <PartyDocumentLetterheadPreview letterhead={letterhead} />
                                <div className="text-left sm:text-right">
                                    <p className="text-lg font-bold tracking-wide text-slate-900 uppercase">
                                        Dispatch Challan
                                    </p>
                                    <p className="text-xs text-slate-500 mt-1">Party copy — not a tax invoice</p>
                                    <p className="font-mono text-sm font-semibold text-slate-800 mt-3">{data.invoiceNo}</p>
                                    <p className="text-sm text-slate-600 mt-1">{data.invoiceDate}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                        Deliver to
                                    </p>
                                    <p className="text-base font-semibold text-slate-900">{data.partyName}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Vehicle
                                        </p>
                                        <p className="font-mono text-slate-800">{data.vehicleNo || "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Driver
                                        </p>
                                        <p className="text-slate-800">{data.driverName || "—"}</p>
                                    </div>
                                </div>
                            </div>

                            <table className="w-full mb-6 text-sm">
                                <thead>
                                    <tr className="border-b-2 border-slate-900">
                                        <th className="py-2 pr-2 text-left text-[11px] font-bold uppercase text-slate-900 w-10">
                                            #
                                        </th>
                                        <th className="py-2 pr-2 text-left text-[11px] font-bold uppercase text-slate-900">
                                            Item
                                        </th>
                                        <th className="py-2 px-2 text-right text-[11px] font-bold uppercase text-slate-900 w-28">
                                            Net wt
                                        </th>
                                        <th className="py-2 px-2 text-right text-[11px] font-bold uppercase text-slate-900 w-28">
                                            Rate
                                        </th>
                                        <th className="py-2 pl-2 text-right text-[11px] font-bold uppercase text-slate-900 w-32">
                                            Amount
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.lines.length > 0 ? (
                                        data.lines.map((line) => (
                                            <tr key={line.lineNo} className="border-b border-slate-100">
                                                <td className="py-2.5 pr-2 text-slate-500 tabular-nums">{line.lineNo}</td>
                                                <td className="py-2.5 pr-2 text-slate-900">{line.description}</td>
                                                <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-700">
                                                    {formatKg(line.netWeightKg)}
                                                </td>
                                                <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-700">
                                                    {formatAmount(line.rate)}
                                                </td>
                                                <td className="py-2.5 pl-2 text-right font-mono font-medium tabular-nums text-slate-900">
                                                    {formatAmount(line.amount)}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                                                No items on this invoice
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-slate-900">
                                        <td colSpan={2} className="pt-4 text-right text-sm font-bold text-slate-900">
                                            Totals
                                        </td>
                                        <td className="pt-4 px-2 text-right font-mono font-bold tabular-nums text-slate-900">
                                            {formatKg(data.totalWeightKg)}
                                        </td>
                                        <td className="pt-4 px-2" />
                                        <td className="pt-4 pl-2 text-right font-mono text-lg font-bold tabular-nums text-blue-700">
                                            {formatAmount(data.totalAmount)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>

                            {data.remarks ? (
                                <p className="text-sm text-slate-600 mb-6 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                                    <span className="font-medium text-slate-700">Remarks: </span>
                                    {data.remarks}
                                </p>
                            ) : null}

                            <p className="text-xs text-slate-500 border-t border-slate-200 pt-4 mb-8">
                                This dispatch challan confirms goods sent against the referenced sales invoice. It is
                                intended for party acknowledgment only and is not a sales tax invoice.
                            </p>

                            <div className="grid grid-cols-2 gap-10 pt-4">
                                <div className="text-center">
                                    <div className="border-t border-slate-400 w-44 mx-auto mb-2" />
                                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Dispatched by</p>
                                </div>
                                <div className="text-center">
                                    <div className="border-t border-slate-400 w-44 mx-auto mb-2" />
                                    <p className="text-[10px] uppercase tracking-wide text-slate-500">
                                        Received by (party)
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
