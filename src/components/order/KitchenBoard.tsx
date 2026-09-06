/**
 * KitchenBoard — the live kitchen queue island. One list of active orders; the
 * kitchen taps Complete to finish a ticket, which drops off the board. Updates
 * come from polling /api/staff/kitchen/active every few seconds (same shape the
 * server rendered), so the board never computes time itself — `waited_min`
 * arrives as data. That keeps SSR and hydration identical.
 */
import { useEffect, useState } from "react";
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

/** Board columns, left to right — mirrors ACTIVE_STATUSES order in
 * lib/orders/kitchen.ts. Purely a display grouping over `order.status`;
 * the data and the single-step complete() action are unchanged. */
const COLUMNS: { key: string; label: string }[] = [
  { key: "confirmed", label: "New" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
];

export default function KitchenBoard({
  initialOrders,
  canComplete = true,
}: {
  initialOrders: KitchenOrderData[];
  canComplete?: boolean;
}) {
  const [orders, setOrders] = useState<KitchenOrderData[]>(initialOrders);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  // Poll the live queue. The server owns the truth; we just re-render it.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/staff/kitchen/active", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { orders?: KitchenOrderData[] };
        if (alive && Array.isArray(data.orders)) setOrders(data.orders);
      } catch {
        /* transient — the next tick retries */
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

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

  if (orders.length === 0) {
    return (
      <p className="board__empty">
        No active orders. Confirmed orders land here as servers take them.
      </p>
    );
  }

  return (
    <div className="board__cols">
      {COLUMNS.map((col) => {
        const colOrders = orders.filter((o) => o.status === col.key);
        return (
          <div key={col.key} className="board__col">
            <div className="board__col-head" data-status={col.key}>
              <span className="board__col-label">{col.label}</span>
              <span className="board__col-count">{colOrders.length}</span>
            </div>
            {colOrders.length === 0 ? (
              <p className="board__col-empty">No tickets.</p>
            ) : (
              <div className="board__col-list">
                {colOrders.map((o) => (
                  <article key={o.code} className={`ticket ticket--${o.status}`}>
                    <div className="ticket__top">
                      <span className="ticket__code">{o.code}</span>
                      <span className="ticket__meta">
                        {o.table_label ? `Table ${o.table_label}` : "No table"} · {o.waited_min}m
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
          </div>
        );
      })}
    </div>
  );
}
