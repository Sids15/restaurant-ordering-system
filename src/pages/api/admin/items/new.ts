/**
 * POST /api/admin/items/new — create a dish. Manager only (RLS enforces it too).
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { parseItemForm, createItem } from "../../../../lib/menu/admin";
import { audit, actorOf } from "../../../../lib/audit/log";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "menu.manage");
  if (gate instanceof Response) return gate;

  const form = await context.request.formData();
  const parsed = parseItemForm(form);
  if (!parsed.ok) {
    return context.redirect(`/admin/items/new?err=${encodeURIComponent(parsed.error)}`, 303);
  }

  const result = await createItem(context.locals.supabase, parsed.value);
  if (!result.ok) {
    return context.redirect(`/admin/items/new?err=${encodeURIComponent(result.error)}`, 303);
  }
  audit({
    action: "menu.item.create",
    actor: actorOf(gate.profile),
    subjectType: "menu_item",
    summary: `Added "${parsed.value.name}" at ${parsed.value.price}`,
    detail: { name: parsed.value.name, price: parsed.value.price },
    request: context.request,
  });

  return context.redirect("/admin?ok=created", 303);
};
