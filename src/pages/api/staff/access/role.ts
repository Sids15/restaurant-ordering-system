/**
 * POST /api/staff/access/role — give one person a different role. Owner-only.
 */
import type { APIRoute } from "astro";
import { requireStaff } from "../../../../lib/auth/session";
import { canAdminister } from "../../../../lib/auth/access";
import { invalidateGrants } from "../../../../lib/auth/grants-cache";
import { setRole } from "../../../../lib/auth/rbac";
import { audit, actorOf } from "../../../../lib/audit/log";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requireStaff(context.locals);
  if (gate instanceof Response) return gate;
  if (!canAdminister(gate.grants)) {
    return context.redirect("/staff?err=Not+permitted", 303);
  }

  const form = await context.request.formData();
  const result = await setRole(
    context.locals.supabase,
    gate.profile.id,
    String(form.get("id") ?? ""),
    String(form.get("role") ?? ""),
  );

  // A role change moves someone between permission sets, and can be the
  // moment the first owner appears — which is what ends the bootstrap.
  if (result.ok) invalidateGrants();

  if (result.ok) {
    audit({
      action: "access.role",
      actor: actorOf(gate.profile),
      subjectType: "profile",
      subjectId: String(form.get("id") ?? ""),
      summary: `Set someone's role to ${form.get("role")}`,
      detail: { role: String(form.get("role") ?? "") },
      request: context.request,
    });
  }

  const q = result.ok ? "ok=role" : `err=${encodeURIComponent(result.error ?? "Couldn't change it.")}`;
  return context.redirect(`/staff/access?${q}`, 303);
};
