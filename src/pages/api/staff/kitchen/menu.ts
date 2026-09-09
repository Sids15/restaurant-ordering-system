/**
 * GET /api/staff/kitchen/menu — every dish with its availability, grouped by
 * category, for the 86 panel's poll. Kitchen + manager only. Static route, so
 * it takes precedence over /kitchen/[code].
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { getKitchenMenu } from "../../../../lib/menu/availability";
import { json } from "../../../../lib/http/json";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "kitchen.view");
  if (gate instanceof Response) return gate;

  const menu = await getKitchenMenu(context.locals.supabase);
  return json({ menu }, 200, { "cache-control": "no-store" });
};
