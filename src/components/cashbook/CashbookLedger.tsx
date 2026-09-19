import { useMemo, useRef } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatPkr, type CashbookLedgerRow, type CashbookLedgerViewMode } from "@/lib/cashbookTypes";
import { thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";
import { AlertCircle, Edit, Loader2, RefreshCw, Search, TrendingDown, TrendingUp } from "lucide-react";

type CashbookLedgerProps = {
    rows: CashbookLedgerRow[];
    searchQuery: string;
    onSearchChange: (q: string) => void;
    openingBalance: number;
    closingBalance: number;
    received: number;
    paid: number;
    onEditRow: (row: CashbookLedgerRow) => void;
    ledgerDate?: string;
    pageNo?: string;
    viewMode: CashbookLedgerViewMode;
    onViewModeChange: (mode: CashbookLedgerViewMode) => void;
    highlightVoucherId?: string | null;
    isLoading?: boolean;
    error?: string | null;
    onRetry?: () => void;
};

export function CashbookLedger({
    rows,
    searchQuery,
    onSearchChange,
    openingBalance,
    closingBalance,
    received,
    paid,
    onEditRow,
    ledgerDate,
    pageNo,
    viewMode,
    onViewModeChange,
    highlightVoucherId,
    isLoading = false,
    error = null,
    onRetry,
}: CashbookLedgerProps) {
    const showDateColumn = viewMode !== "date";

    const receiptRows = useMemo(() => rows.filter((r) => r.debit > 0), [rows]);
    const paymentRows = useMemo(() => rows.filter((r) => r.credit > 0), [rows]);

    const emptyMessage = searchQuery
        ? "No entries match this search."
        : viewMode === "date"
            ? openingBalance !== 0
              ? `No entries on this date. Opening balance ${formatPkr(openingBalance)} carries forward.`
              : "No entries for this date."
            : openingBalance !== 0
              ? `No entries on page ${pageNo || "—"}. Opening balance ${formatPkr(openingBalance)} carries forward.`
              : `No entries on page ${pageNo || "—"}.`;

    return (
        <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-slate-200/80 bg-white shadow-soft overflow-hidden">
            <div className="shrink-0 px-3 py-2.5 border-b border-slate-100 flex flex-col gap-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">
                            {viewMode === "date" ? "Day ledger — all pages" : "Page ledger"}
                        </h2>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            {viewMode === "date" && ledgerDate ? (
                                <>
                                    <span className="tabular-nums">{ledgerDate}</span>
                                    {" · "}
                                </>
                            ) : null}
                            {viewMode === "page" && pageNo ? (
                                <>
                                    Page <span className="font-mono">{pageNo}</span> only — receipts left,
                                    payments right
                                    {" · "}
                                </>
                            ) : null}
                            {rows.length} entr{rows.length === 1 ? "y" : "ies"}
                            {rows.length > 0 ? (
                                <>
                                    {" "}
                                    · {receiptRows.length} in / {paymentRows.length} out
                                </>
                            ) : null}
                        </p>
                    </div>
                    <div className="relative w-full sm:w-[200px]">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                        <Input
                            placeholder="Search…"
                            className="pl-8 h-8 text-xs bg-white border-zinc-200"
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex gap-1 rounded-lg bg-slate-100/70 p-1 shrink-0 w-fit">
                    <button
                        type="button"
                        onClick={() => onViewModeChange("date")}
                        className={cn(
                            "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                            viewMode === "date"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-700",
                        )}
                    >
                        By date
                    </button>
                    <button
                        type="button"
                        onClick={() => onViewModeChange("page")}
                        className={cn(
                            "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                            viewMode === "page"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-700",
                        )}
                    >
                        By page
                    </button>
                </div>
            </div>

            <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-1.5 px-3 py-2 bg-slate-50/60 border-b border-slate-100 text-sm">
                <Stat label="Opening" value={formatPkr(openingBalance)} />
                <Stat
                    label="Received"
                    value={formatPkr(received)}
                    icon={TrendingUp}
                    tone="text-emerald-700"
                />
                <Stat
                    label="Paid"
                    value={formatPkr(paid)}
                    icon={TrendingDown}
                    tone="text-rose-700"
                />
                <Stat label="Closing" value={formatPkr(closingBalance)} highlight />
            </div>

            <div className={cn("flex-1 min-h-0 p-1.5 overflow-auto", thinScrollbarClass)}>
                {isLoading ? (
                    <div className="flex h-28 items-center justify-center text-xs text-zinc-500">
                        <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading complete cashbook…
                        </span>
                    </div>
                ) : error ? (
                    <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-rose-700">
                        <span className="inline-flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </span>
                        {onRetry ? (
                            <Button variant="outline" size="sm" onClick={onRetry}>
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                Retry
                            </Button>
                        ) : null}
                    </div>
                ) : rows.length === 0 ? (
                    <div className="flex h-28 items-center justify-center text-xs text-zinc-400 px-4 text-center">
                        {emptyMessage}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 min-h-0 h-full">
                        <SidePanel
                            title="Receipts"
                            tone="receipt"
                            rows={receiptRows}
                            amountKey="debit"
                            showDateColumn={showDateColumn}
                            highlightVoucherId={highlightVoucherId}
                            onEditRow={onEditRow}
                            emptyLabel="No receipts in this view."
                        />
                        <SidePanel
                            title="Payments"
                            tone="payment"
                            rows={paymentRows}
                            amountKey="credit"
                            showDateColumn={showDateColumn}
                            highlightVoucherId={highlightVoucherId}
                            onEditRow={onEditRow}
                            emptyLabel="No payments in this view."
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function SidePanel({
    title,
    tone,
    rows,
    amountKey,
    showDateColumn,
    highlightVoucherId,
    onEditRow,
    emptyLabel,
}: {
    title: string;
    tone: "receipt" | "payment";
    rows: CashbookLedgerRow[];
    amountKey: "debit" | "credit";
    showDateColumn: boolean;
    highlightVoucherId?: string | null;
    onEditRow: (row: CashbookLedgerRow) => void;
    emptyLabel: string;
}) {
    const [animateRef, enableAnimations] = useAutoAnimate<HTMLTableSectionElement>();
    enableAnimations(rows.length <= 50);
    const scrollRef = useRef<HTMLDivElement>(null);
    const amountTone = tone === "receipt" ? "text-emerald-700" : "text-rose-700";
    const headerTone =
        tone === "receipt"
            ? "bg-emerald-50/80 text-emerald-900 border-emerald-100"
            : "bg-rose-50/80 text-rose-900 border-rose-100";

    return (
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white">
            <div
                className={cn(
                    "shrink-0 border-b px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide",
                    headerTone,
                )}
            >
                {title}
                <span className="ml-1.5 font-mono font-medium tabular-nums opacity-70">
                    ({rows.length})
                </span>
            </div>
            <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-auto", thinScrollbarClass)}>
                <Table noWrapper className="w-full">
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-zinc-100">
                            {showDateColumn ? (
                                <TableHead className="h-7 px-1.5 text-[10px] font-medium text-zinc-500 w-[4.25rem]">
                                    Date
                                </TableHead>
                            ) : null}
                            <TableHead className="h-7 px-1.5 text-[10px] font-medium text-zinc-500">
                                Account
                            </TableHead>
                            <TableHead className="h-7 px-1.5 text-[10px] font-medium text-zinc-500 w-12">
                                Type
                            </TableHead>
                            <TableHead className="h-7 px-1.5 text-[10px] font-medium text-zinc-500">
                                Detail
                            </TableHead>
                            <TableHead className="h-7 px-1.5 text-[10px] font-medium text-zinc-500 text-right w-[4.5rem]">
                                Amt
                            </TableHead>
                            <TableHead className="h-7 w-7 px-0" />
                        </TableRow>
                    </TableHeader>
                    <TableBody ref={animateRef}>
                        {rows.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={showDateColumn ? 6 : 5}
                                    className="h-20 text-center text-[11px] text-zinc-400"
                                >
                                    {emptyLabel}
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((row) => {
                                const amount = amountKey === "debit" ? row.debit : row.credit;
                                return (
                                    <TableRow
                                        key={row.id}
                                        className={cn(
                                            "border-slate-50 hover:bg-slate-50/80 group",
                                            highlightVoucherId === row.id &&
                                                "bg-amber-50/90 hover:bg-amber-50 ring-1 ring-inset ring-amber-200/80",
                                        )}
                                    >
                                        {showDateColumn ? (
                                            <TableCell className="font-mono text-[10px] text-zinc-500 py-1.5 px-1.5 tabular-nums whitespace-nowrap">
                                                {row.date.slice(5)}
                                            </TableCell>
                                        ) : null}
                                        <TableCell className="font-medium text-zinc-900 text-[11px] py-1.5 px-1.5 max-w-[7rem] truncate">
                                            {row.account}
                                        </TableCell>
                                        <TableCell className="py-1.5 px-1.5">
                                            <VoucherBadge type={row.voucherType} />
                                        </TableCell>
                                        <TableCell className="text-[10px] text-zinc-500 max-w-[6.5rem] truncate py-1.5 px-1.5">
                                            {row.desc}
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                "text-right font-mono text-[11px] tabular-nums py-1.5 px-1.5",
                                                amountTone,
                                            )}
                                        >
                                            {amount > 0 ? amount.toLocaleString() : "—"}
                                        </TableCell>
                                        <TableCell className="py-1 px-0.5">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 opacity-60 group-hover:opacity-100"
                                                onClick={() => onEditRow(row)}
                                            >
                                                <Edit className="h-3 w-3" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

function Stat({
    label,
    value,
    icon: Icon,
    tone,
    highlight,
}: {
    label: string;
    value: string;
    icon?: typeof TrendingUp;
    tone?: string;
    highlight?: boolean;
}) {
    return (
        <div
            className={cn(
                "rounded-md px-2 py-1.5 ring-1",
                highlight ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white ring-zinc-200/70",
            )}
        >
            <p
                className={cn(
                    "text-[9px] uppercase tracking-wide font-medium",
                    highlight ? "text-zinc-400" : "text-zinc-500",
                )}
            >
                {label}
            </p>
            <p
                className={cn(
                    "font-semibold tabular-nums text-xs mt-0.5 flex items-center gap-1",
                    highlight ? "text-white" : tone ?? "text-zinc-900",
                )}
            >
                {Icon ? <Icon className="h-3 w-3 shrink-0" /> : null}
                {value}
            </p>
        </div>
    );
}

function VoucherBadge({ type }: { type: string }) {
    const isIn = type === "CRV" || type === "PARCHI_CLEAR";
    const isOut = type === "CPV";
    const isCross = type === "CROSS_SETTLE";
    return (
        <Badge
            variant="outline"
            className={cn(
                "text-[9px] font-semibold border-0 px-1 py-0",
                isIn && "bg-emerald-50 text-emerald-800",
                isOut && "bg-rose-50 text-rose-800",
                isCross && "bg-blue-50 text-blue-800",
                !isIn && !isOut && !isCross && "bg-zinc-100 text-zinc-600",
            )}
        >
            {type === "PARCHI_CLEAR" ? "Parchi" : type === "CROSS_SETTLE" ? "Cross" : type}
        </Badge>
    );
}
