/**
 * createOrder — the ONLY path an order enters the database. Runs server-side
 * (API route) with the service-role client, because neither customers nor the
 * browser have direct access to the `orders` tables under RLS.
 *
 * The submitted lines are never trusted: every line is re-read from `menu_items`
 * for its *current* price and availability. Names and prices are snapshotted
 * onto the order line so a later menu edit can't rewrite history.
 *
 * Customer orders start `pending` (default). A server building an order passes
 * { source: "server", autoConfirm: true, confirmedBy } to have it land already
 * `confirmed` — skipping the accept step, since the server is the one taking it.
 */
import { supabaseAdmin } from "../supabase/admin";
import { generateOrderCode } from "./code";
import type { OrderSource } from "../types";

/** One line as the client submits it — item id + quantity, nothing priced. */
export interface CreateOrderLine {
  item_id: string;
  qty: number;
  notes?: string | null;
}

export interface CreateOrderInput {
  table_label?: string | null;
  notes?: string | null;
  lines: CreateOrderLine[];
}

export type CreateOrderResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/** How the order enters the system. Defaults produce a pending customer order. */
export interface CreateOrderOptions {
  source?: OrderSource;
  /** Land the order already `confirmed` (a server taking it directly). */
  autoConfirm?: boolean;
  /** Staff user id credited as confirming it, when autoConfirm. */
  confirmedBy?: string | null;
  /** The tab this order belongs to — resolved by the caller (session/staff). */
  tabId?: string | null;
}

const MAX_QTY_PER_LINE = 50;
// Upper bound on distinct cart lines. The menu is ~20 items, so anything past
// this is a malformed or hostile client — reject before it becomes a big
// `.in(...)` query and bulk insert. Not a UX limit; it's far above any real order.
const MAX_LINES = 100;
const CODE_RETRIES = 5;

export async function createOrder(
  input: CreateOrderInput,
  opts: CreateOrderOptions = {},
): Promise<CreateOrderResult> {
  const source: OrderSource = opts.source ?? "customer";
  const autoConfirm = opts.autoConfirm ?? false;
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) return { ok: false, error: "Your cart is empty." };
  if (lines.length > MAX_LINES) {
    return { ok: false, error: "That order didn't look right — please try again." };
  }

  // Collapse duplicate item ids and sanity-check quantities.
  const wanted = new Map<string, number>();
  for (const line of lines) {
    const qty = Math.floor(Number(line.qty));
    if (!line.item_id || !Number.isFinite(qty) || qty <= 0) {
      return { ok: false, error: "That order didn't look right — please try again." };
    }
    if (qty > MAX_QTY_PER_LINE) {
      return { ok: false, error: `Up to ${MAX_QTY_PER_LINE} of any one dish.` };
    }
    wanted.set(line.item_id, (wanted.get(line.item_id) ?? 0) + qty);
  }

  // The cap again, on the COLLAPSED total.
  //
  // Checking it per submitted line only bounds what one line may say. Duplicate
  // ids are merged above, so a hundred legal lines of the same dish at fifty
  // each passed every check and became an order for five thousand of it — each
  // line legal, the order not. The client never sends duplicates; anything that
  // does is malformed or hostile, and either way the kitchen should not see it.
  for (const [, total] of wanted) {
    if (total > MAX_QTY_PER_LINE) {
      return { ok: false, error: `Up to ${MAX_QTY_PER_LINE} of any one dish.` };
    }
  }

  const supabase = supabaseAdmin();

  // Re-read the requested items at their live price + availability.
  const ids = [...wanted.keys()];
  const { data: rows, error: readErr } = await supabase
    .from("menu_items")
    .select("id, name, price, is_available")
    .in("id", ids);

  if (readErr) return { ok: false, error: "Couldn't reach the kitchen — please try again." };

  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));

  const orderItems: {
    menu_item_id: string;
    name_snapshot: string;
    price_snapshot: number;
    qty: number;
    notes: string | null;
  }[] = [];
  let subtotal = 0;

  for (const [itemId, qty] of wanted) {
    const row = byId.get(itemId);
    if (!row) {
      return { ok: false, error: "One of your dishes is no longer on the menu. Please review your order." };
    }
    if (!row.is_available) {
      return { ok: false, error: `“${row.name}” just sold out. Please remove it and try again.` };
    }
    const price = Number(row.price);
    subtotal += price * qty;
    orderItems.push({
      menu_item_id: itemId,
      name_snapshot: row.name as string,
      price_snapshot: price,
      qty,
      notes: notesFor(lines, itemId),
    });
  }

  const table_label = normalizeText(input.table_label);
  const notes = normalizeText(input.notes);
  // The tab is resolved by the caller: the customer's session, or the table the
  // staff builder targeted. Rounds on the same tab bill together.
  const tab_id = opts.tabId ?? null;

  // Insert the order, retrying on the (astronomically rare) code collision.
  for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
    const code = generateOrderCode();
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        code,
        table_label,
        tab_id,
        status: autoConfirm ? "confirmed" : "pending",
        source,
        subtotal,
        notes,
        ...(autoConfirm
          ? { confirmed_at: new Date().toISOString(), confirmed_by: opts.confirmedBy ?? null }
          : {}),
      })
      .select("id")
      .single();

    if (orderErr) {
      // 23505 = unique_violation on `code`; try a fresh code.
      if ((orderErr as { code?: string }).code === "23505") continue;
      return { ok: false, error: "Couldn't place your order — please try again." };
    }

    const { error: itemsErr } = await supabase
      .from("order_items")
      .insert(orderItems.map((oi) => ({ ...oi, order_id: order.id })));

    if (itemsErr) {
      // Roll back the orphaned order so a retry starts clean.
      await supabase.from("orders").delete().eq("id", order.id);
      return { ok: false, error: "Couldn't place your order — please try again." };
    }

    return { ok: true, code };
  }

  return { ok: false, error: "Couldn't place your order — please try again." };
}

/** First note supplied for a given item id, trimmed to null. */
function notesFor(lines: CreateOrderLine[], itemId: string): string | null {
  const withNote = lines.find((l) => l.item_id === itemId && normalizeText(l.notes));
  return withNote ? normalizeText(withNote.notes) : null;
}

function normalizeText(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t.slice(0, 280) : null;
}
