/**
 * PendingQueue — the server notification. A live list of orders waiting to be
 * confirmed, so a server can see the table and walk over. Polls
 * /api/staff/orders/pending every few seconds and badges the browser-tab title
 * with the count. Confirm/Cancel act inline via fetch (JSON), then the row
 * leaves the list; the next poll reconciles with the truth.
 *
 * No clock math in render — `waited_min` arrives as data, so SSR and hydration
 * are identical.
 */
import { useEffect, useState } from "react";
import { usePoll } from "./use-poll";
import { formatINR } from "../../lib/money";
import { brand } from "../../data/brand";
import "./pending-queue.css";

interface PendingLine {
  name: string;
  qty: number;
  notes: string | null;
}
interface PendingOrderData {
  code: string;
  table_label: string | null;
  waited_min: number;
  subtotal: number;
  items: PendingLine[];
}

const POLL_MS = 4000;
const BASE_TITLE = `Staff console — ${brand.name}`;

export default function PendingQueue({
  initialOrders,
}: {
  initialOrders: PendingOrderData[];
}) {
  const [orders, setOrders] = useState<PendingOrderData[]>(initialOrders);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  usePoll(
    async () => {
      const res = await fetch("/api/staff/orders/pending", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`pending queue: ${res.status}`);
      const data = (await res.json()) as { orders?: PendingOrderData[] };
      if (Array.isArray(data.orders)) setOrders(data.orders);
    },
    POLL_MS,
    { immediate: false }, // the desk is server-rendered with its first batch
  );

  // Badge the tab title so a background console still signals waiting orders.
  useEffect(() => {
    document.title = orders.length ? `(${orders.length}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [orders.length]);

  async function act(code: string, action: "confirm" | "cancel") {
    setBusy((s) => new Set(s).add(code));
    try {
      const res = await fetch(`/api/staff/orders/${code}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ action }),
      });
      if (res.ok) setOrders((prev) => prev.filter((o) => o.code !== code));
    } catch {
      /* ignore — the poll reconciles */
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
      <section className="pending pending--empty" aria-label="Orders waiting to be confirmed">
        <p>No orders waiting. New orders appear here as customers place them.</p>
      </section>
    );
  }

  return (
    <section className="pending" aria-label="Orders waiting to be confirmed">
      <header className="pending__head">
        <h2 className="pending__title h-label">Waiting to confirm</h2>
        <span className="pending__count">{orders.length}</span>
      </header>
      <ul className="pending__list">
        {orders.map((o) => (
          <li key={o.code} className="pcard">
            <div className="pcard__top">
              <div>
                <span className="pcard__table">
                  {o.table_label ? `Table ${o.table_label}` : "No table"}
                </span>
                <span className="pcard__code">{o.code}</span>
              </div>
              <span className="pcard__chip">
                <span className="pcard__dot" aria-hidden="true" />
                {o.waited_min}m
              </span>
            </div>
            <ul className="pcard__items">
              {o.items.map((it, idx) => (
                <li key={idx} className="pcard__item">
                  <span className="pcard__qty">{it.qty}×</span>
                  <span className="pcard__name">
                    {it.name}
                    {it.notes && <span className="pcard__inote"> — {it.notes}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="pcard__foot">
              <span className="pcard__total">{formatINR(o.subtotal)}</span>
              <div className="pcard__actions">
                <button
                  type="button"
                  className="pcard__cancel"
                  onClick={() => act(o.code, "cancel")}
                  disabled={busy.has(o.code)}
                  aria-label={`Cancel order ${o.code}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pcard__confirm"
                  onClick={() => act(o.code, "confirm")}
                  disabled={busy.has(o.code)}
                  aria-label={`Confirm order ${o.code}`}
                >
                  Confirm
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
