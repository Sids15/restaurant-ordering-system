/**
 * POST /api/staff/kitchen/availability — 86 a dish (or bring it back). Body:
 * { itemId, available }. Kitchen + manager only (the RPC also enforces this in
 * the database). Static route, so it takes precedence over /kitchen/[code].
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { setAvailability } from "../../../../lib/menu/availability";
import { audit, actorOf } from "../../../../lib/audit/log";
import { json } from "../../../../lib/http/json";

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
  if (result.ok) {
    audit({
      action: "menu.availability",
      actor: actorOf(gate.profile),
      subjectType: "menu_item",
      subjectId: itemId,
      summary: available ? "Put a dish back on" : "Marked a dish 86",
      detail: { available },
      request: context.request,
    });
  }

  return json(result, result.ok ? 200 : 422);
};
