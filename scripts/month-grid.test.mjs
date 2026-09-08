// Mirror of the month helpers in lib/orders/day.ts, exercised directly (the
// real module imports brand.ts through Astro's alias, which node can't resolve
// standalone).
//
// Calendars break at boundaries, so that is all this tests: the year wrap, a
// month whose 1st is a Sunday (the worst case for a Monday-first grid), a leap
// February, and the rule that you cannot page into days that haven't happened.

function shiftMonth(monthKey, by) {
  const [y, m] = monthKey.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthGrid(monthKey, todayKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const lead = (firstOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    const at = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    const key = at.toISOString().slice(0, 10);
    cells.push({
      key,
      day: at.getUTCDate(),
      inMonth: at.getUTCMonth() === m - 1 && at.getUTCFullYear() === y,
      future: key > todayKey,
      today: key === todayKey,
    });
  }
  return cells;
}

let fail = 0;
const chk = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      got  ${got}\n      want ${want}`);
};

// --- Year boundary ----------------------------------------------------------
chk("December pages to January", shiftMonth("2026-12", 1), "2027-01");
chk("January pages back to December", shiftMonth("2026-01", -1), "2025-12");
chk("a whole year forward", shiftMonth("2026-09", 12), "2027-09");

// --- Grid shape -------------------------------------------------------------
// 1 Sep 2026 is a Tuesday: one leading day (Mon 31 Aug).
let g = monthGrid("2026-09", "2026-09-08");
chk("September is whole weeks", g.length % 7, 0);
chk("grid starts on the Monday before the 1st", g[0].key, "2026-08-31");
chk("that leading day is not in the month", g[0].inMonth, false);
chk("the 1st is the second cell", g[1].key, "2026-09-01");
chk("September has 30 days in the month", g.filter((c) => c.inMonth).length, 30);

// The worst case for a Monday-first grid: a month starting on a Sunday needs a
// full six-day lead, and must not silently drop the last week.
// 1 Feb 2026 is a Sunday.
g = monthGrid("2026-02", "2026-09-08");
chk("a Sunday 1st gets a six-day lead", g[0].key, "2026-01-26");
chk("the 1st still lands on the Sunday column", g[6].key, "2026-02-01");
chk("February 2026 has 28 days", g.filter((c) => c.inMonth).length, 28);

// Leap year — 2028 is one.
chk("February 2028 has 29 days", monthGrid("2028-02", "2028-09-08").filter((c) => c.inMonth).length, 29);

// --- Today and the future ---------------------------------------------------
g = monthGrid("2026-09", "2026-09-08");
chk("today is marked once", g.filter((c) => c.today).length, 1);
chk("today is the right square", g.find((c) => c.today).key, "2026-09-08");
chk("tomorrow is future", g.find((c) => c.key === "2026-09-09").future, true);
chk("today is not future", g.find((c) => c.key === "2026-09-08").future, false);
chk("yesterday is not future", g.find((c) => c.key === "2026-09-07").future, false);

// A month entirely in the past has no future days at all.
chk("a past month is fully selectable", monthGrid("2026-08", "2026-09-08").some((c) => c.future), false);

console.log(fail ? `\n${fail} FAILED` : "\nAll assertions passed.");
process.exit(fail ? 1 : 0);
