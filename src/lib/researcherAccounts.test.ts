import { describe, expect, it } from "vitest";
import { parseResearcherCredentials } from "./researcherAccounts";

describe("parseResearcherCredentials", () => {
    it("accepts a complete accountant credential response", () => {
        expect(parseResearcherCredentials({
            ok: true,
            credentials: {
                email: "researcher@example.test",
                password: "generated-password",
                loginAs: "accountant",
            },
        })).toEqual({
            email: "researcher@example.test",
            password: "generated-password",
            loginAs: "accountant",
        });
    });

    it("rejects malformed or privileged credential responses", () => {
        expect(() => parseResearcherCredentials({
            ok: true,
            credentials: { email: "x", password: "y", loginAs: "admin" },
        })).toThrow("invalid researcher credentials");
    });

    it("surfaces server errors", () => {
        expect(() => parseResearcherCredentials({
            ok: false,
            error: "Account creation limit reached.",
        })).toThrow("Account creation limit reached.");
    });
});
