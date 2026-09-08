/**
 * KitchenBoard — the live kitchen queue island. One list of active orders; the
 * kitchen taps Complete to finish a ticket, which drops off the board. Updates
 * come from polling /api/staff/kitchen/active every few seconds (same shape the
 * server rendered), so the board never computes time itself — `waited_min`
 * arrives as data. That keeps SSR and hydration identical.
 */
import { useMemo, useState } from "react";
import { usePoll } from "./use-poll";
import "./kitchen-board.css";

interface KitchenLine {
  name: string;
  qty: number;
  notes: string | null;
}
interface KitchenOrderData {
  code: string;
  table_label: string | null;
  status: string;
  waited_min: number;
  notes: string | null;
  items: KitchenLine[];
}

const POLL_MS = 4000;

/* The board is one queue, not a set of columns. `complete()` sends a ticket
 * straight to `served`, so nothing ever entered Preparing or Ready — both
 * columns sat permanently empty, and an always-empty column is a label eating
 * half the screen. Tickets render oldest-first (the query orders by
 * confirmed_at), which is the order a kitchen actually works in.
 *
 * Every ACTIVE_STATUSES value still renders, so a ticket left in `preparing` or
 * `ready` by an earlier deploy stays visible and completable. */

/** "224m" is unreadable as elapsed time; a cook parses "3h 44m" instantly. */
function waited(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** How hard the wait should shout. The clock is the board's only urgency
 *  signal, so it earns colour rather than sitting in grey with everything else. */
function urgency(min: number): "ok" | "warn" | "late" {
  if (min >= 20) return "late";
  if (min >= 10) return "warn";
  return "ok";
}

/**
 * What a cook wants to narrow to mid-service. Deliberately few: a filter bar
 * you have to read is slower than the list it filters.
 *
 * "Late" uses the same 10-minute threshold the wait badge already shouts at, so
 * the filter and the colour cannot disagree about what late means.
 */
const FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "late", label: "Late", match: (o: KitchenOrderData) => urgency(o.waited_min) !== "ok" },
  { key: "new", label: "Just in", match: (o: KitchenOrderData) => o.waited_min < 5 },
  { key: "notes", label: "With notes", match: (o: KitchenOrderData) =>
      Boolean(o.notes) || o.items.some((i) => Boolean(i.notes)) },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default function KitchenBoard({
  initialOrders,
  canComplete = true,
}: {
  initialOrders: KitchenOrderData[];
  canComplete?: boolean;
}) {
  const [orders, setOrders] = useState<KitchenOrderData[]>(initialOrders);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>("all");

  // Poll the live queue. The server owns the truth; we just re-render it.
  // Throwing on a bad response is deliberate: usePoll backs off on failure, and
  // it can only do that if it hears about one.
  usePoll(
    async () => {
      const res = await fetch("/api/staff/kitchen/active", { cache: "no-store" });
      if (!res.ok) throw new Error(`kitchen board: ${res.status}`);
      const data = (await res.json()) as { orders?: KitchenOrderData[] };
      if (Array.isArray(data.orders)) setOrders(data.orders);
    },
    POLL_MS,
    { immediate: false }, // the board is server-rendered with its first batch
  );

  async function complete(code: string) {
    setBusy((s) => new Set(s).add(code));
    try {
      const res = await fetch(`/api/staff/kitchen/${code}`, { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean };
        // Optimistically drop it; the next poll reconciles.
        if (data.ok) setOrders((prev) => prev.filter((o) => o.code !== code));
      }
    } catch {
      /* ignore — the poll will reconcile */
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(code);
        return n;
      });
    }
  }

  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const f of FILTERS) out[f.key] = orders.filter(f.match).length;
    return out;
  }, [orders]);

  const shown = useMemo(
    () => orders.filter(FILTERS.find((f) => f.key === filter)!.match),
    [orders, filter],
  );

  if (orders.length === 0) {
    return (
      <p className="board__empty">
        No active orders. Confirmed orders land here as servers take them.
      </p>
    );
  }

  return (
    <section className="board">
      <div className="board__head">
        <span className="board__label">In the pass</span>
        <span className="board__count">{orders.length}</span>

        <div className="board__filters" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="board__filter"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {/* The count is the point: it shows there are late tickets
                  without making anyone switch filters to find out. */}
              {counts[f.key] > 0 && f.key !== "all" && (
                <span className="board__filter-n">{counts[f.key]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="board__empty">
          Nothing matches that filter. {orders.length} ticket
          {orders.length === 1 ? "" : "s"} still in the pass.
        </p>
      ) : (
      <div className="board__list">
        {shown.map((o) => (
                  <article key={o.code} className={`ticket ticket--${o.status}`}>
                    <div className="ticket__top">
                      <span className="ticket__ident">
                        <span className="ticket__table">
                          {o.table_label ? `Table ${o.table_label}` : "No table"}
                        </span>
                        <span className="ticket__code">{o.code}</span>
                      </span>
                      <span className="ticket__wait" data-urgency={urgency(o.waited_min)}>
                        {waited(o.waited_min)}
                      </span>
                    </div>
                    <ul className="ticket__items">
                      {o.items.map((it, idx) => (
                        <li key={idx} className="ticket__item">
                          <span className="ticket__qty">{it.qty}×</span>
                          <span className="ticket__name">
                            {it.name}
                            {it.notes && <span className="ticket__inote">{it.notes}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {o.notes && <p className="ticket__note">Note: {o.notes}</p>}
                    <div className="ticket__actions">
                      <a className="ticket__slip" href={`/staff/orders/${o.code}/slip`}>Print slip</a>
                      {canComplete && (
                        <button
                          type="button"
                          className="ticket__advance"
                          onClick={() => complete(o.code)}
                          disabled={busy.has(o.code)}
                        >
                          {busy.has(o.code) ? "…" : "Complete"}
                        </button>
                      )}
                    </div>
                  </article>
        ))}
      </div>
      )}
    </section>
  );
}
