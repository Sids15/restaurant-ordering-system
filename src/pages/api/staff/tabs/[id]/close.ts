/**
 * POST /api/staff/tabs/<id>/close — close a tab at payment. Only roles that
 * take orders (manager, server) may close. Redirects back to the bill.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../../lib/auth/session";
import { closeTab } from "../../../../../lib/orders/tabs";
import { audit, actorOf } from "../../../../../lib/audit/log";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "tabs.close");
  if (gate instanceof Response) return gate;

  const id = context.params.id ?? "";
  const result = await closeTab(context.locals.supabase, id, gate.user.id);

  if (result.ok) {
    audit({
      action: "tab.close",
      actor: actorOf(gate.profile),
      subjectType: "tab",
      subjectId: id,
      summary: "Closed a tab as paid",
      request: context.request,
    });
  }

  const q = new URLSearchParams();
  if (result.ok) q.set("closed", "1");
  else q.set("err", result.error ?? "Couldn't close the tab.");

  return context.redirect(`/staff/tabs/${id}?${q.toString()}`, 303);
};
