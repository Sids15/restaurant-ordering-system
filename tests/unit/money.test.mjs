/**
 * UNIT — money.
 *
 * Every figure a guest is charged and every figure an owner reads passes
 * through here, so the arithmetic is worth pinning: the rates, the rounding,
 * the order GST and service are applied in, and Indian digit grouping (which is
 * not thousands).
 *
 * THESE TESTS MIRROR src/lib/billing.ts, AND THAT IS A HAZARD. The real module
 * imports through Astro's alias, which node cannot resolve standalone, so the
 * logic is reimplemented here — and the first version of this file quietly used
 * 5% service and 2dp rounding when the app uses 10% and whole rupees. Every
 * assertion passed, because a mirror tested against itself always does.
 *
 * So the mirror is pinned to the source: the constants and the rounding rule
 * are read out of billing.ts and asserted before anything else runs. If someone
 * changes a rate, these fail immediately and say so, instead of continuing to
 * test a version of the app that no longer exists.
 */
import { readFileSync } from "node:fs";
import { suite, is, ok, note, finish } from "../harness.mjs";

const SOURCE = readFileSync("src/lib/billing.ts", "utf8");

/** Pull a numeric constant out of the real module. */
function sourceConstant(name) {
  const m = new RegExp(`export const ${name}\\s*=\\s*([0-9.]+)`).exec(SOURCE);
  return m ? Number(m[1]) : null;
}

suite("UNIT · money and billing");

// --- The mirror is honest ----------------------------------------------------
const SERVICE_RATE = 0.1;
const GST_RATE = 0.05;

is("mirror's service rate matches billing.ts", sourceConstant("SERVICE_RATE"), SERVICE_RATE);
is("mirror's GST rate matches billing.ts", sourceConstant("GST_RATE"), GST_RATE);
ok(
  "mirror's rounding matches billing.ts (whole rupees)",
  /const round = \(n: number\) => Math\.round\(n\);/.test(SOURCE),
  "billing.ts no longer rounds to whole rupees — update this mirror before trusting it",
);
ok(
  "GST is still applied to subtotal + service",
  /round\(\(sub \+ service\) \* GST_RATE\)/.test(SOURCE),
  "the order of operations changed in billing.ts",
);

// --- The mirror --------------------------------------------------------------
const round = (n) => Math.round(n);
function computeBill(subtotal) {
  const sub = round(subtotal);
  const service = round(sub * SERVICE_RATE);
  const gst = round((sub + service) * GST_RATE);
  return { subtotal: sub, service, gst, total: sub + service + gst };
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const formatINR = (n) => inr.format(n);

// --- Totals ------------------------------------------------------------------
const b = computeBill(1000);
is("service is 10% of subtotal", b.service, 100);
is("GST is 5% of subtotal + service", b.gst, 55);
is("total is the three added", b.total, 1155);
is("an empty bill totals nothing", computeBill(0).total, 0);

// --- Whole rupees ------------------------------------------------------------
// A printed bill whose lines do not add up to its own total is the kind of
// thing a guest notices at the table, so every component is a whole number and
// the sum is exact rather than approximately right.
note("every line rounds to a whole rupee so the printed bill adds up exactly");
let allWhole = true;
let exact = true;
for (let subtotal = 0; subtotal <= 50000; subtotal += 137.77) {
  const bill = computeBill(subtotal);
  if (![bill.subtotal, bill.service, bill.gst, bill.total].every(Number.isInteger)) allWhole = false;
  if (bill.subtotal + bill.service + bill.gst !== bill.total) exact = false;
}
is("no component is ever fractional", allWhole, true);
is("the printed lines always sum to the total", exact, true);

// Floating point: 0.1 + 0.2 is famously not 0.3.
is("a floating-point subtotal is tamed", computeBill(0.1 + 0.2).subtotal, 0);
is("a subtotal of 0.6 rounds up to 1", computeBill(0.6).subtotal, 1);

// --- Indian grouping ---------------------------------------------------------
// 2,40,000 not 240,000 — a bill grouped in thousands reads as wrong to
// everyone who will ever see this one.
note("Indian grouping is lakh/crore, not thousands");
is("hundreds", formatINR(860), "₹860");
is("thousands", formatINR(2140), "₹2,140");
is("a lakh groups at two digits", formatINR(240000), "₹2,40,000");
is("a crore", formatINR(10000000), "₹1,00,00,000");
is("whole numbers show no decimals", formatINR(1500), "₹1,500");

// --- Invariants that protect the guest ---------------------------------------
let monotonic = true;
let bounded = true;
for (let subtotal = 0; subtotal <= 100000; subtotal += 331.7) {
  const bill = computeBill(subtotal);
  if (bill.total < bill.subtotal) monotonic = false;
  // 10% service, then 5% GST on top of both: 1.155, plus a rupee for rounding.
  if (bill.total > subtotal * 1.155 + 2) bounded = false;
}
is("the total is never less than the subtotal", monotonic, true);
is("the total never exceeds the two rates compounded", bounded, true);

finish();
