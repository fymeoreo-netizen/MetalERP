/** PKR tolerance aligned with erp.fn_reconciliation_checks (±0.5). */
export const REPORT_BALANCE_TOLERANCE = 0.5;

export function isReportBalanced(
    left: number,
    right: number,
    tolerance: number = REPORT_BALANCE_TOLERANCE,
): boolean {
    return Math.abs(left - right) <= tolerance;
}

export function reportBalanceVariance(left: number, right: number): number {
    return left - right;
}
