/**
 * Analytics — what the owner needs to run the place, computed from the orders
 * and tabs already in the database. Read-only, manager-gated.
 *
 * Everything is derived from one paginated read of the period plus the same
 * read of the period immediately before it, so every figure on the page comes
 * from a single consistent snapshot and can be compared against its own past.
 *
 * WHY THE PAGINATION MATTERS: PostgREST answers with at most 1000 rows. A busy
 * month exceeds that, and a silently truncated read would under-report takings
 * while looking entirely plausible — the worst kind of wrong for a number
 * someone makes staffing and menu decisions on. So reads page until exhausted.
 *
 * Cancelled rounds never count toward money, matching the day view; they are
 * reported separately, because who voids what is its own signal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey, type Period } from "./day";
import { selectOptional } from "../supabase/optional-columns";

const PAGE = 1000;
const COUNTS_AS_MONEY = (status: string) => status !== "cancelled";
const AUTHOR_EMBED = "cancelled_by:profiles!orders_cancelled_by_fkey ( id, name, role )";
const MIGRATION = "supabase/migrations/009_cancellation_audit.sql";

interface RawItem {
  menu_item_id: string | null;
  name_snapshot: string;
  price_snapshot: number;
  qty: number;
}
interface RawOrder {
  status: string;
  source: string;
  subtotal: number;
  created_at: string;
  confirmed_at: string | null;
  tab_id: string | null;
  table_label: string | null;
  cancelled_by?: { id: string; name: string; role: string } | null;
  order_items: RawItem[] | null;
}

// --- Shapes the page renders -------------------------------------------------

export interface Headline {
  takings: number;
  orders: number;
  /** Average order value. */
  aov: number;
  /** Tables seated — one tab is one sitting. */
  tables: number;
  /** Average spend across a whole sitting, which is the number that matters
   *  more than order value when guests order in rounds. */
  perTable: number;
  voids: number;
  /** Voided rounds as a share of all rounds, 0–1. */
  voidRate: number;
}

export interface Point {
  key: string;
  label: string;
  takings: number;
  orders: number;
}

export interface DishRow {
  name: string;
  qty: number;
  revenue: number;
  /** Share of total dish revenue, 0–1. */
  share: number;
}

export interface NamedTotal {
  name: string;
  count: number;
  value: number;
}

export interface Analytics {
  headline: Headline;
  /** The same headline for the period immediately before, for comparison. */
  previous: Headline;
  daily: Point[];
  byHour: Point[];
  byWeekday: Point[];
  dishes: DishRow[];
  /** Sold at least once, but least of all — menu-pruning candidates. */
  slow: DishRow[];
  categories: DishRow[];
  vegMix: DishRow[];
  /** How orders arrived: scanned by a guest, or built by a server. */
  source: { guest: number; server: number };
  /** Rounds per sitting — the upselling signal. */
  roundsPerTab: number;
  servers: NamedTotal[];
  tables: NamedTotal[];
  voidsBy: NamedTotal[];
  /** Median minutes from an order arriving to a server accepting it. */
  confirmMedian: number | null;
  /** Median minutes a table stays open — the turn time. */
  tabMedian: number | null;
  /** True when a read hit its ceiling and figures may be partial. */
  truncated: boolean;
}

// --- Reading -----------------------------------------------------------------

/**
 * Keep asking for the next page until one comes back short.
 *
 * `from` is the row index to start at, so the caller decides where paging
 * begins. An error mid-way is reported as truncated rather than swallowed —
 * a partial total presented as a complete one is the failure to avoid here.
 */
async function fetchPages<T>(
  first: number,
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let i = 0; i < 50; i++) {
    const from = first + i * PAGE;
    const { data, error } = await run(from, from + PAGE - 1);
    if (error || !data) return { rows, truncated: true };
    rows.push(...data);
    if (data.length < PAGE) return { rows, truncated: false };
  }
  // 50k rows in one period. Say so rather than quietly rounding a year down.
  return { rows, truncated: true };
}

async function readOrders(
  supabase: SupabaseClient,
  period: Period,
): Promise<{ rows: RawOrder[]; truncated: boolean }> {
  const from = period.start.toISOString();
  const to = period.end.toISOString();
  const columns = (withAuthor: boolean) =>
    "status, source, subtotal, created_at, confirmed_at, tab_id, table_label, " +
    (withAuthor ? `${AUTHOR_EMBED}, ` : "") +
    "order_items ( menu_item_id, name_snapshot, price_snapshot, qty )";

  // Settle once whether the author column exists, then page with that answer.
  const probe = await selectOptional<RawOrder[]>(
    (withAuthor) =>
      supabase
        .from("orders")
        .select(columns(withAuthor))
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: true })
        .range(0, PAGE - 1),
    MIGRATION,
  );
  const withAuthor = (probe.data ?? []).some((o) => "cancelled_by" in o);
  const first = probe.data ?? [];
  if (first.length < PAGE) return { rows: first, truncated: false };

  const rest = await fetchPages<RawOrder>(PAGE, (a, b) =>
    supabase
      .from("orders")
      .select(columns(withAuthor))
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true })
      .range(a, b),
  );
  return { rows: [...first, ...rest.rows], truncated: rest.truncated };
}

// --- Small helpers -----------------------------------------------------------

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const div = (a: number, b: number) => (b === 0 ? 0 : a / b);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Accumulate into a keyed bucket. */
function bucket<T>(map: Map<string, T>, key: string, seed: T, apply: (v: T) => void): void {
  const v = map.get(key) ?? seed;
  apply(v);
  map.set(key, v);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Hour and weekday IN THE RESTAURANT'S ZONE — the server runs UTC, and a peak
 *  hour computed there would be 5:30 out for an Indian restaurant. */
function localParts(iso: string, timeZone: string): { hour: number; weekday: number; key: string } {
  const at = new Date(iso);
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(at)) p[type] = value;
  const hour = Number(p.hour === "24" ? "0" : p.hour);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { hour, weekday, key: localDateKey(at, timeZone) };
}

function headlineOf(orders: RawOrder[], tabCount: number): Headline {
  const billable = orders.filter((o) => COUNTS_AS_MONEY(o.status));
  const takings = sum(billable.map((o) => Number(o.subtotal)));
  const voids = orders.length - billable.length;
  return {
    takings,
    orders: billable.length,
    aov: div(takings, billable.length),
    tables: tabCount,
    perTable: div(takings, tabCount),
    voids,
    voidRate: div(voids, orders.length),
  };
}

/** Rank a keyed tally into rows with a share of the whole. */
function rank(map: Map<string, { qty: number; revenue: number }>, limit?: number): DishRow[] {
  const total = sum([...map.values()].map((v) => v.revenue));
  const rows = [...map.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue, share: div(v.revenue, total) }))
    .sort((a, b) => b.revenue - a.revenue);
  return limit ? rows.slice(0, limit) : rows;
}

// --- The one call the page makes ---------------------------------------------

export async function getAnalytics(
  supabase: SupabaseClient,
  period: Period,
  previous: Period,
  timeZone: string,
): Promise<Analytics> {
  const [current, prior, menu, tabs, priorTabs] = await Promise.all([
    readOrders(supabase, period),
    readOrders(supabase, previous),
    supabase.from("menu_items").select("id, veg_type, menu_categories ( name )"),
    readTabs(supabase, period),
    readTabs(supabase, previous),
  ]);

  const orders = current.rows;
  const billable = orders.filter((o) => COUNTS_AS_MONEY(o.status));

  // menu_item_id → its category and diet, for the mix breakdowns. A dish
  // deleted since the order was placed has a null id; its snapshot name still
  // counts toward dish totals, just not toward a category.
  const itemMeta = new Map<string, { category: string; veg: string }>();
  for (const m of (menu.data ?? []) as {
    id: string;
    veg_type: string;
    menu_categories: { name: string } | null;
  }[]) {
    itemMeta.set(m.id, { category: m.menu_categories?.name ?? "Uncategorised", veg: m.veg_type });
  }

  // --- Time series ---
  const daily = new Map<string, { qty: number; revenue: number }>();
  const hours = new Map<string, { qty: number; revenue: number }>();
  const weekdays = new Map<string, { qty: number; revenue: number }>();
  for (const o of billable) {
    const { hour, weekday, key } = localParts(o.created_at, timeZone);
    const money = Number(o.subtotal);
    const add = (m: Map<string, { qty: number; revenue: number }>, k: string) =>
      bucket(m, k, { qty: 0, revenue: 0 }, (v) => {
        v.qty += 1;
        v.revenue += money;
      });
    add(daily, key);
    add(hours, String(hour));
    add(weekdays, String(weekday));
  }

  // --- Dishes, categories, diet mix ---
  const dishes = new Map<string, { qty: number; revenue: number }>();
  const categories = new Map<string, { qty: number; revenue: number }>();
  const veg = new Map<string, { qty: number; revenue: number }>();
  for (const o of billable) {
    for (const i of o.order_items ?? []) {
      const line = Number(i.price_snapshot) * i.qty;
      bucket(dishes, i.name_snapshot, { qty: 0, revenue: 0 }, (v) => {
        v.qty += i.qty;
        v.revenue += line;
      });
      const meta = i.menu_item_id ? itemMeta.get(i.menu_item_id) : undefined;
      bucket(categories, meta?.category ?? "Uncategorised", { qty: 0, revenue: 0 }, (v) => {
        v.qty += i.qty;
        v.revenue += line;
      });
      bucket(veg, VEG_LABEL[meta?.veg ?? "unknown"] ?? "Unspecified", { qty: 0, revenue: 0 }, (v) => {
        v.qty += i.qty;
        v.revenue += line;
      });
    }
  }

  // --- Service ---
  const tables = new Map<string, { qty: number; revenue: number }>();
  for (const o of billable) {
    if (!o.table_label) continue;
    bucket(tables, o.table_label, { qty: 0, revenue: 0 }, (v) => {
      v.qty += 1;
      v.revenue += Number(o.subtotal);
    });
  }

  const takingsByTab = new Map<string, number>();
  for (const o of billable) {
    if (!o.tab_id) continue;
    takingsByTab.set(o.tab_id, (takingsByTab.get(o.tab_id) ?? 0) + Number(o.subtotal));
  }
  const servers = new Map<string, { qty: number; revenue: number }>();
  for (const t of tabs.rows) {
    if (!t.assigned) continue;
    const name = (t.assigned.name ?? "").trim() || t.assigned.role;
    bucket(servers, name, { qty: 0, revenue: 0 }, (v) => {
      v.qty += 1;
      v.revenue += takingsByTab.get(t.id) ?? 0;
    });
  }

  const voidsBy = new Map<string, { qty: number; revenue: number }>();
  for (const o of orders) {
    if (COUNTS_AS_MONEY(o.status)) continue;
    const who = o.cancelled_by;
    const name = who ? (who.name ?? "").trim() || who.role : "Not recorded";
    bucket(voidsBy, name, { qty: 0, revenue: 0 }, (v) => {
      v.qty += 1;
      v.revenue += Number(o.subtotal);
    });
  }

  const confirmMins = billable
    .filter((o) => o.confirmed_at)
    .map((o) => (new Date(o.confirmed_at!).getTime() - new Date(o.created_at).getTime()) / 60000)
    .filter((m) => m >= 0 && m < 60 * 12);
  const tabMins = tabs.rows
    .filter((t) => t.closed_at)
    .map((t) => (new Date(t.closed_at!).getTime() - new Date(t.opened_at).getTime()) / 60000)
    .filter((m) => m >= 0 && m < 60 * 24);

  const dishRows = rank(dishes);
  const tabCount = tabs.rows.length;

  return {
    headline: headlineOf(orders, tabCount),
    previous: headlineOf(prior.rows, priorTabs.rows.length),
    daily: [...daily.entries()]
      .map(([key, v]) => ({ key, label: key, takings: v.revenue, orders: v.qty }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
    byHour: Array.from({ length: 24 }, (_, h) => ({
      key: String(h),
      label: `${String(h).padStart(2, "0")}:00`,
      takings: hours.get(String(h))?.revenue ?? 0,
      orders: hours.get(String(h))?.qty ?? 0,
    })),
    // Monday first, matching the calendar and how a restaurant reads its week.
    byWeekday: [1, 2, 3, 4, 5, 6, 0].map((d) => ({
      key: String(d),
      label: WEEKDAYS[d],
      takings: weekdays.get(String(d))?.revenue ?? 0,
      orders: weekdays.get(String(d))?.qty ?? 0,
    })),
    dishes: dishRows.slice(0, 10),
    slow: [...dishRows].reverse().slice(0, 5),
    categories: rank(categories),
    vegMix: rank(veg),
    source: {
      guest: billable.filter((o) => o.source === "customer").length,
      server: billable.filter((o) => o.source !== "customer").length,
    },
    roundsPerTab: div(billable.filter((o) => o.tab_id).length, takingsByTab.size),
    servers: rank(servers).map((r) => ({ name: r.name, count: r.qty, value: r.revenue })),
    tables: rank(tables, 8).map((r) => ({ name: r.name, count: r.qty, value: r.revenue })),
    voidsBy: rank(voidsBy).map((r) => ({ name: r.name, count: r.qty, value: r.revenue })),
    confirmMedian: median(confirmMins),
    tabMedian: median(tabMins),
    truncated: current.truncated || prior.truncated,
  };
}

const VEG_LABEL: Record<string, string> = {
  veg: "Vegetarian",
  non_veg: "Non-vegetarian",
  egg: "Contains egg",
};

interface RawTab {
  id: string;
  opened_at: string;
  closed_at: string | null;
  assigned?: { id: string; name: string; role: string } | null;
}

async function readTabs(
  supabase: SupabaseClient,
  period: Period,
): Promise<{ rows: RawTab[]; truncated: boolean }> {
  const from = period.start.toISOString();
  const to = period.end.toISOString();
  const res = await selectOptional<RawTab[]>(
    (withAssignment) =>
      supabase
        .from("tabs")
        .select(
          "id, opened_at, closed_at" +
            (withAssignment ? ", assigned:profiles!tabs_assigned_to_fkey ( id, name, role )" : ""),
        )
        .gte("opened_at", from)
        .lt("opened_at", to)
        .range(0, PAGE - 1),
    "supabase/migrations/008_tab_assignment.sql",
  );
  const rows = res.data ?? [];
  return { rows, truncated: rows.length >= PAGE };
}
