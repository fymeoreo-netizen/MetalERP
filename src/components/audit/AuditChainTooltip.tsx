import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchAuditChain, formatAuditAction, type AuditChainEvent } from "@/lib/repositories/auditRepo";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { History, Loader2 } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";

type AuditChainTooltipProps = {
    sourceDocType?: string | null;
    sourceDocId?: string | null;
    postedByName?: string | null;
    postedAt?: string | null;
    children: ReactNode;
    className?: string;
    enabled?: boolean;
};

const chainCache = new Map<string, AuditChainEvent[]>();

function cacheKey(type: string, id: string) {
    return `${type}:${id}`;
}

function formatEventTime(iso: string): string {
    try {
        return format(new Date(iso), "dd-MMM-yy HH:mm");
    } catch {
        return iso;
    }
}

function AuditTimeline({ events, postedByName, postedAt }: {
    events: AuditChainEvent[];
    postedByName?: string | null;
    postedAt?: string | null;
}) {
    if (events.length === 0) {
        if (!postedByName && !postedAt) {
            return <p className="text-xs text-slate-400">No audit trail recorded.</p>;
        }
        return (
            <div className="space-y-1 text-xs">
                <p className="font-semibold text-slate-100">Recorded by</p>
                <p>{postedByName}{postedAt ? ` · ${formatEventTime(postedAt)}` : ""}</p>
            </div>
        );
    }

    return (
        <div className="space-y-2 max-w-xs">
            <p className="font-semibold text-slate-100 flex items-center gap-1">
                <History className="h-3.5 w-3.5" /> Audit trail
            </p>
            <ul className="space-y-1.5 border-l border-slate-600 pl-2">
                {events.map((ev) => (
                    <li key={ev.eventId} className="text-xs leading-snug">
                        <span className="font-medium text-slate-200">{formatAuditAction(ev.action)}</span>
                        {" · "}
                        <span className="text-slate-300">{ev.actorDisplayName}</span>
                        <br />
                        <span className="text-slate-400">{formatEventTime(ev.eventAt)}</span>
                        {ev.summary && (
                            <p className="text-slate-400 mt-0.5 truncate">{ev.summary}</p>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function AuditChainTooltip({
    sourceDocType,
    sourceDocId,
    postedByName,
    postedAt,
    children,
    className,
    enabled = true,
}: AuditChainTooltipProps) {
    const [events, setEvents] = useState<AuditChainEvent[] | null>(null);
    const [loading, setLoading] = useState(false);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadChain = useCallback(async () => {
        if (!enabled || !sourceDocType || !sourceDocId) return;
        setLoading(true);
        try {
            const rows = await fetchAuditChain(sourceDocType, sourceDocId);
            setEvents(rows);
        } finally {
            setLoading(false);
        }
    }, [enabled, sourceDocType, sourceDocId]);

    const handleOpen = useCallback(() => {
        if (!enabled) return;
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => void loadChain(), 200);
    }, [enabled, loadChain]);

    const handleClose = useCallback(() => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
    }, []);

    if (!enabled) {
        return <span className={className}>{children}</span>;
    }

    // Do NOT wrap each cell in its own TooltipProvider — ledgers mount hundreds
    // of these and it freezes the main thread. Callers that need a provider
    // (FinancialLedgerPanel, etc.) supply one at the panel level.
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className={cn("cursor-help underline decoration-dotted decoration-slate-300/80 underline-offset-2", className)}
                    onMouseEnter={handleOpen}
                    onMouseLeave={handleClose}
                    onFocus={handleOpen}
                    onBlur={handleClose}
                >
                    {children}
                </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-slate-900 text-slate-50 border-slate-700 max-w-sm">
                {loading && (
                    <div className="flex items-center gap-2 text-xs py-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading audit trail…
                    </div>
                )}
                {!loading && (
                    <AuditTimeline
                        events={events ?? []}
                        postedByName={postedByName}
                        postedAt={postedAt}
                    />
                )}
            </TooltipContent>
        </Tooltip>
    );
}
