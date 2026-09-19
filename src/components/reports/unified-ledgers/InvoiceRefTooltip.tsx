import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { InvoiceLineAggregate } from "./ledgerRowMappers";

type InvoiceRefTooltipProps = {
    aggregate: InvoiceLineAggregate | null | undefined;
    children: ReactNode;
    className?: string;
};

function formatMoney(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatQty(n: number | null): string {
    if (n == null || n === 0) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

/**
 * Hover on a multi-line invoice Ref No. to see each ledger line and the invoice total.
 * Uses already-loaded ledger rows (no extra fetch). Provider must wrap the panel.
 */
export function InvoiceRefTooltip({ aggregate, children, className }: InvoiceRefTooltipProps) {
    if (!aggregate || aggregate.lineCount < 2) {
        return <span className={className}>{children}</span>;
    }

    const net = aggregate.totalDebit - aggregate.totalCredit;
    const showAllLines = aggregate.lineCount <= 12;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className={cn(
                        "cursor-help underline decoration-dotted decoration-blue-400/70 underline-offset-2",
                        className,
                    )}
                >
                    {children}
                </span>
            </TooltipTrigger>
            <TooltipContent
                side="top"
                className="bg-slate-900 text-slate-50 border-slate-700 max-w-md p-3 print:hidden"
            >
                <div className="space-y-2 text-xs">
                    <div className="flex items-baseline justify-between gap-3 border-b border-slate-700 pb-1.5">
                        <p className="font-semibold text-slate-100 font-mono">{aggregate.ref}</p>
                        <p className="text-slate-400 shrink-0">
                            {aggregate.lineCount} line{aggregate.lineCount === 1 ? "" : "s"}
                        </p>
                    </div>

                    {showAllLines ? (
                        <ul className="space-y-1 max-h-56 overflow-y-auto">
                            {aggregate.lines.map((line, i) => {
                                const amt = line.debit > 0 ? line.debit : line.credit;
                                const side = line.debit > 0 ? "Dr" : line.credit > 0 ? "Cr" : "";
                                return (
                                    <li
                                        key={`${line.particulars}-${i}`}
                                        className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 leading-snug"
                                    >
                                        <span className="text-slate-200 truncate" title={line.particulars}>
                                            {line.particulars || "—"}
                                        </span>
                                        <span className="tabular-nums text-slate-100 text-right whitespace-nowrap">
                                            {amt > 0 ? `₨ ${formatMoney(amt)} ${side}` : "—"}
                                        </span>
                                        <span className="text-slate-500 col-span-2">
                                            {formatQty(line.weight)} kg
                                            {line.rate != null && line.rate > 0
                                                ? ` · @ ${formatMoney(line.rate)}`
                                                : ""}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p className="text-slate-400">
                            {aggregate.lineCount} lines (hover totals below). Open the invoice for full detail.
                        </p>
                    )}

                    <div className="border-t border-slate-700 pt-1.5 space-y-0.5 tabular-nums">
                        {aggregate.totalWeight > 0 && (
                            <div className="flex justify-between gap-4 text-slate-300">
                                <span>Total qty</span>
                                <span>{formatQty(aggregate.totalWeight)} kg</span>
                            </div>
                        )}
                        {aggregate.totalDebit > 0 && (
                            <div className="flex justify-between gap-4 text-slate-300">
                                <span>Total debit</span>
                                <span>₨ {formatMoney(aggregate.totalDebit)}</span>
                            </div>
                        )}
                        {aggregate.totalCredit > 0 && (
                            <div className="flex justify-between gap-4 text-slate-300">
                                <span>Total credit</span>
                                <span>₨ {formatMoney(aggregate.totalCredit)}</span>
                            </div>
                        )}
                        <div className="flex justify-between gap-4 font-semibold text-slate-50 pt-0.5">
                            <span>Invoice total</span>
                            <span>
                                ₨ {formatMoney(Math.abs(net))} {net >= 0 ? "Dr" : "Cr"}
                            </span>
                        </div>
                    </div>
                </div>
            </TooltipContent>
        </Tooltip>
    );
}
