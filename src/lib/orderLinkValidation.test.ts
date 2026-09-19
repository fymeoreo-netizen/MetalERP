import { describe, expect, it } from "vitest";
import { formatRateWarningMessage, validateLinkedInvoiceLines } from "./orderLinkValidation";

const linked = {
    itemCode: "ENM20",
    netWeight: 100,
    rate: 1200,
    salesOrderLineId: "sol-1",
    orderItemCode: "ENM20",
    orderRate: 1200,
    orderedQty: 150,
};

describe("validateLinkedInvoiceLines", () => {
    it("passes everything through when no order is linked", () => {
        const result = validateLinkedInvoiceLines([{ itemCode: "X", netWeight: 5 }], null);
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.rateWarnings).toHaveLength(0);
    });

    it("requires an order line reference for weighted lines unless item matches the order line's item", () => {
        const missingRef = validateLinkedInvoiceLines(
            [{ itemCode: "ENM20", netWeight: 100 }],
            "order-1",
        );
        expect(missingRef.errors[0]).toContain("requires an order line reference");

        const matchingItemNoRef = validateLinkedInvoiceLines(
            [{ itemCode: "ENM20", netWeight: 100, orderItemCode: "ENM20" }],
            "order-1",
        );
        expect(matchingItemNoRef.errors).toHaveLength(0);
    });

    it("flags item mismatches between invoice line and order line", () => {
        const result = validateLinkedInvoiceLines(
            [{ ...linked, itemCode: "ROD8", orderItemCode: "ENM20" }],
            "order-1",
        );
        expect(result.errors.some((e) => e.includes("does not match order line item"))).toBe(true);
    });

    it("rejects invoicing beyond remaining ordered qty (tolerance 0.001 kg)", () => {
        const overQty = validateLinkedInvoiceLines([{ ...linked, netWeight: 150.002 }], "order-1");
        expect(overQty.errors.some((e) => e.includes("exceeds remaining order qty"))).toBe(true);

        const withinTolerance = validateLinkedInvoiceLines([{ ...linked, netWeight: 150.0005 }], "order-1");
        expect(withinTolerance.errors).toHaveLength(0);
    });

    it("emits a soft rate warning outside the 0.001 epsilon instead of a hard error", () => {
        const warned = validateLinkedInvoiceLines([{ ...linked, rate: 1250 }], "order-1");
        expect(warned.errors).toHaveLength(0);
        expect(warned.rateWarnings).toEqual([
            { itemLabel: "ENM20", orderRate: 1200, invoiceRate: 1250 },
        ]);

        const sameRate = validateLinkedInvoiceLines([{ ...linked, rate: 1200.0005 }], "order-1");
        expect(sameRate.rateWarnings).toHaveLength(0);
    });
});

describe("formatRateWarningMessage", () => {
    it("renders one ₨-denominated comparison per warning, newline-joined", () => {
        const message = formatRateWarningMessage([
            { itemLabel: "ENM20", orderRate: 1200, invoiceRate: 1250 },
            { itemLabel: "ENM22", orderRate: 900, invoiceRate: 850 },
        ]);
        const lines = message.split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain("ENM20");
        expect(lines[0]).toContain("vs invoice rate");
        expect(lines[1]).toContain("ENM22");
    });
});
