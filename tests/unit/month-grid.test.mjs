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


// --- Date ranges ------------------------------------------------------------
// Mirrors dateRange/daysBetween in lib/orders/day.ts. The end bound is the
// start of the day AFTER `to`, because the range includes its last day — get
// that wrong and every range silently loses its final day's takings.
function nextDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
function zoneOffsetMinutes(at, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(at)) p[type] = value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === "24" ? "0" : p.hour), +p.minute, +p.second);
  return (asUtc - at.getTime()) / 60000;
}
function dayStartUTC(key, tz) {
  const [y, m, d] = key.split("-").map(Number);
  const g = new Date(Date.UTC(y, m - 1, d));
  return new Date(g.getTime() - zoneOffsetMinutes(g, tz) * 60000);
}
function dateRange(fromKey, toKey, tz) {
  const [from, to] = fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
  return { from, to, start: dayStartUTC(from, tz), end: dayStartUTC(nextDay(to), tz) };
}
function daysBetween(a, b) {
  const at = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.abs(Math.round((at(b) - at(a)) / 86400000)) + 1;
}

const TZ = "Asia/Kolkata";
let r2 = dateRange("2026-09-01", "2026-09-07", TZ);
chk("range starts at local midnight", r2.start.toISOString(), "2026-08-31T18:30:00.000Z");
chk("range end includes the last day", r2.end.toISOString(), "2026-09-07T18:30:00.000Z");

// The last day must be INSIDE the range — a 23:59 bill on the 7th still counts.
const lastBill = new Date("2026-09-07T18:00:00.000Z"); // 23:30 IST on the 7th
chk("a late bill on the final day is inside", lastBill >= r2.start && lastBill < r2.end, true);
// And the first moment of the day after must be outside.
const nextBill = new Date("2026-09-07T18:30:00.000Z"); // 00:00 IST on the 8th
chk("midnight of the next day is outside", nextBill < r2.end, false);

// Picking the end before the start is a normal thing to do in a calendar.
const backwards = dateRange("2026-09-07", "2026-09-01", TZ);
chk("a reversed pick is sorted", backwards.from + ".." + backwards.to, "2026-09-01..2026-09-07");
chk("reversed pick spans the same instants", backwards.end.getTime(), r2.end.getTime());

chk("a single day is one day", daysBetween("2026-09-07", "2026-09-07"), 1);
chk("a week is seven days", daysBetween("2026-09-01", "2026-09-07"), 7);
chk("counting is inclusive across a month", daysBetween("2026-08-28", "2026-09-03"), 7);
chk("counting is order-independent", daysBetween("2026-09-07", "2026-09-01"), 7);

console.log(fail ? `\n${fail} FAILED` : "\nAll assertions passed.");
process.exit(fail ? 1 : 0);
