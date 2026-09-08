import { useEffect, useRef } from "react";

/**
 * Poll while the tab is actually being looked at.
 *
 * Every island in this app refreshes on a timer, and every one of them was
 * polling forever — a guest's phone with the menu open in a background tab kept
 * asking every two seconds until the battery died. On a full floor that is the
 * dominant source of both serverless invocations and wasted battery, and none
 * of it changes a pixel anyone can see.
 *
 * So: the interval stops when the document is hidden, and a single fetch fires
 * the moment it comes back — which is also better UX than the old behaviour,
 * because a guest returning to the tab saw stale data until the next tick.
 *
 * On failure the delay doubles up to `maxDelay`. A restaurant's wifi drops, and
 * hammering a dead endpoint every two seconds neither helps nor recovers
 * faster; the interval resets to normal on the first success.
 */
export function usePoll(
  fetcher: () => Promise<void> | void,
  intervalMs: number,
  { immediate = true, maxDelay = 60_000 } = {},
): void {
  // Kept in a ref so a re-render with a new closure doesn't restart the timer:
  // the effect depends only on the interval, not on the caller's identity.
  const latest = useRef(fetcher);
  latest.current = fetcher;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = intervalMs;

    const visible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const run = async () => {
      if (!alive || !visible()) return;
      try {
        await latest.current();
        delay = intervalMs; // recovered
      } catch {
        // Back off, capped. The next attempt still happens.
        delay = Math.min(delay * 2, maxDelay);
      }
      schedule();
    };

    // setTimeout chained rather than setInterval: with setInterval a slow
    // response can stack calls on top of each other, and the backoff above
    // would have nothing to lengthen.
    const schedule = () => {
      if (!alive || !visible()) return;
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    };

    const onVisibility = () => {
      if (!alive) return;
      if (visible()) {
        delay = intervalMs; // a fresh look deserves a fresh try
        void run(); // catch up immediately, then resume the timer
      } else {
        clearTimeout(timer);
      }
    };

    if (immediate) void run();
    else schedule();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [intervalMs, immediate, maxDelay]);
}
