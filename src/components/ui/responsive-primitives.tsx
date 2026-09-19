import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { erpScrollbarClass } from "@/lib/scrollStyles";

/** Horizontal scroll for tab bars on narrow viewports. */
export function TabsScroller({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "w-full overflow-x-auto overflow-y-hidden pb-1",
                erpScrollbarClass,
                className
            )}
        >
            <div className="min-w-max">{children}</div>
        </div>
    );
}

/**
 * Horizontal scroll for wide tables. Child `<Table>` must use `noWrapper` to avoid
 * double scroll containers (Table's default wrapper also sets overflow-auto).
 */
export function TableScroller({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "w-full overflow-x-auto overflow-y-hidden",
                erpScrollbarClass,
                className
            )}
        >
            {children}
        </div>
    );
}

/** Vertical scroll panel for modals or fixed-height regions (use sparingly). */
export function PanelScroller({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "w-full overflow-y-auto overflow-x-hidden overscroll-y-contain",
                erpScrollbarClass,
                className
            )}
        >
            {children}
        </div>
    );
}
