import { useCallback, useMemo, useRef, useState } from "react";
import {
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnDef,
    type FilterFn,
    type Row,
    type SortingState,
} from "@tanstack/react-table";
import { rankItem } from "@tanstack/match-sorter-utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { erpScrollbarClass } from "@/lib/scrollStyles";
import { alignCellClass, alignHeaderFlexClass, getColumnAlign } from "@/components/data-table/columnMeta";

/** Rows above this count switch from auto-animate to windowed rendering. */
const VIRTUALIZE_THRESHOLD = 50;

function fuzzyFilter<T>(
    row: Row<T>,
    columnId: string,
    value: unknown,
    addMeta: Parameters<FilterFn<T>>[3],
): boolean {
    const itemRank = rankItem(row.getValue(columnId), String(value));
    addMeta({ itemRank });
    return itemRank.passed;
}

export type DataTableProps<T> = {
    columns: ColumnDef<T, unknown>[];
    data: T[];
    /** Stable row key; falls back to row index. */
    getRowId?: (row: T, index: number) => string;
    onRowClick?: (row: T) => void;
    searchPlaceholder?: string;
    /** Hide the built-in search input (e.g. when the page has its own). */
    hideSearch?: boolean;
    /** Extra toolbar content rendered next to search (filter chips, actions). */
    toolbar?: React.ReactNode;
    /** Page size; set to 0 to disable pagination (virtualizes when > 50 rows). */
    pageSize?: number;
    loading?: boolean;
    emptyMessage?: string;
    /** Estimated row height in px for the virtualizer. */
    estimateRowHeight?: number;
    /** Max body height when virtualized. */
    maxBodyHeight?: number;
    className?: string;
};

export function DataTable<T>({
    columns,
    data,
    getRowId,
    onRowClick,
    searchPlaceholder = "Search…",
    hideSearch = false,
    toolbar,
    pageSize = 50,
    loading = false,
    emptyMessage = "No records found.",
    estimateRowHeight = 44,
    maxBodyHeight = 560,
    className,
}: DataTableProps<T>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [globalFilter, setGlobalFilter] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);

    const paginate = pageSize > 0;

    const table = useReactTable<T>({
        data,
        columns,
        state: { sorting, globalFilter },
        onSortingChange: setSorting,
        onGlobalFilterChange: setGlobalFilter,
        globalFilterFn: fuzzyFilter,
        getRowId: getRowId ? (row, index) => getRowId(row, index) : undefined,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: paginate ? getPaginationRowModel() : undefined,
        initialState: paginate ? { pagination: { pageSize } } : undefined,
    });

    const rows = table.getRowModel().rows;
    const useVirtual = rows.length > VIRTUALIZE_THRESHOLD;

    // auto-animate and virtualization are mutually exclusive on the same tbody:
    // animating thousands of windowed rows causes layout thrash, so animation
    // only applies to the small non-virtualized branch.
    const [animateRef, enableAnimations] = useAutoAnimate<HTMLTableSectionElement>();
    enableAnimations(!useVirtual);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => estimateRowHeight,
        overscan: 10,
        enabled: useVirtual,
    });

    const handleRowClick = useCallback(
        (row: Row<T>) => {
            onRowClick?.(row.original);
        },
        [onRowClick],
    );

    const colSpan = useMemo(
        () => table.getAllLeafColumns().length,
        [table],
    );

    const renderRow = (row: Row<T>) => (
        <TableRow
            key={row.id}
            data-state={row.getIsSelected() ? "selected" : undefined}
            onClick={onRowClick ? () => handleRowClick(row) : undefined}
            className={cn(onRowClick && "cursor-pointer")}
        >
            {row.getVisibleCells().map((cell) => {
                const align = getColumnAlign(cell.column);
                return (
                    <TableCell
                        key={cell.id}
                        className={cn("px-3 py-2.5 align-middle", alignCellClass[align])}
                    >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                );
            })}
        </TableRow>
    );

    const virtualItems = useVirtual ? virtualizer.getVirtualItems() : [];
    const paddingTop = useVirtual && virtualItems.length > 0 ? virtualItems[0].start : 0;
    const paddingBottom =
        useVirtual && virtualItems.length > 0
            ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
            : 0;

    return (
        <div className={cn("space-y-3", className)}>
            {(!hideSearch || toolbar) && (
                <div className="flex flex-wrap items-center gap-2">
                    {!hideSearch && (
                        <div className="relative w-full max-w-xs">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={globalFilter}
                                onChange={(e) => setGlobalFilter(e.target.value)}
                                placeholder={searchPlaceholder}
                                className="h-9 pl-8"
                            />
                        </div>
                    )}
                    {toolbar}
                </div>
            )}

            <div className="rounded-lg border bg-card">
                <div
                    ref={scrollRef}
                    className={cn("overflow-auto", erpScrollbarClass)}
                    style={useVirtual ? { maxHeight: maxBodyHeight } : undefined}
                >
                    <Table noWrapper>
                        <TableHeader className="sticky top-0 z-10 bg-card">
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                                    {headerGroup.headers.map((header) => {
                                        const canSort = header.column.getCanSort();
                                        const sortDir = header.column.getIsSorted();
                                        const align = getColumnAlign(header.column);
                                        return (
                                            <TableHead
                                                key={header.id}
                                                className={cn(
                                                    "h-9 px-3 text-xs font-medium text-muted-foreground align-middle",
                                                    alignCellClass[align],
                                                    canSort && "cursor-pointer select-none",
                                                )}
                                                onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                                            >
                                                <span
                                                    className={cn(
                                                        "flex w-full items-center gap-1",
                                                        alignHeaderFlexClass[align],
                                                    )}
                                                >
                                                    {header.isPlaceholder
                                                        ? null
                                                        : flexRender(header.column.columnDef.header, header.getContext())}
                                                    {canSort ? (
                                                        sortDir === "asc" ? (
                                                            <ArrowUp className="h-3 w-3 shrink-0" />
                                                        ) : sortDir === "desc" ? (
                                                            <ArrowDown className="h-3 w-3 shrink-0" />
                                                        ) : (
                                                            <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                                                        )
                                                    ) : null}
                                                </span>
                                            </TableHead>
                                        );
                                    })}
                                </TableRow>
                            ))}
                        </TableHeader>

                        {loading ? (
                            <TableBody>
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={colSpan} className="px-3 py-2.5">
                                            <Skeleton className="h-5 w-full" />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        ) : rows.length === 0 ? (
                            <TableBody>
                                <TableRow>
                                    <TableCell colSpan={colSpan} className="h-28 text-center text-sm text-muted-foreground">
                                        {emptyMessage}
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        ) : useVirtual ? (
                            <TableBody>
                                {paddingTop > 0 && (
                                    <tr aria-hidden>
                                        <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 0 }} />
                                    </tr>
                                )}
                                {virtualItems.map((vi) => renderRow(rows[vi.index]))}
                                {paddingBottom > 0 && (
                                    <tr aria-hidden>
                                        <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                                    </tr>
                                )}
                            </TableBody>
                        ) : (
                            <TableBody ref={animateRef}>{rows.map(renderRow)}</TableBody>
                        )}
                    </Table>
                </div>

                {paginate && table.getPageCount() > 1 && (
                    <div className="flex items-center justify-between border-t px-3 py-2">
                        <p className="text-xs text-muted-foreground">
                            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                            {" · "}
                            {table.getFilteredRowModel().rows.length} rows
                        </p>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => table.previousPage()}
                                disabled={!table.getCanPreviousPage()}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => table.nextPage()}
                                disabled={!table.getCanNextPage()}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
