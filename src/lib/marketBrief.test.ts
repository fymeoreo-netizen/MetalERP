import { describe, expect, it } from "vitest";
import { parseMarketBriefSections, summarizeMarketBrief } from "./marketBrief";

describe("market brief formatting", () => {
    const brief = "## Market position\nCopper is **PKR 4,010/kg**.\n\n## Procurement action\n- Compare supplier quotes.";

    it("creates a short dashboard summary without markdown headings", () => {
        expect(summarizeMarketBrief(brief, 45)).toBe("Copper is PKR 4,010/kg. Compare supplier...");
    });

    it("splits the full brief into display sections", () => {
        expect(parseMarketBriefSections(brief)).toEqual([
            { title: "Market position", body: "Copper is **PKR 4,010/kg**." },
            { title: "Procurement action", body: "- Compare supplier quotes." },
        ]);
    });
});
