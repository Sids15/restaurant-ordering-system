/**
 * Request-scoped Supabase client for SSR (pages, endpoints, middleware). Uses
 * the PUBLIC anon key but reads/writes the auth session from cookies via
 * @supabase/ssr, so an authenticated staff session flows through and RLS sees
 * the user's role (auth.uid() → current_role_name()).
 *
 * One per request — never a singleton (each request has its own cookies).
 */
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";
import { serverEnv } from "../env";

/**
 * Hardening for the Supabase auth cookies.
 *
 * @supabase/ssr's DEFAULT_COOKIE_OPTIONS are `{ httpOnly: false, sameSite:
 * "lax", maxAge: 400 days }` with no `secure` flag, and it force-restores its
 * own maxAge over anything passed as `cookieOptions`. Left alone that means the
 * staff access AND refresh tokens are readable by any JavaScript on the page —
 * one XSS is a full session takeover — sent in cleartext on a plain-HTTP
 * request, and valid on disk for over a year.
 *
 * Nothing in this app reads the session from the browser (there is no client
 * Supabase instance; every island talks to our own /api routes), so httpOnly
 * costs nothing. Applied in setAll(), which is the last word on the options.
 */
const AUTH_COOKIE_HARDENING = {
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: "lax" as const,
  // A shift, not a year. Supabase still refreshes the session while it's in
  // use; this only caps how long a stolen cookie survives on a shared tablet.
  maxAge: 60 * 60 * 12,
};

export function supabaseServer(ctx: {
  request: Request;
  cookies: AstroCookies;
}): SupabaseClient {
  return createServerClient(
    serverEnv(import.meta.env.SUPABASE_URL, "SUPABASE_URL"),
    serverEnv(import.meta.env.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return parseCookieHeader(ctx.request.headers.get("Cookie") ?? "").map(
            ({ name, value }) => ({ name, value: value ?? "" }),
          );
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            // A delete arrives as an empty value with maxAge 0 — don't hand it
            // a 12-hour lifetime and resurrect the cookie on sign-out.
            const expiring = options?.maxAge === 0 || value === "";
            ctx.cookies.set(name, value, {
              ...options,
              ...AUTH_COOKIE_HARDENING,
              ...(expiring ? { maxAge: 0 } : {}),
            });
          }
        },
      },
    },
  );
}
