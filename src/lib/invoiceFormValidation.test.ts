import { describe, expect, it } from "vitest";
import { collectInvoiceFormIssues, collectPremiumSalesInvoiceErrors } from "./invoiceFormValidation";
import type { LinkedInvoiceLine } from "./orderLinkValidation";

const goodLine: LinkedInvoiceLine = { itemCode: "ENM20", netWeight: 100, rate: 1200 };

describe("collectInvoiceFormIssues", () => {
    it("demands a party first, using the caller-supplied label", () => {
        const customer = collectInvoiceFormIssues({
            partyId: "",
            partyLabel: "Customer",
            lines: [goodLine],
            linkedOrderId: null,
            forPost: true,
        });
        expect(customer.errors).toContain("Select a customer before saving.");

        const supplier = collectInvoiceFormIssues({
            partyId: " ",
            partyLabel: "Supplier",
            lines: [],
            linkedOrderId: null,
            forPost: true,
        });
        expect(supplier.errors).toContain("Select a supplier before saving.");
    });

    it("skips all line checks when the invoice has no line items (purchase advance settlement)", () => {
        const result = collectInvoiceFormIssues({
            partyId: "P01",
            partyLabel: "Supplier",
            lines: [{ netWeight: 10 }],
            linkedOrderId: "order-1",
            forPost: true,
            skipLineChecks: true,
        });
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
    });

    it("rejects weight entered without an item", () => {
        const result = collectInvoiceFormIssues({
            partyId: "P01",
            partyLabel: "Customer",
            lines: [{ itemCode: "", netWeight: 25 }],
            linkedOrderId: null,
            forPost: false,
        });
        expect(result.errors).toContain("A line has weight entered but no item selected.");
    });

    it("on post, demands at least one billable line and warns about weightless items", () => {
        const nothingBillable = collectInvoiceFormIssues({
            partyId: "P01",
            partyLabel: "Customer",
            lines: [],
            linkedOrderId: null,
            forPost: true,
        });
        expect(nothingBillable.errors.some((e) => e.startsWith("Add at least one line"))).toBe(true);

        const withWeightless = collectInvoiceFormIssues({
            partyId: "P01",
            partyLabel: "Customer",
            lines: [goodLine, { itemCode: "ENM22", netWeight: 0 }],
            linkedOrderId: null,
            forPost: true,
        });
        expect(withWeightless.errors).toHaveLength(0);
        expect(withWeightless.warnings[0]).toContain("1 line(s) have an item selected but no weight yet");
    });

    it("propagates linked-order errors and soft rate warnings on post", () => {
        const result = collectInvoiceFormIssues({
            partyId: "P01",
            partyLabel: "Customer",
            lines: [{ ...goodLine, salesOrderLineId: undefined }],
            linkedOrderId: "order-1",
            forPost: true,
        });
        expect(result.errors.some((e) => e.includes("requires an order line reference"))).toBe(true);

        const rateDrift = collectInvoiceFormIssues({
            partyId: "P01",
            partyLabel: "Customer",
            lines: [
                {
                    ...goodLine,
                    salesOrderLineId: "sol-1",
                    orderItemCode: "ENM20",
                    orderedQty: 150,
                    orderRate: 1100,
                },
            ],
            linkedOrderId: "order-1",
            forPost: true,
        });
        expect(rateDrift.errors).toHaveLength(0);
        expect(rateDrift.warnings[0]).toContain("vs invoice rate");
    });
});

describe("collectPremiumSalesInvoiceErrors", () => {
    it("is silent outside premium mode", () => {
        expect(
            collectPremiumSalesInvoiceErrors({
                saleMode: "direct",
                refScrapRate: "",
                totalNetWeight: 0,
                lines: [],
                liveMode: true,
            }),
        ).toEqual([]);
    });

    it("requires a positive scrap reference rate and enamel weight in premium mode", () => {
        const errors = collectPremiumSalesInvoiceErrors({
            saleMode: "premium",
            refScrapRate: "",
            totalNetWeight: 0,
            lines: [],
            liveMode: true,
        });
        expect(errors).toContain("Premium invoices need a scrap reference rate (PKR/kg).");
        expect(errors).toContain(
            "Premium invoice must have enamel line weight — this becomes scrap expected from customer.",
        );
    });

    it("enforces matrix watta on every weighted line only in live mode", () => {
        const lines = [{ netWeight: 100, wattaRate: 0 }, { netWeight: 50, wattaRate: 503 }];
        const live = collectPremiumSalesInvoiceErrors({
            saleMode: "premium",
            refScrapRate: "980",
            totalNetWeight: 150,
            lines,
            liveMode: true,
        });
        expect(live).toEqual([
            "Each premium line needs watta from the matrix (party + SWG). Check customer and gauge.",
        ]);

        const offline = collectPremiumSalesInvoiceErrors({
            saleMode: "premium",
            refScrapRate: "980",
            totalNetWeight: 150,
            lines,
            liveMode: false,
        });
        expect(offline).toEqual([]);
    });
});
