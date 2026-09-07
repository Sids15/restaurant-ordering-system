/**
 * check-keys — what keys is this app holding, and do they still work?
 *
 * Rotating a Supabase key is easy to get half-right: the dashboard shows a new
 * value, the app keeps running on a compiled-in old one, and nothing tells you.
 * This proves what is actually true by making real requests with each key.
 *
 * It NEVER prints a key. Each is identified by type, its claims (for a legacy
 * JWT), and a short SHA-256 fingerprint you can compare against Vercel.
 *
 *   node scripts/check-keys.mjs         read .env  (local)
 *   node scripts/check-keys.mjs --env   read process.env  (CI, or `vercel env pull`)
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const useProcessEnv = process.argv.includes("--env");

function loadEnv() {
  if (useProcessEnv) return process.env;
  const out = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fingerprint = (k) => createHash("sha256").update(k).digest("hex").slice(0, 12);

/** Describe a key without revealing it. */
function describe(key) {
  if (key.startsWith("sb_secret_")) {
    return { kind: "new secret key", detail: "revocable on its own" };
  }
  if (key.startsWith("sb_publishable_")) {
    return { kind: "new publishable key", detail: "safe to expose" };
  }
  const parts = key.split(".");
  if (parts.length !== 3) return { kind: "unrecognised", detail: "" };
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const on = (t) => new Date(t * 1000).toISOString().slice(0, 10);
    return {
      kind: `legacy JWT (role: ${p.role})`,
      detail: `issued ${on(p.iat)}, expires ${on(p.exp)}`,
    };
  } catch {
    return { kind: "unrecognised", detail: "" };
  }
}

const headers = (key) => ({ apikey: key, authorization: `Bearer ${key}` });
const TIMEOUT = { signal: AbortSignal.timeout(10_000) };

/**
 * Is the key accepted by the API gateway at all?
 *
 * A table request, not the /rest/v1/ OpenAPI root — that root needs elevated
 * privilege and answers 401 even for a perfectly good public key, which reads
 * as "revoked" when it isn't. A table answers 200 for any valid key (RLS may
 * still return no rows) and 401 for one that is revoked or from another project.
 */
async function isLive(url, key) {
  try {
    const res = await fetch(`${url}/rest/v1/orders?select=id&limit=1`, {
      headers: headers(key),
      ...TIMEOUT,
    });
    return res.status !== 401;
  } catch {
    return null;
  }
}

/**
 * Does the key carry service-role privilege?
 *
 * NOT by reading a table. RLS answers a denied read with `200 []`, which is
 * indistinguishable from an empty table — so a data probe cannot tell "refused"
 * from "nothing there". The auth admin endpoint is data-independent: 200 for a
 * service key, 403 for anything else.
 */
async function isPrivileged(url, key) {
  try {
    const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: headers(key),
      ...TIMEOUT,
    });
    return res.ok;
  } catch {
    return null;
  }
}

/** Confirm RLS still hides staff data from the public key. */
async function rlsHolds(url, anonKey) {
  try {
    const res = await fetch(`${url}/rest/v1/orders?select=id&limit=1`, {
      headers: headers(anonKey),
      ...TIMEOUT,
    });
    if (!res.ok) return true; // refused outright is also fine
    const rows = await res.json();
    return Array.isArray(rows) && rows.length === 0;
  } catch {
    return null;
  }
}

const env = loadEnv();
const url = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
if (!url) {
  console.error("No SUPABASE_URL found. Run from the project root, or pass --env.");
  process.exit(1);
}

console.log(`\nProject: ${url}`);
console.log(`Source:  ${useProcessEnv ? "process.env" : ".env"}\n`);

let problems = 0;

for (const [name, mustBePrivileged] of [
  ["SUPABASE_ANON_KEY", false],
  ["SUPABASE_SERVICE_ROLE_KEY", true],
]) {
  const key = env[name];
  console.log(name);

  if (!key) {
    console.log("  NOT SET\n");
    problems++;
    continue;
  }

  const d = describe(key);
  console.log(`  type        ${d.kind}${d.detail ? ` — ${d.detail}` : ""}`);
  console.log(`  fingerprint ${fingerprint(key)}`);

  const live = await isLive(url, key);
  if (live === null) {
    console.log("  status      COULD NOT REACH SUPABASE\n");
    problems++;
    continue;
  }
  if (!live) {
    console.log("  status      REJECTED — revoked, or belongs to another project\n");
    problems++;
    continue;
  }

  const privileged = await isPrivileged(url, key);
  if (privileged === mustBePrivileged) {
    console.log(
      `  status      live, ${
        mustBePrivileged ? "service-role privilege confirmed" : "public privilege as expected"
      }`,
    );
  } else if (mustBePrivileged) {
    console.log("  status      live but NOT a service key — the app cannot place orders");
    problems++;
  } else {
    console.log("  status      live and SERVICE-ROLE — a secret key is in the public slot");
    problems++;
  }
  console.log();
}

if (env.SUPABASE_ANON_KEY) {
  const held = await rlsHolds(url, env.SUPABASE_ANON_KEY);
  console.log("Row-Level Security");
  if (held === null) {
    console.log("  could not check\n");
  } else if (held) {
    console.log("  the public key reads no orders — RLS is holding\n");
  } else {
    console.log("  THE PUBLIC KEY CAN READ ORDERS — RLS is not protecting this table\n");
    problems++;
  }
}

console.log(problems === 0 ? "All good.\n" : `${problems} problem(s) above.\n`);
process.exit(problems === 0 ? 0 : 1);
