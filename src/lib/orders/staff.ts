/**
 * Staff-side order reads and state transitions. Unlike the customer helpers
 * (service-role, collapsed state), these run through the *authenticated* client
 * so RLS enforces that only staff can read/write orders, and transitions follow
 * ORDER_FLOW. Used by the /staff console and its API route.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_FLOW, type OrderStatus, type OrderSource } from "../types";

export interface StaffOrderLine {
  name: string;
  qty: number;
  price: number;
  notes: string | null;
}

export interface StaffOrder {
  id: string;
  code: string;
  table_label: string | null;
  status: OrderStatus;
  source: OrderSource;
  subtotal: number;
  notes: string | null;
  tab_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  items: StaffOrderLine[];
}

export type OrderActionResult =
  | { ok: true; status: OrderStatus }
  | { ok: false; error: string };

export interface PendingOrder {
  code: string;
  table_label: string | null;
  waited_min: number;
  subtotal: number;
  items: StaffOrderLine[];
}

/**
 * Orders waiting for a server to confirm — the pending queue the /staff console
 * polls. Oldest first, so the longest-waiting table surfaces at the top.
 * `waited_min` is computed server-side (page and poll share this), so the island
 * never touches the clock during render.
 */
export async function getPendingOrders(
  supabase: SupabaseClient,
): Promise<PendingOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("code, table_label, subtotal, created_at, order_items ( name_snapshot, price_snapshot, qty, notes )")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const now = Date.now();
  return data.map((o) => ({
    code: o.code as string,
    table_label: o.table_label as string | null,
    subtotal: Number(o.subtotal),
    waited_min: Math.max(0, Math.floor((now - new Date(o.created_at).getTime()) / 60000)),
    items: (o.order_items ?? []).map(
      (i: { name_snapshot: string; price_snapshot: number; qty: number; notes: string | null }) => ({
        name: i.name_snapshot,
        qty: i.qty,
        price: Number(i.price_snapshot),
        notes: i.notes,
      }),
    ),
  }));
}

/** Full order + items for the staff console; null if the code doesn't exist. */
export async function getStaffOrder(
  supabase: SupabaseClient,
  code: string,
): Promise<StaffOrder | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, code, table_label, status, source, subtotal, notes, tab_id, created_at, confirmed_at, " +
        "order_items ( name_snapshot, price_snapshot, qty, notes )",
    )
    .eq("code", code)
    .maybeSingle();

  if (error || !data) return null;

  const items = (data.order_items ?? []).map(
    (i: {
      name_snapshot: string;
      price_snapshot: number;
      qty: number;
      notes: string | null;
    }) => ({
      name: i.name_snapshot,
      qty: i.qty,
      price: Number(i.price_snapshot),
      notes: i.notes,
    }),
  );

  return {
    id: data.id,
    code: data.code,
    table_label: data.table_label,
    status: data.status,
    source: data.source,
    subtotal: Number(data.subtotal),
    notes: data.notes,
    tab_id: data.tab_id,
    created_at: data.created_at,
    confirmed_at: data.confirmed_at,
    items,
  };
}

/** Accept a pending customer order. Idempotent if already confirmed. */
export async function confirmOrder(
  supabase: SupabaseClient,
  code: string,
  byUserId: string,
): Promise<OrderActionResult> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status")
    .eq("code", code)
    .maybeSingle();

  if (error) return { ok: false, error: "Couldn't reach that order — please retry." };
  if (!order) return { ok: false, error: "No order with that code." };
  if (order.status === "confirmed") return { ok: true, status: "confirmed" };
  if (!ORDER_FLOW[order.status as OrderStatus].includes("confirmed")) {
    return { ok: false, error: `Can't confirm an order that's already ${order.status}.` };
  }

  // Guard the status in the WHERE so a concurrent confirm can't double-apply.
  const { data: updated, error: upErr } = await supabase
    .from("orders")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: byUserId,
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .select("status")
    .maybeSingle();

  if (upErr) return { ok: false, error: "Couldn't confirm — please retry." };
  if (!updated) return { ok: true, status: "confirmed" }; // someone beat us to it
  return { ok: true, status: "confirmed" };
}

/**
 * Cancel an order that hasn't been served yet, recording who did it.
 *
 * Attribution is the point: voiding a round is how cash goes missing in a
 * restaurant, and it was the one money-moving action this app didn't sign.
 * `byUserId` is required rather than optional so a new call site can't quietly
 * drop it. ORDER_FLOW already blocks cancelling once a round is ready or
 * served — only pending and confirmed rounds can be voided.
 */
export async function cancelOrder(
  supabase: SupabaseClient,
  code: string,
  byUserId: string,
): Promise<OrderActionResult> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status")
    .eq("code", code)
    .maybeSingle();

  if (error) return { ok: false, error: "Couldn't reach that order — please retry." };
  if (!order) return { ok: false, error: "No order with that code." };
  if (order.status === "cancelled") return { ok: true, status: "cancelled" };
  if (!ORDER_FLOW[order.status as OrderStatus].includes("cancelled")) {
    return { ok: false, error: `Can't cancel an order that's already ${order.status}.` };
  }

  // Guard the status in the WHERE, as confirm does, so two servers hitting
  // Cancel at once can't both write an author.
  const { error: upErr } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_by: byUserId,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", order.status);

  if (upErr) return { ok: false, error: "Couldn't cancel — please retry." };
  return { ok: true, status: "cancelled" };
}
