/**
 * POST /api/staff/kitchen/<code> — mark a ticket complete (served). Kitchen
 * only: the kitchen completes its own tickets, not the manager on its behalf.
 * Returns JSON for the board island (fetch).
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { completeOrder } from "../../../../lib/orders/kitchen";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "kitchen.view");
  if (gate instanceof Response) return gate;

  const code = (context.params.code ?? "").toUpperCase();
  const result = await completeOrder(context.locals.supabase, code);

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 422,
    headers: { "content-type": "application/json" },
  });
};
