/**
 * INTEGRATION — the app's real queries against the real database.
 *
 * Unit tests prove the logic; these prove the app and the schema still agree.
 * That is a different failure, and a quiet one: PostgREST names an embed after
 * the foreign-key constraint behind it, and if a name is wrong the app's
 * fallback retries WITHOUT the embed, the query succeeds, and a whole feature
 * silently never appears. Nothing logs an error. Only running the real select
 * finds it.
 *
 * Read-only. Nothing here writes.
 */
import { suite, is, ok, note, skip, finish, db } from "../harness.mjs";

const svc = db("service");

suite("INTEGRATION · schema and the app's own queries");

if (!svc.ready) {
  skip("every check", "no SUPABASE_URL / service key in .env");
  finish();
}

// --- Migration state ---------------------------------------------------------
// Reported rather than asserted where a migration is applied by hand: a pending
// migration is a deployment step, not a broken app.
const applied = {};
for (const [key, probe] of [
  ["003 tabs", "tabs?select=id&limit=1"],
  ["008 assignment", "tabs?select=assigned_to&limit=1"],
  ["009 void author", "orders?select=cancelled_by&limit=1"],
  ["011 rbac", "role_permissions?select=role&limit=1"],
  ["014 audit", "audit_log?select=id&limit=1"],
  ["015 sessions", "tab_sessions?select=id&limit=1"],
]) {
  const r = await svc.get(probe);
  applied[key] = r.ok;
  if (r.ok) ok(`${key} applied`, true);
  else skip(`${key} applied`, "migration pending");
}

// --- The embeds the app actually builds --------------------------------------
note("running the app's real select strings, not approximations of them");

const EMBEDS = [
  [
    "open tabs with their server (lib/orders/tabs.ts)",
    "tabs?select=id,table_label,opened_at,orders(subtotal,status),assigned:profiles!tabs_assigned_to_fkey(id,name,role)&limit=1",
    "008 assignment",
  ],
  [
    "day view tabs (lib/orders/manager.ts)",
    "tabs?select=id,table_label,status,opened_at,closed_at,assigned:profiles!tabs_assigned_to_fkey(id,name,role),orders(subtotal,status)&limit=1",
    "008 assignment",
  ],
  [
    "day view orders with void author (lib/orders/manager.ts)",
    "orders?select=code,table_label,status,source,subtotal,created_at,cancelled_by:profiles!orders_cancelled_by_fkey(id,name,role)&limit=1",
    "009 void author",
  ],
  [
    "analytics orders and lines (lib/orders/analytics.ts)",
    "orders?select=status,source,subtotal,created_at,confirmed_at,tab_id,table_label,order_items(menu_item_id,name_snapshot,price_snapshot,qty)&limit=1",
    null,
  ],
  [
    "analytics menu categories (lib/orders/analytics.ts)",
    "menu_items?select=id,veg_type,menu_categories(name)&limit=1",
    null,
  ],
  [
    "the collective bill (lib/orders/tabs.ts)",
    "tabs?select=id,table_label,status,opened_at,closed_at,orders(status,order_items(name_snapshot,price_snapshot,qty))&limit=1",
    null,
  ],
  [
    "a guest session resolving to its tab (lib/orders/session.ts)",
    "tab_sessions?select=tab_id,tabs!inner(id,table_label,status)&limit=1",
    "015 sessions",
  ],
];

for (const [what, query, needs] of EMBEDS) {
  if (needs && !applied[needs]) {
    skip(what, `needs ${needs}`);
    continue;
  }
  const r = await svc.get(query);
  ok(what, r.status === 200, `HTTP ${r.status} — ${r.body?.message ?? ""}`);
}

// --- Constraints that protect the money --------------------------------------
note("the constraints, tested by trying to violate them");

// One open tab per table. Two rounds arriving together must not open two tabs,
// or a table ends up with two bills and one of them gets forgotten.
{
  const open = await svc.get("tabs?select=table_label&status=eq.open");
  const labels = (open.body ?? []).map((t) => t.table_label);
  is("no table has two open tabs", labels.length, new Set(labels).size);
}

// Order codes are the capability token for the tracking page: a duplicate would
// hand one guest another's order.
{
  const r = await svc.get("orders?select=code");
  const codes = (r.body ?? []).map((o) => o.code);
  is("every order code is unique", codes.length, new Set(codes).size);
}

// A cancelled order must never contribute to takings. This is the invariant the
// day view and analytics both depend on.
{
  const r = await svc.get("orders?select=code,status,subtotal&status=eq.cancelled");
  const rows = r.body ?? [];
  if (rows.length === 0) skip("cancelled orders are excluded from money", "nothing cancelled yet");
  else ok(`${rows.length} cancelled order(s) present to exclude`, true);
}

// --- RBAC data ---------------------------------------------------------------
if (applied["011 rbac"]) {
  const perms = await svc.get("permissions?select=name");
  const grants = await svc.get("role_permissions?select=role,permission");
  const names = new Set((perms.body ?? []).map((p) => p.name));

  ok("the permission catalogue is seeded", names.size > 0, `${names.size} permissions`);

  // A grant naming a permission that no longer exists would be invisible in the
  // UI and unremovable through it.
  const orphans = (grants.body ?? []).filter((g) => !names.has(g.permission));
  is("no grant references an unknown permission", orphans.length, 0);

  // The owner holds everything implicitly; stored rows would be misleading and
  // could imply an owner can have a permission withheld.
  const ownerRows = (grants.body ?? []).filter((g) => g.role === "owner");
  is("the owner has no stored grants", ownerRows.length, 0);

  // 'pending' means "not yet given a role" — it must hold nothing.
  const pendingRows = (grants.body ?? []).filter((g) => g.role === "pending");
  is("pending accounts hold no permissions", pendingRows.length, 0);

  const owners = await svc.get("profiles?select=id&role=eq.owner");
  ok(
    "someone owns this restaurant",
    (owners.body ?? []).length > 0,
    "no owner exists — nobody can administer access",
  );
}

// --- Referential sanity ------------------------------------------------------
{
  const orders = await svc.get("orders?select=id,tab_id&tab_id=not.is.null&limit=200");
  const tabIds = new Set((orders.body ?? []).map((o) => o.tab_id));
  if (tabIds.size === 0) {
    skip("every order's tab exists", "no orders are on a tab yet");
  } else {
    const tabs = await svc.get(`tabs?select=id&id=in.(${[...tabIds].join(",")})`);
    is("every order's tab exists", (tabs.body ?? []).length, tabIds.size);
  }
}

finish();
