/**
 * The permission vocabulary, and which permission each surface needs.
 *
 * A permission is a capability in the restaurant's own language — "close tabs",
 * "mark dishes 86" — not a URL. That matters because an owner granting one has
 * to be able to tell what they are granting, and because routes move while
 * capabilities don't.
 *
 * This file is the app's copy of the catalogue; `permissions` in the database
 * is the record that the management page reads and RLS enforces against. They
 * are seeded together in 011_rbac.sql. Adding a permission means adding it in
 * both, which is deliberate: a capability the database has never heard of
 * cannot be granted, and one the app has never heard of cannot be checked.
 */
import type { Role } from "../types";

export type Permission =
  | "orders.view"
  | "orders.take"
  | "orders.void"
  | "kitchen.view"
  | "kitchen.availability"
  | "tabs.view"
  | "tabs.close"
  | "tabs.move"
  | "tabs.assign"
  | "menu.manage"
  | "tables.manage"
  | "reports.day"
  | "reports.analytics";

export interface PermissionDef {
  name: Permission;
  label: string;
  description: string;
  group: string;
}

/** Display order on the management page. */
export const PERMISSIONS: PermissionDef[] = [
  { name: "orders.view", label: "See orders", group: "Orders", description: "Look up any order by its code on the order desk." },
  { name: "orders.take", label: "Take orders", group: "Orders", description: "Build an order at the table, and accept one a guest sent." },
  { name: "orders.void", label: "Void orders", group: "Orders", description: "Cancel a round. Always recorded against whoever did it." },

  { name: "kitchen.view", label: "Kitchen board", group: "Kitchen", description: "See the live queue and mark rounds ready." },
  { name: "kitchen.availability", label: "Mark dishes 86", group: "Kitchen", description: "Take a dish off the menu when it sells out, and put it back." },

  { name: "tabs.view", label: "Open tabs", group: "Tabs and billing", description: "See the floor's open tabs and their bills." },
  { name: "tabs.close", label: "Close tabs", group: "Tabs and billing", description: "Mark a tab paid and free the table." },
  { name: "tabs.move", label: "Move and merge tabs", group: "Tabs and billing", description: "Move a tab to another table, or settle two tables on one bill." },
  { name: "tabs.assign", label: "Assign servers", group: "Tabs and billing", description: "Put a server on a table." },

  { name: "menu.manage", label: "Manage the menu", group: "Menu", description: "Add, edit, price and remove dishes and categories." },
  { name: "tables.manage", label: "Table QR codes", group: "Menu", description: "Generate and print the codes guests scan." },

  { name: "reports.day", label: "Daily takings", group: "Reports", description: "The day view: takings, orders, and open and closed tabs." },
  { name: "reports.analytics", label: "Analytics", group: "Reports", description: "Trading performance, menu mix, staff and void figures." },
];

/** Groups in display order, each with its permissions. */
export function groupedPermissions(): { group: string; items: PermissionDef[] }[] {
  const out: { group: string; items: PermissionDef[] }[] = [];
  for (const p of PERMISSIONS) {
    const found = out.find((g) => g.group === p.group);
    if (found) found.items.push(p);
    else out.push({ group: p.group, items: [p] });
  }
  return out;
}

/**
 * The roles whose permissions an owner can edit.
 *
 * 'owner' is absent on purpose — it holds everything unconditionally, and
 * offering a toggle that cannot be switched off is a lie. 'pending' is absent
 * because it means "not yet given a role"; granting it anything would defeat
 * the lockdown that made it the default for new signups (007).
 */
export const EDITABLE_ROLES: Role[] = ["manager", "server", "kitchen"];

/**
 * What each role can do when nothing has been customised. These reproduce the
 * access each role had before RBAC existed, and back the "restore defaults"
 * button. Kept in step with the seed in 011_rbac.sql.
 */
export const DEFAULT_GRANTS: Record<string, Permission[]> = {
  manager: PERMISSIONS.map((p) => p.name),
  server: ["orders.view", "orders.take", "orders.void", "tabs.view", "tabs.close", "tabs.move", "tabs.assign"],
  kitchen: ["kitchen.view", "kitchen.availability", "orders.view"],
};

// --- Routes ------------------------------------------------------------------

/**
 * Which permissions open a path. ANY one of them is enough, so a surface two
 * roles reach by different routes — the order slip, which both the desk and the
 * kitchen print — can name both rather than inventing a third permission.
 *
 * Longest prefix wins, so the specific entries are listed before the general.
 * A path that appears nowhere here is not permission-gated (the login page, the
 * whole customer side).
 */
const ROUTE_PERMISSIONS: { prefix: string; any: Permission[] }[] = [
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

/**
 * Paths inside a gated area that are nonetheless open to everyone.
 *
 * The login page sits under /staff and would otherwise inherit that prefix's
 * permission — demanding you already be signed in to reach the page that signs
 * you in. Middleware happens to route around it, but pathAllowed() is also what
 * decides which links the rail offers and where a login redirects to, so the
 * answer has to be right here rather than only there.
 */
const UNGATED = new Set(["/staff/login"]);

/** Permissions that open `pathname`, or null when it isn't gated by one. */
export function requiredPermissions(pathname: string): Permission[] | null {
  if (UNGATED.has(pathname)) return null;

  let best: { prefix: string; any: Permission[] } | null = null;
  for (const r of ROUTE_PERMISSIONS) {
    const hit = pathname === r.prefix || pathname.startsWith(`${r.prefix}/`);
    if (hit && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best ? best.any : null;
}
