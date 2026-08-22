/**
 * Server-only env access that survives Vercel's "Sensitive" variables.
 *
 * Astro/Vite inlines `import.meta.env.X` at BUILD time. Vercel does NOT expose
 * variables marked "Sensitive" to the build step, so those get inlined as
 * `undefined` and stay undefined at runtime — which is why a sensitive
 * PUBLIC_SUPABASE_URL produced "URL and Key are required" 500s.
 *
 * Vercel DOES inject every variable (sensitive included) into the function's
 * `process.env` at RUNTIME. So we read the build-inlined value first and fall
 * back to process.env, which makes the app work whether a variable is marked
 * sensitive or not. NEVER call this from client code — process.env isn't there.
 */
export function serverEnv(inlined: string | undefined, name: string): string {
  const value = inlined ?? process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Like serverEnv but returns null instead of throwing when unset. */
export function optionalServerEnv(inlined: string | undefined, name: string): string | null {
  return inlined ?? process.env[name] ?? null;
}
