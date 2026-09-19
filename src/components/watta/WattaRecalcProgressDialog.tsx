import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

export type WattaRecalcProgress = {
    running: boolean;
    estimatedTotal: number;
    processed: number;
    updatedDrafts: number;
    updatedPosted: number;
    skipped: number;
    done: boolean;
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    progress: WattaRecalcProgress;
    effectiveFrom: string;
    onCancel?: () => void;
};

export function WattaRecalcProgressDialog({ open, onOpenChange, progress, effectiveFrom, onCancel }: Props) {
    const pct =
        progress.estimatedTotal > 0
            ? Math.min(100, Math.round((progress.processed / progress.estimatedTotal) * 100))
            : progress.done
              ? 100
              : 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Applying watta to invoices</DialogTitle>
                    <DialogDescription>
                        Updating premium sales invoices from {effectiveFrom}. Posted invoices with open AR are adjusted
                        in the ledger.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    {progress.running ? (
                        <div className="flex items-center gap-2 text-sm text-zinc-600">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Processing…
                        </div>
                    ) : null}
                    <Progress value={pct} className="h-2" />
                    <p className="text-sm text-zinc-600 tabular-nums">
                        Processed {progress.processed}
                        {progress.estimatedTotal > 0 ? ` / ~${progress.estimatedTotal}` : ""} invoices
                    </p>
                    <ul className="text-xs text-zinc-500 space-y-1">
                        <li>Drafts updated: {progress.updatedDrafts}</li>
                        <li>Posted updated: {progress.updatedPosted}</li>
                        <li>Skipped: {progress.skipped}</li>
                    </ul>
                </div>
                <DialogFooter>
                    {progress.running && onCancel ? (
                        <Button type="button" variant="outline" onClick={onCancel}>
                            Cancel
                        </Button>
                    ) : (
                        <Button type="button" onClick={() => onOpenChange(false)}>
                            Close
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
