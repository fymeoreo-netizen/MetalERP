import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerScrollContainer, VirtualLedgerRows, ledgerRowKey } from "@/components/reports/VirtualLedgerRows";
import type { RefObject } from "react";
import type { MetalLedgerDisplayRow } from "./types";

export type MetalLedgerPanelProps = {
    rows: MetalLedgerDisplayRow[];
    metalViewMode: "detail" | "summary";
    onMetalViewModeChange: (mode: "detail" | "summary") => void;
    scrollRef: RefObject<HTMLDivElement | null>;
};

export function MetalLedgerPanel({
    rows,
    metalViewMode,
    onMetalViewModeChange,
    scrollRef,
}: MetalLedgerPanelProps) {
    if (!rows.length) return null;

    return (
        <div className="mb-12 print:mb-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h3 className="text-lg font-bold text-amber-800 tracking-wide border-b-2 border-amber-800 pb-0.5 inline-block uppercase print:border-black print:text-black print:text-[10pt] print:break-after-avoid">
                    Statement of Material Position (Metal Weight)
                </h3>
                <div className="flex gap-1 print:hidden erp-no-print">
                    <Button
                        type="button"
                        size="sm"
                        variant={metalViewMode === "detail" ? "default" : "outline"}
                        className="h-7 text-xs"
                        onClick={() => onMetalViewModeChange("detail")}
                    >
                        Detail
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={metalViewMode === "summary" ? "default" : "outline"}
                        className="h-7 text-xs"
                        onClick={() => onMetalViewModeChange("summary")}
                    >
                        Summary
                    </Button>
                </div>
            </div>
            <p className="text-[11px] text-slate-500 mb-3 print:hidden">
                Wt Received (+) = metal this party gave you. Wt Issued (-) = metal you delivered to this party. Scrap
                trade: source shows Received; destination shows Issued.
            </p>

            <LedgerScrollContainer scrollRef={scrollRef}>
                <div className="border border-slate-300/90 print:border-slate-800 rounded-xl print:rounded-none overflow-hidden print:overflow-visible shadow-sm print:shadow-none bg-white">
                    <Table className="report-table report-table--compact text-[11px] w-full">
                        <TableHeader>
                            <TableRow className="bg-amber-50/50 print:bg-slate-200 border-b-2 border-slate-300 print:border-slate-800">
                                <TableHead className="w-[100px] font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400">
                                    Date
                                </TableHead>
                                <TableHead className="w-[120px] font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400">
                                    Ref No.
                                </TableHead>
                                <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400">
                                    Description / Particulars
                                </TableHead>
                                <TableHead className="text-right w-[100px] font-bold text-slate-800 py-2 h-auto bg-emerald-50/50 print:bg-transparent border-r border-slate-300 print:border-slate-400">
                                    Wt Received (+)
                                </TableHead>
                                <TableHead className="text-right w-[100px] font-bold text-slate-800 py-2 h-auto bg-rose-50/50 print:bg-transparent border-r border-slate-300 print:border-slate-400">
                                    Wt Issued (-)
                                </TableHead>
                                <TableHead className="text-right w-[110px] font-bold text-slate-900 py-2 h-auto bg-amber-50 print:bg-transparent">
                                    Net Wt Balance
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="[&_tr:last-child]:border-0">
                            <VirtualLedgerRows
                                rows={rows}
                                colSpan={6}
                                scrollRef={scrollRef}
                                getRowKey={(row, index) => row.id ?? ledgerRowKey(row, index)}
                                renderRow={(row, index) => (
                                    <TableRow
                                        key={row.id ?? ledgerRowKey(row, index)}
                                        className={`border-b border-slate-200 print:border-slate-300 print:h-6 hover:bg-transparent ${row.isOpening ? "bg-amber-50/30 print:bg-transparent font-medium" : index % 2 === 0 ? "bg-white print:bg-transparent" : "bg-slate-50/50 print:bg-transparent"}`}
                                    >
                                        <TableCell className="py-1.5 whitespace-nowrap border-r border-slate-200 print:border-slate-400">
                                            {format(new Date(row.date), "dd-MMM-yy")}
                                        </TableCell>
                                        <TableCell className="py-1.5 font-mono text-slate-600 border-r border-slate-200 print:border-slate-400">
                                            {row.ref}
                                        </TableCell>
                                        <TableCell className="py-1.5 leading-tight border-r border-slate-200 print:border-slate-400">
                                            <span className="font-semibold text-slate-800 pr-1">
                                                {row.material !== "N/A" ? row.material : ""}
                                            </span>
                                            <span className="text-slate-600">{row.desc}</span>
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right text-emerald-700 font-medium border-r border-slate-200 print:border-slate-400 bg-emerald-50/20 print:bg-transparent">
                                            {row.weightIn > 0 ? `${row.weightIn.toLocaleString()} kg` : "-"}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right text-amber-700 font-medium border-r border-slate-200 print:border-slate-400 bg-rose-50/20 print:bg-transparent">
                                            {row.weightOut > 0 ? `${row.weightOut.toLocaleString()} kg` : "-"}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right font-bold text-slate-900 bg-amber-50/40 print:bg-transparent">
                                            {Math.abs(row.runningBalance).toLocaleString()} kg{" "}
                                            <span className="text-[9px] text-slate-600 font-normal ml-0.5">
                                                {row.runningBalance >= 0 ? "(Adv)" : "(Owed)"}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                )}
                            />
                        </TableBody>
                    </Table>
                </div>
            </LedgerScrollContainer>
            <div className="flex justify-end pt-2 print:pt-1 print:break-inside-avoid">
                <div className="text-right print:pr-1 bg-amber-50/60 print:bg-transparent px-4 py-2 print:py-0.5 rounded-lg border border-amber-200 print:border-none inline-block shadow-sm print:shadow-none">
                    <span className="text-slate-700 font-bold mr-3 text-xs uppercase tracking-wider">
                        Closing Net Weight:
                    </span>
                    <span className="text-base print:text-[11pt] font-bold text-slate-900 underline decoration-double underline-offset-4">
                        {Math.abs(rows[rows.length - 1].runningBalance).toLocaleString()} kg{" "}
                        <span className="text-xs text-slate-700 font-semibold ml-1">
                            {rows[rows.length - 1].runningBalance >= 0 ? "(Advance Given)" : "(Owed to Us)"}
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
}
