/**
 * POST /api/staff/tabs/<id>/move — move an open tab to a different table (guests
 * changed tables mid-meal). Manager + server. Blocked if the destination
 * already has an open tab. Redirects back to the bill.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../../lib/auth/session";
import { moveTab } from "../../../../../lib/orders/tabs";
import { audit, actorOf } from "../../../../../lib/audit/log";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "tabs.move");
  if (gate instanceof Response) return gate;

  const id = context.params.id ?? "";
  const form = await context.request.formData();
  const to = String(form.get("to") ?? "");

  const result = await moveTab(context.locals.supabase, id, to);

  if (result.ok) {
    audit({
      action: "tab.move",
      actor: actorOf(gate.profile),
      subjectType: "tab",
      subjectId: id,
      summary: `Moved a tab to table ${to}`,
      detail: { to },
      request: context.request,
    });
  }

  const q = new URLSearchParams();
  if (result.ok) q.set("moved", "1");
  else q.set("err", result.error ?? "Couldn't move the tab.");

  return context.redirect(`/staff/tabs/${id}?${q.toString()}`, 303);
};
