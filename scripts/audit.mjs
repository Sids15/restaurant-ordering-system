/**
 * audit — read the activity trail from a terminal.
 *
 * The log is deliberately not a page in the app: no staff role can read it, and
 * the table has no RLS policies at all (014_audit_log.sql). It is reached with
 * the service-role key, which means from here, or from the Supabase SQL editor.
 *
 *   npm run audit                    today, newest first
 *   npm run audit -- --days 7        the last week
 *   npm run audit -- --who Priya     one person
 *   npm run audit -- --action order  a prefix: order.confirm, order.void, …
 *   npm run audit -- --failed        failed sign-ins, grouped by account
 *   npm run audit -- --limit 500
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const url = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env — run from the project root.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const has = (name) => argv.includes(`--${name}`);

const days = Number(flag("days", 1));
const limit = Number(flag("limit", 200));
const who = flag("who");
const action = flag("action");
const tz = "Asia/Kolkata";

const since = new Date(Date.now() - days * 86_400_000);

const params = new URLSearchParams({
  select: "at,actor_name,actor_role,action,subject_type,subject_id,summary,detail,ip",
  order: "at.desc",
  limit: String(limit),
});
params.append("at", `gte.${since.toISOString()}`);
if (who) params.append("actor_name", `ilike.*${who}*`);
if (action) params.append("action", `like.${action}*`);
if (has("failed")) params.set("action", "eq.auth.signin.failed");

const res = await fetch(`${url}/rest/v1/audit_log?${params}`, {
  headers: { apikey: key, authorization: `Bearer ${key}` },
});

if (!res.ok) {
  const body = await res.text();
  if (/does not exist|PGRST205/i.test(body)) {
    console.error("\nNo audit_log table. Apply supabase/migrations/014_audit_log.sql.\n");
  } else {
    console.error(`\nCouldn't read the log: HTTP ${res.status}\n${body.slice(0, 200)}\n`);
  }
  process.exit(1);
}

const rows = await res.json();

if (rows.length === 0) {
  console.log(`\nNothing recorded in the last ${days} day${days === 1 ? "" : "s"}.\n`);
  process.exit(0);
}

// --- Failed sign-ins are a tally, not a list --------------------------------
if (has("failed")) {
  const byAccount = new Map();
  for (const r of rows) {
    const k = r.actor_name || "(unknown)";
    const e = byAccount.get(k) ?? { n: 0, last: r.at };
    e.n += 1;
    byAccount.set(k, e);
  }
  console.log(`\nFailed sign-ins, last ${days} day${days === 1 ? "" : "s"}\n`);
  for (const [account, e] of [...byAccount.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(4)}×  ${account.padEnd(34)} last ${when(e.last)}`);
  }
  console.log("\nA run against one account is the shape of an attack.\n");
  process.exit(0);
}

// --- The trail ---------------------------------------------------------------
const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
function when(iso) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
const clock = (iso) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

// Money and access are what someone opens this log to find.
const NOTABLE = new Set(["order.void", "access.role", "access.permissions", "auth.signin.failed"]);

let day = "";
console.log();
for (const r of rows) {
  const d = fmtDay(r.at);
  if (d !== day) {
    day = d;
    console.log(`\n  ${d}`);
    console.log(`  ${"-".repeat(d.length)}`);
  }
  const mark = NOTABLE.has(r.action) ? "*" : " ";
  const actor = `${r.actor_name || "anon"}${r.actor_role ? ` (${r.actor_role})` : ""}`;
  console.log(`  ${mark} ${clock(r.at)}  ${actor.padEnd(24)} ${r.summary || r.action}`);
}

const notable = rows.filter((r) => NOTABLE.has(r.action)).length;
console.log(
  `\n  ${rows.length} entr${rows.length === 1 ? "y" : "ies"}` +
    (notable ? `, ${notable} marked * (voids, access changes, failed sign-ins)` : "") +
    (rows.length >= limit ? ` — capped at ${limit}, pass --limit for more` : "") +
    "\n",
);
