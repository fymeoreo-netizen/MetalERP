#!/usr/bin/env node
// Security guard (CI): block NEW migrations from reintroducing dangerous RLS patterns
// that were remediated in migrations 156-158:
//   * permissive write policies using (true) / with check (true)
//   * DELETE policies guarded only by  auth.uid() is not null
//
// Migrations at or before the hardening baseline are grandfathered (their permissive
// policies are superseded by 156/157/158). Any migration numbered ABOVE the baseline
// that reintroduces these patterns fails the build.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "supabase", "migrations");

// Last migration that is allowed to contain the legacy patterns.
// Bumped to 163 after the C1-C5/H1-H6 hardening pass (migrations 159-163).
const BASELINE = 163;

const FORBIDDEN = [
    {
        id: "permissive-true",
        // Public authenticated reads can intentionally use USING (true).
        // Writes must always be permission-gated.
        re: /\bwith\s+check\s*\(\s*true\s*\)|\bfor\s+(?:all|insert|update|delete)\b[\s\S]{0,160}?\busing\s*\(\s*true\s*\)/i,
        msg: "permissive write RLS policy — use can_mutate_transactions()/can_mutate_masters().",
    },
    {
        id: "auth-only-delete",
        // for delete ... using (auth.uid() is not null)
        re: /for\s+delete[\s\S]{0,160}?using\s*\(\s*auth\.uid\(\)\s+is\s+not\s+null\s*\)/i,
        msg: "DELETE policy guarded only by `auth.uid() is not null` — require has_role('ADMIN') or can_mutate_transactions().",
    },
];

function migrationNumber(name) {
    const m = name.match(/^(\d+)_/);
    return m ? Number(m[1]) : null;
}

let failures = 0;
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
    const num = migrationNumber(file);
    if (num === null || num <= BASELINE) continue; // grandfathered / non-numbered

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    // strip line comments to avoid false positives in documentation
    const stripped = sql.replace(/--.*$/gm, "");

    for (const rule of FORBIDDEN) {
        if (rule.re.test(stripped)) {
            failures++;
            console.error(`\u2717 ${file}: ${rule.msg}`);
        }
    }
}

if (failures > 0) {
    console.error(`\nRLS policy guard failed with ${failures} issue(s).`);
    console.error("If this is intentional, justify in review and update scripts/check-rls-policies.mjs BASELINE.");
    process.exit(1);
}

console.log(`RLS policy guard passed (${files.length} migration files scanned, baseline ${BASELINE}).`);
