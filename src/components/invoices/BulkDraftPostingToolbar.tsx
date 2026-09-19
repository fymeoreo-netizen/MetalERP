import { CheckCheck, Loader2, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type BulkDraftPostingToolbarProps = {
    documentLabel: "sales" | "purchase";
    shownDraftCount: number;
    selectedCount: number;
    posting: boolean;
    completed: number;
    total: number;
    onSelectShown: () => void;
    onClear: () => void;
    onPost: () => Promise<void>;
};

export function BulkDraftPostingToolbar({
    documentLabel,
    shownDraftCount,
    selectedCount,
    posting,
    completed,
    total,
    onSelectShown,
    onClear,
    onPost,
}: BulkDraftPostingToolbarProps) {
    return (
        <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={posting || shownDraftCount === 0}
                onClick={onSelectShown}
            >
                <CheckCheck className="mr-2 h-4 w-4" />
                Select shown drafts ({shownDraftCount})
            </Button>

            {selectedCount > 0 ? (
                <>
                    <Badge variant="outline" className="h-8 px-2.5 text-xs tabular-nums">
                        {posting ? `${completed}/${total}` : `${selectedCount} selected`}
                    </Badge>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={posting}
                        onClick={onClear}
                        title="Clear invoice selection"
                        aria-label="Clear invoice selection"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button type="button" size="sm" disabled={posting}>
                                {posting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                Post selected
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Post {selectedCount} selected {documentLabel} invoices?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Invoices will post one at a time in date order. Successfully posted invoices remain posted if a later invoice fails.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void onPost()}>Post invoices</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </>
            ) : null}
        </div>
    );
}
