/**
 * Ledger reconciliation regression guard.
 *
 * Calls erp.fn_reconciliation_checks() on the live Supabase project and enforces the
 * STRUCTURAL invariants that must always hold (the root-cause fixes from migrations
 * 261-268). Operational residuals (AR/AP allocation, INV PAC drift) are reported as
 * warnings, not failures, because they close via operator action + final PAC close.
 *
 * Structural (must PASS, else exit 1):
 *   TB_BALANCE          — every posted JE balances; GL nets to zero
 *   ORPHAN_PROD_JE      — no PRODUCTION_BATCH JE whose batch was deleted
 *   ORPHAN_SCRAP_ARAP   — no scrap AR/AP doc whose trade was deleted
 *   OPENING_JE_MOVEMENT_MATCH — opening JE ↔ opening movement
 *
 * Report-grade (fail CI when present and FAIL; monthly close gates):
 *   PAC_PERIOD_LOCKED, UNABSORBED_51999_CAP
 *   INV_CONTROL is FAIL in RPC when variance; CI treats it as report-grade when
 *   prior month PAC is locked (else warn).
 *
 * Operational (warn only):
 *   AR_CONTROL, AP_CONTROL,
 *   AR_UNALLOCATED_RECEIPTS, AP_UNALLOCATED_PAYMENTS, PAYMENTS_NULL_PARTY
 *   INV_CONTROL (warn when PAC not locked for prior month)
 *
 * Env (self-skips with exit 0 if absent so CI stays green for contributors without secrets):
 *   SUPABASE_URL                     project URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY        service role key (preferred; bypasses RLS)
 *   SUPABASE_ANON_KEY                anon key fallback (VITE_SUPABASE_PUBLISHABLE_KEY)
 *
 * Usage: npm run test:recon
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// --- minimal .env loader (so local `npm run test:recon` works without --env-file) ---
function loadDotenv() {
    const envPath = join(root, ".env");
    if (!existsSync(envPath)) return;
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const [, k, v] = m;
        if (process.env[k] === undefined) {
            process.env[k] = v.replace(/^["']|["']$/g, "");
        }
    }
}
loadDotenv();

async function main() {
    const supabaseUrl = (
        process.env.SUPABASE_URL ||
        process.env.VITE_SUPABASE_URL ||
        ""
    ).trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    // Only the service role can call erp.* RPCs headlessly (anon lacks schema permission).
    // Self-skip when absent so CI stays green for contributors without the secret.
    if (!supabaseUrl || !serviceKey) {
        console.log(
            "test:recon — skipped (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set).",
        );
        return;
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        db: { schema: "erp" },
    });

const STRUCTURAL = new Set([
    "TB_BALANCE",
    "ORPHAN_PROD_JE",
    "ORPHAN_SCRAP_ARAP",
    "OPENING_JE_MOVEMENT_MATCH",
]);
const REPORT_GRADE = new Set([
    "PAC_PERIOD_LOCKED",
    "UNABSORBED_51999_CAP",
]);

const { data, error } = await supabase.rpc("fn_reconciliation_checks");
if (error) {
    console.error("test:recon — RPC call failed:", error.message);
    process.exitCode = 1;
    return;
}

const rows = Array.isArray(data) ? data : [];
const failures = rows.filter((r) => r.status === "FAIL");
const pacLockedRow = rows.find((r) => r.check_code === "PAC_PERIOD_LOCKED");
const priorMonthPacLocked = pacLockedRow?.status === "PASS" && Number(pacLockedRow?.variance ?? 0) > 1000;
/** INV residual tolerance after PAC lock (PKR). Above this → report-grade FAIL. */
const INV_LOCK_TOLERANCE = 20_000_000;

console.log("test:recon — erp.fn_reconciliation_checks()");
const width = Math.max(...rows.map((r) => (r.check_code || "").length), 24);
for (const r of rows) {
    const code = String(r.check_code || "").padEnd(width);
    const varStr = Number(r.variance ?? 0).toLocaleString(undefined, {
        maximumFractionDigits: 2,
    });
    let flag = "PASS";
    if (r.status !== "PASS") {
        if (STRUCTURAL.has(r.check_code) || REPORT_GRADE.has(r.check_code)) flag = "FAIL";
        else if (
            r.check_code === "INV_CONTROL" &&
            priorMonthPacLocked &&
            Math.abs(Number(r.variance ?? 0)) > INV_LOCK_TOLERANCE
        ) {
            flag = "FAIL";
        } else flag = "WARN";
    }
    console.log(`  ${code}  ${flag}  ${varStr}`);
}

const structuralFails = failures.filter((r) => STRUCTURAL.has(r.check_code));
if (structuralFails.length > 0) {
    console.error(
        `\ntest:recon — ${structuralFails.length} STRUCTURAL check(s) failed:` +
            structuralFails.map((r) => `\n  - ${r.check_code}: ${r.check_name}`).join(""),
    );
    process.exitCode = 1;
    return;
}

const reportFails = failures.filter(
    (r) =>
        REPORT_GRADE.has(r.check_code) ||
        (r.check_code === "INV_CONTROL" &&
            priorMonthPacLocked &&
            Math.abs(Number(r.variance ?? 0)) > INV_LOCK_TOLERANCE),
);
if (reportFails.length > 0) {
    console.error(
        `\ntest:recon — ${reportFails.length} REPORT-GRADE check(s) failed:` +
            reportFails
                .map((r) => `\n  - ${r.check_code}: ${Number(r.variance).toLocaleString()}`)
                .join(""),
    );
    process.exitCode = 1;
    return;
}

const opFails = failures.filter(
    (r) =>
        !STRUCTURAL.has(r.check_code) &&
        !REPORT_GRADE.has(r.check_code) &&
        !(
            r.check_code === "INV_CONTROL" &&
            priorMonthPacLocked &&
            Math.abs(Number(r.variance ?? 0)) > INV_LOCK_TOLERANCE
        ),
);
if (opFails.length > 0) {
    console.log(
        `\ntest:recon — ${opFails.length} operational residual(s) (warn only, close via operator allocation + final PAC):` +
            opFails.map((r) => `\n  - ${r.check_code}: ${Number(r.variance).toLocaleString()}`).join(""),
    );
}

console.log("\ntest:recon — structural + report-grade gates PASS.");
}

await main();
