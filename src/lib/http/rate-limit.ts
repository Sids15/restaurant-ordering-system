/**
 * Best-effort in-memory rate limiter (fixed window).
 *
 * SCOPE + LIMITATION: this lives in the serverless function's memory, so each
 * warm instance has its own counters and a cold start resets them. That makes it
 * a real backstop against a single client hammering one instance (credential
 * stuffing, an order-flood script) — but NOT a distributed guarantee. For hard,
 * cross-instance limits move this to a shared store (Vercel KV / Upstash) keyed
 * the same way; the call sites here won't need to change.
 *
 * Deliberately NOT applied to the customer read-polls (/api/menu/availability
 * every 2s, /api/orders/<code> every 4s): a whole restaurant shares one NAT IP,
 * so a per-IP limit low enough to stop a scraper would also break legitimate
 * polling. Those are protected by token/code entropy instead.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (only meaningful when !ok). */
  retryAfterSec: number;
}

/**
 * Count one hit against `key`. Returns ok:false once `limit` hits land inside
 * `windowMs`. `key` should already namespace the action (e.g. "login:1.2.3.4").
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Opportunistic cleanup so the map can't grow without bound.
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

/** Best-effort client IP: the left-most X-Forwarded-For hop, else the socket. */
export function clientIp(request: Request, fallback?: string | null): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return fallback?.trim() || "unknown";
}
