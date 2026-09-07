import { readFileSync } from "node:fs";

/**
 * Server-only env access that survives Vercel's "Sensitive" variables.
 *
 * Astro/Vite inlines `import.meta.env.X` at BUILD time. Vercel does NOT expose
 * variables marked "Sensitive" to the build step, so those get inlined as
 * `undefined` and stay undefined at runtime — which is why a sensitive
 * SUPABASE_URL produced "URL and Key are required" 500s.
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

/**
 * A secret that must never be compiled into a build artifact.
 *
 * `import.meta.env.X` is substituted with the literal value at BUILD time, so
 * any secret read that way ends up as a plaintext string inside the server
 * bundle. That widens where it can leak from (build caches, deployment
 * archives, anyone with read access to the deployment) and it means rotating
 * the key silently does nothing until the next deploy — the compiled-in copy
 * keeps working.
 *
 * In production this reads process.env ONLY, so the value exists just in the
 * running function's memory. In dev it falls back to the inlined value, because
 * `astro dev` loads .env into import.meta.env and not into process.env.
 */
export function runtimeSecret(name: string): string {
  const value = optionalRuntimeSecret(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** runtimeSecret without the throw — for a secret whose absence switches a
 *  feature off rather than meaning a broken deployment. */
export function optionalRuntimeSecret(name: string): string | null {
  return process.env[name] ?? devEnv(name);
}

/**
 * Dev-only .env reader.
 *
 * The callers above deliberately never write `import.meta.env.SOME_SECRET`,
 * because Vite substitutes that expression with the literal value at build
 * time — the point of this whole module is to keep the value OUT of the
 * artifact, and merely passing it as an argument still bakes it in.
 *
 * `astro dev` loads .env into import.meta.env and not into process.env, so
 * without this the local server would have no secrets at all. Parsed once,
 * never in production.
 */
let devCache: Record<string, string> | null = null;
function devEnv(name: string): string | null {
  if (!import.meta.env.DEV) return null;
  if (!devCache) {
    try {
      devCache = parseDotEnv(readFileSync(".env", "utf8"));
    } catch {
      // No .env locally: the caller reports the missing variable by name.
      devCache = {};
    }
  }
  return devCache[name] ?? null;
}

const NEWLINE = /\r?\n/;
const ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const QUOTES = /^["']|["']$/g;

/** KEY=value lines, ignoring comments and surrounding quotes. */
function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(NEWLINE)) {
    const m = ASSIGNMENT.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(QUOTES, "");
  }
  return out;
}
