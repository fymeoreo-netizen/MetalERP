import { ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { erpScrollbarClass, thinScrollbarClass } from "@/lib/scrollStyles";

export { erpScrollbarClass, thinScrollbarClass };

interface InvoiceModalShellProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    subtitle?: string;
    headerEnd?: ReactNode;
    footer: ReactNode;
    children: ReactNode;
}

export function InvoiceModalShell({
    open,
    onOpenChange,
    title,
    subtitle,
    headerEnd,
    footer,
    children,
}: InvoiceModalShellProps) {
    const [maximized, setMaximized] = useState(false);

    const handleOpenChange = (next: boolean) => {
        if (!next) setMaximized(false);
        onOpenChange(next);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className={cn(
                    "flex flex-col gap-0 p-0 overflow-hidden border-zinc-200/80 shadow-2xl",
                    "transition-[width,height,max-width,border-radius,transform] duration-200 ease-out",
                    maximized
                        ? "left-0 top-0 !translate-x-0 !translate-y-0 max-w-none w-screen h-screen max-h-screen rounded-none border-0 sm:rounded-none"
                        : "max-w-none w-screen h-[100dvh] rounded-none border-0 sm:max-w-6xl sm:w-[96vw] sm:h-[min(90vh,820px)] sm:rounded-2xl sm:border"
                )}
            >
                <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-zinc-200/60 pr-[4.5rem]">
                    <div className="min-w-0">
                        <DialogTitle className="text-base font-semibold tracking-tight text-zinc-900">
                            {title}
                        </DialogTitle>
                        {subtitle ? (
                            <DialogDescription className="text-[11px] text-zinc-500 mt-0.5 truncate">
                                {subtitle}
                            </DialogDescription>
                        ) : (
                            <DialogDescription className="sr-only">{title}</DialogDescription>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {headerEnd}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-zinc-500 hover:text-zinc-800"
                            onClick={() => setMaximized((m) => !m)}
                            title={maximized ? "Restore window" : "Maximize window"}
                            aria-label={maximized ? "Restore window" : "Maximize window"}
                        >
                            {maximized ? (
                                <Minimize2 className="h-4 w-4" />
                            ) : (
                                <Maximize2 className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>

                {footer}
            </DialogContent>
        </Dialog>
    );
}
