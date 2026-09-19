import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmVoidDocumentDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    docLabel?: string;
    onConfirm: () => void | Promise<void>;
    loading?: boolean;
};

export function ConfirmVoidDocumentDialog({
    open,
    onOpenChange,
    docLabel = "this document",
    onConfirm,
    loading = false,
}: ConfirmVoidDocumentDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Void document?</AlertDialogTitle>
                    <AlertDialogDescription className="text-left space-y-2">
                        <span className="block">
                            {docLabel} will be voided. This action will reverse the financial and inventory
                            ledger entries. A reversing journal entry will be retained for audit.
                        </span>
                        <span className="block font-medium text-amber-800">This cannot be undone.</span>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={loading}
                        className="bg-amber-600 hover:bg-amber-700 focus:ring-amber-600"
                        onClick={(e) => {
                            e.preventDefault();
                            void Promise.resolve(onConfirm());
                        }}
                    >
                        {loading ? "Voiding…" : "Void document"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
