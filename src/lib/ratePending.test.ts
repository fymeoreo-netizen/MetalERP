import { describe, expect, it } from "vitest";
import {
    docTypeLabel,
    financialStatusLabel,
    isRatePending,
    lineRateFields,
    mapLineFromDb,
    mapLineRateStatus,
    mapPendingRateRegisterRow,
    pendingReasonLabel,
    salesInvoiceDisplayTotal,
    sumFixedLineAmounts,
} from "./ratePending";

describe("isRatePending", () => {
    it("accepts only the literal 'pending' status", () => {
        expect(isRatePending("pending")).toBe(true);
        expect(isRatePending("fixed")).toBe(false);
        expect(isRatePending(null)).toBe(false);
        expect(isRatePending(undefined)).toBe(false);
    });
});

describe("lineRateFields — DB serialization of rate-pending lines", () => {
    it("zeroes rate and amount for pending lines (migs 141–151 lineage)", () => {
        expect(lineRateFields({ rateStatus: "pending", rate: 999, amount: 5000 })).toEqual({
            rate_status: "pending",
            unit_price: 0,
            line_amount: 0,
        });
    });

    it("passes numeric rate and amount through for fixed lines", () => {
        expect(lineRateFields({ rateStatus: "fixed", rate: 120, amount: 3600 })).toEqual({
            rate_status: "fixed",
            unit_price: 120,
            line_amount: 3600,
        });
    });

    it("defaults missing amounts to 0", () => {
        expect(lineRateFields({ rateStatus: "fixed" })).toEqual({
            rate_status: "fixed",
            unit_price: 0,
            line_amount: 0,
        });
    });
});

describe("labels", () => {
    it("financialStatusLabel covers complete/partial/pending and defaults to Completed", () => {
        expect(financialStatusLabel("pending")).toBe("Pending Rate");
        expect(financialStatusLabel("partial")).toBe("Partial Rate");
        expect(financialStatusLabel("complete")).toBe("Completed");
        expect(financialStatusLabel(undefined)).toBe("Completed");
    });

    it("pendingReasonLabel distinguishes tare vs rate vs both", () => {
        expect(pendingReasonLabel("tare")).toBe("Tare pending");
        expect(pendingReasonLabel("rate_and_tare")).toBe("Rate & tare pending");
        expect(pendingReasonLabel("rate")).toBe("Rate pending");
        expect(pendingReasonLabel(null)).toBe("Rate pending");
    });

    it("docTypeLabel humanizes snake_case doc types", () => {
        expect(docTypeLabel("sales_invoice")).toBe("Sales Invoice");
        expect(docTypeLabel("credit_note")).toBe("Credit Note");
    });
});

describe("mapPendingRateRegisterRow", () => {
    it("maps snake_case register rows to camelCase DTO", () => {
        const row = mapPendingRateRegisterRow({
            id: "p1",
            source_doc_type: "purchase_invoice",
            source_doc_id: "d1",
            source_line_id: "l1",
            source_doc_no: "PI-7",
            line_seq: 2,
            party_code: "P01",
            party_name: "Acme",
            item_code: "ENM",
            item_name: "Enamel",
            qty: 12.5,
            original_posting_date: "2026-07-01",
            days_pending: 9,
            status: "open",
            pending_reason: "rate_and_tare",
        });
        expect(row).toMatchObject({
            id: "p1",
            sourceDocType: "purchase_invoice",
            sourceLineId: "l1",
            lineSeq: 2,
            qty: 12.5,
            daysPending: 9,
            pendingReason: "rate_and_tare",
        });
    });

    it("coerces unknown pending reasons to 'rate' and absent fields to safe defaults", () => {
        const row = mapPendingRateRegisterRow({ id: 42 });
        expect(row.pendingReason).toBe("rate");
        expect(row.sourceLineId).toBeNull();
        expect(row.lineSeq).toBe(1);
        expect(row.status).toBe("open");
    });
});

describe("sumFixedLineAmounts", () => {
    it("sums only fixed-rate line amounts", () => {
        const lines = [
            { rateStatus: "fixed" as const, amount: 100 },
            { rateStatus: "pending" as const, amount: 999 },
            { rateStatus: "fixed" as const, amount: 23.5 },
            { rateStatus: undefined, amount: 50 },
        ];
        expect(sumFixedLineAmounts(lines)).toBeCloseTo(173.5, 6);
    });
});

describe("mapLineFromDb / mapLineRateStatus", () => {
    it("treats anything not literally 'pending' as fixed", () => {
        expect(mapLineRateStatus("pending")).toBe("pending");
        expect(mapLineRateStatus("fixed")).toBe("fixed");
        expect(mapLineRateStatus(null)).toBe("fixed");
    });

    it("keeps the stored unit price but zeroes amount for pending DB lines", () => {
        expect(mapLineFromDb({ rate_status: "pending", unit_price: 150, line_amount: 4500 })).toEqual({
            rateStatus: "pending",
            rate: 150,
            amount: 0,
        });
        expect(mapLineFromDb({ rate_status: "fixed", unit_price: 150, line_amount: 4500 })).toEqual({
            rateStatus: "fixed",
            rate: 150,
            amount: 4500,
        });
    });
});

describe("salesInvoiceDisplayTotal", () => {
    it("prefers a positive header grand_total", () => {
        expect(
            salesInvoiceDisplayTotal({
                grand_total: 1234.5,
                sales_invoice_lines: [{ line_amount: 99 }],
            }),
        ).toBe(1234.5);
    });

    it("falls back to line amounts minus discount when header stayed 0", () => {
        expect(
            salesInvoiceDisplayTotal({
                grand_total: 0,
                discount_amount: 50,
                sales_invoice_lines: [
                    { line_amount: 100 },
                    { line_amount: 200 },
                    { line_amount: null, rate_status: "pending" },
                ],
            }),
        ).toBe(250);
    });

    it("adds proportional tax when subtotal and tax are known", () => {
        expect(
            salesInvoiceDisplayTotal({
                grand_total: 0,
                subtotal_amount: 1000,
                discount_amount: 0,
                tax_amount: 100,
                sales_invoice_lines: [{ line_amount: 1000 }],
            }),
        ).toBe(1100);
    });

    it("clamps discounted-below-zero results to 0 and returns 0 with no lines", () => {
        expect(
            salesInvoiceDisplayTotal({
                grand_total: 0,
                discount_amount: 300,
                sales_invoice_lines: [{ line_amount: 100 }],
            }),
        ).toBe(0);
        expect(salesInvoiceDisplayTotal({ grand_total: null, sales_invoice_lines: [] })).toBe(0);
    });
});
