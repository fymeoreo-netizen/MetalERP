import { describe, expect, it } from "vitest";
import { COGS_BAND_LABELS, cogsBandForAccount, unabsorbedDominatesCogs } from "./cogsBands";

describe("cogsBandForAccount — characterization (migs 251/276/285)", () => {
    it("maps sales split codes 51001 + 51010–13 to sales_cogs", () => {
        for (const code of ["51001", "51010", "51011", "51012", "51013"]) {
            expect(cogsBandForAccount(code)).toBe("sales_cogs");
        }
    });

    it("maps period cash codes to period_cash", () => {
        for (const code of ["51002", "51003", "51004", "51005", "51007", "51008", "51009"]) {
            expect(cogsBandForAccount(code)).toBe("period_cash");
        }
    });

    it("maps 51006 to wastage and 51999 to absorption", () => {
        expect(cogsBandForAccount("51006")).toBe("wastage");
        expect(cogsBandForAccount("51999")).toBe("absorption");
    });

    it("maps any other 51xxx to other_cogs, including empty and foreign prefixes", () => {
        expect(cogsBandForAccount("51500")).toBe("other_cogs");
        expect(cogsBandForAccount("")).toBe("other_cogs");
        expect(cogsBandForAccount("40001")).toBe("other_cogs");
    });

    it("trims surrounding whitespace before classification", () => {
        expect(cogsBandForAccount(" 51001 ")).toBe("sales_cogs");
    });
});

describe("COGS_BAND_LABELS", () => {
    it("covers every band key", () => {
        const bands = ["sales_cogs", "period_cash", "wastage", "absorption", "other_cogs"] as const;
        for (const band of bands) {
            expect(COGS_BAND_LABELS[band]).toBeTruthy();
        }
    });
});

describe("unabsorbedDominatesCogs", () => {
    it("flags when unabsorbed debit share reaches the 5% default threshold", () => {
        expect(unabsorbedDominatesCogs(5, 100)).toBe(true);
        expect(unabsorbedDominatesCogs(4.99, 100)).toBe(false);
    });

    it("supports custom thresholds", () => {
        expect(unabsorbedDominatesCogs(15, 100, 0.1)).toBe(true);
        expect(unabsorbedDominatesCogs(9, 100, 0.1)).toBe(false);
    });

    it("returns false when either side is zero or negative", () => {
        expect(unabsorbedDominatesCogs(0, 100)).toBe(false);
        expect(unabsorbedDominatesCogs(10, 0)).toBe(false);
        expect(unabsorbedDominatesCogs(-1, 100)).toBe(false);
    });
});
