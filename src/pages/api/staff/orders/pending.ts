/**
 * GET /api/staff/orders/pending — orders waiting to be confirmed, for the
 * console's live pending queue (the server notification). Only roles that take
 * orders (manager, server) poll this.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { getPendingOrders } from "../../../../lib/orders/staff";
import { json } from "../../../../lib/http/json";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "orders.view");
  if (gate instanceof Response) return gate;

  const orders = await getPendingOrders(context.locals.supabase);
  return json({ orders }, 200, { "cache-control": "no-store" });
};
