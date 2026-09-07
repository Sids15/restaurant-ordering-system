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

/**
 * The client IP, preferring headers the platform controls over ones the client
 * can influence.
 *
 * `x-forwarded-for` is a request header like any other: a caller can send their
 * own, and whether the edge overwrites or prepends to it is a property of the
 * deployment, not something this code can rely on. Keying a login throttle off
 * a value the attacker may set gives them a fresh bucket per request and no
 * throttle at all — so it is the LAST resort here, not the first.
 *
 * `x-vercel-forwarded-for` and `x-real-ip` are set by Vercel's proxy and are not
 * forwarded from the client, so they are trusted first. Astro's `clientAddress`
 * is itself derived from x-forwarded-for on this adapter, hence it ranks with
 * that rather than above it.
 */
const IP_SHAPED = /^[0-9a-fA-F.:]{3,45}$/;

function firstHop(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first && IP_SHAPED.test(first) ? first : null;
}

export function clientIp(request: Request, fallback?: string | null): string {
  return (
    firstHop(request.headers.get("x-vercel-forwarded-for")) ??
    firstHop(request.headers.get("x-real-ip")) ??
    firstHop(request.headers.get("x-forwarded-for")) ??
    (fallback?.trim() || "unknown")
  );
}
