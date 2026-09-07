/**
 * Server-only Supabase admin client — uses the SERVICE-ROLE key, which
 * bypasses Row-Level Security. NEVER import this from client-side code; it must
 * only run inside API routes / server endpoints (serverless functions).
 *
 * Used for privileged actions the anon client shouldn't do directly, e.g.
 * creating a customer order and reading it back by code.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runtimeSecret, serverEnv } from "../env";

export function supabaseAdmin(): SupabaseClient {
  return createClient(
    serverEnv(import.meta.env.SUPABASE_URL, "SUPABASE_URL"),
    // runtimeSecret, not serverEnv: this key bypasses every RLS policy in the
    // database, so it must never be substituted into the build output as a
    // literal. Note the variable is NOT named via import.meta.env here — doing
    // so is what bakes it in. See lib/env.ts.
    runtimeSecret("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
