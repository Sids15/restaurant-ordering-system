/**
 * POST /api/orders — place a customer order.
 *
 * Ordering follows the table SESSION, not the URL: we read the httpOnly cookie,
 * find the guest's OPEN tab, and attach the order to it with that tab's table.
 * No open session (never scanned, or the tab was closed) → the order is refused.
 * The client's table in the body is ignored.
 */
import type { APIRoute } from "astro";
import { createOrder } from "../../../lib/orders/create";
import { currentSession } from "../../../lib/orders/session";
import { json } from "../../../lib/http/json";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  let body: { lines?: unknown; notes?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const session = await currentSession(context.cookies);
  if (!session) {
    return json(
      { error: "Your table session has ended. Please rescan your table's QR to order." },
      409,
    );
  }

  const result = await createOrder(
    {
      table_label: session.table_label,
      notes: typeof body.notes === "string" ? body.notes : null,
      lines: Array.isArray(body.lines) ? (body.lines as never) : [],
    },
    { source: "customer", tabId: session.tabId },
  );

  if (!result.ok) return json({ error: result.error }, 422);
  return json({ code: result.code }, 201);
};
