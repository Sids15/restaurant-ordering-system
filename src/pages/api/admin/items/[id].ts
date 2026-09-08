/**
 * POST /api/admin/items/<id> — update or delete a dish (form field
 * action=update|delete). Manager only.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { parseItemForm, updateItem, deleteItem } from "../../../../lib/menu/admin";
import { audit, actorOf } from "../../../../lib/audit/log";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "menu.manage");
  if (gate instanceof Response) return gate;

  const id = context.params.id ?? "";
  const form = await context.request.formData();
  const action = String(form.get("action") ?? "");

  if (action === "delete") {
    const result = await deleteItem(context.locals.supabase, id);
    if (result.ok) {
      audit({
        action: "menu.item.delete",
        actor: actorOf(gate.profile),
        subjectType: "menu_item",
        subjectId: id,
        summary: "Deleted a dish",
        request: context.request,
      });
    }
    const q = result.ok ? "ok=deleted" : `err=${encodeURIComponent(result.error)}`;
    return context.redirect(`/admin?${q}`, 303);
  }

  const parsed = parseItemForm(form);
  if (!parsed.ok) {
    return context.redirect(`/admin/items/${id}?err=${encodeURIComponent(parsed.error)}`, 303);
  }
  const result = await updateItem(context.locals.supabase, id, parsed.value);
  if (!result.ok) {
    return context.redirect(`/admin/items/${id}?err=${encodeURIComponent(result.error)}`, 303);
  }
  // Price changes are the edit worth being able to point at later.
  audit({
    action: "menu.item.update",
    actor: actorOf(gate.profile),
    subjectType: "menu_item",
    subjectId: id,
    summary: `Edited "${parsed.value.name}" — now ${parsed.value.price}`,
    detail: { name: parsed.value.name, price: parsed.value.price },
    request: context.request,
  });

  return context.redirect("/admin?ok=saved", 303);
};
