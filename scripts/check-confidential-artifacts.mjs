import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));

const blockedRoots = ["docs/", "data/", "reports/", "exports/", "imports/", "backups/", ".firecrawl/"];
const blockedExtensions = new Set([
    ".pdf",
    ".csv",
    ".tsv",
    ".xls",
    ".xlsx",
    ".ods",
    ".dump",
    ".backup",
    ".bak",
]);
const documentExtensions = new Set([".md", ".txt", ".rst"]);
const documentTerms = [
    /\bopening\s+(?:stock|balances?)\b/i,
    /\b(?:stock|inventory)\s+balances?\b/i,
    /\b(?:stock|inventory)\s+on[ -]hand\b/i,
];
const operationalSqlSignals = [
    /\b(?:PRD|INV)-\d{3,}(?:-\d+)?\b/i,
    /\bTotals?:\s*[\d,.]+\s*kg\b/i,
    /\b(?:opening|stock|inventory)[^\n]{0,80}\b(?:rate|value|quantity|qty|total)\b[^\n]{0,30}\d{3,}/i,
    /["']qty["']\s*:\s*\d+(?:\.\d+)?[^\n]{0,120}["']unit_cost["']\s*:\s*\d+/i,
];

const failures = [];

for (const file of tracked) {
    const lower = file.toLowerCase();
    const extension = extname(lower);

    if (blockedRoots.some((root) => lower.startsWith(root))) {
        failures.push(`${file}: confidential artifact directory`);
        continue;
    }

    if (blockedExtensions.has(extension) || lower.endsWith(".sql.gz")) {
        failures.push(`${file}: confidential data-file format`);
        continue;
    }

    if (!documentExtensions.has(extension) && !(lower.startsWith("supabase/migrations/") && extension === ".sql")) {
        continue;
    }

    const content = readFileSync(file, "utf8");

    if (documentExtensions.has(extension)) {
        for (const signal of documentTerms) {
            if (signal.test(content)) {
                failures.push(`${file}: documents must not describe stock or opening balances`);
                break;
            }
        }
    }

    if (lower.startsWith("supabase/migrations/") && extension === ".sql") {
        if (content.startsWith("-- REDACTED OPERATIONAL DATA MIGRATION")) continue;
        for (const signal of operationalSqlSignals) {
            if (signal.test(content)) {
                failures.push(`${file}: possible production document, stock quantity, or valuation payload`);
                break;
            }
        }
    }
}

if (failures.length > 0) {
    console.error("Confidential data guard failed:\n");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error("\nKeep operational exports and one-off data fixes in ignored local files only.");
    process.exit(1);
}

console.log(`Confidential data guard passed (${tracked.length} tracked files checked).`);
