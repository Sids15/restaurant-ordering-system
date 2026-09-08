/**
 * GET /api/staff/orders/pending — orders waiting to be confirmed, for the
 * console's live pending queue (the server notification). Only roles that take
 * orders (manager, server) poll this.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { getPendingOrders } from "../../../../lib/orders/staff";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "orders.view");
  if (gate instanceof Response) return gate;

  const orders = await getPendingOrders(context.locals.supabase);
  return new Response(JSON.stringify({ orders }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
