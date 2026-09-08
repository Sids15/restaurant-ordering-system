/**
 * OrderStatus — the live status region on the tracking page. Owns just the
 * status banner: it polls GET /api/orders/<code> while the order is still
 * "waiting" and flips to "Order placed" the moment a server accepts it. Stops
 * polling once the order is placed or cancelled.
 */
import { useState } from "react";
import { usePoll } from "./use-poll";
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

  // Only "waiting" can still change from under us; once a server has accepted
  // or cancelled the order there is nothing left to poll for.
  const settled = state !== "waiting";
  usePoll(
    async () => {
      if (settled) return;
      const res = await fetch(`/api/orders/${code}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`order state: ${res.status}`);
      const data = (await res.json()) as { state?: CustomerOrderState };
      if (data.state && data.state !== state) setState(data.state);
    },
    POLL_MS,
    { immediate: false }, // the page is rendered with the state it starts in
  );

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
