import { defineMiddleware } from "astro:middleware";
import { supabaseServer } from "./lib/supabase/server";
import { loadStaff } from "./lib/auth/session";
import { pathAllowed } from "./lib/auth/access";
import { rateLimitShared, clientIp } from "./lib/http/rate-limit";

/**
 * Guards the staff-facing surfaces. Every request gets a request-scoped Supabase
 * client on `locals`. For paths that need a staff session (the protected pages
 * and the staff/logout APIs) we verify the session and load the profile:
 *   • protected *pages* with no valid staff session → redirect to the login page
 *   • protected *APIs* → left for the endpoint to 401/403 via requireStaff()
 * Customer routes (the menu / ordering flow) stay open and skip the auth round-trip.
 */
const PROTECTED = ["/staff", "/kitchen", "/admin"];
const PUBLIC_WITHIN = ["/staff/login"];
const SESSION_APIS = ["/api/staff", "/api/admin", "/api/auth/logout"];

const underAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p + "/"));

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // --- The image endpoint, which this app has no use for ---------------------
  // Astro routes /_image whether or not anything renders an image, and there is
  // not one <img>, <Image> or getImage() in this codebase. Astro 7.2.4 shipped
  // a critical RCE in that path (GHSA-26w7-cxv4-gfx2, AVIF decoding); the
  // upgrade fixed that particular bug, and this makes the next one in an image
  // decoder not our problem.
  //
  // Setting the image service to noop is not enough on its own — it stops the
  // transform but still answers on the route — so the refusal lives here, which
  // is the only way into the render function.
  //
  // IF THIS APP EVER SHOWS DISH PHOTOGRAPHY: delete this block, and drop the
  // `service` line in astro.config.mjs.
  if (pathname === "/_image" || pathname.startsWith("/_image/")) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // --- Rate limiting (best-effort; see lib/http/rate-limit.ts) --------------
  // Only the two endpoints where a per-IP limit is a clear win and won't catch
  // legitimate NAT-shared traffic: staff login (credential stuffing) and
  // customer order creation (flood). Read-polls are intentionally excluded.
  if (context.request.method === "POST") {
    const ip = clientIp(context.request, context.clientAddress);
    if (pathname === "/api/auth/login") {
      const rl = await rateLimitShared(`login:${ip}`, 10, 5 * 60_000);
      if (!rl.ok) {
        return context.redirect("/staff/login?error=throttled", 303);
      }
    } else if (pathname === "/api/orders") {
      const rl = await rateLimitShared(`orders:${ip}`, 30, 60_000);
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
  // locals.supabase. An eager client would force the build to have the keys
  // (which aren't present at build on Vercel) and crash any prerender/build-time
  // pass. Lazy means the keys are needed only at runtime, where they are.
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
  context.locals.grants = null;

  const protectedPage =
    underAny(pathname, PROTECTED) && !PUBLIC_WITHIN.includes(pathname);
  const sessionApi = underAny(pathname, SESSION_APIS);

  if (protectedPage || sessionApi) {
    // Reading locals.supabase here fires the lazy getter, creating the client
    // (these routes are server-rendered, so the keys exist at runtime).
    const { user, profile, grants } = await loadStaff(context.locals.supabase);
    context.locals.user = user;
    context.locals.profile = profile;
    context.locals.grants = grants;

    // Pages redirect to login; APIs fall through and answer with JSON 401/403.
    if (protectedPage && !profile) {
      const next = encodeURIComponent(pathname + context.url.search);
      return context.redirect(`/staff/login?next=${next}`, 302);
    }

    // The account exists but hasn't been granted this surface. Back to login,
    // where they can sign in with an account that has it — switching between
    // the kitchen and the order desk still means switching accounts.
    if (protectedPage && profile && !pathAllowed(pathname, grants)) {
      const next = encodeURIComponent(pathname + context.url.search);
      return context.redirect(`/staff/login?next=${next}`, 302);
    }
  }

  const response = await next();
  return withSecurityHeaders(response);
});

/**
 * Response hardening. None of this was set before, so the staff console could
 * be framed by any site (clickjacking a Cancel or Close-tab button), and a
 * single injected string had no second line of defence.
 *
 * script-src keeps 'unsafe-inline' because Astro emits its island-hydration
 * runtime as inline <script> blocks; removing it would break every interactive
 * surface. Everything else is locked down, which still blocks the useful half:
 * no third-party script origins, no <base> rewriting, no plugins, no framing,
 * and forms can only post back to us.
 */
function withSecurityHeaders(response: Response): Response {
  const h = response.headers;

  // Only meaningful on HTML; skip JSON and asset responses.
  if (h.get("content-type")?.includes("text/html")) {
    h.set(
      "content-security-policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
      ].join("; "),
    );
  }

  h.set("x-frame-options", "DENY");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (import.meta.env.PROD) {
    h.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  }
  return response;
}
