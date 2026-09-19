import { RateStatusCell } from "@/components/shared/RateStatusCell";
import type { RateStatus } from "@/lib/ratePending";

type Props = {
    itemLabel: string;
    qtyLabel?: string;
    qty: number;
    rate?: number;
    amount?: number;
    rateStatus?: RateStatus;
    readOnly?: boolean;
    onRateStatusChange?: (status: RateStatus) => void;
};

export function InvoiceLineRateRow({
    itemLabel,
    qtyLabel,
    qty,
    rate,
    amount,
    rateStatus = "fixed",
    readOnly,
    onRateStatusChange,
}: Props) {
    const pending = rateStatus === "pending";
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{itemLabel}</p>
                <p className="text-xs text-muted-foreground">
                    {qtyLabel ?? `${qty.toLocaleString()} kg`}
                    {!pending && rate != null ? ` @ ₨ ${rate.toLocaleString()}` : ""}
                </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {!readOnly && onRateStatusChange ? (
                    <RateStatusCell compact value={rateStatus} onChange={onRateStatusChange} />
                ) : null}
                <p className="font-mono text-sm w-24 text-right">
                    {pending ? "—" : `₨ ${Number(amount ?? 0).toLocaleString()}`}
                </p>
            </div>
        </div>
    );
}
