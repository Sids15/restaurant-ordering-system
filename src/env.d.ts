/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Supabase project URL (public). */
  readonly PUBLIC_SUPABASE_URL: string;
  /** Supabase anon key (public; data guarded by RLS). */
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  /** Supabase service-role key (SECRET — server only). */
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  /** HMAC secret that signs table QR tokens (SECRET — server only). */
  readonly TABLE_TOKEN_SECRET: string;
  /** Canonical customer domain for printed QR codes (public; optional). */
  readonly PUBLIC_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** A signed-in staff member, as loaded onto `Astro.locals` by the middleware. */
interface StaffProfile {
  id: string;
  name: string;
  role: import("./lib/types").Role;
}

declare namespace App {
  interface Locals {
    /** Request-scoped Supabase client (anon key + cookie session, RLS applies). */
    supabase: import("@supabase/supabase-js").SupabaseClient;
    /** The authenticated auth user, or null on public/unauthenticated requests. */
    user: import("@supabase/supabase-js").User | null;
    /** The staff profile (role) for `user`, or null if not staff / not loaded. */
    profile: StaffProfile | null;
  }
}
