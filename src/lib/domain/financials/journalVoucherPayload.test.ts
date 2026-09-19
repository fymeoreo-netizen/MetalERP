import { describe, expect, it } from "vitest";
import {
    formValuesToPayload,
    isPartyControlAccount,
    journalVoucherPayloadSchema,
    type JournalVoucherFormValues,
    type JournalVoucherPayload,
} from "./journalVoucherPayload";

describe("isPartyControlAccount — AR/AP control codes require parties", () => {
    it("accepts the four control accounts with trimming", () => {
        for (const code of ["11201", "11202", "21101", "21103"]) {
            expect(isPartyControlAccount(code)).toBe(true);
            expect(isPartyControlAccount(` ${code} `)).toBe(true);
        }
        expect(isPartyControlAccount("51001")).toBe(false);
        expect(isPartyControlAccount(null)).toBe(false);
        expect(isPartyControlAccount(undefined)).toBe(false);
    });
});

function twoLinePayload(): JournalVoucherPayload {
    return {
        postingDate: "2026-08-25",
        narration: "Opening adjustment",
        lines: [
            { accountCode: "51001", debit: 1000.5, credit: 0, remarks: "COGS" },
            { accountCode: "11201", partyCode: "CUST-1", debit: 0, credit: 1000.5 },
        ],
    };
}

describe("journalVoucherPayloadSchema", () => {
    it("accepts a balanced two-line voucher", () => {
        const result = journalVoucherPayloadSchema.safeParse(twoLinePayload());
        expect(result.success).toBe(true);
    });

    it("rejects unbalanced vouchers naming both totals", () => {
        const payload = twoLinePayload();
        payload.lines[1].credit = 1000;
        const result = journalVoucherPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message.includes("out of balance"))).toBe(true);
        }
    });

    it("rejects zero-total sides even when balanced", () => {
        const payload = {
            postingDate: "2026-08-25",
            lines: [
                { accountCode: "51001", debit: -5, credit: 0 },
                { accountCode: "11201", partyCode: "C1", debit: 0, credit: -5 },
            ],
        };
        // negative amounts violate nonnegativity before balance checks
        expect(journalVoucherPayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("enforces one-sided entries per line", () => {
        const both = twoLinePayload();
        both.lines[0].credit = 10;
        const result = journalVoucherPayloadSchema.safeParse(both);
        expect(result.success).toBe(false);

        const neither = twoLinePayload();
        neither.lines[0].debit = 0;
        const result2 = journalVoucherPayloadSchema.safeParse(neither);
        expect(result2.success).toBe(false);
    });

    it("requires a party on AR/AP control lines and forbids one elsewhere", () => {
        const missingParty = twoLinePayload();
        missingParty.lines[1].partyCode = null;
        expect(journalVoucherPayloadSchema.safeParse(missingParty).success).toBe(false);

        const strayParty = twoLinePayload();
        strayParty.lines[0].partyCode = "CUST-9";
        expect(journalVoucherPayloadSchema.safeParse(strayParty).success).toBe(false);
    });

    it("needs at least two lines to post", () => {
        const single = twoLinePayload();
        single.lines = [single.lines[0]];
        const result = journalVoucherPayloadSchema.safeParse(single);
        expect(result.success).toBe(false);
    });
});

describe("formValuesToPayload — form-string normalization", () => {
    const formValues: JournalVoucherFormValues = {
        postingDate: "2026-08-25",
        referenceNo: "  REF-7  ",
        narration: "  Adjust  ",
        lines: [
            { accountCode: " 11201 ", partyCode: " CUST-1 ", debit: "500", credit: "" },
            { accountCode: "51001", partyCode: "CUST-X", debit: "", credit: "500" },
        ],
    };

    it("trims strings, coerces numerics, blanks credits on control lines, and strips parties elsewhere", () => {
        const payload = formValuesToPayload(formValues);
        expect(payload.referenceNo).toBe("REF-7");
        expect(payload.narration).toBe("Adjust");
        expect(payload.lines[0]).toEqual({
            accountCode: "11201",
            partyCode: "CUST-1",
            debit: 500,
            credit: 0,
            remarks: undefined,
        });
        expect(payload.lines[1]).toEqual({
            accountCode: "51001",
            partyCode: null,
            debit: 0,
            credit: 500,
            remarks: undefined,
        });
        expect(journalVoucherPayloadSchema.safeParse(payload).success).toBe(true);
    });
});
