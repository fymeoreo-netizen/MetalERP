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

type ConfirmInvoiceDeleteDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    variant: "draft" | "posted";
    docLabel?: string;
    onConfirm: () => void | Promise<void>;
    loading?: boolean;
};

export function ConfirmInvoiceDeleteDialog({
    open,
    onOpenChange,
    variant,
    docLabel = "this invoice",
    onConfirm,
    loading = false,
}: ConfirmInvoiceDeleteDialogProps) {
    const isPosted = variant === "posted";

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {isPosted ? "Permanently delete posted invoice?" : "Delete draft invoice?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-left space-y-2">
                        <span className="block">
                            {isPosted
                                ? `${docLabel} will be removed from the ledger with no audit trail. Linked order fulfillment will be rolled back when applicable.`
                                : `${docLabel} will be removed. This cannot be undone.`}
                        </span>
                        {isPosted ? (
                            <span className="block font-medium text-rose-700">This action is permanent.</span>
                        ) : null}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={loading}
                        className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
                        onClick={(e) => {
                            e.preventDefault();
                            void Promise.resolve(onConfirm());
                        }}
                    >
                        {loading ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
