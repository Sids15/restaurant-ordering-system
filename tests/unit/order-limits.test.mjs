/**
 * UNIT — the limits on what one order may contain.
 *
 * createOrder is the only path an order enters the database, and it is reachable
 * by anyone holding a table session — which is anyone who scanned a QR. Its two
 * bounds are therefore the whole of the guest-side input model: at most
 * MAX_LINES distinct lines, at most MAX_QTY_PER_LINE of any one dish.
 *
 * THE BUG THIS PINS. The per-dish cap was applied to each SUBMITTED line, and
 * duplicate item ids were collapsed into a single quantity afterwards. Nothing
 * re-checked the collapsed total, so a hundred lines of the same dish at fifty
 * each passed both bounds and produced an order for five thousand of it. Each
 * line was legal; the order was not.
 *
 * Mirrors the validation in src/lib/orders/create.ts, with the mirror PINNED to
 * that source below — both constants and the collapsed-total check itself. A
 * mirror tested against itself passes no matter what the app does.
 */
import { readFileSync } from "node:fs";
import { suite, is, ok, note, finish } from "../harness.mjs";

const SRC = readFileSync("src/lib/orders/create.ts", "utf8");

suite("UNIT · order limits");

// --- Pin the mirror to the source -------------------------------------------
const MAX_QTY_PER_LINE = Number(/const MAX_QTY_PER_LINE = (\d+)/.exec(SRC)?.[1]);
const MAX_LINES = Number(/const MAX_LINES = (\d+)/.exec(SRC)?.[1]);

is("the per-dish cap is read from the source", Number.isFinite(MAX_QTY_PER_LINE), true);
is("the line cap is read from the source", Number.isFinite(MAX_LINES), true);

ok(
  "the source checks the COLLAPSED total, not just each submitted line",
  /for \(const \[[^\]]*\] of wanted\)[\s\S]{0,240}> MAX_QTY_PER_LINE/.test(SRC),
  "duplicate lines of one dish are never re-checked — the per-dish cap splits away",
);

// --- The mirror --------------------------------------------------------------
/** The shape of createOrder's validation, up to the point it reaches the DB. */
function validate(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "empty";
  if (lines.length > MAX_LINES) return "malformed";

  const wanted = new Map();
  for (const line of lines) {
    const qty = Math.floor(Number(line.qty));
    if (!line.item_id || !Number.isFinite(qty) || qty <= 0) return "malformed";
    if (qty > MAX_QTY_PER_LINE) return "too-many";
    wanted.set(line.item_id, (wanted.get(line.item_id) ?? 0) + qty);
  }
  for (const total of wanted.values()) {
    if (total > MAX_QTY_PER_LINE) return "too-many";
  }
  return "ok";
}

const line = (item_id, qty) => ({ item_id, qty });
const repeat = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// --- A real order still goes through ----------------------------------------
is("an ordinary order is accepted", validate([line("a", 2), line("b", 1)]), "ok");
is("the cap itself is allowed", validate([line("a", MAX_QTY_PER_LINE)]), "ok");
is(
  "a full cart of different dishes is fine",
  validate(repeat(MAX_LINES, (i) => line(`item-${i}`, 1))),
  "ok",
);

// --- The bypass --------------------------------------------------------------
note("each line below is individually legal; the order is not");
is(
  "the cap cannot be split across two lines",
  validate([line("a", MAX_QTY_PER_LINE), line("a", 1)]),
  "too-many",
);
is(
  "...nor across a whole cart of them",
  validate(repeat(MAX_LINES, () => line("a", MAX_QTY_PER_LINE))),
  "too-many",
);
is(
  "...nor by many small lines adding up",
  validate(repeat(MAX_QTY_PER_LINE + 1, () => line("a", 1))),
  "too-many",
);

// --- The bounds that already held -------------------------------------------
is("too many lines is refused", validate(repeat(MAX_LINES + 1, (i) => line(`i${i}`, 1))), "malformed");
is("an empty cart is refused", validate([]), "empty");
is("a zero quantity is refused", validate([line("a", 0)]), "malformed");
is("a negative quantity is refused", validate([line("a", -5)]), "malformed");
is("a non-numeric quantity is refused", validate([line("a", "many")]), "malformed");
is("a missing item id is refused", validate([line("", 1)]), "malformed");

finish();
