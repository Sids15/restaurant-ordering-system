/**
 * The manager's day view: every order taken on a given day, plus the tabs the
 * money sits in. Read-only and manager-gated (lib/auth/access.ts).
 *
 * Money is summed from non-cancelled orders only, matching how getOpenTabs
 * computes a running total — a cancelled round shows in the order list so the
 * manager can see it happened, but never in a figure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DayRange } from "./day";
import type { TabStatus } from "../types";
import { ASSIGNED_EMBED, selectTabs, type Assignee } from "./assign";

export interface DayOrder {
  code: string;
  table_label: string | null;
  status: string;
  source: string;
  subtotal: number;
  created_at: string;
}

export interface DayTab {
  id: string;
  table_label: string;
  status: TabStatus;
  opened_at: string;
  closed_at: string | null;
  order_count: number;
  subtotal: number;
  /** The server who worked this table, or null. */
  assigned: Assignee | null;
}

export interface DaySummary {
  orders: DayOrder[];
  /** Currently open, whenever they were opened — an overnight tab still needs
   *  chasing, so it belongs here even if it started yesterday. */
  openTabs: DayTab[];
  /** Tabs closed within the day. */
  closedTabs: DayTab[];
  totals: {
    orderCount: number;
    /** Non-cancelled order value taken during the day. */
    takings: number;
    cancelledCount: number;
    openValue: number;
    closedValue: number;
  };
}

const COUNTS_AS_MONEY = (status: string) => status !== "cancelled";

// Shared by the open and closed tab reads. The assignment embed drops out when
// 008_tab_assignment.sql hasn't been applied yet — see selectTabs().
const tabColumns = (withAssignment: boolean) =>
  "id, table_label, status, opened_at, closed_at, " +
  (withAssignment ? `${ASSIGNED_EMBED}, ` : "") +
  "orders ( subtotal, status )";

function tabRow(t: Record<string, unknown>): DayTab {
  const rounds = (t.orders as { subtotal: number; status: string }[] | null) ?? [];
  const billable = rounds.filter((o) => COUNTS_AS_MONEY(o.status));
  return {
    id: t.id as string,
    table_label: t.table_label as string,
    status: t.status as TabStatus,
    opened_at: t.opened_at as string,
    closed_at: (t.closed_at as string | null) ?? null,
    assigned: (t.assigned as Assignee | null) ?? null,
    order_count: billable.length,
    subtotal: billable.reduce((s, o) => s + Number(o.subtotal), 0),
  };
}

export async function getDaySummary(
  supabase: SupabaseClient,
  range: DayRange,
): Promise<DaySummary> {
  const from = range.start.toISOString();
  const to = range.end.toISOString();

  const [ordersRes, openRes, closedRes] = await Promise.all([
    supabase
      .from("orders")
      .select("code, table_label, status, source, subtotal, created_at")
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false }),
    selectTabs<Record<string, unknown>[]>((a) =>
      supabase
        .from("tabs")
        .select(tabColumns(a))
        .eq("status", "open")
        .order("opened_at", { ascending: true }),
    ),
    selectTabs<Record<string, unknown>[]>((a) =>
      supabase
        .from("tabs")
        .select(tabColumns(a))
        .eq("status", "closed")
        .gte("closed_at", from)
        .lt("closed_at", to)
        .order("closed_at", { ascending: false }),
    ),
  ]);

  const orders: DayOrder[] = (ordersRes.data ?? []).map((o) => ({
    code: o.code as string,
    table_label: (o.table_label as string | null) ?? null,
    status: o.status as string,
    source: o.source as string,
    subtotal: Number(o.subtotal),
    created_at: o.created_at as string,
  }));

  const openTabs = (openRes.data ?? []).map(tabRow);
  const closedTabs = (closedRes.data ?? []).map(tabRow);
  const billable = orders.filter((o) => COUNTS_AS_MONEY(o.status));

  return {
    orders,
    openTabs,
    closedTabs,
    totals: {
      orderCount: orders.length,
      takings: billable.reduce((s, o) => s + o.subtotal, 0),
      cancelledCount: orders.length - billable.length,
      openValue: openTabs.reduce((s, t) => s + t.subtotal, 0),
      closedValue: closedTabs.reduce((s, t) => s + t.subtotal, 0),
    },
  };
}
