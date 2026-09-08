/**
 * Tabs — a table session groups the rounds a table orders across one visit, so
 * the bill is collective while each round stays its own kitchen ticket. A table
 * has at most one open tab (enforced by a partial unique index); the second
 * round for that table joins it. Runs with whichever client the caller passes:
 * the service-role client from order creation, or the authenticated staff
 * client from the billing surfaces.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TabStatus } from "../types";
import { computeBill, type BillTotals } from "../billing";
import { ASSIGNED_EMBED, type Assignee } from "./assign";
import { selectOptional } from "../supabase/optional-columns";

const MIGRATION = "supabase/migrations/008_tab_assignment.sql";

export interface OpenTab {
  tabId: string;
  table_label: string;
  token: string;
}

/** A hard-to-guess session token for a device. 192 bits from a CSPRNG. */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * What gets STORED for a token. The guest's cookie holds the token; the
 * database only ever sees this, so a staff account reading the tables cannot
 * lift a live session (015_hash_session_tokens.sql).
 *
 * No salt, no stretching, deliberately: the token is already 192 bits of
 * randomness, so there is no dictionary to defend against, and a per-row salt
 * would make the single lookup-by-value every guest request performs
 * impossible. SHA-256 is right for proving possession of an unguessable secret;
 * it would be wrong for a password.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Bind one device to a tab and hand back its token, or null if it didn't take. */
async function bindDevice(
  supabase: SupabaseClient,
  tabId: string,
): Promise<string | null> {
  const token = generateSessionToken();
  const { error } = await supabase
    .from("tab_sessions")
    .insert({ tab_id: tabId, token_hash: hashSessionToken(token) });
  return error ? null : token;
}

/**
 * The open tab for a table — reusing the existing one or opening a fresh one —
 * and a session token for the device that asked. Null only when there's no
 * table (a standalone order). Race-safe on the one-open-tab-per-table index.
 *
 * Every caller gets its OWN token now, rather than being handed whatever token
 * the table already had. Two guests at one table each bind their own device to
 * the same tab, so they share a bill without sharing a credential — and the
 * second to scan no longer signs the first one out.
 */
export async function openOrJoinTab(
  supabase: SupabaseClient,
  tableLabel: string | null,
): Promise<OpenTab | null> {
  if (!tableLabel) return null;

  const existing = await findOpenTab(supabase, tableLabel);
  if (existing) {
    const token = await bindDevice(supabase, existing.tabId);
    return token ? { ...existing, token } : null;
  }

  const { data: created, error } = await supabase
    .from("tabs")
    .insert({ table_label: tableLabel, status: "open" })
    .select("id, table_label")
    .single();

  if (!error && created) {
    const tabId = created.id as string;
    const token = await bindDevice(supabase, tabId);
    return token
      ? { tabId, table_label: created.table_label as string, token }
      : null;
  }

  // 23505 = another round opened the tab first; join the winner.
  if ((error as { code?: string } | null)?.code === "23505") {
    const winner = await findOpenTab(supabase, tableLabel);
    if (!winner) return null;
    const token = await bindDevice(supabase, winner.tabId);
    return token ? { ...winner, token } : null;
  }
  return null;
}

/**
 * The open tab at a table, if any. Carries no token — tokens belong to devices
 * now, and handing back an existing guest's session is exactly the
 * impersonation 015 removes.
 */
async function findOpenTab(
  supabase: SupabaseClient,
  tableLabel: string,
): Promise<{ tabId: string; table_label: string } | null> {
  const { data } = await supabase
    .from("tabs")
    .select("id, table_label")
    .eq("table_label", tableLabel)
    .eq("status", "open")
    .maybeSingle();
  if (!data) return null;
  return { tabId: data.id as string, table_label: data.table_label as string };
}

/**
 * Unbind every device on a tab. Called when a tab stops being orderable — paid,
 * or merged away — so a settled table cannot keep sending rounds. The rows are
 * deleted rather than flagged: there is nothing worth keeping about a dead
 * credential, and ON DELETE CASCADE means a removed tab takes them anyway.
 */
async function unbindDevices(supabase: SupabaseClient, tabId: string): Promise<void> {
  await supabase.from("tab_sessions").delete().eq("tab_id", tabId);
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
  const { data, error } = await selectOptional<Record<string, unknown>[]>((withAssignment) =>
    supabase
      .from("tabs")
      .select(
        "id, table_label, opened_at, orders ( subtotal, status )" +
          (withAssignment ? `, ${ASSIGNED_EMBED}` : ""),
      )
      .eq("status", "open")
      .order("opened_at", { ascending: true }),
    MIGRATION,
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
  const { data, error } = await selectOptional<Record<string, unknown>>((withAssignment) =>
    supabase
      .from("tabs")
      .select(
        "id, table_label, status, opened_at, closed_at, " +
          (withAssignment ? `${ASSIGNED_EMBED}, ` : "") +
          "orders ( status, order_items ( name_snapshot, price_snapshot, qty ) )",
      )
      .eq("id", tabId)
      .maybeSingle(),
    MIGRATION,
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

  const { error } = await supabase
    .from("tabs")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: byUserId,
    })
    .eq("id", tabId)
    .eq("status", "open");

  if (error) return { ok: false, error: "Couldn't close the tab — please retry." };

  // Only after the tab is actually closed: unbinding first would leave a live
  // tab nobody could order on if the update then failed.
  await unbindDevices(supabase, tabId);
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

  // Retire the source tab: merged, not paid. merged_into records which bill it
  // folded into.
  const { error: mergeErr } = await supabase
    .from("tabs")
    .update({
      status: "merged",
      merged_into: tabId,
      closed_at: new Date().toISOString(),
    })
    .eq("id", src.tabId)
    .eq("status", "open");
  if (mergeErr) return { ok: false, error: "Couldn't merge the tables — please retry." };

  // The absorbed table's devices FOLLOW the bill. Their rounds moved to the
  // surviving tab, so their phones should too: merging two tables means the
  // guests keep ordering, now onto one bill. Kicking them off would make a
  // merge feel like a punishment for asking to pay together.
  await supabase.from('tab_sessions').update({ tab_id: tabId }).eq('tab_id', src.tabId);
  return { ok: true };
}
