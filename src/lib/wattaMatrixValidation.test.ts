import { describe, expect, it } from "vitest";
import {
    findWattaOverlapWarning,
    inferWire8Grade,
    parseSwgDecimalFromText,
    parseSwgFromText,
    validateWattaForm,
    type WattaFormValues,
} from "./wattaMatrixValidation";
import type { WattaMatrixRow } from "./scrapObligationTypes";

const baseForm: WattaFormValues = {
    party_id: null,
    direction: "sales",
    product_kind: "enamel",
    wire8_grade: null,
    swg_min: 1,
    swg_max: 24,
    base_watta: 503,
    increment_per_swg: 0,
    effective_from: "2026-08-01",
    is_active: true,
    remarks: null,
};

function matrixRow(overrides: Partial<WattaMatrixRow>): WattaMatrixRow {
    return {
        id: "row-1",
        party_id: null,
        party_code: null,
        party_name: null,
        direction: "sales",
        product_kind: "enamel",
        wire8_grade: null,
        swg_min: 1,
        swg_max: 24,
        base_watta: 503,
        increment_per_swg: 0,
        effective_from: "2026-08-01",
        is_active: true,
        remarks: null,
        ...overrides,
    };
}

describe("validateWattaForm", () => {
    it("rejects negative base watta and negative increments", () => {
        expect(validateWattaForm({ ...baseForm, base_watta: -1 })).toEqual({
            ok: false,
            error: "Base watta cannot be negative.",
        });
        expect(validateWattaForm({ ...baseForm, increment_per_swg: -5 })).toEqual({
            ok: false,
            error: "Increment per SWG cannot be negative.",
        });
    });

    it("requires an effective-from date", () => {
        expect(validateWattaForm({ ...baseForm, effective_from: "  " }).ok).toBe(false);
    });

    it("sales rows must be enamel with SWG bounds in ascending order", () => {
        expect(validateWattaForm({ ...baseForm, product_kind: "wire8" }).ok).toBe(false);
        expect(
            validateWattaForm({ ...baseForm, swg_min: null, swg_max: null }).ok,
        ).toBe(false);
        const inverted = validateWattaForm({ ...baseForm, swg_min: 25, swg_max: 10 });
        expect(inverted).toEqual({ ok: false, error: "SWG min must be less than or equal to SWG max." });
    });

    it("purchase wire8 rows require a grade; rod rows must not carry one", () => {
        expect(
            validateWattaForm({
                ...baseForm,
                direction: "purchase",
                product_kind: "wire8",
                wire8_grade: null,
                swg_min: null,
                swg_max: null,
            }),
        ).toEqual({ ok: false, error: "Wire No 8 grade (Fail / Pass / Special) is required." });
        expect(
            validateWattaForm({
                ...baseForm,
                direction: "purchase",
                product_kind: "rod",
                wire8_grade: "Pass",
                swg_min: null,
                swg_max: null,
            }).ok,
        ).toBe(false);
    });

    it("SWG bands apply only to enamel sales rows", () => {
        expect(
            validateWattaForm({
                ...baseForm,
                direction: "purchase",
                product_kind: "rod",
                wire8_grade: null,
                swg_min: 1,
                swg_max: 10,
            }),
        ).toEqual({ ok: false, error: "SWG bands apply only to enamel (sales)." });
    });

    it("accepts the canonical enamel sales preset", () => {
        expect(validateWattaForm(baseForm)).toEqual({ ok: true });
    });
});

describe("findWattaOverlapWarning", () => {
    it("warns when another active row covers the same band/party/date", () => {
        const warning = findWattaOverlapWarning(baseForm, [matrixRow({})]);
        expect(warning).toContain("overlaps this band");
    });

    it("ignores self, inactive rows, other directions, kinds, parties, dates, and disjoint bands", () => {
        const existing = [
            matrixRow({ id: "self" }),
            matrixRow({ id: "inactive", is_active: false }),
            matrixRow({ id: "dir", direction: "purchase" }),
            matrixRow({ id: "kind", product_kind: "rod" }),
            matrixRow({ id: "party", party_id: "P9", party_code: "P9" }),
            matrixRow({ id: "date", effective_from: "2027-01-01" }),
            matrixRow({ id: "band", swg_min: 40, swg_max: 50 }),
        ];
        expect(findWattaOverlapWarning({ ...baseForm, id: "self" }, existing)).toBeNull();
    });

    it("flags overlapping (not just identical) enamel bands", () => {
        const warning = findWattaOverlapWarning(baseForm, [
            matrixRow({ swg_min: 20, swg_max: 30 }),
        ]);
        expect(warning).toContain("overlaps this band");
    });
});

describe("SWG text parsing", () => {
    it("parseSwgFromText reads integer SWG values", () => {
        expect(parseSwgFromText("SWG 18")).toBe(18);
        expect(parseSwgFromText("swg 8")).toBe(8);
        expect(parseSwgFromText("18")).toBe(18);
        expect(parseSwgFromText("")).toBeNull();
        expect(parseSwgFromText(null)).toBeNull();
        expect(parseSwgFromText("copper coil")).toBeNull();
    });

    it("integer parser truncates decimals while decimal parser keeps them", () => {
        expect(parseSwgFromText("SWG 19.5")).toBe(19);
        expect(parseSwgDecimalFromText("SWG 19.5")).toBe(19.5);
        expect(parseSwgDecimalFromText("19.5")).toBe(19.5);
        expect(parseSwgDecimalFromText("nope")).toBeNull();
    });
});

describe("inferWire8Grade", () => {
    it("prefers exact size-spec matches", () => {
        expect(inferWire8Grade("Anything", "fail")).toBe("Fail");
        expect(inferWire8Grade("Anything", "Special")).toBe("Special");
        expect(inferWire8Grade("Anything", "pass")).toBe("Pass");
    });

    it("falls back to name heuristics", () => {
        expect(inferWire8Grade("Wire No 8 Fail lot")).toBe("Fail");
        expect(inferWire8Grade("w8 scrap bundle")).toBe("Pass");
        expect(inferWire8Grade("Copper rod 8mm")).toBeUndefined();
        expect(inferWire8Grade("Enamel wire SWG 20")).toBe("Pass");
        expect(inferWire8Grade("Random item")).toBeUndefined();
    });
});
