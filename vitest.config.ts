import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.{ts,tsx}"],
        coverage: {
            reporter: ["text"],
            include: ["src/lib/domain/**", "src/lib/premiumScrapAllocation.ts", "src/lib/cogsBands.ts", "src/lib/scrapReceivableAllocation.ts", "src/lib/ratePending.ts", "src/lib/orderLinkValidation.ts", "src/lib/wattaMatrixValidation.ts", "src/lib/invoiceFormValidation.ts"],
        },
    },
});
