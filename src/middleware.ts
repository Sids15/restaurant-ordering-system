import { defineMiddleware } from "astro:middleware";
import { supabaseServer } from "./lib/supabase/server";
import { loadStaff } from "./lib/auth/session";
import { roleCanAccess } from "./lib/auth/access";
import { rateLimit, clientIp } from "./lib/http/rate-limit";

/**
 * Guards the staff-facing surfaces. Every request gets a request-scoped Supabase
 * client on `locals`. For paths that need a staff session (the protected pages
 * and the staff/logout APIs) we verify the session and load the profile:
 *   • protected *pages* with no valid staff session → redirect to the login page
 *   • protected *APIs* → left for the endpoint to 401/403 via requireStaff()
 * Marketing and customer routes stay open and skip the auth round-trip.
 */
const PROTECTED = ["/staff", "/kitchen", "/admin"];
const PUBLIC_WITHIN = ["/staff/login"];
const SESSION_APIS = ["/api/staff", "/api/admin", "/api/auth/logout"];

const underAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p + "/"));

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // --- Rate limiting (best-effort; see lib/http/rate-limit.ts) --------------
  // Only the two endpoints where a per-IP limit is a clear win and won't catch
  // legitimate NAT-shared traffic: staff login (credential stuffing) and
  // customer order creation (flood). Read-polls are intentionally excluded.
  if (context.request.method === "POST") {
    const ip = clientIp(context.request, context.clientAddress);
    if (pathname === "/api/auth/login") {
      const rl = rateLimit(`login:${ip}`, 10, 5 * 60_000);
      if (!rl.ok) {
        return context.redirect("/staff/login?error=throttled", 303);
      }
    } else if (pathname === "/api/orders") {
      const rl = rateLimit(`orders:${ip}`, 30, 60_000);
      if (!rl.ok) {
        return new Response(
          JSON.stringify({ error: "Too many orders too quickly — please wait a moment." }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(rl.retryAfterSec),
            },
          },
        );
      }
    }
  }

  // Create the request-scoped client LAZILY — only when a route actually reads
  // locals.supabase. Middleware runs during prerendering too, and the static
  // marketing pages never touch Supabase; an eager client would force the build
  // to have the keys (which aren't present at build on Vercel) and crash the
  // prerender. Lazy means the keys are needed only at runtime, where they are.
  let supabase: ReturnType<typeof supabaseServer> | null = null;
  Object.defineProperty(context.locals, "supabase", {
    configurable: true,
    enumerable: true,
    get() {
      if (!supabase) supabase = supabaseServer(context);
      return supabase;
    },
  });
  context.locals.user = null;
  context.locals.profile = null;

  const protectedPage =
    underAny(pathname, PROTECTED) && !PUBLIC_WITHIN.includes(pathname);
  const sessionApi = underAny(pathname, SESSION_APIS);

  if (protectedPage || sessionApi) {
    // Reading locals.supabase here fires the lazy getter, creating the client
    // (these routes are server-rendered, so the keys exist at runtime).
    const { user, profile } = await loadStaff(context.locals.supabase);
    context.locals.user = user;
    context.locals.profile = profile;

    // Pages redirect to login; APIs fall through and answer with JSON 401/403.
    if (protectedPage && !profile) {
      const next = encodeURIComponent(pathname + context.url.search);
      return context.redirect(`/staff/login?next=${next}`, 302);
    }

    // Wrong role for this surface → back to login. Switching between the kitchen
    // and the order desk means signing in with the other account.
    if (protectedPage && profile && !roleCanAccess(pathname, profile.role)) {
      const next = encodeURIComponent(pathname + context.url.search);
      return context.redirect(`/staff/login?next=${next}`, 302);
    }
  }

  return next();
});
