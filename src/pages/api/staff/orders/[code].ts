/**
 * POST /api/staff/orders/<code> — a server confirms or cancels an order. Form
 * field `action` = "confirm" | "cancel". Only roles that take orders (manager,
 * server) may act. The looked-up order card posts a plain form and gets a
 * redirect + flash; the live pending queue posts via fetch with
 * `Accept: application/json` and gets JSON back. The confirm is what flips the
 * customer's page to "placed".
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { confirmOrder, cancelOrder } from "../../../../lib/orders/staff";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const code = (context.params.code ?? "").toUpperCase();
  const form = await context.request.formData();
  const action = String(form.get("action") ?? "");

  // Accepting an order and voiding one are separate capabilities: the first is
  // the job, the second moves money and is recorded against the person.
  const gate = requirePermission(
    context.locals,
    action === "cancel" ? "orders.void" : "orders.take",
  );
  if (gate instanceof Response) return gate;

  const supabase = context.locals.supabase;
  const result =
    action === "confirm"
      ? await confirmOrder(supabase, code, gate.user.id)
      : action === "cancel"
        ? await cancelOrder(supabase, code, gate.user.id)
        : ({ ok: false, error: "Unknown action." } as const);

  // fetch callers (the pending queue) want JSON; form posts want the redirect.
  if (context.request.headers.get("accept")?.includes("application/json")) {
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 422,
      headers: { "content-type": "application/json" },
    });
  }

  const q = new URLSearchParams({ code });
  if (result.ok) q.set("ok", result.status);
  else q.set("err", result.error);

  return context.redirect(`/staff?${q.toString()}`, 303);
};
