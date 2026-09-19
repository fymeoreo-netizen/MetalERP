import { type ReactNode, useEffect, useState } from "react";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TableScroller } from "@/components/ui/responsive-primitives";
import {
    REPORT_COMPANY,
    formatReportAmount,
    formatReportAsOf,
    formatReportPeriod,
    printReport,
    resolveReportPrintedBy,
    type ReportPrintMetaItem,
} from "@/lib/reportPrintConfig";
import "@/styles/report-print.css";

export type { ReportPrintMetaItem };

export { printReport, REPORT_COMPANY, formatReportAmount };

export type ReportPrintHeaderProps = {
    reportTitle: string;
    subtitle?: string;
    dateFrom?: string;
    dateTo?: string;
    asOfDate?: string;
    hierarchyLabel?: string;
    groupedBy?: string;
    printedBy?: string;
    meta?: ReportPrintMetaItem[];
};

function usePrintedByName(override?: string): string {
    const [name, setName] = useState(override ?? "Authorized User");
    useEffect(() => {
        if (override) {
            setName(override);
            return;
        }
        void resolveReportPrintedBy().then(setName);
    }, [override]);
    return override ?? name;
}

export function ReportPrintHeader({
    dateFrom,
    dateTo,
    asOfDate,
    hierarchyLabel,
    groupedBy,
    printedBy,
    meta = [],
}: ReportPrintHeaderProps) {
    const printedByName = usePrintedByName(printedBy);
    const timestamp = format(new Date(), "dd-MMM-yyyy HH:mm");
    const period = formatReportPeriod(dateFrom, dateTo);
    const asOf = formatReportAsOf(asOfDate);
    const groupingLabel = groupedBy ?? hierarchyLabel;

    const metaRows: ReportPrintMetaItem[] = [...meta];
    if (period) metaRows.unshift({ label: "Period", value: period });
    if (asOf) metaRows.unshift({ label: "As of", value: asOf });

    if (metaRows.length === 0 && !groupingLabel) return null;

    return (
        <header className="report-print-header">
            <div className="report-print-header__meta-bar">
                {metaRows.map((m) => (
                    <div key={`${m.label}-${m.value}`}>
                        <span className="font-semibold text-slate-700">{m.label}: </span>
                        <span className="text-slate-600">{m.value}</span>
                    </div>
                ))}
                {groupingLabel && (
                    <div>
                        <span className="font-semibold text-slate-700">Grouped by: </span>
                        <span className="text-slate-600">{groupingLabel}</span>
                    </div>
                )}
                <div>
                    <span className="font-semibold text-slate-700">Generated: </span>
                    <span className="text-slate-600">{timestamp} PKT</span>
                </div>
                <div>
                    <span className="font-semibold text-slate-700">Printed by: </span>
                    <span className="text-slate-600">{printedByName}</span>
                </div>
            </div>
        </header>
    );
}

export function ReportPrintFooter() {
    return null;
}

export type ReportPrintDocumentProps = ReportPrintHeaderProps & {
    children: ReactNode;
    className?: string;
    density?: "standard" | "compact";
    /** When false, omit company letterhead and footer (classic ledger-style reports). */
    letterhead?: boolean;
};

/** A4-ready printable body: letterhead, content, footer. */
export function ReportPrintDocument({
    children,
    className,
    density = "standard",
    letterhead = true,
    ...headerProps
}: ReportPrintDocumentProps) {
    return (
        <article
            className={cn(
                "report-print-document report-document-preview",
                "print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none",
                !letterhead && "report-print-document--classic",
                className,
            )}
        >
            {letterhead ? <ReportPrintHeader {...headerProps} /> : null}
            <div
                className={cn(
                    "report-print-body",
                    density === "compact" && "report-print-body--compact",
                )}
            >
                {children}
            </div>
            {letterhead ? <ReportPrintFooter /> : null}
        </article>
    );
}

/** Sticky filter toolbar — hidden when printing. */
export function ReportPrintControls({
    children,
    className,
    actions,
}: {
    children: ReactNode;
    className?: string;
    actions?: ReactNode;
}) {
    return (
        <div className={cn("erp-no-print report-print-controls mb-4", className)}>
            <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">{children}</div>
            {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
        </div>
    );
}

export function ReportFilterField({
    label,
    children,
    className,
}: {
    label: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("report-filter-field", className)}>
            <span className="report-filter-field__label">{label}</span>
            {children}
        </div>
    );
}

export function ReportPrintButton({
    disabled,
    label = "Print / Save PDF",
}: {
    disabled?: boolean;
    label?: string;
}) {
    return (
        <Button
            type="button"
            variant="outline"
            className="h-8 text-sm"
            disabled={disabled}
            onClick={() => printReport()}
        >
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            {label}
        </Button>
    );
}

/** Screen-only status strip; hidden on print. */
export function ReportPrintBanner({
    children,
    tone = "neutral",
}: {
    children: ReactNode;
    tone?: "success" | "warning" | "error" | "neutral";
}) {
    const toneClass =
        tone === "success"
            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
            : tone === "warning"
              ? "bg-amber-50 text-amber-900 border-amber-200"
              : tone === "error"
                ? "bg-rose-50 text-rose-800 border-rose-200"
                : "bg-slate-50 text-slate-700 border-slate-200";
    return (
        <div
            className={cn(
                "erp-no-print report-print-banner flex items-center gap-2 mb-4 px-3 py-1.5 text-sm font-semibold border",
                toneClass,
            )}
            data-print-hide="true"
        >
            {children}
        </div>
    );
}

export function ReportSectionTitle({ children }: { children: ReactNode }) {
    return <h3 className="report-section-title">{children}</h3>;
}

export function ReportTable({
    children,
    className,
    compact,
}: {
    children: ReactNode;
    className?: string;
    compact?: boolean;
}) {
    return (
        <TableScroller className={cn("report-avoid-break", className)}>
            <table className={cn("report-table w-full", compact && "report-table--compact")}>{children}</table>
        </TableScroller>
    );
}

export function ReportAmount({
    value,
    className,
    showZero,
}: {
    value: number;
    className?: string;
    showZero?: boolean;
}) {
    const negative = value < 0;
    const positive = value > 0;
    return (
        <span
            className={cn(
                "report-amount",
                negative && "report-amount--negative",
                positive && "report-amount--positive",
                className,
            )}
        >
            {formatReportAmount(value, { showZero })}
        </span>
    );
}

export type ReportKpiItem = {
    label: string;
    value: string;
    sub?: string;
    /** Optional hover explanation (rendered by report pages that wrap with TooltipProvider). */
    insightLabel?: ReactNode;
};

export function ReportKpiGrid({
    items,
    columns = 4,
    className,
}: {
    items: ReportKpiItem[];
    columns?: 2 | 3 | 4;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "report-kpi-grid",
                columns === 2 && "report-kpi-grid--2",
                columns === 3 && "report-kpi-grid--3",
                columns === 4 && "report-kpi-grid--4",
                className,
            )}
        >
            {items.map((item) => (
                <div key={item.label} className="report-kpi report-print-kpi">
                    <p className="report-kpi__label">{item.insightLabel ?? item.label}</p>
                    <p className="report-kpi__value">{item.value}</p>
                    {item.sub ? <p className="report-kpi__sub">{item.sub}</p> : null}
                </div>
            ))}
        </div>
    );
}

export function ReportMetaStrip({
    left,
    right,
}: {
    left: { label: string; value: string };
    right?: { label: string; value: string };
}) {
    return (
        <div className="report-meta-strip">
            <div>
                <p className="report-meta-strip__label">{left.label}</p>
                <p className="report-meta-strip__value">{left.value}</p>
            </div>
            {right ? (
                <div className="text-right">
                    <p className="report-meta-strip__label">{right.label}</p>
                    <p className="report-meta-strip__value font-mono">{right.value}</p>
                </div>
            ) : null}
        </div>
    );
}

export function ReportPanel({
    title,
    children,
    className,
}: {
    title: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("report-panel", className)}>
            <h4 className="report-panel__title">{title}</h4>
            {children}
        </div>
    );
}
