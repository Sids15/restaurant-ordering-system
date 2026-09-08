/**
 * Reading and writing the RBAC grants — the data behind /staff/access.
 *
 * Every write here runs through the caller's own authenticated client, so
 * Postgres decides whether it is allowed (011_rbac.sql makes the grant tables
 * owner-writable). This module never reaches for the service-role client: an
 * administration screen is exactly the place where the database check has to be
 * real rather than assumed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { EDITABLE_ROLES, DEFAULT_GRANTS, PERMISSIONS } from "./permissions";
import type { Role } from "../types";

export interface StaffRow {
  id: string;
  name: string;
  role: string;
  email: string | null;
}

/** True once the RBAC tables exist. Everything degrades politely until then. */
export async function rbacReady(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("role_permissions").select("role").limit(1);
  return !error;
}

/** Current grants, as role -> set of permission names. */
export async function readGrants(supabase: SupabaseClient): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const { data, error } = await supabase.from("role_permissions").select("role, permission");
  if (error || !data) return out;
  for (const r of data) {
    const role = r.role as string;
    if (!out.has(role)) out.set(role, new Set());
    out.get(role)!.add(r.permission as string);
  }
  return out;
}

/** Everyone with a profile, for the role picker. Newest roles first. */
export async function listStaff(supabase: SupabaseClient): Promise<StaffRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role, created_at")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((p) => ({
    id: p.id as string,
    name: (p.name as string) ?? "",
    role: p.role as string,
    // profiles holds no email; auth.users does, and it isn't exposed through
    // PostgREST. The id prefix is enough to tell two unnamed accounts apart.
    email: null,
  }));
}

const VALID = new Set<string>(PERMISSIONS.map((p) => p.name));

/**
 * Replace the whole grant table for the editable roles.
 *
 * A wholesale replace rather than a diff, because the form posts the complete
 * intended state: a permission absent from the body means the owner switched it
 * off, and a diff would read that as "unchanged". Delete-then-insert in that
 * order so a half-applied write leaves fewer permissions rather than more.
 */
export async function writeGrants(
  supabase: SupabaseClient,
  desired: Map<string, Set<string>>,
): Promise<{ ok: boolean; error?: string }> {
  const rows: { role: string; permission: string }[] = [];
  for (const role of EDITABLE_ROLES) {
    for (const permission of desired.get(role) ?? new Set<string>()) {
      // Ignore anything not in the catalogue: a forged field cannot invent a
      // capability, and the foreign key would refuse it anyway.
      if (VALID.has(permission)) rows.push({ role, permission });
    }
  }

  const { error: delErr } = await supabase
    .from("role_permissions")
    .delete()
    .in("role", EDITABLE_ROLES as string[]);
  if (delErr) return { ok: false, error: "Couldn't update permissions — please retry." };

  if (rows.length > 0) {
    const { error } = await supabase.from("role_permissions").insert(rows);
    if (error) return { ok: false, error: "Permissions were cleared but not re-applied. Retry." };
  }
  return { ok: true };
}

/** Put the editable roles back to what the app ships with. */
export async function restoreDefaults(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const desired = new Map<string, Set<string>>();
  for (const role of EDITABLE_ROLES) {
    desired.set(role, new Set(DEFAULT_GRANTS[role] ?? []));
  }
  return writeGrants(supabase, desired);
}

const ASSIGNABLE = new Set<string>(["owner", "manager", "server", "kitchen", "pending"]);

/**
 * Change one person's role.
 *
 * Refuses to change your own, which is the guard that matters: an owner who
 * demotes themselves by accident has no way back through the UI, because the
 * page that fixes it is the page they just lost.
 */
export async function setRole(
  supabase: SupabaseClient,
  actorId: string,
  targetId: string,
  role: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!ASSIGNABLE.has(role)) return { ok: false, error: "That isn't a role." };
  if (targetId === actorId) {
    return { ok: false, error: "You can't change your own role — ask another owner, or use the SQL editor." };
  }
  const { error } = await supabase
    .from("profiles")
    .update({ role: role as Role })
    .eq("id", targetId);
  if (error) return { ok: false, error: "Couldn't change that role — please retry." };
  return { ok: true };
}
