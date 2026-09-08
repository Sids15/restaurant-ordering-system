/**
 * GET /api/staff/kitchen/menu — every dish with its availability, grouped by
 * category, for the 86 panel's poll. Kitchen + manager only. Static route, so
 * it takes precedence over /kitchen/[code].
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { getKitchenMenu } from "../../../../lib/menu/availability";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "kitchen.view");
  if (gate instanceof Response) return gate;

  const menu = await getKitchenMenu(context.locals.supabase);
  return new Response(JSON.stringify({ menu }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
