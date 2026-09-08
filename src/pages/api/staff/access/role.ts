/**
 * POST /api/staff/access/role — give one person a different role. Owner-only.
 */
import type { APIRoute } from "astro";
import { requireStaff } from "../../../../lib/auth/session";
import { canAdminister } from "../../../../lib/auth/access";
import { setRole } from "../../../../lib/auth/rbac";

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

  const q = result.ok ? "ok=role" : `err=${encodeURIComponent(result.error ?? "Couldn't change it.")}`;
  return context.redirect(`/staff/access?${q}`, 303);
};
