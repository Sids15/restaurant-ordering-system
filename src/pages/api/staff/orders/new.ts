/**
 * POST /api/staff/orders/new — a server builds an order at the table and it
 * lands already confirmed (source: server). The form posts a `qty_<itemId>`
 * field per dish plus the table and an optional note; we turn the positive
 * quantities into lines and hand them to createOrder, which re-reads live
 * prices. Only roles that take orders (manager, server) may do this.
 *
 * The table is required. A server-built order without one can't open a tab, so
 * it never joins the table's bill, never inherits an assigned server, and shows
 * on the docket as "No table" with nowhere to carry it — the guest's other
 * rounds bill separately from this one.
 */
import type { APIRoute } from "astro";
import { requirePermission } from "../../../../lib/auth/session";
import { createOrder, type CreateOrderLine } from "../../../../lib/orders/create";
import { openOrJoinTab } from "../../../../lib/orders/tabs";
import { claimTabIfUnassigned } from "../../../../lib/orders/assign";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const gate = requirePermission(context.locals, "orders.take");
  if (gate instanceof Response) return gate;

  const form = await context.request.formData();
  const table_label = String(form.get("table_label") ?? "").trim();
  const notes = String(form.get("notes") ?? "");

  // The input carries `required`, so this is the bypassed-form case.
  if (!table_label) return context.redirect("/staff/new?err=table", 303);

  // Collect qty_<itemId> fields with a positive quantity.
  const lines: CreateOrderLine[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("qty_")) continue;
    const qty = Math.floor(Number(value));
    if (Number.isFinite(qty) && qty > 0) {
      lines.push({ item_id: key.slice(4), qty });
    }
  }

  if (lines.length === 0) {
    return context.redirect("/staff/new?err=empty", 303);
  }

  // A server-built order joins the table's open tab (or opens one), so it bills
  // with the guest's rounds and their scanned session shares the same tab.
  const tab = await openOrJoinTab(context.locals.supabase, table_label);

  const result = await createOrder(
    { table_label, notes, lines },
    { source: "server", autoConfirm: true, confirmedBy: gate.user.id, tabId: tab?.tabId ?? null },
  );

  if (!result.ok) {
    const q = new URLSearchParams({ err: result.error });
    return context.redirect(`/staff/new?${q.toString()}`, 303);
  }

  // Whoever takes the first round owns the table by default — one less thing to
  // do at the pass. Only if nobody has it; a manager can reassign from the bill.
  if (tab) await claimTabIfUnassigned(context.locals.supabase, tab.tabId, gate.user.id);

  const q = new URLSearchParams({ code: result.code, ok: "created" });
  return context.redirect(`/staff?${q.toString()}`, 303);
};
