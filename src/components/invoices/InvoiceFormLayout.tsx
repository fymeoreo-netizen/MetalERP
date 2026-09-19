import { ReactNode, ComponentProps, Ref } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Package, Pencil } from "lucide-react";
import { thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";

/** Shared input styling for premium minimal forms */
export const invoiceInputClass =
    "h-9 border-0 bg-zinc-100/80 shadow-none ring-1 ring-zinc-200/70 focus-visible:ring-2 focus-visible:ring-zinc-400/40 rounded-lg text-sm";

export function InvoiceSplitLayout({
    form,
    lines,
    className,
    formWidthClassName,
}: {
    form: ReactNode;
    lines: ReactNode;
    className?: string;
    /** Overrides the default fixed-width left column (e.g. give it a percentage-based width). */
    formWidthClassName?: string;
}) {
    return (
        <div
            className={cn(
                "flex flex-1 min-h-0 flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-zinc-200/80",
                className
            )}
        >
            <div
                className={cn(
                    formWidthClassName ?? "w-full lg:w-[min(100%,420px)]",
                    "shrink-0 flex flex-col min-h-[320px] lg:min-h-0 bg-white"
                )}
            >
                {form}
            </div>
            <div className="flex-1 flex flex-col min-h-[280px] lg:min-h-0 min-w-0 bg-zinc-50/60">
                {lines}
            </div>
        </div>
    );
}

export function InvoiceFormScroll({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={cn(
                "flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-6",
                thinScrollbarClass,
                className
            )}
        >
            {children}
        </div>
    );
}

export function InvoiceLinesColumn({
    title,
    subtitle,
    badge,
    children,
    footer,
    className,
}: {
    title: string;
    subtitle?: string;
    badge?: ReactNode;
    children: ReactNode;
    footer: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col h-full min-h-0", className)}>
            <div className="shrink-0 px-5 py-4 border-b border-zinc-200/60 flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-medium tracking-tight text-zinc-900">{title}</h3>
                    {subtitle && (
                        <p className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">{subtitle}</p>
                    )}
                </div>
                {badge}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-4 py-3">
                {children}
            </div>
            <div className="shrink-0 border-t border-zinc-200/60 bg-white/80 backdrop-blur-sm px-5 py-4">
                {footer}
            </div>
        </div>
    );
}

export function FormBlock({
    label,
    children,
    className,
}: {
    label?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("space-y-3", className)}>
            {label && (
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">
                    {label}
                </p>
            )}
            {children}
        </div>
    );
}

export function FieldGroup({
    label,
    children,
    hint,
    className,
}: {
    label: string;
    children: ReactNode;
    hint?: string;
    className?: string;
}) {
    return (
        <div className={cn("space-y-1.5", className)}>
            <Label className="text-[11px] font-medium text-zinc-500">{label}</Label>
            {children}
            {hint && <p className="text-[10px] text-zinc-400 tabular-nums">{hint}</p>}
        </div>
    );
}

export function ModeToggle<T extends string>({
    value,
    onChange,
    options,
    className,
}: {
    value: T;
    onChange: (v: T) => void;
    options: { value: T; label: string }[];
    className?: string;
}) {
    return (
        <div
            className={cn(
                "inline-flex w-full rounded-lg bg-zinc-100/90 p-0.5 ring-1 ring-zinc-200/60",
                className
            )}
        >
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={cn(
                        "flex-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-all duration-150",
                        value === opt.value
                            ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/50"
                            : "text-zinc-500 hover:text-zinc-700"
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

export function LineItemsPanel({
    lines,
    emptyMessage,
    renderLine,
    onRemove,
    onEdit,
    className,
}: {
    lines: { id: string }[];
    emptyMessage: string;
    renderLine: (line: { id: string }, index: number) => ReactNode;
    onRemove?: (id: string) => void;
    onEdit?: (id: string) => void;
    className?: string;
}) {
    // Smoothly collapses/expands rows on add/remove. Line grids stay well
    // under 50 rows, so this never coexists with virtualization.
    const [listRef] = useAutoAnimate<HTMLDivElement>();

    if (lines.length === 0) {
        return (
            <div
                className={cn(
                    "flex flex-1 flex-col items-center justify-center text-center text-zinc-400 rounded-xl border border-dashed border-zinc-200/90 bg-white/50",
                    className
                )}
            >
                <Package className="h-8 w-8 mb-2.5 stroke-[1.25] opacity-25" />
                <p className="text-xs font-medium text-zinc-500">{emptyMessage}</p>
            </div>
        );
    }

    return (
        <div
            ref={listRef}
            className={cn(
                "flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1",
                thinScrollbarClass,
                className
            )}
        >
            {lines.map((line, i) => (
                <div
                    key={line.id}
                    className="group flex items-start gap-2.5 rounded-lg bg-white px-3.5 py-3 ring-1 ring-zinc-200/50 hover:ring-zinc-300/70 transition-shadow"
                >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums text-zinc-400">
                        {i + 1}
                    </span>
                    <div className="flex-1 min-w-0 text-sm">{renderLine(line, i)}</div>
                    {onEdit ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-zinc-300 hover:text-blue-600 hover:bg-blue-50/80 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => onEdit(line.id)}
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </Button>
                    ) : null}
                    {onRemove ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 -mr-1 text-zinc-300 hover:text-rose-500 hover:bg-rose-50/80 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => onRemove(line.id)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

export type InvoicePhysicalTotals = {
    totalNetKg: number;
    totalTrackedUnits: number;
};

type InvoiceMeasureLine = {
    netWeight?: number | string | null;
    quantity?: number | string | null;
    unitCount?: number | string | null;
};

const nonNegativeNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

/** Aggregate only committed invoice lines; callers decide which item codes track units. */
export function sumInvoicePhysicalTotals<T extends InvoiceMeasureLine>(
    lines: T[],
    tracksUnits: (line: T) => boolean,
): InvoicePhysicalTotals {
    return lines.reduce<InvoicePhysicalTotals>(
        (totals, line) => ({
            totalNetKg: totals.totalNetKg + nonNegativeNumber(line.netWeight),
            totalTrackedUnits:
                totals.totalTrackedUnits +
                (tracksUnits(line) ? nonNegativeNumber(line.unitCount ?? line.quantity) : 0),
        }),
        { totalNetKg: 0, totalTrackedUnits: 0 },
    );
}

const formatPhysicalValue = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 3 });

export function formatInvoicePhysicalSummary(totals: InvoicePhysicalTotals) {
    const unitLabel = totals.totalTrackedUnits === 1 ? "tracked unit" : "tracked units";
    return `${formatPhysicalValue(totals.totalNetKg)} kg net · ${formatPhysicalValue(totals.totalTrackedUnits)} ${unitLabel}`;
}

/** Fixed-width value column — keeps amounts, inputs, and % aligned */
const TOTALS_VALUE_W = "w-[112px]";

function TotalsAmount({ children }: { children: ReactNode }) {
    return (
        <span className="block text-right text-sm font-medium text-zinc-800 tabular-nums leading-none">
            {children}
        </span>
    );
}

function TotalsFieldInput({ className, ...props }: ComponentProps<typeof Input>) {
    return (
        <Input
            {...props}
            className={cn(
                invoiceInputClass,
                "h-8 w-full text-right tabular-nums text-sm px-2.5",
                className
            )}
        />
    );
}

function TotalsRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-6 py-2">
            <span className="text-xs text-zinc-500">{label}</span>
            <div className={cn("shrink-0", TOTALS_VALUE_W)}>{children}</div>
        </div>
    );
}

function InvoicePhysicalTotalsBlock({ totals }: { totals: InvoicePhysicalTotals }) {
    return (
        <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-zinc-200/70 ring-1 ring-zinc-200/70">
            <div className="bg-zinc-50/95 px-3.5 py-2.5">
                <p className="text-[10px] text-zinc-500">Total net weight</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-800">
                    {formatPhysicalValue(totals.totalNetKg)} kg
                </p>
            </div>
            <div className="bg-zinc-50/95 px-3.5 py-2.5 text-right">
                <p className="text-[10px] text-zinc-500">Tracked units</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-800">
                    {formatPhysicalValue(totals.totalTrackedUnits)}
                </p>
            </div>
        </div>
    );
}

/** Receipt-style totals: subtotal, discount, GST rate + tax, grand total */
export function SalesInvoiceTotals({
    subtotal,
    discount,
    onDiscountChange,
    taxRate,
    onTaxRateChange,
    taxAmount,
    total,
    totalLabel = "Total payable",
    accentClass = "text-zinc-900",
    readOnly = false,
    physicalTotals,
}: {
    subtotal: number;
    discount: string;
    onDiscountChange: (v: string) => void;
    taxRate: string;
    onTaxRateChange: (v: string) => void;
    taxAmount: number;
    total: number;
    totalLabel?: string;
    accentClass?: string;
    readOnly?: boolean;
    physicalTotals?: InvoicePhysicalTotals;
}) {
    return (
        <div className="w-full">
            {physicalTotals ? <InvoicePhysicalTotalsBlock totals={physicalTotals} /> : null}
            <div className="rounded-xl bg-white/90 ring-1 ring-zinc-200/70 px-4 py-1">
                <TotalsRow label="Subtotal">
                    <TotalsAmount>₨ {subtotal.toLocaleString()}</TotalsAmount>
                </TotalsRow>
                <TotalsRow label="Discount">
                    <TotalsFieldInput
                        type="number"
                        min={0}
                        value={discount}
                        onChange={(e) => onDiscountChange(e.target.value)}
                        placeholder="0"
                        disabled={readOnly}
                    />
                </TotalsRow>
                <TotalsRow label="GST %">
                    <div className="relative">
                        <TotalsFieldInput
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={taxRate}
                            onChange={(e) => onTaxRateChange(e.target.value)}
                            placeholder="0"
                            className="pr-7"
                            disabled={readOnly}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
                            %
                        </span>
                    </div>
                </TotalsRow>
                <TotalsRow label="Tax amount">
                    <TotalsAmount>₨ {taxAmount.toLocaleString()}</TotalsAmount>
                </TotalsRow>
            </div>
            <div className="flex items-baseline justify-between gap-6 mt-4 pt-4 border-t border-zinc-200">
                <span className="text-xs font-medium text-zinc-600">{totalLabel}</span>
                <span
                    className={cn(
                        "text-right text-[1.35rem] font-semibold tracking-tight tabular-nums leading-none shrink-0",
                        TOTALS_VALUE_W,
                        accentClass
                    )}
                >
                    ₨ {total.toLocaleString()}
                </span>
            </div>
        </div>
    );
}

/** Generic totals for purchase and other invoices */
export function InvoiceTotalsPanel({
    rows,
    totalLabel,
    total,
    accentClass = "text-zinc-900",
    physicalTotals,
}: {
    rows: Array<
        | { type: "amount"; label: string; amount: number }
        | { type: "input"; label: string; value: number; onChange: (n: number) => void }
    >;
    totalLabel: string;
    total: number;
    accentClass?: string;
    physicalTotals?: InvoicePhysicalTotals;
}) {
    return (
        <div className="w-full">
            {physicalTotals ? <InvoicePhysicalTotalsBlock totals={physicalTotals} /> : null}
            <div className="rounded-xl bg-white/90 ring-1 ring-zinc-200/70 px-4 py-1">
                {rows.map((row, i) => (
                    <TotalsRow key={i} label={row.label}>
                        {row.type === "amount" ? (
                            <TotalsAmount>₨ {row.amount.toLocaleString()}</TotalsAmount>
                        ) : (
                            <TotalsFieldInput
                                type="number"
                                min={0}
                                value={row.value}
                                onChange={(e) => row.onChange(Number(e.target.value))}
                                placeholder="0"
                            />
                        )}
                    </TotalsRow>
                ))}
            </div>
            <div className="flex items-baseline justify-between gap-6 mt-4 pt-4 border-t border-zinc-200">
                <span className="text-xs font-medium text-zinc-600">{totalLabel}</span>
                <span
                    className={cn(
                        "text-right text-[1.35rem] font-semibold tracking-tight tabular-nums leading-none shrink-0",
                        TOTALS_VALUE_W,
                        accentClass
                    )}
                >
                    ₨ {total.toLocaleString()}
                </span>
            </div>
        </div>
    );
}

/** @deprecated Use SalesInvoiceTotals or InvoiceTotalsPanel */
export function TotalsFooter({
    rows,
    totalLabel,
    totalValue,
    accentClass = "text-zinc-900",
}: {
    rows: { label: string; value: ReactNode }[];
    totalLabel: string;
    totalValue: string;
    accentClass?: string;
}) {
    return (
        <div className="w-full">
            <div className="rounded-xl bg-white/90 ring-1 ring-zinc-200/70 px-4 py-1">
                {rows.map((row, i) => (
                    <TotalsRow key={i} label={row.label}>
                        <div className="text-right text-sm font-medium text-zinc-800 tabular-nums">
                            {row.value}
                        </div>
                    </TotalsRow>
                ))}
            </div>
            <div className="flex items-baseline justify-between gap-6 mt-4 pt-4 border-t border-zinc-200">
                <span className="text-xs font-medium text-zinc-600">{totalLabel}</span>
                <span
                    className={cn(
                        "text-right text-[1.35rem] font-semibold tracking-tight tabular-nums leading-none shrink-0",
                        TOTALS_VALUE_W,
                        accentClass
                    )}
                >
                    {totalValue}
                </span>
            </div>
        </div>
    );
}

export function AlertBanner({
    variant = "info",
    children,
    action,
}: {
    variant?: "info" | "success" | "warning" | "error";
    children: ReactNode;
    action?: ReactNode;
}) {
    const styles = {
        info: "bg-zinc-100/90 ring-zinc-200/60 text-zinc-700",
        success: "bg-emerald-50/80 ring-emerald-200/50 text-emerald-800",
        warning: "bg-amber-50/80 ring-amber-200/50 text-amber-900",
        error: "bg-rose-50/90 ring-rose-200/60 text-rose-900",
    }[variant];

    return (
        <div
            className={cn(
                "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[11px] ring-1",
                styles
            )}
        >
            <span className="font-medium leading-snug">{children}</span>
            {action}
        </div>
    );
}

export function AddLineBar({
    netLabel,
    amountLabel,
    onAdd,
    disabled,
    buttonRef,
    buttonLabel = "Add",
}: {
    netLabel: string;
    amountLabel: string;
    onAdd: () => void;
    disabled?: boolean;
    buttonRef?: Ref<HTMLButtonElement>;
    buttonLabel?: string;
}) {
    return (
        <div className="flex items-center justify-between gap-3 pt-4 mt-1 border-t border-zinc-100">
            <div className="text-xs text-zinc-500 tabular-nums">
                <span className="text-zinc-400">Net </span>
                <span className="font-medium text-zinc-800">{netLabel}</span>
                <span className="mx-2 text-zinc-300">·</span>
                <span className="text-zinc-400">Amount </span>
                <span className="font-medium text-zinc-900">{amountLabel}</span>
            </div>
            <Button
                ref={buttonRef}
                type="button"
                size="sm"
                onClick={onAdd}
                disabled={disabled}
                className="h-8 px-3 text-xs bg-zinc-900 hover:bg-zinc-800 rounded-lg"
            >
                {buttonLabel}
            </Button>
        </div>
    );
}
