/**
 * Who may open what.
 *
 * This used to be a hard-coded list of roles per route. Access is now decided
 * by permissions the owner grants on /staff/access, so the same question is
 * asked of a set of granted capabilities instead (lib/auth/permissions.ts).
 *
 * The database enforces the same grants through has_permission() in RLS
 * (011_rbac.sql), so this layer decides what to *offer* - which links appear,
 * which page loads - while Postgres decides what can actually be read and
 * written. Neither is trusted as the only check.
 */
import type { Role } from "../types";
import { requiredPermissions, type Permission } from "./permissions";

/** The access-control page itself. Not permission-gated - see canAdminister. */
export const ACCESS_PATH = "/staff/access";

/** A staff member's granted capabilities, as loaded for the request. */
export interface Grants {
  role: Role;
  permissions: Set<string>;
  /** No owner exists yet, so a manager may administer rather than be locked out. */
  bootstrap: boolean;
}

/** True if the grants include `permission`. An owner holds everything. */
export function can(grants: Grants | null | undefined, permission: Permission): boolean {
  if (!grants) return false;
  if (grants.role === "owner") return true;
  return grants.permissions.has(permission);
}

/** True if any one of `permissions` is held. */
export function canAny(grants: Grants | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((p) => can(grants, p));
}

/**
 * May this person change what other people can do?
 *
 * Owners, always. A manager only while NO owner exists: a fresh install has
 * nobody to grant the first permission, and an administration page nobody can
 * reach is worse than one whose first administrator is the existing top role.
 * That door closes the moment an owner exists, and a manager cannot create one
 * - writing to `profiles` is owner-only in RLS.
 */
export function canAdminister(grants: Grants | null | undefined): boolean {
  if (!grants) return false;
  if (grants.role === "owner") return true;
  return grants.bootstrap && grants.role === "manager";
}

/** True if the grants open `pathname` (or it isn't gated at all). */
export function pathAllowed(pathname: string, grants: Grants | null | undefined): boolean {
  if (pathname === ACCESS_PATH || pathname.startsWith(`${ACCESS_PATH}/`)) {
    return canAdminister(grants);
  }
  const needed = requiredPermissions(pathname);
  if (!needed) return true;
  return canAny(grants, needed);
}
