import {
    type MutableRefObject,
    type ReactNode,
    type RefObject,
    Fragment,
    useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

type VirtualLedgerRowsProps<T> = {
    rows: T[];
    colSpan: number;
    rowHeight?: number;
    scrollRef: RefObject<HTMLDivElement | null>;
    getRowKey: (row: T, index: number) => string;
    renderRow: (row: T, index: number) => ReactNode;
};

/**
 * Renders table rows with virtual padding when the parent scroll container has
 * many rows. Falls back to a plain map until the scroll element is mounted and
 * measured — otherwise TanStack Virtual returns zero items and the table body
 * stays blank while footers (e.g. closing balance) still render from `rows`.
 */
export function VirtualLedgerRows<T>({
    rows,
    colSpan,
    rowHeight = 36,
    scrollRef,
    getRowKey,
    renderRow,
}: VirtualLedgerRowsProps<T>) {
    const scrollEl = scrollRef.current;
    const useVirtual = rows.length > 50 && !!scrollEl;

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan: 12,
        enabled: useVirtual,
    });

    // Safety net: if virtualization is "on" but has not produced a visible
    // range yet, render every row so the statement is never blank.
    const items = useVirtual ? virtualizer.getVirtualItems() : [];
    if (!useVirtual || items.length === 0) {
        return <>{rows.map((row, index) => renderRow(row, index))}</>;
    }

    const paddingTop = items[0]?.start ?? 0;
    const paddingBottom =
        virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);

    return (
        <>
            {paddingTop > 0 ? (
                <tr aria-hidden className="print:hidden">
                    <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 0, lineHeight: 0 }} />
                </tr>
            ) : null}
            {items.map((vi) => {
                const row = rows[vi.index];
                return (
                    <Fragment key={getRowKey(row, vi.index)}>{renderRow(row, vi.index)}</Fragment>
                );
            })}
            {paddingBottom > 0 ? (
                <tr aria-hidden className="print:hidden">
                    <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 0, lineHeight: 0 }} />
                </tr>
            ) : null}
        </>
    );
}

export function LedgerScrollContainer({
    children,
    scrollRef,
    className,
}: {
    children: ReactNode;
    scrollRef: RefObject<HTMLDivElement | null>;
    className?: string;
}) {
    // Callback ref keeps the caller's scrollRef in sync and re-renders once the
    // DOM node exists so VirtualLedgerRows can measure on the next paint.
    const [, setHasNode] = useState(false);
    return (
        <div
            ref={(node) => {
                (scrollRef as MutableRefObject<HTMLDivElement | null>).current = node;
                setHasNode(!!node);
            }}
            className={`max-h-[480px] overflow-auto print:max-h-none print:overflow-visible ${className ?? ""}`}
        >
            {children}
        </div>
    );
}

export function ledgerRowKey(
    row: { ref?: string; date?: string; sourceDocId?: string | null },
    index: number,
): string {
    return `${row.sourceDocId ?? row.ref ?? "row"}-${row.date ?? index}-${index}`;
}
