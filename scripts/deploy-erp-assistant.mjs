#!/usr/bin/env node
/**
 * Deploy erp-assistant edge function to Supabase.
 * Requires: npx supabase login (once), GEMINI_API_KEY set as edge secret.
 *
 *   set SUPABASE_PROJECT_REF=your-test-project-ref
 *   npx supabase secrets set GEMINI_API_KEY=your-test-key --project-ref %SUPABASE_PROJECT_REF%
 *   npm run deploy:erp-assistant
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();

if (!projectRef) {
    console.error("SUPABASE_PROJECT_REF is required and must identify the isolated test project.");
    process.exit(1);
}

const result = spawnSync(
    "npx",
    ["supabase", "functions", "deploy", "erp-assistant", "--project-ref", projectRef],
    { cwd: root, stdio: "inherit", shell: true },
);

if (result.status !== 0) {
    console.error("\nDeploy failed. Run: npx supabase login");
    process.exit(result.status ?? 1);
}
console.log("\nDeployed erp-assistant to", projectRef);
