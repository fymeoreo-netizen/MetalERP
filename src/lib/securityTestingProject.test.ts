import { describe, expect, it } from "vitest";
import {
    assertSecurityTestingProject,
    SECURITY_TEST_PROJECT_REF,
} from "./securityTestingProject";

describe("assertSecurityTestingProject", () => {
    const testUrl = `https://${SECURITY_TEST_PROJECT_REF}.supabase.co`;

    it("accepts only the dedicated test project", () => {
        expect(() => assertSecurityTestingProject(testUrl, SECURITY_TEST_PROJECT_REF)).not.toThrow();
        expect(() => assertSecurityTestingProject(testUrl, null)).not.toThrow();
    });

    it("rejects a different Supabase project", () => {
        expect(() => assertSecurityTestingProject("https://different-project.supabase.co", null))
            .toThrow("only to the isolated");
    });

    it("rejects a mismatched key project reference", () => {
        expect(() => assertSecurityTestingProject(testUrl, "different-project"))
            .toThrow("does not belong");
    });

    it("rejects insecure or malformed URLs", () => {
        expect(() => assertSecurityTestingProject(`http://${SECURITY_TEST_PROJECT_REF}.supabase.co`, null))
            .toThrow("only to the isolated");
        expect(() => assertSecurityTestingProject("not-a-url", null))
            .toThrow("URL is invalid");
    });
});
