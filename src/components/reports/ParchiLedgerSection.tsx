import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Copy, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { invokeErpAssistant } from "@/lib/ai/assistantApi";
import {
    buildParchiSummaryFacts,
    computeAdjustedBalance,
    extractPaymentsFromPartyLedger,
    extractSalesFromPartyLedger,
    formatBalanceLabel,
    PARCHI_OVERDUE_SUMMARY_PROMPT,
    reconcilePartyParchis,
    type ParchiInstrumentRow,
} from "@/lib/parchiLedgerReconciliation";
import { toast } from "sonner";

function mapParchiStatus(status: string): string {
    if (status === "cleared") return "Cleared";
    if (status === "partial") return "Partial";
    if (status === "void") return "Void";
    return "Open";
}

type ParchiLedgerSectionProps = {
    partyCode: string;
    partyName: string;
    dateFrom: string;
    dateTo: string;
    partyLedgerRows: Record<string, unknown>[];
    parchis: ParchiInstrumentRow[];
    closingBalance: number;
};

export function ParchiLedgerSection({
    partyCode,
    partyName,
    dateFrom,
    dateTo,
    partyLedgerRows,
    parchis,
    closingBalance,
}: ParchiLedgerSectionProps) {
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [summaryText, setSummaryText] = useState("");
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    const reconciliation = useMemo(() => {
        const sales = extractSalesFromPartyLedger(partyLedgerRows);
        return reconcilePartyParchis(sales, parchis);
    }, [partyLedgerRows, parchis]);

    const recentPayments = useMemo(
        () => extractPaymentsFromPartyLedger(partyLedgerRows, 5),
        [partyLedgerRows],
    );

    const openParchis = useMemo(
        () => parchis.filter((p) => String(p.status ?? "") !== "void" && Number(p.open_amount ?? 0) > 0),
        [parchis],
    );

    const adjustedBalance = computeAdjustedBalance(closingBalance, reconciliation.totalOpenParchi);
    const hasOverdue = reconciliation.overdueParchis.length > 0;

    const summaryFacts = useMemo(
        () =>
            buildParchiSummaryFacts({
                partyCode,
                partyName,
                dateFrom,
                dateTo,
                reconciliation,
                recentPayments,
                openParchis,
                closingBalance,
            }),
        [partyCode, partyName, dateFrom, dateTo, reconciliation, recentPayments, openParchis, closingBalance],
    );

    // Drop cached AI text when ledger/parchi context changes.
    useEffect(() => {
        setSummaryText("");
        setSummaryError(null);
    }, [summaryFacts]);

    const generateSummary = useCallback(async () => {
        setSummaryLoading(true);
        setSummaryError(null);
        setSummaryText("");
        try {
            const result = await invokeErpAssistant(PARCHI_OVERDUE_SUMMARY_PROMPT, {
                page: "unified-ledgers",
                party_code: partyCode,
                task: "parchi_overdue_summary",
                facts: summaryFacts,
            });
            if (!result.ok || !result.answer?.trim()) {
                const err = result.error ?? "Could not generate summary";
                setSummaryError(err);
                toast.error(err);
                return;
            }
            setSummaryText(result.answer.trim());
        } catch (e) {
            const err = e instanceof Error ? e.message : "Could not generate summary";
            setSummaryError(err);
            toast.error(err);
        } finally {
            setSummaryLoading(false);
        }
    }, [partyCode, summaryFacts]);

    const openSummary = () => {
        setSummaryOpen(true);
        if (!summaryText && !summaryLoading) {
            void generateSummary();
        }
    };

    const copySummary = async () => {
        if (!summaryText) return;
        try {
            await navigator.clipboard.writeText(summaryText);
            toast.success("Summary copied to clipboard");
        } catch {
            toast.error("Could not copy — select and copy manually");
        }
    };

    return (
        <div className="mb-8 print:mb-4 space-y-6">
            {reconciliation.salesMissingParchi.length > 0 && (
                <div className="print:break-inside-avoid">
                    <h3 className="text-lg font-bold text-rose-900 tracking-wide border-b-2 border-rose-700 pb-0.5 inline-block mb-3 uppercase print:border-black print:text-black print:text-[10pt] print:mb-1.5 print:break-after-avoid">
                        Sales — Parchi Not Yet Received
                    </h3>
                    <div className="border border-rose-200/90 print:border-slate-800 rounded-xl print:rounded-none overflow-hidden print:overflow-visible shadow-sm print:shadow-none bg-white">
                        <Table className="report-table report-table--compact text-[11px] print:text-[10px] w-full">
                            <TableHeader>
                                <TableRow className="bg-rose-50/70 print:bg-slate-200 border-b-2 border-rose-200 print:border-slate-800">
                                    <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-rose-200 print:border-slate-400">
                                        Invoice
                                    </TableHead>
                                    <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-rose-200 print:border-slate-400">
                                        Sale Date
                                    </TableHead>
                                    <TableHead className="text-right font-bold text-slate-800 py-2 h-auto border-r border-rose-200 print:border-slate-400">
                                        Amount (₨)
                                    </TableHead>
                                    <TableHead className="text-right font-bold text-slate-800 py-2 h-auto">
                                        Days Since Sale
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {reconciliation.salesMissingParchi.map((s, index) => (
                                    <TableRow
                                        key={`${s.invoiceNo}-${s.saleDate}`}
                                        className={`border-b border-rose-100 print:border-slate-300 ${index % 2 === 0 ? "bg-white print:bg-transparent" : "bg-rose-50/20 print:bg-transparent"}`}
                                    >
                                        <TableCell className="py-1.5 font-mono font-semibold text-slate-800 border-r border-rose-100 print:border-slate-400">
                                            {s.invoiceNo}
                                        </TableCell>
                                        <TableCell className="py-1.5 whitespace-nowrap border-r border-rose-100 print:border-slate-400">
                                            {s.saleDate ? format(new Date(s.saleDate), "dd-MMM-yy") : "—"}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right font-medium border-r border-rose-100 print:border-slate-400">
                                            {s.amount.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right text-rose-800 font-semibold">
                                            {s.daysSinceSale}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <p className="text-xs text-slate-500 mt-2 print:text-[8pt]">
                        Sales in this period with no matching received parchi on record (amount-for-amount).
                    </p>
                </div>
            )}

            <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3 print:mb-1.5">
                    <h3 className="text-lg font-bold text-amber-900 tracking-wide border-b-2 border-amber-700 pb-0.5 inline-block uppercase print:border-black print:text-black print:text-[10pt] print:break-after-avoid">
                        Parchi Commitments Register
                    </h3>
                    {hasOverdue && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 erp-no-print"
                            onClick={openSummary}
                        >
                            <Sparkles className="h-4 w-4 text-violet-500" />
                            AI overdue parchi summary
                        </Button>
                    )}
                </div>

                {openParchis.length > 0 ? (
                    <div className="border border-amber-200/90 print:border-slate-800 rounded-xl print:rounded-none overflow-hidden print:overflow-visible shadow-sm print:shadow-none bg-white">
                        <Table className="report-table report-table--compact text-[11px] print:text-[10px] w-full">
                            <TableHeader>
                                <TableRow className="bg-amber-50/70 print:bg-slate-200 border-b-2 border-amber-200 print:border-slate-800">
                                    <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Parchi ID
                                    </TableHead>
                                    <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Type
                                    </TableHead>
                                    <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Direction
                                    </TableHead>
                                    <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Issue Date
                                    </TableHead>
                                    <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Due Date
                                    </TableHead>
                                    <TableHead className="text-right font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Total (₨)
                                    </TableHead>
                                    <TableHead className="text-right font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Cleared (₨)
                                    </TableHead>
                                    <TableHead className="text-right font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Balance (₨)
                                    </TableHead>
                                    <TableHead className="font-bold text-slate-800 py-2 h-auto border-r border-amber-200 print:border-slate-400">
                                        Status
                                    </TableHead>
                                    <TableHead className="text-right font-bold text-slate-800 py-2 h-auto">
                                        Days Late
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {openParchis.map((p, index) => {
                                    const overdue = reconciliation.overdueParchis.find(
                                        (o) => o.parchiNo === p.parchi_no,
                                    );
                                    return (
                                        <TableRow
                                            key={p.parchi_no}
                                            className={`border-b border-amber-100 print:border-slate-300 ${index % 2 === 0 ? "bg-white print:bg-transparent" : "bg-amber-50/20 print:bg-transparent"}`}
                                        >
                                            <TableCell className="py-1.5 font-mono font-semibold text-slate-800 border-r border-amber-100 print:border-slate-400">
                                                {p.parchi_no}
                                            </TableCell>
                                            <TableCell className="py-1.5 border-r border-amber-100 print:border-slate-400 capitalize">
                                                {p.parchi_type === "bank_cheque" ? "Bank Cheque" : "Company Parchi"}
                                            </TableCell>
                                            <TableCell className="py-1.5 border-r border-amber-100 print:border-slate-400 capitalize">
                                                {p.direction}
                                            </TableCell>
                                            <TableCell className="py-1.5 whitespace-nowrap border-r border-amber-100 print:border-slate-400">
                                                {p.issue_date ? format(new Date(p.issue_date), "dd-MMM-yy") : "—"}
                                            </TableCell>
                                            <TableCell className="py-1.5 whitespace-nowrap border-r border-amber-100 print:border-slate-400">
                                                {p.due_date ? format(new Date(p.due_date), "dd-MMM-yy") : "—"}
                                            </TableCell>
                                            <TableCell className="py-1.5 text-right font-medium border-r border-amber-100 print:border-slate-400">
                                                {Number(p.total_amount).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="py-1.5 text-right text-slate-600 border-r border-amber-100 print:border-slate-400">
                                                {Number(p.cleared_amount).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="py-1.5 text-right font-bold text-amber-900 border-r border-amber-100 print:border-slate-400">
                                                {Number(p.open_amount).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="py-1.5 border-r border-amber-100 print:border-slate-400">
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        p.status === "cleared"
                                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                                                            : p.status === "partial"
                                                              ? "bg-blue-50 text-blue-700 border-blue-200 text-[10px]"
                                                              : overdue
                                                                ? "bg-rose-50 text-rose-700 border-rose-200 text-[10px]"
                                                                : "bg-amber-50 text-amber-800 border-amber-200 text-[10px]"
                                                    }
                                                >
                                                    {overdue ? `Overdue` : mapParchiStatus(String(p.status))}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="py-1.5 text-right font-semibold text-rose-800">
                                                {overdue ? overdue.daysLate : "—"}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <p className="text-sm text-slate-500 border border-dashed border-amber-200 rounded-lg px-4 py-3 bg-amber-50/30">
                        No open parchi on record for this party.
                    </p>
                )}

                <div className="flex flex-col items-end gap-2 pt-3 print:pt-1 print:break-inside-avoid">
                    <div className="text-right print:pr-1 bg-amber-50/60 print:bg-transparent px-4 py-2 print:py-0.5 rounded-lg border border-amber-200 print:border-none inline-block shadow-sm print:shadow-none">
                        <span className="text-slate-700 font-bold mr-3 text-xs uppercase tracking-wider">
                            Total Open Parchi:
                        </span>
                        <span className="text-base print:text-[11pt] font-bold text-slate-900 underline decoration-double underline-offset-4">
                            ₨ {reconciliation.totalOpenParchi.toLocaleString()}
                        </span>
                    </div>
                    <div className="text-right print:pr-1 bg-blue-50/60 print:bg-transparent px-4 py-2 print:py-0.5 rounded-lg border border-blue-200 print:border-none inline-block shadow-sm print:shadow-none">
                        <span className="text-slate-700 font-bold mr-3 text-xs uppercase tracking-wider">
                            Balance After Adjustment of Parchis:
                        </span>
                        <span className="text-base print:text-[11pt] font-bold text-slate-900 underline decoration-double underline-offset-4">
                            {formatBalanceLabel(adjustedBalance)}
                        </span>
                        <span className="block text-[10px] text-slate-500 mt-1 print:text-[8pt]">
                            Closing balance ({formatBalanceLabel(closingBalance)}) minus open parchi total
                        </span>
                    </div>
                </div>
            </div>

            <Dialog
                open={summaryOpen}
                onOpenChange={(open) => {
                    setSummaryOpen(open);
                    if (!open) {
                        setSummaryError(null);
                    }
                }}
            >
                <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-violet-500" />
                            AI overdue parchi follow-up
                        </DialogTitle>
                        <DialogDescription>
                            Generated from live ledger and parchi context for {partyName}.
                        </DialogDescription>
                    </DialogHeader>

                    {summaryLoading ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-slate-600">
                            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                            Writing summary from ledger context…
                        </div>
                    ) : summaryError ? (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                            {summaryError}
                        </div>
                    ) : (
                        <div className="flex-1 overflow-auto text-sm leading-relaxed whitespace-pre-wrap rounded-lg border bg-slate-50 p-4 text-slate-800">
                            {summaryText}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={summaryLoading}
                            onClick={() => void generateSummary()}
                        >
                            {summaryLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="h-4 w-4" />
                            )}
                            Regenerate
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={!summaryText || summaryLoading}
                            onClick={() => void copySummary()}
                        >
                            <Copy className="h-4 w-4" />
                            Copy summary
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
