import type { Column } from "@tanstack/react-table";

export type DataTableAlign = "left" | "center" | "right";

export type DataTableColumnMeta = {
    align?: DataTableAlign;
};

declare module "@tanstack/react-table" {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData, TValue> extends DataTableColumnMeta {}
}

export function getColumnAlign<T>(column: Column<T, unknown>): DataTableAlign {
    return column.columnDef.meta?.align ?? "left";
}

export const alignCellClass: Record<DataTableAlign, string> = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
};

export const alignHeaderFlexClass: Record<DataTableAlign, string> = {
    left: "justify-start",
    center: "justify-center",
    right: "justify-end",
};
