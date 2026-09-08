/**
 * POST /api/admin/categories/<id> — rename/reorder or delete a category (form
 * field action=update|delete). Manager only. Delete is blocked when the category
 * still has dishes.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { updateCategory, deleteCategory } from "../../../../lib/menu/admin";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "menu.manage");
  if (gate instanceof Response) return gate;

  const id = context.params.id ?? "";
  const form = await context.request.formData();
  const action = String(form.get("action") ?? "");

  if (action === "delete") {
    const result = await deleteCategory(context.locals.supabase, id);
    const q = result.ok ? "ok=cat-deleted" : `err=${encodeURIComponent(result.error)}`;
    return context.redirect(`/admin?${q}`, 303);
  }

  const name = String(form.get("name") ?? "");
  const sort_order = Math.floor(Number(form.get("sort_order")) || 0);
  const result = await updateCategory(context.locals.supabase, id, name, sort_order);
  const q = result.ok ? "ok=cat-saved" : `err=${encodeURIComponent(result.error)}`;
  return context.redirect(`/admin?${q}`, 303);
};
