/**
 * GET /api/staff/kitchen/active — the live kitchen queue, for the board's poll.
 * Any signed-in staff may read it. Same serializer as the /kitchen page, so a
 * ticket is identical whether it arrived at page load or via a poll.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { getActiveKitchenOrders } from "../../../../lib/orders/kitchen";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "kitchen.view", "orders.view");
  if (gate instanceof Response) return gate;

  const orders = await getActiveKitchenOrders(context.locals.supabase);
  return new Response(JSON.stringify({ orders }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
