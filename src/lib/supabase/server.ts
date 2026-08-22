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

export function supabaseServer(ctx: {
  request: Request;
  cookies: AstroCookies;
}): SupabaseClient {
  return createServerClient(
    serverEnv(import.meta.env.PUBLIC_SUPABASE_URL, "PUBLIC_SUPABASE_URL"),
    serverEnv(import.meta.env.PUBLIC_SUPABASE_ANON_KEY, "PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return parseCookieHeader(ctx.request.headers.get("Cookie") ?? "").map(
            ({ name, value }) => ({ name, value: value ?? "" }),
          );
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            ctx.cookies.set(name, value, options);
          }
        },
      },
    },
  );
}
