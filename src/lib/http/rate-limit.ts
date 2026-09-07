/**
 * Rate limiting, shared across instances when a store is configured.
 *
 * Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or the KV_REST_API_*
 * pair Vercel's marketplace integration injects) and every instance counts
 * against one window, which is what makes a login throttle actually hold.
 * Without them it falls back to per-instance memory: still a real backstop
 * against one client hammering one instance, but a warm pool multiplies the
 * effective limit by the number of instances and a cold start resets it.
 *
 * The store is never allowed to break sign-in. A missing config, a timeout or
 * an error falls through to the in-memory counter rather than locking staff out
 * of their own console mid-service.
 *
 * Deliberately NOT applied to the customer read-polls (/api/menu/availability
 * every 2s, /api/orders/<code> every 4s): a whole restaurant shares one NAT IP,
 * so a per-IP limit low enough to stop a scraper would also break legitimate
 * polling. Those are protected by token/code entropy instead.
 */
import { optionalRuntimeSecret } from "../env";

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

// --- Shared window (Upstash REST; no dependency, just fetch) -----------------

/** Read at call time, never named via import.meta.env — see lib/env.ts. */
function store(): { url: string; token: string } | null {
  const url = optionalRuntimeSecret("UPSTASH_REDIS_REST_URL") ?? optionalRuntimeSecret("KV_REST_API_URL");
  const token =
    optionalRuntimeSecret("UPSTASH_REDIS_REST_TOKEN") ?? optionalRuntimeSecret("KV_REST_API_TOKEN");
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

/** True when counters are shared across instances rather than per-instance. */
export function rateLimitIsShared(): boolean {
  return store() !== null;
}

/**
 * Count one hit against `key` in the shared window, falling back to the
 * in-memory counter when no store is configured or the store doesn't answer.
 *
 * INCR then PEXPIRE ... NX sets the TTL only on the first hit of a window, so
 * the window is fixed rather than sliding forward with every request — an
 * attacker can't hold a bucket open by continuing to knock.
 */
export async function rateLimitShared(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const s = store();
  if (!s) return rateLimit(key, limit, windowMs);

  try {
    const res = await fetch(`${s.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
        ["PTTL", key],
      ]),
      // A slow store must not become a slow login.
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) throw new Error(`store responded ${res.status}`);

    const [incr, , pttl] = (await res.json()) as { result: number }[];
    const count = Number(incr?.result);
    if (!Number.isFinite(count)) throw new Error("unreadable store response");

    const ttlMs = Number(pttl?.result);
    return {
      ok: count <= limit,
      retryAfterSec: Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000)),
    };
  } catch (err) {
    // Fail over, never fail shut: a store outage must not lock staff out.
    console.warn("[rate-limit] shared store unavailable, using in-memory:", err);
    return rateLimit(key, limit, windowMs);
  }
}
