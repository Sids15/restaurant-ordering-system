/**
 * Staff session helpers, shared by the middleware and the staff API routes.
 *
 * `loadStaff` turns a request-scoped Supabase client into a verified auth user
 * plus their staff profile (role). `requireStaff` is the endpoint-side guard:
 * it returns the staff context or a ready-to-return JSON error Response.
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Role } from "../types";
import { can, canAny, type Grants } from "./access";
import { DEFAULT_GRANTS, PERMISSIONS, type Permission } from "./permissions";
import { cachedGrants, cacheGrants, cachedOwnerExists, cacheOwnerExists } from "./grants-cache";
import { json } from "../http/json";

/**
 * The roles that actually grant access. A profile with any other role (e.g. the
 * 'pending' default a fresh signup receives, before a manager promotes it) is
 * treated as NOT staff — mirrors the database's is_staff() so a self-provisioned
 * account can't reach staff surfaces even if signups are left open.
 */
const STAFF_ROLES: readonly Role[] = ["owner", "manager", "kitchen", "server"];

export interface StaffContext {
  user: User;
  profile: { id: string; name: string; role: Role };
  grants: Grants;
}

/**
 * Verify the session and load the staff profile. Returns nulls when there's no
 * valid session or the user isn't staff. Uses getUser() (not getSession) so the
 * JWT is validated against the auth server, not just read from the cookie.
 */
export async function loadStaff(
  supabase: SupabaseClient,
): Promise<{
  user: User | null;
  profile: StaffContext["profile"] | null;
  grants: Grants | null;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null, grants: null };

  const { data } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return { user, profile: null, grants: null };
  // A profile whose role isn't a working staff role (e.g. 'pending') is not
  // staff: return null so middleware redirects and requireStaff() 401s.
  if (!STAFF_ROLES.includes(data.role as Role)) return { user, profile: null, grants: null };

  const profile = data as StaffContext["profile"];
  return { user, profile, grants: await loadGrants(supabase, profile.role) };
}

/**
 * What a role may do, from the RBAC grant table.
 *
 * Falls back to the pre-RBAC defaults if that table isn't there yet. Migrations
 * are applied by hand, so the deployed code is always briefly ahead of the
 * database — and without this, that window would revoke every permission from
 * every role at once and lock the whole restaurant out mid-service.
 */
async function loadGrants(supabase: SupabaseClient, role: Role): Promise<Grants> {
  // The owner holds everything unconditionally; no need to ask.
  if (role === "owner") {
    return { role, permissions: new Set(PERMISSIONS.map((p) => p.name)), bootstrap: false };
  }

  return {
    role,
    permissions: await grantsFor(supabase, role),
    // Only a manager can be the bootstrap administrator, so nobody else pays
    // for the question.
    bootstrap: role === "manager" ? !(await anyOwnerExists(supabase)) : false,
  };
}

/** This role's permissions, from the short-lived cache when it is warm. */
async function grantsFor(supabase: SupabaseClient, role: Role): Promise<Set<string>> {
  const hit = cachedGrants(role);
  if (hit) return hit;

  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission")
    .eq("role", role);

  if (error) {
    // The table isn't there yet. Fall back to the pre-RBAC defaults and do NOT
    // cache: migrations are applied by hand, so this should start working
    // without waiting out a TTL. Without the fallback, the window between
    // deploying and migrating would revoke every permission from every role at
    // once and lock the floor out mid-service.
    console.warn("[auth] no RBAC grants — apply supabase/migrations/011_rbac.sql");
    return new Set<string>(DEFAULT_GRANTS[role] ?? []);
  }

  const permissions = new Set<string>((data ?? []).map((r) => r.permission as string));
  cacheGrants(role, permissions);
  return permissions;
}

/** Whether anyone owns this restaurant yet — see canAdminister(). */
async function anyOwnerExists(supabase: SupabaseClient): Promise<boolean> {
  const hit = cachedOwnerExists();
  if (hit !== null) return hit;

  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner");

  // On error, assume an owner DOES exist: that closes the bootstrap door rather
  // than opening it on a failed query.
  const exists = error ? true : (count ?? 0) > 0;
  if (!error) cacheOwnerExists(exists);
  return exists;
}

/**
 * Endpoint guard. Reads the staff context that middleware placed on `locals`;
 * on failure returns a JSON Response the route can return directly. Pass
 * `roles` to restrict to specific roles (e.g. who may confirm an order).
 */
export function requireStaff(
  locals: App.Locals,
  roles?: Role[],
): StaffContext | Response {
  if (!locals.user || !locals.profile || !locals.grants) {
    return json({ error: "Not signed in." }, 401);
  }
  if (roles && !roles.includes(locals.profile.role)) {
    return json({ error: "Not permitted for your role." }, 403);
  }
  return { user: locals.user, profile: locals.profile, grants: locals.grants };
}

/**
 * Endpoint guard by capability rather than role — the form every mutating
 * route should use now that an owner can move a capability between roles.
 * Passing several permissions means any one of them is enough.
 */
export function requirePermission(
  locals: App.Locals,
  ...permissions: Permission[]
): StaffContext | Response {
  const gate = requireStaff(locals);
  if (gate instanceof Response) return gate;
  const ok = permissions.length === 1
    ? can(gate.grants, permissions[0])
    : canAny(gate.grants, permissions);
  if (!ok) return json({ error: "You don't have permission to do that." }, 403);
  return gate;
}
