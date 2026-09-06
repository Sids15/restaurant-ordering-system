/**
 * OrderStatus — the live status region on the tracking page. Owns just the
 * status banner: it polls GET /api/orders/<code> while the order is still
 * "waiting" and flips to "Order placed" the moment a server accepts it. Stops
 * polling once the order is placed or cancelled.
 */
import { useEffect, useState } from "react";
import type { CustomerOrderState } from "../../lib/orders/track";

const POLL_MS = 4000;

/** `tone` selects the --status-* token pair (see src/pages/order/[code].astro's <style> block). */
const COPY: Record<CustomerOrderState, { title: string; note: string; tone: string }> = {
  waiting: {
    title: "Waiting for a server",
    note: "Show your code below to a server — they'll accept your order at the table.",
    tone: "pending",
  },
  placed: {
    title: "Order placed",
    note: "A server has accepted your order. It's on the way.",
    tone: "confirmed",
  },
  cancelled: {
    title: "Order cancelled",
    note: "This order was cancelled. Please speak to a server if that's unexpected.",
    tone: "cancelled",
  },
};

/** The two customer-visible milestones, in order — cancelled is a separate,
 * terminal state and isn't part of this line. */
const STEPS: { key: "waiting" | "placed"; label: string }[] = [
  { key: "waiting", label: "Order sent" },
  { key: "placed", label: "Confirmed" },
];

export default function OrderStatus({
  code,
  initialState,
}: {
  code: string;
  initialState: CustomerOrderState;
}) {
  const [state, setState] = useState<CustomerOrderState>(initialState);

  useEffect(() => {
    if (state !== "waiting") return;
    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${code}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { state?: CustomerOrderState };
        if (alive && data.state && data.state !== state) setState(data.state);
      } catch {
        /* transient network error — the next tick retries */
      }
    };

    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code, state]);

  const c = COPY[state];
  const stepIndex = state === "placed" ? 1 : 0;

  return (
    <div className="status" aria-live="polite">
      <div className={`status__chip status__chip--${c.tone}`}>
        <span className="status__dot" aria-hidden="true" />
        <span className="status__title">{c.title}</span>
      </div>
      <p className="status__note">{c.note}</p>

      {state !== "cancelled" && (
        <ol className="status__steps">
          {STEPS.map((step, i) => (
            <li
              key={step.key}
              className={i <= stepIndex ? "status__step is-done" : "status__step"}
            >
              <span className="status__step-dot" aria-hidden="true" />
              <span className="status__step-label">{step.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
