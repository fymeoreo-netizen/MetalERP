import { format } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, Ban, BookOpen, CreditCard, Pencil, Receipt } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatParchiAmount, type ParchiRegisterRow } from "@/lib/parchiTypes";

type ParchiSlipProps = {
    parchi: ParchiRegisterRow;
    variant?: "register" | "preview";
    className?: string;
    liveMode?: boolean;
    onEdit?: () => void;
    onVoid?: () => void;
    previewId?: string;
};

const STATUS_STYLES: Record<ParchiRegisterRow["status"], string> = {
    Cleared: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
    "Partially Cleared": "bg-blue-50 text-blue-700 ring-blue-200/70",
    Pending: "bg-amber-50 text-amber-700 ring-amber-200/70",
};

function StatusPill({ status }: { status: ParchiRegisterRow["status"] }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
                STATUS_STYLES[status],
            )}
        >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            {status === "Partially Cleared" ? "Partial" : status}
        </span>
    );
}

export function ParchiSlip({
    parchi,
    variant = "register",
    className,
    liveMode,
    onEdit,
    onVoid,
    previewId,
}: ParchiSlipProps) {
    const isPreview = variant === "preview";
    const isCheque = parchi.parchi_type === "Bank Cheque";
    const isReceived = (parchi.direction ?? "Received") === "Received";
    const displayId = previewId ?? parchi.id;
    const DirectionIcon = isReceived ? ArrowDownLeft : ArrowUpRight;
    const directionTone = isReceived ? "text-emerald-600" : "text-blue-600";
    const directionBg = isReceived ? "bg-emerald-50" : "bg-blue-50";

    const total = parchi.total_amount || 0;
    const cleared = parchi.cleared_amount || 0;
    const progress = total > 0 ? Math.min(100, Math.round((cleared / total) * 100)) : 0;

    return (
        <article
            className={cn(
                "group relative flex flex-col rounded-2xl border border-slate-200/80 bg-white transition-all duration-200",
                isPreview ? "shadow-sm" : "shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                className,
            )}
        >
            <div className={cn("flex flex-col", isPreview ? "gap-4 p-5" : "gap-4 p-5")}>
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div
                            className={cn(
                                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                                directionBg,
                                directionTone,
                            )}
                        >
                            {isCheque ? <CreditCard className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                                {isCheque ? "Bank Cheque" : "Company Parchi"}
                            </p>
                            <p className="truncate font-mono text-sm font-semibold tabular-nums text-slate-900">
                                {displayId === "Auto-Generated" ? "Auto-generated" : displayId}
                            </p>
                        </div>
                    </div>
                    {!isPreview && parchi.status ? <StatusPill status={parchi.status} /> : null}
                    {isPreview ? (
                        <span
                            className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
                                directionBg,
                                directionTone,
                            )}
                        >
                            <DirectionIcon className="h-3 w-3" />
                            {isReceived ? "Received" : "Issued"}
                        </span>
                    ) : null}
                </div>

                {/* Amount hero */}
                <div>
                    <div className="flex items-end justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                                {isPreview ? "Amount" : "Balance"}
                            </p>
                            <p className="font-mono text-[1.75rem] font-bold leading-none tracking-tight tabular-nums text-slate-900">
                                {formatParchiAmount(isPreview ? total : parchi.available_balance)}
                            </p>
                        </div>
                        {!isPreview ? (
                            <span
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                                    directionBg,
                                    directionTone,
                                )}
                            >
                                <DirectionIcon className="h-3 w-3" />
                                {isReceived ? "Received" : "Issued"}
                            </span>
                        ) : null}
                    </div>

                    {!isPreview && total > 0 ? (
                        <div className="mt-3">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <p className="mt-1.5 text-[10px] tabular-nums text-slate-400">
                                {formatParchiAmount(cleared)} cleared of {formatParchiAmount(total)}
                            </p>
                        </div>
                    ) : null}
                </div>

                {/* Cheque info */}
                {isCheque && (parchi.cheque_no || parchi.bank) ? (
                    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <CreditCard className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="font-mono font-semibold text-slate-700">{parchi.cheque_no || "—"}</span>
                        {parchi.bank ? <span className="truncate text-slate-500">· {parchi.bank}</span> : null}
                    </div>
                ) : null}

                {/* Party */}
                <div className="border-t border-slate-100 pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                        {isReceived ? "Receive from" : "Pay to"}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                        {parchi.party || "— Select party —"}
                    </p>
                    {parchi.guarantor && parchi.guarantor !== "none" ? (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                            Guarantor: <span className="font-medium text-slate-600">{parchi.guarantor}</span>
                        </p>
                    ) : null}
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Issued</p>
                        <p className="mt-0.5 font-mono text-sm tabular-nums text-slate-700">
                            {parchi.date ? format(new Date(parchi.date), "dd MMM yyyy") : "—"}
                        </p>
                    </div>
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Due</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                            {parchi.due_date ? format(new Date(parchi.due_date), "dd MMM yyyy") : "—"}
                        </p>
                    </div>
                </div>

                {/* Narration */}
                {parchi.narration ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                        {parchi.narration}
                    </p>
                ) : null}
            </div>

            {/* Footer */}
            {!isPreview ? (
                <div className="flex items-center justify-end gap-1.5 border-t border-slate-100 px-5 py-3">
                    {parchi.partyCode && liveMode ? (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-slate-600" asChild>
                            <Link
                                to={`/reports?report=unified-ledgers&party=${encodeURIComponent(parchi.partyCode)}&parchi=1`}
                            >
                                <BookOpen className="mr-1 h-3 w-3" />
                                Ledger
                            </Link>
                        </Button>
                    ) : null}
                    {onEdit ? (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-slate-600" onClick={onEdit}>
                            <Pencil className="mr-1 h-3 w-3" />
                            Edit
                        </Button>
                    ) : null}
                    {onVoid ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                            disabled={parchi.cleared_amount > 0}
                            title={parchi.cleared_amount > 0 ? "Cannot void — has clearance" : "Void parchi"}
                            onClick={onVoid}
                        >
                            <Ban className="mr-1 h-3 w-3" />
                            Void
                        </Button>
                    ) : null}
                </div>
            ) : (
                <p className="border-t border-dashed border-slate-200 px-5 py-3 text-center text-[10px] text-slate-400">
                    Commitment only — clears in cashbook
                </p>
            )}
        </article>
    );
}
