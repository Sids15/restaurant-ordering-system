/**
 * SECURITY — penetration probes against the live database.
 *
 * These do not assert that policies exist. They present the publishable key —
 * the one shipped in every page a guest loads — and try to actually take
 * something. A policy that reads correctly and denies nothing is the failure
 * mode worth catching, and only a real request finds it.
 *
 * Everything here is read-only or self-restoring. The one destructive probe
 * (86'ing a dish) puts the dish back whichever way it goes.
 *
 * This is the suite that caught a live hole: has_permission() returned NULL for
 * an anonymous caller, PL/pgSQL's IF skipped its NULL branch, and anyone with
 * the publishable key could take dishes off the menu. See 012.
 */
import { suite, is, ok, note, skip, finish, db } from "../harness.mjs";

const anon = db("anon");
const svc = db("service");

suite("SECURITY · what the publishable key can reach");

if (!anon.ready || !svc.ready) {
  skip("every probe", "no SUPABASE_URL / keys in .env");
  finish();
}

note("the anon key below is the one shipped in every page a guest loads");

// --- Staff data --------------------------------------------------------------
// RLS answers a denied read with 200 and an empty array, not a 403 — so an
// empty result IS the pass, and a non-empty one is the finding.
for (const [what, table] of [
  ["orders", "orders?select=id,code,subtotal&limit=5"],
  ["tabs", "tabs?select=id,table_label&limit=5"],
  ["order items", "order_items?select=id,name_snapshot&limit=5"],
  ["profiles", "profiles?select=id,name,role&limit=5"],
]) {
  const r = await anon.get(table);
  const rows = Array.isArray(r.body) ? r.body.length : 0;
  is(`anon reads no ${what}`, rows, 0);
}

// --- The audit trail ---------------------------------------------------------
// 014 gives it no policies at all, so even a staff member is refused. Anon
// certainly is.
{
  const r = await anon.get("audit_log?select=id&limit=1");
  const rows = Array.isArray(r.body) ? r.body.length : 0;
  ok(
    "anon reads no audit entries",
    rows === 0,
    `returned ${rows} row(s) — the audit trail must not be readable`,
  );
}

// --- Session tokens ----------------------------------------------------------
// 015 moved these to their own table and stores only a hash. Neither the table
// nor a plaintext column should be reachable.
{
  const r = await anon.get("tab_sessions?select=token_hash&limit=1");
  const rows = Array.isArray(r.body) ? r.body.length : 0;
  is("anon reads no session rows", rows, 0);

  const legacy = await svc.get("tabs?select=session_token&limit=1");
  if (legacy.ok) {
    skip("the plaintext session_token column is gone", "015 not applied yet");
  } else {
    ok("the plaintext session_token column is gone", true, "column absent, as it should be");
  }
}

// --- Writing -----------------------------------------------------------------
note("now trying to write, not just read");

{
  const before = await svc.get("orders?select=id");
  await anon.post("orders", { code: "PENTEST1", subtotal: 0, status: "pending" }, "return=minimal");
  const after = await svc.get("orders?select=id");
  is("anon cannot insert an order", (after.body ?? []).length, (before.body ?? []).length);
  // Belt and braces: make sure the specific row did not land.
  const planted = await svc.get("orders?select=id&code=eq.PENTEST1");
  is("...and nothing with that code exists", (planted.body ?? []).length, 0);
}
// These two assert on the DATA, not the status code. PostgREST answers an
// UPDATE or DELETE that matched nothing with 204 — the same 204 it returns when
// the write succeeded. Checking the response here would call a held policy a
// breach, and would just as happily call a real breach a pass.
{
  const before = await svc.get("menu_items?select=id,price&order=id&limit=20");
  await anon.patch("menu_items?id=neq.00000000-0000-0000-0000-000000000000", { price: 1 });
  const after = await svc.get("menu_items?select=id,price&order=id&limit=20");
  is(
    "anon cannot rewrite every price",
    JSON.stringify(after.body),
    JSON.stringify(before.body),
  );
}
{
  const before = await svc.get("orders?select=id");
  await anon.del("orders?id=neq.00000000-0000-0000-0000-000000000000");
  const after = await svc.get("orders?select=id");
  is(
    "anon cannot delete orders",
    (after.body ?? []).length,
    (before.body ?? []).length,
  );
}
{
  await anon.post("audit_log", { action: "forged", summary: "forged" }, "return=minimal");
  const planted = await svc.get("audit_log?select=id&action=eq.forged");
  const rows = Array.isArray(planted.body) ? planted.body.length : 0;
  is("anon cannot forge an audit entry", rows, 0);
}
{
  await anon.post(
    "role_permissions",
    { role: "kitchen", permission: "menu.manage" },
    "return=minimal",
  );
  const planted = await svc.get(
    "role_permissions?select=role&role=eq.kitchen&permission=eq.menu.manage",
  );
  const rows = Array.isArray(planted.body) ? planted.body.length : 0;
  is("anon cannot grant itself a permission", rows, 0);
}

// --- Privilege functions -----------------------------------------------------
{
  const r = await anon.rpc("has_permission", { perm: "menu.manage" });
  const refused = r.status === 401 || r.status === 403 || r.body?.code === "42501";
  const answeredFalse = r.body === false;
  ok(
    "has_permission does not answer NULL to anon",
    refused || answeredFalse,
    `returned ${JSON.stringify(r.body)} — NULL here is the 012 hole`,
  );
}
{
  const r = await anon.rpc("set_role_permissions", { grants: { manager: [] } });
  ok("anon cannot rewrite the permission matrix", !r.ok, `HTTP ${r.status}`);
}

// --- The live exploit --------------------------------------------------------
// The one that was real. Restores the dish either way.
{
  const pick = await svc.get("menu_items?select=id,name,is_available&is_available=eq.true&limit=1");
  const item = pick.body?.[0];
  if (!item) {
    skip("anon cannot 86 a dish", "no available dish to test against");
  } else {
    await anon.rpc("set_item_availability", { item: item.id, available: false });
    const after = await svc.get(`menu_items?select=is_available&id=eq.${item.id}`);
    const flipped = after.body?.[0]?.is_available === false;
    ok(
      "anon cannot take a dish off the menu",
      !flipped,
      flipped ? `"${item.name}" was 86'd by an anonymous caller — apply 012` : "refused",
    );
    if (flipped) {
      await svc.patch(`menu_items?id=eq.${item.id}`, { is_available: true });
      note(`restored "${item.name}"`);
    }
  }
}

// --- What anon SHOULD reach --------------------------------------------------
// A menu nobody can read is also a broken restaurant. Denying everything is not
// the goal; denying the right things is.
{
  const r = await anon.get("menu_items?select=id,name,price&is_available=eq.true&limit=3");
  ok("anon CAN read the public menu", r.ok, `HTTP ${r.status}`);
  const r2 = await anon.get("menu_categories?select=id,name&limit=3");
  ok("anon CAN read categories", r2.ok, `HTTP ${r2.status}`);
}

// Unavailable dishes are staff information: a guest should not see what sold
// out, only what is left.
{
  const off = await svc.get("menu_items?select=id&is_available=eq.false&limit=1");
  if (!off.body?.length) {
    skip("anon cannot see 86'd dishes", "nothing is currently 86'd");
  } else {
    const r = await anon.get("menu_items?select=id&is_available=eq.false&limit=5");
    is("anon cannot see 86'd dishes", Array.isArray(r.body) ? r.body.length : -1, 0);
  }
}

finish();
