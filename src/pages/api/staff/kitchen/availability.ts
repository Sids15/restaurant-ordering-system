/**
 * POST /api/staff/kitchen/availability — 86 a dish (or bring it back). Body:
 * { itemId, available }. Kitchen + manager only (the RPC also enforces this in
 * the database). Static route, so it takes precedence over /kitchen/[code].
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { setAvailability } from "../../../../lib/menu/availability";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "kitchen.availability");
  if (gate instanceof Response) return gate;

  let body: { itemId?: string; available?: boolean };
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: "Malformed request." }, 400);
  }

  const itemId = String(body.itemId ?? "");
  if (!itemId) return json({ ok: false, error: "Missing item." }, 400);

  const result = await setAvailability(context.locals.supabase, itemId, Boolean(body.available));
  return json(result, result.ok ? 200 : 422);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
