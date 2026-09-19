import {
    isRatePending,
    lineRateFields,
    sumFixedLineAmounts,
    financialStatusLabel,
    mapPendingRateRegisterRow,
} from "../src/lib/ratePending.ts";

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

// isRatePending
assert(isRatePending("pending") === true, "pending is pending");
assert(isRatePending("fixed") === false, "fixed is not pending");
assert(isRatePending(undefined) === false, "undefined is not pending");

// lineRateFields — fixed line
const fixed = lineRateFields({ rateStatus: "fixed", rate: 3500, amount: 70000 });
assert(fixed.rate_status === "fixed" && fixed.unit_price === 3500 && fixed.line_amount === 70000, "fixed line fields");

// lineRateFields — pending line zeros financials
const pending = lineRateFields({ rateStatus: "pending", rate: 3500, amount: 70000 });
assert(
    pending.rate_status === "pending" && pending.unit_price === 0 && pending.line_amount === 0,
    "pending line fields zeroed",
);

// sumFixedLineAmounts — mixed document
const lines = [
    { rateStatus: "fixed", amount: 100000 },
    { rateStatus: "pending", amount: 50000 },
    { rateStatus: "fixed", amount: 25000 },
];
assert(sumFixedLineAmounts(lines) === 125000, `sum fixed only: ${sumFixedLineAmounts(lines)}`);

// financialStatusLabel
assert(financialStatusLabel("pending") === "Pending Rate", "pending label");
assert(financialStatusLabel("partial") === "Partial Rate", "partial label");
assert(financialStatusLabel("complete") === "Completed", "complete label");

// mapPendingRateRegisterRow
const row = mapPendingRateRegisterRow({
    id: "abc-123",
    source_doc_type: "purchase_invoice",
    source_doc_id: "doc-1",
    source_line_id: "line-1",
    source_doc_no: "PI-2026-001",
    line_seq: 2,
    party_code: "SUP-01",
    party_name: "Alpha Metals",
    item_code: "RM-ROD-001",
    item_name: "Copper Rod",
    qty: 1500,
    original_posting_date: "2026-06-01",
    days_pending: 5,
    status: "open",
});
assert(row.sourceDocNo === "PI-2026-001" && row.qty === 1500 && row.daysPending === 5, "register row mapping");

console.log("ratePending: all tests passed");
