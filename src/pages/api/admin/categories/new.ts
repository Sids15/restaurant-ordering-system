/**
 * POST /api/admin/categories/new — create a category. Manager only.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { createCategory } from "../../../../lib/menu/admin";
import { audit, actorOf } from "../../../../lib/audit/log";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "menu.manage");
  if (gate instanceof Response) return gate;

  const form = await context.request.formData();
  const name = String(form.get("name") ?? "");
  const sort_order = Math.floor(Number(form.get("sort_order")) || 0);

  const result = await createCategory(context.locals.supabase, name, sort_order);
  if (result.ok) {
    audit({
      action: "menu.category.create",
      actor: actorOf(gate.profile),
      subjectType: "menu_category",
      summary: `Added the "${name}" category`,
      request: context.request,
    });
  }

  const q = result.ok ? "ok=cat-created" : `err=${encodeURIComponent(result.error)}`;
  return context.redirect(`/admin?${q}`, 303);
};
