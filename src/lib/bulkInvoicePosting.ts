export type BulkPostInvoice = {
    id: string;
    dbId?: string | null;
    date: string;
};

export type BulkPostFailure<T> = {
    invoice: T;
    error: string;
};

export type BulkPostResult<T> = {
    succeeded: T[];
    failures: Array<BulkPostFailure<T>>;
};

export async function postDraftInvoicesSequentially<T extends BulkPostInvoice>(
    invoices: T[],
    postInvoice: (invoice: T) => Promise<void>,
    onProgress?: (completed: number, total: number) => void,
): Promise<BulkPostResult<T>> {
    const ordered = [...invoices].sort((left, right) => {
        const dateOrder = left.date.localeCompare(right.date);
        return dateOrder || left.id.localeCompare(right.id, undefined, { numeric: true });
    });
    const succeeded: T[] = [];
    const failures: Array<BulkPostFailure<T>> = [];

    for (const invoice of ordered) {
        try {
            await postInvoice(invoice);
            succeeded.push(invoice);
        } catch (error) {
            failures.push({
                invoice,
                error: error instanceof Error ? error.message : "Invoice posting failed.",
            });
        }
        onProgress?.(succeeded.length + failures.length, ordered.length);
    }

    return { succeeded, failures };
}
