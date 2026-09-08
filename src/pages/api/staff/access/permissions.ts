/**
 * POST /api/staff/access/permissions — save the permission matrix, or restore
 * the shipped defaults (action=reset).
 *
 * Owner-only, and gated on canAdminister rather than on a permission: a
 * permission that can switch off the endpoint managing permissions is a lock
 * with the key inside. RLS refuses the write for anyone but an owner regardless.
 */
import type { APIRoute } from "astro";
import { requireStaff } from "../../../../lib/auth/session";
import { canAdminister } from "../../../../lib/auth/access";
import { invalidateGrants } from "../../../../lib/auth/grants-cache";
import { writeGrants, restoreDefaults } from "../../../../lib/auth/rbac";
import { EDITABLE_ROLES } from "../../../../lib/auth/permissions";
import { audit, actorOf } from "../../../../lib/audit/log";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requireStaff(context.locals);
  if (gate instanceof Response) return gate;
  if (!canAdminister(gate.grants)) {
    return context.redirect("/staff?err=Not+permitted", 303);
  }

  const form = await context.request.formData();
  const supabase = context.locals.supabase;

  const result =
    form.get("action") === "reset"
      ? await restoreDefaults(supabase)
      : await writeGrants(supabase, readMatrix(form));

  // Grants are cached for a few seconds per instance; drop ours so the owner
  // who just saved sees the change on their very next request rather than
  // waiting out the TTL and wondering whether it saved.
  if (result.ok) invalidateGrants();

  if (result.ok) {
    audit({
      action: "access.permissions",
      actor: actorOf(gate.profile),
      summary:
        form.get("action") === "reset"
          ? "Restored the default permissions"
          : "Changed what roles may do",
      request: context.request,
    });
  }

  const q = result.ok
    ? `ok=${form.get("action") === "reset" ? "reset" : "saved"}`
    : `err=${encodeURIComponent(result.error ?? "Couldn't save.")}`;
  return context.redirect(`/staff/access?${q}`, 303);
};

/**
 * The posted checkboxes, as role -> permissions. Fields are named
 * `grant:<role>:<permission>`; an unchecked box sends nothing, which is exactly
 * how "switched off" arrives.
 */
function readMatrix(form: FormData): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const role of EDITABLE_ROLES) out.set(role, new Set());
  for (const key of form.keys()) {
    if (!key.startsWith("grant:")) continue;
    const [, role, permission] = key.split(":");
    if (out.has(role) && permission) out.get(role)!.add(permission);
  }
  return out;
}
