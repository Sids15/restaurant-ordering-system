/**
 * Customer-facing order tracking. Reads an order by its code with the
 * service-role client (customers have no direct DB access) and reduces the full
 * status machine down to what a customer needs to see:
 *
 *   waiting   — sent, not yet accepted by a server (show the code + QR)
 *   placed    — a server accepted it (anything past `pending`)
 *   cancelled — a server cancelled it
 *
 * The kitchen's finer states (preparing / ready / served) are staff concerns;
 * the customer only cares that their order is now in.
 */
import { supabaseAdmin } from "../supabase/admin";

export type CustomerOrderState = "waiting" | "placed" | "cancelled";

export interface TrackedLine {
  name: string;
  qty: number;
  price: number;
}

export interface TrackedOrder {
  code: string;
  table_label: string | null;
  state: CustomerOrderState;
  subtotal: number;
  notes: string | null;
  items: TrackedLine[];
}

/** Collapse the DB status enum to the three customer-visible states. */
function toCustomerState(status: string): CustomerOrderState {
  if (status === "pending") return "waiting";
  if (status === "cancelled") return "cancelled";
  return "placed";
}

/** Full order for the tracking page; null if the code doesn't exist. */
export async function getTrackedOrder(code: string): Promise<TrackedOrder | null> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "code, table_label, status, subtotal, notes, order_items ( name_snapshot, price_snapshot, qty )",
    )
    .eq("code", code)
    .maybeSingle();

  if (error || !data) return null;

  const items = (data.order_items ?? []).map(
    (i: { name_snapshot: string; price_snapshot: number; qty: number }) => ({
      name: i.name_snapshot,
      qty: i.qty,
      price: Number(i.price_snapshot),
    }),
  );

  return {
    code: data.code,
    table_label: data.table_label,
    state: toCustomerState(data.status),
    subtotal: Number(data.subtotal),
    notes: data.notes,
    items,
  };
}

export interface SessionRound {
  code: string;
  state: CustomerOrderState;
  created_at: string;
  subtotal: number;
  items: TrackedLine[];
}

/**
 * Every round on a tab, newest first — the customer's history for their current
 * table visit. Read by tab id, which the caller only holds while the tab is open
 * (the session cookie's token resolves to an open tab); once a server closes the
 * tab the caller can no longer reach this, so the history disappears for the
 * guest while the records stay intact for the staff bill.
 */
export async function getSessionOrders(tabId: string): Promise<SessionRound[]> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "code, status, subtotal, created_at, order_items ( name_snapshot, price_snapshot, qty )",
    )
    .eq("tab_id", tabId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((o) => ({
    code: o.code as string,
    state: toCustomerState(o.status as string),
    created_at: o.created_at as string,
    subtotal: Number(o.subtotal),
    items: (o.order_items ?? []).map(
      (i: { name_snapshot: string; price_snapshot: number; qty: number }) => ({
        name: i.name_snapshot,
        qty: i.qty,
        price: Number(i.price_snapshot),
      }),
    ),
  }));
}

/** Just the live state — for the polling endpoint. null if unknown code. */
export async function getOrderState(code: string): Promise<CustomerOrderState | null> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .select("status")
    .eq("code", code)
    .maybeSingle();

  if (error || !data) return null;
  return toCustomerState(data.status);
}
