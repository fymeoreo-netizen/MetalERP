import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ReportRowInsight } from "@/lib/reportRowInsights";

export function ReportInsightBody({ insight }: { insight: ReportRowInsight }) {
    return (
        <div className="max-w-sm space-y-1.5 text-left">
            <p className="font-semibold text-[12px] leading-snug">{insight.title}</p>
            <ul className="space-y-0.5 text-[11px] leading-snug text-popover-foreground/90">
                {insight.lines.map((line, i) =>
                    line === "" ? (
                        <li key={`sp-${i}`} className="h-1 list-none" aria-hidden />
                    ) : (
                        <li key={`${i}-${line.slice(0, 24)}`} className="list-none">
                            {line}
                        </li>
                    ),
                )}
            </ul>
            {insight.warning ? (
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 leading-snug border-t border-border/60 pt-1.5">
                    {insight.warning}
                </p>
            ) : null}
        </div>
    );
}

/** Hoverable label that shows calculation / underpricing insight. Hidden from print. */
export function ReportInsightLabel({
    insight,
    children,
    className,
}: {
    insight?: ReportRowInsight | null;
    children: ReactNode;
    className?: string;
}) {
    if (!insight) {
        return <span className={className}>{children}</span>;
    }
    return (
        <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
                <span
                    className={cn(
                        "cursor-help underline decoration-dotted decoration-slate-400 underline-offset-2 print:no-underline print:cursor-default",
                        className,
                    )}
                >
                    {children}
                </span>
            </TooltipTrigger>
            <TooltipContent
                side="top"
                align="start"
                className="print:hidden max-w-sm border bg-popover px-3 py-2 shadow-md"
            >
                <ReportInsightBody insight={insight} />
            </TooltipContent>
        </Tooltip>
    );
}
