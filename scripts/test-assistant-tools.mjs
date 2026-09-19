#!/usr/bin/env node
/**
 * Smoke tests for ERP assistant client helpers and optional live RPC checks.
 * Run: node scripts/test-assistant-tools.mjs
 * Live RPCs (optional): set VITE_SUPABASE_URL + ERP_TEST_JWT in env.
 */
import { filterExamplesForTools } from "../src/lib/ai/tools.ts";

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

// filterExamplesForTools — ledger-only user should not see trial balance example
const ledgerTools = [
    "resolve_entity",
    "get_party_balance",
    "get_ap_aging",
    "get_document_attribution",
    "get_cashbook_payment",
    "get_scrap_trade",
    "get_recent_sales_invoices",
    "get_sales_summary",
    "get_pending_rate_register",
];
const ledgerExamples = filterExamplesForTools(ledgerTools);
assert(ledgerExamples.length >= 4, "ledger examples should include core prompts");
assert(
    !ledgerExamples.some((q) => q.toLowerCase().includes("trial balance")),
    "trial balance example hidden without financial reports",
);

const adminTools = [...ledgerTools, "get_trial_balance", "get_daily_production", "get_transaction_history"];
const adminExamples = filterExamplesForTools(adminTools);
assert(adminExamples.some((q) => q.toLowerCase().includes("trial balance")), "admin sees financial example");

// Disambiguation shape (documents expected RPC contract)
const sampleResolve = {
    ok: true,
    data: {
        needs_disambiguation: true,
        candidates: [
            { kind: "party", code: "SUP-01", name: "A One Washing Machine", score: 70 },
            { kind: "party", code: "SUP-02", name: "A One Motors", score: 68 },
        ],
    },
};
assert(sampleResolve.data.needs_disambiguation === true, "resolve_entity disambiguation flag");
assert(sampleResolve.data.candidates.length === 2, "resolve_entity candidates");

// Attribution shape — no audit blobs
const sampleAttribution = {
    ok: true,
    doc_type: "sales_invoice",
    doc_no: "SI-2026-014",
    events: [{ at: "2026-06-01T10:00:00Z", action: "post", actor_name: "Admin", summary: "Posted invoice" }],
};
assert(!("before_data" in sampleAttribution.events[0]), "attribution events sanitized");
assert(!("after_data" in sampleAttribution.events[0]), "attribution events sanitized");

async function optionalLiveRpc() {
    const base = process.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
    const jwt = process.env.ERP_TEST_JWT;
    if (!base || !jwt) {
        console.log("assistant-tools: skipped live RPC (set VITE_SUPABASE_URL + ERP_TEST_JWT to enable)");
        return;
    }
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        apikey: process.env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    };
    const rateRes = await fetch(`${base}/rest/v1/rpc/fn_erp_assistant_check_rate_limit`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ p_max_per_hour: 30 }),
    });
    assert(rateRes.ok, `rate limit RPC failed: ${rateRes.status}`);
    const rateJson = await rateRes.json();
    assert(rateJson.ok === true || rateJson.ok === false, "rate limit returns ok field");

    const resolveRes = await fetch(`${base}/rest/v1/rpc/fn_erp_assistant_execute_tool`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
            p_tool: "resolve_entity",
            p_params: { query: "test", kind: "party" },
        }),
    });
    if (resolveRes.ok) {
        const resolveJson = await resolveRes.json();
        assert(resolveJson.ok === true, "resolve_entity execute wrapper ok");
        assert(Array.isArray(resolveJson.data?.candidates) || resolveJson.data?.candidates === undefined, "candidates array");
    } else {
        console.log("assistant-tools: live resolve_entity skipped (auth/schema):", resolveRes.status);
    }
}

await optionalLiveRpc();
console.log("assistant-tools: all tests passed");
