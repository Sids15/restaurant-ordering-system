/**
 * Which staff roles may see which surface. Kitchen and the server/manager
 * console are separate: a kitchen account can't open the order desk, a server
 * can't open the kitchen board, and switching means signing in with the other
 * account. Print/slip pages under /staff/orders are the one shared surface —
 * the kitchen prints slips too.
 */
import type { Role } from "../types";

/** Roles allowed on a page, or null if the path isn't role-gated. */
export function allowedRoles(pathname: string): Role[] | null {
  if (pathname.startsWith("/staff/orders/")) return ["kitchen", "server", "manager"];
  if (pathname === "/kitchen" || pathname.startsWith("/kitchen/")) {
    return ["kitchen", "manager"];
  }
  if (pathname === "/staff/login") return null;
  // Table QR codes are printed once and last: a wrong or forged sheet is a
  // physical problem to undo. Provisioning the floor is a manager decision,
  // so this sits above the general /staff rule.
  if (pathname === "/staff/tables" || pathname.startsWith("/staff/tables/")) {
    return ["manager"];
  }
  if (pathname === "/staff" || pathname.startsWith("/staff/")) {
    return ["server", "manager"];
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return ["manager"];
  return null;
}

/** True if the role may view the path (or the path isn't gated). */
export function roleCanAccess(pathname: string, role: Role | null | undefined): boolean {
  const allowed = allowedRoles(pathname);
  if (!allowed) return true;
  return !!role && allowed.includes(role);
}
