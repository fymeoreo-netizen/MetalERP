import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { thinScrollbarClass } from "@/components/invoices/InvoiceModalShell";

/** Scrollable body for sales / purchase order modals */
export function OrderItemsScroll({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "max-h-[min(320px,40vh)] overflow-auto rounded-lg border border-zinc-200/80",
                thinScrollbarClass,
                className
            )}
        >
            {children}
        </div>
    );
}
