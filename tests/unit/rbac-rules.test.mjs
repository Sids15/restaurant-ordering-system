// Mirrors the access rules in lib/auth/access.ts and the route map in
// lib/auth/permissions.ts (the real modules import through Astro's alias, which
// node can't resolve standalone).
//
// These are the invariants that make RBAC safe rather than merely configurable:
// an owner can never be locked out, the bootstrap door closes, a revoked
// permission actually closes its page, and the longest route prefix wins.

const PERMISSIONS = [
  "orders.view", "orders.take", "orders.void",
  "kitchen.view", "kitchen.availability",
  "tabs.view", "tabs.close", "tabs.move", "tabs.assign",
  "menu.manage", "tables.manage",
  "reports.day", "reports.analytics",
];

const ROUTE_PERMISSIONS = [
  { prefix: "/staff/orders", any: ["orders.view", "kitchen.view"] },
  { prefix: "/staff/new", any: ["orders.take"] },
  { prefix: "/staff/tabs", any: ["tabs.view"] },
  { prefix: "/staff/tables", any: ["tables.manage"] },
  { prefix: "/staff/today", any: ["reports.day"] },
  { prefix: "/staff/analytics", any: ["reports.analytics"] },
  { prefix: "/kitchen", any: ["kitchen.view"] },
  { prefix: "/admin", any: ["menu.manage"] },
  { prefix: "/staff", any: ["orders.view"] },
];
const ACCESS_PATH = "/staff/access";
const UNGATED = new Set(["/staff/login"]);

function requiredPermissions(pathname) {
  if (UNGATED.has(pathname)) return null;
  let best = null;
  for (const r of ROUTE_PERMISSIONS) {
    const hit = pathname === r.prefix || pathname.startsWith(`${r.prefix}/`);
    if (hit && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best ? best.any : null;
}
const can = (g, p) => (!g ? false : g.role === "owner" ? true : g.permissions.has(p));
const canAny = (g, ps) => ps.some((p) => can(g, p));
function canAdminister(g) {
  if (!g) return false;
  if (g.role === "owner") return true;
  return g.bootstrap && g.role === "manager";
}
function pathAllowed(pathname, g) {
  if (pathname === ACCESS_PATH || pathname.startsWith(`${ACCESS_PATH}/`)) return canAdminister(g);
  const needed = requiredPermissions(pathname);
  if (!needed) return true;
  return canAny(g, needed);
}

const grants = (role, perms = [], bootstrap = false) => ({
  role,
  permissions: new Set(perms),
  bootstrap,
});

let fail = 0;
const chk = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      got  ${got}\n      want ${want}`);
};

// --- The owner cannot be locked out -----------------------------------------
// The whole design rests on this: no combination of toggles may close the page
// that manages the toggles.
const strippedOwner = grants("owner", []); // every permission revoked
chk("an owner with no grants still administers", canAdminister(strippedOwner), true);
chk("an owner with no grants still opens the access page", pathAllowed("/staff/access", strippedOwner), true);
for (const p of PERMISSIONS) {
  if (!can(strippedOwner, p)) {
    chk(`owner holds ${p} regardless of grants`, false, true);
  }
}
chk("owner holds every permission unconditionally", PERMISSIONS.every((p) => can(strippedOwner, p)), true);
chk("owner opens every gated route", ["/staff", "/kitchen", "/admin", "/staff/today", "/staff/analytics"].every((r) => pathAllowed(r, strippedOwner)), true);

// --- The bootstrap door closes ----------------------------------------------
const firstManager = grants("manager", ["orders.view"], true);
const laterManager = grants("manager", ["orders.view"], false);
chk("a manager administers while no owner exists", canAdminister(firstManager), true);
chk("...and stops once an owner exists", canAdminister(laterManager), false);
chk("a server never administers, even during bootstrap", canAdminister(grants("server", [], true)), false);
chk("a kitchen account never administers", canAdminister(grants("kitchen", [], true)), false);
chk("nobody signed out administers", canAdminister(null), false);

// --- Revoking actually closes the door --------------------------------------
const server = grants("server", ["orders.view", "orders.take", "tabs.view"]);
chk("a server with tabs.view opens open tabs", pathAllowed("/staff/tabs", server), true);
chk("...and one bill inside it", pathAllowed("/staff/tabs/abc-123", server), true);
const noTabs = grants("server", ["orders.view", "orders.take"]);
chk("revoking tabs.view closes the tabs page", pathAllowed("/staff/tabs", noTabs), false);
chk("...and the bill inside it", pathAllowed("/staff/tabs/abc-123", noTabs), false);
chk("a server without menu.manage cannot open admin", pathAllowed("/admin", server), false);
chk("a server without reports.day cannot open Today", pathAllowed("/staff/today", server), false);

// A capability granted to an unusual role works: that is the point of RBAC.
const headChef = grants("kitchen", ["kitchen.view", "menu.manage"]);
chk("a kitchen account granted menu.manage opens admin", pathAllowed("/admin", headChef), true);
chk("...but still not the order desk", pathAllowed("/staff", headChef), false);

// --- Longest prefix wins ------------------------------------------------------
// /staff/tables must not fall through to the general /staff rule, or anyone who
// can see an order could print table QR codes.
chk("/staff/tables needs tables.manage", requiredPermissions("/staff/tables")[0], "tables.manage");
chk("/staff needs orders.view", requiredPermissions("/staff")[0], "orders.view");
chk("/staff/analytics needs reports.analytics", requiredPermissions("/staff/analytics")[0], "reports.analytics");
const deskOnly = grants("server", ["orders.view"]);
chk("orders.view alone does NOT open the QR sheet", pathAllowed("/staff/tables", deskOnly), false);
chk("orders.view alone does NOT open analytics", pathAllowed("/staff/analytics", deskOnly), false);

// The order slip is reachable from both sides of the pass, by either permission.
chk("the slip opens for the desk", pathAllowed("/staff/orders/ABC123/slip", grants("server", ["orders.view"])), true);
chk("the slip opens for the kitchen", pathAllowed("/staff/orders/ABC123/slip", grants("kitchen", ["kitchen.view"])), true);
chk("the slip stays shut without either", pathAllowed("/staff/orders/ABC123/slip", grants("server", ["tabs.view"])), false);

// --- Ungated paths ------------------------------------------------------------
chk("the login page is not permission-gated", pathAllowed("/staff/login", null), true);
chk("the customer menu is not permission-gated", pathAllowed("/menu", null), true);
chk("a signed-out visitor cannot open the desk", pathAllowed("/staff", null), false);

// --- pending holds nothing ----------------------------------------------------
const pending = grants("pending", []);
chk("a pending account opens nothing", ["/staff", "/kitchen", "/admin", "/staff/access"].some((r) => pathAllowed(r, pending)), false);

console.log(fail ? `\n${fail} FAILED` : "\nAll assertions passed.");
process.exit(fail ? 1 : 0);
