// Mirror of lib/orders/day.ts logic, exercised directly (the real module imports
// brand.ts through Astro's alias, which node can't resolve standalone).
function zoneOffsetMinutes(at, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false,
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit" });
  const p = {}; for (const {type,value} of fmt.formatToParts(at)) p[type]=value;
  const asUtc = Date.UTC(+p.year, +p.month-1, +p.day, +(p.hour==="24"?"0":p.hour), +p.minute, +p.second);
  return (asUtc - at.getTime())/60000;
}
function dayRange(key, tz) {
  const [y,m,d] = key.split("-").map(Number);
  const g = new Date(Date.UTC(y,m-1,d));
  const start = new Date(g.getTime() - zoneOffsetMinutes(g,tz)*60000);
  const n = new Date(Date.UTC(y,m-1,d+1));
  const end = new Date(n.getTime() - zoneOffsetMinutes(n,tz)*60000);
  return {start,end};
}
let fail = 0;
const chk = (name, got, want) => { const ok = got===want; if(!ok) fail++;
  console.log(`${ok?"PASS":"FAIL"}  ${name}\n      got  ${got}\n      want ${want}`); };

// India: UTC+5:30, no DST. Local midnight 7 Sep = 6 Sep 18:30 UTC.
let r = dayRange("2026-09-07","Asia/Kolkata");
chk("IST day start", r.start.toISOString(), "2026-09-06T18:30:00.000Z");
chk("IST day end",   r.end.toISOString(),   "2026-09-07T18:30:00.000Z");
chk("IST day length is 24h", (r.end-r.start)/3600000, 24);

// The bug this guards: a 00:30 IST bill must fall INSIDE 7 Sep, not 6 Sep.
const lateBill = new Date("2026-09-06T19:00:00.000Z"); // = 7 Sep 00:30 IST
chk("00:30 IST bill lands in 7 Sep", lateBill >= r.start && lateBill < r.end, true);
// And a UTC-naive boundary would have put it in the previous day:
chk("UTC-naive would misfile it", lateBill < new Date("2026-09-07T00:00:00Z"), true);

// A DST zone, to prove the offset isn't assumed constant (white-label copies).
r = dayRange("2026-03-29","Europe/London");   // clocks go forward -> 23h day
chk("London spring-forward day is 23h", (r.end-r.start)/3600000, 23);
r = dayRange("2026-10-25","Europe/London");   // clocks go back -> 25h day
chk("London fall-back day is 25h", (r.end-r.start)/3600000, 25);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail?1:0);
