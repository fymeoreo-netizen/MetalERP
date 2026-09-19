import { describe, expect, it, vi } from "vitest";
import { postDraftInvoicesSequentially } from "./bulkInvoicePosting";

describe("postDraftInvoicesSequentially", () => {
    it("posts in document date and invoice order and retains individual failures", async () => {
        const calls: string[] = [];
        const progress = vi.fn();
        const invoices = [
            { id: "INV-10", dbId: "10", date: "2026-08-02" },
            { id: "INV-2", dbId: "2", date: "2026-08-01" },
            { id: "INV-1", dbId: "1", date: "2026-08-01" },
        ];

        const result = await postDraftInvoicesSequentially(
            invoices,
            async (invoice) => {
                calls.push(invoice.id);
                if (invoice.id === "INV-2") throw new Error("blocked");
            },
            progress,
        );

        expect(calls).toEqual(["INV-1", "INV-2", "INV-10"]);
        expect(result.succeeded.map((invoice) => invoice.id)).toEqual(["INV-1", "INV-10"]);
        expect(result.failures).toEqual([{ invoice: invoices[1], error: "blocked" }]);
        expect(progress).toHaveBeenLastCalledWith(3, 3);
    });
});
