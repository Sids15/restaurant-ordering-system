/**
 * Tabs — a table session groups the rounds a table orders across one visit, so
 * the bill is collective while each round stays its own kitchen ticket. A table
 * has at most one open tab (enforced by a partial unique index); the second
 * round for that table joins it. Runs with whichever client the caller passes:
 * the service-role client from order creation, or the authenticated staff
 * client from the billing surfaces.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TabStatus } from "../types";
import { computeBill, type BillTotals } from "../billing";
import { ASSIGNED_EMBED, selectTabs, type Assignee } from "./assign";

export interface OpenTab {
  tabId: string;
  table_label: string;
  token: string;
}

/** A hard-to-guess session token for a tab. */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The open tab for a table — reusing the existing one or opening a fresh one —
 * always with a session token (backfilled for a legacy tab that lacks one).
 * Null only when there's no table (a standalone order). Race-safe on the
 * one-open-tab-per-table unique index.
 */
export async function openOrJoinTab(
  supabase: SupabaseClient,
  tableLabel: string | null,
): Promise<OpenTab | null> {
  if (!tableLabel) return null;

  const existing = await findOpenTab(supabase, tableLabel);
  if (existing) {
    if (existing.token) return existing;
    const token = generateSessionToken();
    await supabase.from("tabs").update({ session_token: token }).eq("id", existing.tabId);
    return { ...existing, token };
  }

  const token = generateSessionToken();
  const { data: created, error } = await supabase
    .from("tabs")
    .insert({ table_label: tableLabel, status: "open", session_token: token })
    .select("id, table_label")
    .single();

  if (!error && created) {
    return { tabId: created.id as string, table_label: created.table_label as string, token };
  }

  // 23505 = another round opened the tab first; re-read the winner.
  if ((error as { code?: string } | null)?.code === "23505") {
    return findOpenTab(supabase, tableLabel);
  }
  return null;
}

async function findOpenTab(
  supabase: SupabaseClient,
  tableLabel: string,
): Promise<OpenTab | null> {
  const { data } = await supabase
    .from("tabs")
    .select("id, table_label, session_token")
    .eq("table_label", tableLabel)
    .eq("status", "open")
    .maybeSingle();
  if (!data) return null;
  return {
    tabId: data.id as string,
    table_label: data.table_label as string,
    token: (data.session_token as string | null) ?? "",
  };
}

// --- Billing (staff surfaces) ------------------------------------------------

export interface OpenTabSummary {
  id: string;
  table_label: string;
  order_count: number;
  subtotal: number;
  opened_at: string;
  /** The server on this table, or null — assignment is optional. */
  assigned: Assignee | null;
}

export interface TabBillLine {
  name: string;
  qty: number;
  price: number;
}

export interface TabBill {
  id: string;
  table_label: string;
  status: TabStatus;
  opened_at: string;
  closed_at: string | null;
  lines: TabBillLine[];
  round_count: number;
  totals: BillTotals;
  /** The server on this table, or null. Printed as "Served by" on the bill. */
  assigned: Assignee | null;
}

/** Open tabs with a running total, for the /staff/tabs list. Oldest first. */
export async function getOpenTabs(supabase: SupabaseClient): Promise<OpenTabSummary[]> {
  const { data, error } = await selectTabs<Record<string, unknown>[]>((withAssignment) =>
    supabase
      .from("tabs")
      .select(
        "id, table_label, opened_at, orders ( subtotal, status )" +
          (withAssignment ? `, ${ASSIGNED_EMBED}` : ""),
      )
      .eq("status", "open")
      .order("opened_at", { ascending: true }),
  );

  if (error || !data) return [];

  return data.map((t) => {
    const billable = ((t.orders as { subtotal: number; status: string }[] | null) ?? []).filter(
      (o) => o.status !== "cancelled",
    );
    return {
      id: t.id as string,
      table_label: t.table_label as string,
      opened_at: t.opened_at as string,
      assigned: (t.assigned as Assignee | null) ?? null,
      order_count: billable.length,
      subtotal: billable.reduce((s, o) => s + Number(o.subtotal), 0),
    };
  });
}

/**
 * The collective bill for a tab: every non-cancelled round's items merged by
 * name+price, with GST + service totals. Null if the tab doesn't exist.
 */
export async function getTabBill(
  supabase: SupabaseClient,
  tabId: string,
): Promise<TabBill | null> {
  const { data, error } = await selectTabs<Record<string, unknown>>((withAssignment) =>
    supabase
      .from("tabs")
      .select(
        "id, table_label, status, opened_at, closed_at, " +
          (withAssignment ? `${ASSIGNED_EMBED}, ` : "") +
          "orders ( status, order_items ( name_snapshot, price_snapshot, qty ) )",
      )
      .eq("id", tabId)
      .maybeSingle(),
  );

  if (error || !data) return null;

  const merged = new Map<string, TabBillLine>();
  let subtotal = 0;
  let round_count = 0;

  for (const o of (data.orders ?? []) as {
    status: string;
    order_items: { name_snapshot: string; price_snapshot: number; qty: number }[];
  }[]) {
    if (o.status === "cancelled") continue;
    round_count += 1;
    for (const i of o.order_items ?? []) {
      const price = Number(i.price_snapshot);
      subtotal += price * i.qty;
      const key = `${i.name_snapshot}@@${price}`;
      const existing = merged.get(key);
      if (existing) existing.qty += i.qty;
      else merged.set(key, { name: i.name_snapshot, price, qty: i.qty });
    }
  }

  return {
    id: data.id as string,
    table_label: data.table_label as string,
    status: data.status as TabStatus,
    opened_at: data.opened_at as string,
    closed_at: data.closed_at as string | null,
    assigned: (data.assigned as Assignee | null) ?? null,
    lines: [...merged.values()],
    round_count,
    totals: computeBill(subtotal),
  };
}

/** Close a tab at payment. Idempotent; guarded so only an open tab closes. */
export async function closeTab(
  supabase: SupabaseClient,
  tabId: string,
  byUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: tab } = await supabase
    .from("tabs")
    .select("id, status")
    .eq("id", tabId)
    .maybeSingle();

  if (!tab) return { ok: false, error: "Tab not found." };
  if (tab.status === "closed") return { ok: true };

  // Clearing the token kills every device bound to this tab.
  const { error } = await supabase
    .from("tabs")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: byUserId,
      session_token: null,
    })
    .eq("id", tabId)
    .eq("status", "open");

  if (error) return { ok: false, error: "Couldn't close the tab — please retry." };
  return { ok: true };
}

/**
 * Move an open tab (and its orders) to a different table — for guests who
 * change tables mid-meal. Blocked if the destination already has an open tab.
 * Sessions bind to the tab, not the label, so bound devices keep working.
 */
export async function moveTab(
  supabase: SupabaseClient,
  tabId: string,
  newLabel: string,
): Promise<{ ok: boolean; error?: string }> {
  const label = newLabel.trim();
  if (!label) return { ok: false, error: "Enter a table to move to." };

  const { data: tab } = await supabase
    .from("tabs")
    .select("id, status, table_label")
    .eq("id", tabId)
    .maybeSingle();
  if (!tab) return { ok: false, error: "Tab not found." };
  if (tab.status !== "open") return { ok: false, error: "That tab is closed." };
  if (tab.table_label === label) return { ok: true };

  // Destination must be free (one open tab per table).
  const dest = await findOpenTab(supabase, label);
  if (dest) return { ok: false, error: `Table ${label} already has an open tab.` };

  const { error: tabErr } = await supabase
    .from("tabs")
    .update({ table_label: label })
    .eq("id", tabId)
    .eq("status", "open");
  if (tabErr) return { ok: false, error: "Couldn't move the tab — please retry." };

  // Keep the orders' table snapshot in step so the kitchen sees the new table.
  await supabase.from("orders").update({ table_label: label }).eq("tab_id", tabId);
  return { ok: true };
}

/**
 * Merge the open tab at `fromLabel` into `tabId` — two tables settling on one
 * bill. The source tab's rounds move onto this tab (relabelled to this table so
 * the kitchen stays consistent) and the source tab is marked 'merged', pointing
 * back at the survivor. Idempotent-ish: a source that's already gone reports a
 * clear error rather than half-merging.
 */
export async function mergeTab(
  supabase: SupabaseClient,
  tabId: string,
  fromLabel: string,
): Promise<{ ok: boolean; error?: string }> {
  const label = fromLabel.trim();
  if (!label) return { ok: false, error: "Enter a table to merge in." };

  const { data: dest } = await supabase
    .from("tabs")
    .select("id, status, table_label")
    .eq("id", tabId)
    .maybeSingle();
  if (!dest) return { ok: false, error: "Tab not found." };
  if (dest.status !== "open") return { ok: false, error: "This tab is closed." };
  if (dest.table_label === label) return { ok: false, error: "That's this table." };

  const src = await findOpenTab(supabase, label);
  if (!src) return { ok: false, error: `No open tab at Table ${label}.` };
  if (src.tabId === tabId) return { ok: false, error: "That's this table." };

  // Move the source rounds onto this tab, relabelled to this table.
  const { error: moveErr } = await supabase
    .from("orders")
    .update({ tab_id: tabId, table_label: dest.table_label })
    .eq("tab_id", src.tabId);
  if (moveErr) return { ok: false, error: "Couldn't merge the tables — please retry." };

  // Retire the source tab: merged, not paid. Clearing the token unbinds its
  // devices; merged_into records which bill it folded into.
  const { error: mergeErr } = await supabase
    .from("tabs")
    .update({
      status: "merged",
      merged_into: tabId,
      closed_at: new Date().toISOString(),
      session_token: null,
    })
    .eq("id", src.tabId)
    .eq("status", "open");
  if (mergeErr) return { ok: false, error: "Couldn't merge the tables — please retry." };

  return { ok: true };
}
