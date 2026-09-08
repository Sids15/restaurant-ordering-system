/**
 * POST /api/admin/categories/new — create a category. Manager only.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { createCategory } from "../../../../lib/menu/admin";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "menu.manage");
  if (gate instanceof Response) return gate;

  const form = await context.request.formData();
  const name = String(form.get("name") ?? "");
  const sort_order = Math.floor(Number(form.get("sort_order")) || 0);

  const result = await createCategory(context.locals.supabase, name, sort_order);
  const q = result.ok ? "ok=cat-created" : `err=${encodeURIComponent(result.error)}`;
  return context.redirect(`/admin?${q}`, 303);
};
