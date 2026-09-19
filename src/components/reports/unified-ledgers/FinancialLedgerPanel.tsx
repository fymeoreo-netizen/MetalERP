import { format } from "date-fns";
import {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuditChainTooltip } from "@/components/audit/AuditChainTooltip";
import { LedgerScrollContainer, VirtualLedgerRows, ledgerRowKey } from "@/components/reports/VirtualLedgerRows";
import type { RefObject } from "react";
import { useMemo } from "react";
import { InvoiceRefTooltip } from "./InvoiceRefTooltip";
import {
    buildInvoiceLineAggregates,
    formatRecordedBy,
    isExpandableInvoiceDoc,
    isFinancialOpeningRow,
    openingBalanceSeed,
    type InvoiceLineAggregate,
} from "./ledgerRowMappers";
import type { AccountTypeFilter, FinancialLedgerDisplayRow } from "./types";

export type FinancialLedgerPanelProps = {
    rows: FinancialLedgerDisplayRow[];
    effectiveAccountType: AccountTypeFilter | "Select";
    canViewAuditAttribution: boolean;
    scrollRef: RefObject<HTMLDivElement | null>;
};

function sumSide(rows: FinancialLedgerDisplayRow[], side: "debit" | "credit"): number {
    let total = 0;
    // Opening / B/F seeds Balance only — never inflate period Dr/Cr totals.
    for (const row of rows) {
        if (isFinancialOpeningRow(row)) continue;
        total += side === "debit" ? row.debit : row.credit;
    }
    return total;
}

function displayBalance(row: FinancialLedgerDisplayRow): number {
    if (!isFinancialOpeningRow(row)) return row.runningBalance;
    // If recompute left B/F at 0, fall back to backend/starting seed.
    if (row.runningBalance !== 0) return row.runningBalance;
    return openingBalanceSeed(row);
}

function LedgerRefCell({
    row,
    invoiceAggregate,
}: {
    row: FinancialLedgerDisplayRow;
    invoiceAggregate: InvoiceLineAggregate | undefined;
}) {
    const invoiceHover =
        isExpandableInvoiceDoc(row.sourceDocType) &&
        !!row.sourceDocId &&
        !!invoiceAggregate &&
        invoiceAggregate.lineCount >= 2;

    return (
        <TableCell className="py-1.5 font-mono text-slate-600 border-r border-slate-200 print:border-slate-400">
            {invoiceHover ? (
                <InvoiceRefTooltip aggregate={invoiceAggregate}>{row.ref}</InvoiceRefTooltip>
            ) : (
                row.ref
            )}
        </TableCell>
    );
}

export function FinancialLedgerPanel({
    rows,
    effectiveAccountType,
    canViewAuditAttribution,
    scrollRef,
}: FinancialLedgerPanelProps) {
    const invoiceAggregates = useMemo(() => buildInvoiceLineAggregates(rows), [rows]);

    if (!rows.length) return null;

    const totalDebit = sumSide(rows, "debit");
    const totalCredit = sumSide(rows, "credit");
    const closing = displayBalance(rows[rows.length - 1]);

    return (
        <div className="mb-8 print:mb-4 relative auto-rows-min">
            <div className="flex justify-between items-end mb-3 print:mb-1.5">
                <h3 className="text-lg font-bold text-slate-800 tracking-wide border-b-2 border-blue-800 pb-0.5 inline-block uppercase print:border-black print:text-[10pt] print:break-after-avoid">
                    {effectiveAccountType === "Cash & Bank" && "Cash & Bank Statement"}
                    {effectiveAccountType === "Expenses" && "Expense Ledger Register"}
                    {effectiveAccountType === "Revenue" && "Sales & Revenue Ledger"}
                    {effectiveAccountType === "Liabilities" && "Liabilities Ledger"}
                    {effectiveAccountType === "Equity" && "Equity Ledger"}
                    {effectiveAccountType === "Inventory & Assets" && "Inventory & Assets Ledger"}
                    {effectiveAccountType === "Party" && "Statement of Account (Financial)"}
                    {effectiveAccountType === "All" && "Ledger"}
                </h3>
            </div>

            <TooltipProvider delayDuration={200}>
            <LedgerScrollContainer scrollRef={scrollRef}>
                <div className="border border-slate-300/90 print:border-slate-800 rounded-xl print:rounded-none overflow-hidden print:overflow-visible shadow-sm print:shadow-none bg-white">
                    <Table className="report-table report-table--compact text-[11px] w-full">
                        <TableHeader>
                            <TableRow className="bg-slate-100 print:bg-slate-200 border-b-2 border-slate-300 print:border-slate-800">
                                <TableHead className="w-[80px] font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400">
                                    Date
                                </TableHead>
                                <TableHead className="w-[100px] font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400">
                                    Ref No.
                                </TableHead>
                                <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400">
                                    Particulars / Details
                                </TableHead>
                                <TableHead className="text-right w-[60px] font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400">
                                    Wt/Qty
                                </TableHead>
                                <TableHead className="text-right w-[70px] font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400">
                                    Rate
                                </TableHead>
                                <TableHead className="text-right w-[90px] font-bold text-slate-800 py-2 h-auto bg-slate-50 print:bg-transparent border-r border-slate-300 print:border-slate-400">
                                    Debit (₨)
                                </TableHead>
                                <TableHead className="text-right w-[90px] font-bold text-slate-800 py-2 h-auto bg-slate-50 print:bg-transparent border-r border-slate-300 print:border-slate-400">
                                    Credit (₨)
                                </TableHead>
                                {canViewAuditAttribution && (
                                    <TableHead className="w-[120px] font-bold text-slate-800 py-2 h-auto border-r border-slate-300 print:border-slate-400 print:hidden">
                                        Recorded by
                                    </TableHead>
                                )}
                                <TableHead className="text-right w-[100px] font-bold text-slate-900 py-2 h-auto bg-blue-50/50 print:bg-transparent">
                                    Balance
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="[&_tr:last-child]:border-0">
                            <VirtualLedgerRows
                                rows={rows}
                                colSpan={canViewAuditAttribution ? 9 : 8}
                                scrollRef={scrollRef}
                                getRowKey={(row, index) => row.id ?? ledgerRowKey(row, index)}
                                renderRow={(row, index) => {
                                    const bal = displayBalance(row);
                                    const invoiceAggregate =
                                        row.sourceDocId != null
                                            ? invoiceAggregates.get(row.sourceDocId)
                                            : undefined;
                                    return (
                                    <TableRow
                                        key={row.id ?? ledgerRowKey(row, index)}
                                        className={`border-b border-slate-200 print:border-slate-300 print:h-6 hover:bg-transparent ${isFinancialOpeningRow(row) ? "bg-amber-50/30 print:bg-transparent font-medium" : index % 2 === 0 ? "bg-white print:bg-transparent" : "bg-slate-50/50 print:bg-transparent"}`}
                                    >
                                        <TableCell className="py-1.5 whitespace-nowrap border-r border-slate-200 print:border-slate-400">
                                            {format(new Date(row.date), "dd-MMM-yy")}
                                        </TableCell>
                                        <LedgerRefCell
                                            row={row}
                                            invoiceAggregate={invoiceAggregate}
                                        />
                                        <TableCell className="py-1.5 leading-tight text-slate-600 border-r border-slate-200 print:border-slate-400">
                                            {row.particulars}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right text-slate-600 border-r border-slate-200 print:border-slate-400">
                                            {row.weight || "-"}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right text-slate-600 border-r border-slate-200 print:border-slate-400">
                                            {row.rate?.toLocaleString() || "-"}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right text-slate-800 font-medium border-r border-slate-200 print:border-slate-400 bg-slate-50/30 print:bg-transparent">
                                            {row.debit > 0 ? row.debit.toLocaleString() : "-"}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right text-slate-800 font-medium border-r border-slate-200 print:border-slate-400 bg-slate-50/30 print:bg-transparent">
                                            {row.credit > 0 ? row.credit.toLocaleString() : "-"}
                                        </TableCell>
                                        {canViewAuditAttribution && (
                                            <TableCell className="py-1.5 text-[10px] leading-tight text-slate-600 border-r border-slate-200 print:hidden">
                                                <AuditChainTooltip
                                                    enabled={
                                                        !!row.sourceDocType && !!row.sourceDocId
                                                    }
                                                    sourceDocType={row.sourceDocType}
                                                    sourceDocId={row.sourceDocId}
                                                    postedByName={row.postedByName}
                                                    postedAt={row.postedAt}
                                                >
                                                    {formatRecordedBy(row.postedByName, row.postedAt)}
                                                </AuditChainTooltip>
                                            </TableCell>
                                        )}
                                        <TableCell
                                            className="py-1.5 text-right font-bold tracking-tight bg-blue-50/20 print:bg-transparent text-slate-900"
                                        >
                                            {Math.abs(bal).toLocaleString()}{" "}
                                            <span className="text-[9px] text-slate-500 font-normal ml-0.5">
                                                {bal >= 0 ? "Dr" : "Cr"}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                    );
                                }}
                            />
                        </TableBody>
                        <TableFooter>
                            <TableRow className="bg-slate-100 print:bg-slate-200 border-t-2 border-slate-400 print:border-slate-800 hover:bg-slate-100">
                                <TableCell
                                    colSpan={5}
                                    className="py-2 font-bold uppercase tracking-wider text-slate-700 text-xs border-r border-slate-300 print:border-slate-400"
                                >
                                    Total
                                </TableCell>
                                <TableCell className="py-2 text-right font-bold text-slate-900 tabular-nums border-r border-slate-300 print:border-slate-400 bg-slate-50 print:bg-transparent">
                                    {totalDebit > 0 ? totalDebit.toLocaleString() : "-"}
                                </TableCell>
                                <TableCell className="py-2 text-right font-bold text-slate-900 tabular-nums border-r border-slate-300 print:border-slate-400 bg-slate-50 print:bg-transparent">
                                    {totalCredit > 0 ? totalCredit.toLocaleString() : "-"}
                                </TableCell>
                                {canViewAuditAttribution && (
                                    <TableCell className="py-2 border-r border-slate-300 print:hidden" />
                                )}
                                <TableCell className="py-2 text-right font-bold text-slate-900 tabular-nums bg-blue-50/40 print:bg-transparent">
                                    {Math.abs(closing).toLocaleString()}{" "}
                                    <span className="text-[9px] text-slate-500 font-normal ml-0.5">
                                        {closing >= 0 ? "Dr" : "Cr"}
                                    </span>
                                </TableCell>
                            </TableRow>
                        </TableFooter>
                    </Table>
                </div>
            </LedgerScrollContainer>
            </TooltipProvider>
            <div className="flex flex-wrap justify-end gap-2 pt-2 print:pt-1 print:break-inside-avoid">
                <div className="text-right print:pr-1 bg-slate-100/80 print:bg-transparent px-4 py-2 print:py-0.5 rounded-lg border border-slate-200 print:border-none inline-block shadow-sm print:shadow-none">
                    <span className="text-slate-700 font-bold mr-3 text-xs uppercase tracking-wider">
                        Closing Balance:
                    </span>
                    <span className="text-base print:text-[11pt] font-bold text-slate-900 underline decoration-double underline-offset-4 tabular-nums">
                        ₨ {Math.abs(closing).toLocaleString()}{" "}
                        <span className="text-xs text-slate-600 ml-1 font-semibold">
                            {closing >= 0 ? "Dr" : "Cr"}
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
}
