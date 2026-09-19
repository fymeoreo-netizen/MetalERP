import {
    suggestObligationIdsFifo,
    computeReceivableAllocation,
    sortObligationsFifo,
    totalAllocationAmount,
    computeCreditAllocations,
    remainderKgAfterCredits,
} from "../src/lib/scrapReceivableAllocation.ts";

function obl(id, no, date, open, rate = 3500) {
    return {
        obligation_id: id,
        obligation_no: `SRO-${no}`,
        sales_invoice_id: id,
        sales_invoice_no: no,
        invoice_date: date,
        ref_scrap_rate: rate,
        expected_kg: open,
        received_kg: 0,
        open_kg: open,
        status: "open",
    };
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const A = obl("a", "INV-A", "2026-01-01", 200, 3500);
const B = obl("b", "INV-B", "2026-02-01", 450, 3600);
const C = obl("c", "INV-C", "2026-03-01", 100, 3400);

// FIFO sort (oldest invoice first)
const sorted = sortObligationsFifo([B, A, C]);
assert(sorted[0].obligation_id === "a" && sorted[2].obligation_id === "c", "FIFO sort by date");

// FIFO suggestion
const fifo = suggestObligationIdsFifo(500, [B, A, C]);
assert(fifo.join(",") === "a,b", `FIFO suggest: expected a,b got ${fifo.join(",")}`);

// Single partial
const single = computeReceivableAllocation(150, ["a"], [A, B]);
assert(single.lines.length === 1 && single.lines[0].allocatedKg === 150, "single partial");
assert(single.lines[0].remainingOpenKg === 50, "single remaining");

// Two invoices
const two = computeReceivableAllocation(500, ["a", "b"], [A, B]);
assert(two.lines.length === 2, "two lines");
assert(two.lines[0].allocatedKg === 200 && two.lines[1].allocatedKg === 300, "200+300 split");
assert(two.lines[1].remainingOpenKg === 150, "B remaining 150");

// Shortfall
const short = computeReceivableAllocation(800, ["a", "b"], [A, B]);
assert(short.error && short.error.includes("650"), `shortfall error: ${short.error}`);

// Weighted total amount (per-line, not averaged display)
const lineTotal = totalAllocationAmount(two.lines);
assert(Math.abs(lineTotal - 1780000) < 1, `line total amount ${lineTotal}`);

// Credit + obligation mixed allocation
const creditOnly = computeCreditAllocations(1000, ["c1"], [
    { credit_id: "c1", trade_no: "SCR-1", open_kg: 1000 },
]);
assert(creditOnly.lines.length === 1 && creditOnly.lines[0].allocatedKg === 1000, "credit full apply");

const remainder = remainderKgAfterCredits(1200, 1000);
assert(remainder === 200, `remainder after credit: ${remainder}`);

const mixed = computeReceivableAllocation(200, ["a"], [A]);
assert(mixed.lines[0].allocatedKg === 200, "obligation on remainder");

console.log("scrapReceivableAllocation: all tests passed");
