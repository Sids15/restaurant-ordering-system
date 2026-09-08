/**
 * POST /api/staff/tabs/<id>/merge — fold another table's open tab into this one
 * (two tables, one bill). Manager + server. Blocked if the source table has no
 * open tab. Redirects back to the surviving bill.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../../lib/auth/session";
import { mergeTab } from "../../../../../lib/orders/tabs";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "tabs.move");
  if (gate instanceof Response) return gate;

  const id = context.params.id ?? "";
  const form = await context.request.formData();
  const from = String(form.get("from") ?? "");

  const result = await mergeTab(context.locals.supabase, id, from);

  const q = new URLSearchParams();
  if (result.ok) q.set("merged", "1");
  else q.set("err", result.error ?? "Couldn't merge the tables.");

  return context.redirect(`/staff/tabs/${id}?${q.toString()}`, 303);
};
