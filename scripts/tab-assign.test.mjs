// Mirror of the fallback in lib/orders/assign.ts, exercised directly (the real
// module imports through Astro's alias, which node can't resolve standalone).
//
// What this guards: pushing the code before applying 008_tab_assignment.sql
// must NOT blank the open-tabs list. PostgREST rejects the unknown embed, every
// caller does `if (error) return []`, and the surface servers bill from goes
// empty. selectTabs re-runs the query without the embed instead.
async function selectTabs(run) {
  const first = await run(true);
  if (!first.error) return first;
  return run(false);
}
const assigneeName = (a) => (a ? ((a.name ?? "").trim() || a.role) : "");

let fail = 0;
const chk = (name, got, want) => { const ok = got === want; if (!ok) fail++;
  console.log(`${ok?"PASS":"FAIL"}  ${name}\n      got  ${got}\n      want ${want}`); };

// --- After the migration: one query, embed kept ------------------------------
let calls = [];
let r = await selectTabs(async (a) => { calls.push(a); return { data: ["with-embed"], error: null }; });
chk("migrated: runs once", calls.length, 1);
chk("migrated: asks for the embed", calls[0], true);
chk("migrated: returns embedded rows", r.data[0], "with-embed");

// --- Before the migration: retried without the embed -------------------------
calls = [];
r = await selectTabs(async (a) => {
  calls.push(a);
  return a
    ? { data: null, error: { message: "could not find a relationship" } }
    : { data: ["plain"], error: null };
});
chk("unmigrated: retries", calls.length, 2);
chk("unmigrated: retry drops the embed", calls[1], false);
chk("unmigrated: tabs still list", r.data[0], "plain");
chk("unmigrated: no error surfaces", r.error, null);

// --- A real outage still reports as one --------------------------------------
calls = [];
r = await selectTabs(async () => { calls.push(1); return { data: null, error: { message: "down" } }; });
chk("db down: gives up after the retry", calls.length, 2);
chk("db down: still an error", r.error.message, "down");

// --- Display names ------------------------------------------------------------
chk("named profile shows its name", assigneeName({ name: "Priya", role: "server" }), "Priya");
chk("blank name falls back to role", assigneeName({ name: "  ", role: "server" }), "server");
chk("unassigned renders nothing", assigneeName(null), "");

console.log(fail ? `\n${fail} FAILED` : "\nAll assertions passed.");
process.exit(fail ? 1 : 0);
