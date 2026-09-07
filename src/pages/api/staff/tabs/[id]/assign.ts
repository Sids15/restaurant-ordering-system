/**
 * POST /api/staff/tabs/<id>/assign — put a server on this table, or clear it
 * (empty `to`). Manager + server: on a real floor a server picks up a table
 * without asking, and a manager rearranges after. Assignment is optional and
 * gates nothing.
 *
 * `next` lets the open-tabs list post the same form and land back on the list
 * instead of the bill; it is sanitised to a same-origin path.
 */
import type { APIRoute } from "astro";
import { requireStaff } from "../../../../../lib/auth/session";
import { assignTab } from "../../../../../lib/orders/assign";
import { safeNext } from "../../../../../lib/http/safe-next";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requireStaff(context.locals, ["manager", "server"]);
  if (gate instanceof Response) return gate;

  const id = context.params.id ?? "";
  const form = await context.request.formData();
  const raw = String(form.get("to") ?? "").trim();

  const result = await assignTab(context.locals.supabase, id, raw || null);

  const back = safeNext(String(form.get("next") ?? ""), `/staff/tabs/${id}`);
  const q = new URLSearchParams();
  if (result.ok) q.set("assigned", raw ? "1" : "0");
  else q.set("err", result.error ?? "Couldn't update the table.");

  const sep = back.includes("?") ? "&" : "?";
  return context.redirect(`${back}${sep}${q.toString()}`, 303);
};
