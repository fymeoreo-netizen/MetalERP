import { useCallback, useMemo } from "react";
import {
    isRatePending,
    lineRateFields,
    mapLineFromDb,
    mapLineRateStatus,
    sumFixedLineAmounts,
    type DbInvoiceLineRateFields,
    type RateStatus,
} from "@/lib/ratePending";

export type RatePendingLine = {
    rateStatus?: RateStatus;
    rate?: number;
    amount?: number;
};

export function useRatePendingLines<T extends RatePendingLine>(initial: T[] = []) {
    const fixedTotal = useCallback((lines: T[]) => sumFixedLineAmounts(lines), []);

    const toggleLineRateStatus = useCallback(
        (line: T, next?: RateStatus): T => {
            const rateStatus = next ?? (isRatePending(line.rateStatus) ? "fixed" : "pending");
            const pending = isRatePending(rateStatus);
            return {
                ...line,
                rateStatus,
                amount: pending ? 0 : Number(line.amount ?? 0),
            };
        },
        [],
    );

    const amountForQty = useCallback(
        (qty: number, rate: number, rateStatus?: RateStatus) =>
            isRatePending(rateStatus) ? 0 : qty * Number(rate ?? 0),
        [],
    );

    const mapDbLine = useCallback(
        <R extends DbInvoiceLineRateFields>(row: R) => mapLineFromDb(row),
        [],
    );

    const helpers = useMemo(
        () => ({
            fixedTotal,
            toggleLineRateStatus,
            amountForQty,
            mapDbLine,
            mapLineRateStatus,
            lineRateFields,
            sumFixedLineAmounts,
        }),
        [amountForQty, fixedTotal, mapDbLine, toggleLineRateStatus],
    );

    return helpers;
}
