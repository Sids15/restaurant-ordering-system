/**
 * verify-rbac — check that access control is actually live in the database.
 *
 * The app's own tests (scripts/rbac.test.mjs) cover the rules; this checks the
 * half that only the database can answer: are the tables there, are the grants
 * seeded, is there an owner, and — the one that matters most — does
 * has_permission() REFUSE an anonymous caller rather than returning NULL.
 *
 * That last check is here because it caught a real hole: has_permission()
 * returned NULL for a caller with no profile, PL/pgSQL's IF does not take a
 * NULL branch, and set_item_availability therefore let anyone holding the
 * publishable key take a dish off the menu. See 012_has_permission_null.sql.
 *
 *   npm run verify-rbac
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const url = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
if (!url) {
  console.error("No SUPABASE_URL in .env — run from the project root.");
  process.exit(1);
}
const anon = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
const svc = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
};

let bad = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) bad++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const get = async (path, headers = svc) => {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log(`\nProject: ${url}\n`);

// --- Is it installed? --------------------------------------------------------
console.log("Tables and grants");
const perms = await get("permissions?select=name");
ok("permissions table exists", perms.status === 200, `HTTP ${perms.status}`);
if (perms.status !== 200) {
  console.log("\nApply 010_owner_role.sql and 011_rbac.sql first.\n");
  process.exit(1);
}
ok("permission catalogue seeded", perms.body.length === 13, `${perms.body.length} rows, expected 13`);

const grants = await get("role_permissions?select=role,permission");
ok("role_permissions table exists", grants.status === 200, `HTTP ${grants.status}`);
const byRole = {};
for (const g of grants.body ?? []) (byRole[g.role] ??= []).push(g.permission);
for (const [role, n] of Object.entries({ manager: 13, server: 7, kitchen: 3 })) {
  const got = (byRole[role] ?? []).length;
  ok(`${role} has grants`, got > 0, `${got} (defaults ship ${n})`);
}
ok(
  "owner has no stored grants",
  !byRole.owner?.length,
  "an owner holds everything implicitly; rows here would be misleading",
);

// --- Is there anyone who can administer? -------------------------------------
console.log("\nPeople");
const profiles = await get("profiles?select=role");
const roles = (profiles.body ?? []).map((p) => p.role);
const owners = roles.filter((r) => r === "owner").length;
ok("an owner exists", owners > 0, owners ? `${owners}` : "nobody can open /staff/access");
const pending = roles.filter((r) => r === "pending").length;
if (pending) console.log(`  note  ${pending} account(s) still pending — they can do nothing until given a role`);

// --- The check that matters --------------------------------------------------
console.log("\nRefusing an anonymous caller");
const rpc = await fetch(`${url}/rest/v1/rpc/has_permission`, {
  method: "POST",
  headers: { ...anon, "content-type": "application/json" },
  body: JSON.stringify({ perm: "menu.manage" }),
});
const rpcBody = await rpc.json().catch(() => null);
// 012 revokes EXECUTE from anon, so the best outcome is the call being refused
// outright — Postgres 42501. If the function is still reachable, it must at
// least answer false; NULL is the hole 012 closes.
const refused =
  rpc.status === 401 ||
  rpc.status === 403 ||
  rpc.status === 404 ||
  rpcBody?.code === "42501";
if (refused) {
  ok("has_permission() is not callable by anon", true, "execute revoked");
} else {
  ok(
    "has_permission() returns false, not null",
    rpcBody === false,
    `returned ${JSON.stringify(rpcBody)}${rpcBody === null ? " — apply 012_has_permission_null.sql" : ""}`,
  );
}

// The live exploit, run for real: take a dish off the menu as an anonymous
// caller. Restores it either way.
const pick = await get("menu_items?select=id,name,is_available&is_available=eq.true&limit=1");
const item = pick.body?.[0];
if (!item) {
  console.log("  note  no available dish to test the 86 toggle against");
} else {
  const call = await fetch(`${url}/rest/v1/rpc/set_item_availability`, {
    method: "POST",
    headers: { ...anon, "content-type": "application/json" },
    body: JSON.stringify({ item: item.id, available: false }),
  });
  const after = await get(`menu_items?select=is_available&id=eq.${item.id}`);
  const flipped = after.body?.[0]?.is_available === false;
  ok(
    "anon cannot 86 a dish",
    !flipped,
    flipped ? `"${item.name}" was taken off the menu — apply 012_has_permission_null.sql` : `HTTP ${call.status}`,
  );
  if (flipped) {
    await fetch(`${url}/rest/v1/menu_items?id=eq.${item.id}`, {
      method: "PATCH",
      headers: { ...svc, Prefer: "return=minimal" },
      body: JSON.stringify({ is_available: true }),
    });
    console.log(`        (restored "${item.name}")`);
  }
}

console.log(bad === 0 ? "\nAccess control is live and holding.\n" : `\n${bad} problem(s) above.\n`);
process.exit(bad === 0 ? 0 : 1);
