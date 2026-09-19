import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Lightweight placeholder shown while a lazy document-modal chunk loads.
 * Renders the dialog frame immediately so there is no blank gap after the click.
 */
export function InvoiceModalSkeleton({ title = "Loading…" }: { title?: string }) {
    return (
        <Dialog open onOpenChange={() => {}}>
            <DialogContent
                className={cn(
                    "flex flex-col gap-0 p-0 overflow-hidden border-zinc-200/80 shadow-2xl",
                    "max-w-none w-screen h-[100dvh] rounded-none border-0 sm:max-w-6xl sm:w-[96vw] sm:h-[min(90vh,820px)] sm:rounded-2xl sm:border",
                )}
            >
                <DialogTitle className="sr-only">{title}</DialogTitle>
                <DialogDescription className="sr-only">Loading form…</DialogDescription>
                <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-zinc-200/60 pr-[4.5rem]">
                    <div className="min-w-0 space-y-2">
                        <div className="h-4 w-40 rounded bg-zinc-200/80 animate-pulse" />
                        <div className="h-3 w-24 rounded bg-zinc-100 animate-pulse" />
                    </div>
                </div>
                <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-0">
                    <div className="border-r border-zinc-100 p-6 space-y-4">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="space-y-2">
                                <div className="h-3 w-20 rounded bg-zinc-100 animate-pulse" />
                                <div className="h-9 w-full rounded-lg bg-zinc-100 animate-pulse" />
                            </div>
                        ))}
                    </div>
                    <div className="p-6 space-y-3">
                        <div className="h-32 w-full rounded-xl bg-zinc-100/80 animate-pulse" />
                        <div className="h-9 w-full rounded-lg bg-zinc-100 animate-pulse" />
                        <div className="h-9 w-2/3 rounded-lg bg-zinc-100 animate-pulse" />
                    </div>
                </div>
                <div className="shrink-0 px-6 py-3.5 border-t border-zinc-200/60 flex justify-end gap-2">
                    <div className="h-9 w-24 rounded-lg bg-zinc-100 animate-pulse" />
                    <div className="h-9 w-28 rounded-lg bg-zinc-200/80 animate-pulse" />
                </div>
            </DialogContent>
        </Dialog>
    );
}
