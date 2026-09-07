/**
 * The manager's day view: every order taken on a given day, plus the tabs the
 * money sits in. Read-only and manager-gated (lib/auth/access.ts).
 *
 * Money is summed from non-cancelled orders only, matching how getOpenTabs
 * computes a running total — a cancelled round shows in the order list so the
 * manager can see it happened, but never in a figure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey, type DayRange } from "./day";
import type { TabStatus } from "../types";
import { ASSIGNED_EMBED, type Assignee } from "./assign";
import { selectOptional } from "../supabase/optional-columns";

export interface DayOrder {
  code: string;
  table_label: string | null;
  status: string;
  source: string;
  subtotal: number;
  created_at: string;
  /** Who voided it, for a cancelled order. Null on anything cancelled before
   *  009_cancellation_audit.sql, which has no author to attribute. */
  cancelled_by: Assignee | null;
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
  /** Opened before the day being viewed — a sitting carried over, not a new
   *  one. Only ever true on today, and only for tabs still open. */
  carried: boolean;
}

export interface DaySummary {
  orders: DayOrder[];
  /**
   * Open tabs belonging to this day: the ones opened during it. On today that
   * also includes anything still open from an earlier day (flagged `carried`),
   * because a tab nobody closed is live work no matter when it started.
   *
   * On a PAST day it must not: an unfiltered "currently open" read put tonight's
   * live tables into every historical day, so a quiet Thursday in September
   * showed two open tabs and 840 unbilled next to "No orders on this day".
   */
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

const TABS_MIGRATION = "supabase/migrations/008_tab_assignment.sql";
const ORDERS_MIGRATION = "supabase/migrations/009_cancellation_audit.sql";

// Shared by the open and closed tab reads. The assignment embed drops out when
// 008_tab_assignment.sql hasn't been applied yet — see selectOptional().
const tabColumns = (withAssignment: boolean) =>
  "id, table_label, status, opened_at, closed_at, " +
  (withAssignment ? `${ASSIGNED_EMBED}, ` : "") +
  "orders ( subtotal, status )";

function tabRow(t: Record<string, unknown>, dayStart?: Date): DayTab {
  const rounds = (t.orders as { subtotal: number; status: string }[] | null) ?? [];
  const billable = rounds.filter((o) => COUNTS_AS_MONEY(o.status));
  const openedAt = t.opened_at as string;
  return {
    carried: dayStart ? new Date(openedAt) < dayStart : false,
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

  // Today carries yesterday's stragglers; a past day is closed and shows only
  // what it actually held.
  const isToday = range.key === localDateKey();

  const [ordersRes, openRes, closedRes] = await Promise.all([
    selectOptional<Record<string, unknown>[]>(
      (withAuthor) =>
        supabase
          .from("orders")
          .select(
            "code, table_label, status, source, subtotal, created_at" +
              (withAuthor
                ? ", cancelled_by:profiles!orders_cancelled_by_fkey ( id, name, role )"
                : ""),
          )
          .gte("created_at", from)
          .lt("created_at", to)
          .order("created_at", { ascending: false }),
      ORDERS_MIGRATION,
    ),
    selectOptional<Record<string, unknown>[]>((a) => {
      const q = supabase.from("tabs").select(tabColumns(a)).eq("status", "open");
      return (isToday ? q : q.gte("opened_at", from).lt("opened_at", to)).order(
        "opened_at",
        { ascending: true },
      );
    }, TABS_MIGRATION),
    selectOptional<Record<string, unknown>[]>((a) =>
      supabase
        .from("tabs")
        .select(tabColumns(a))
        .eq("status", "closed")
        .gte("closed_at", from)
        .lt("closed_at", to)
        .order("closed_at", { ascending: false }),
      TABS_MIGRATION,
    ),
  ]);

  const orders: DayOrder[] = (ordersRes.data ?? []).map((o) => ({
    code: o.code as string,
    table_label: (o.table_label as string | null) ?? null,
    status: o.status as string,
    source: o.source as string,
    subtotal: Number(o.subtotal),
    created_at: o.created_at as string,
    cancelled_by: (o.cancelled_by as Assignee | null) ?? null,
  }));

  const openTabs = (openRes.data ?? []).map((t) => tabRow(t, range.start));
  const closedTabs = (closedRes.data ?? []).map((t) => tabRow(t));
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
