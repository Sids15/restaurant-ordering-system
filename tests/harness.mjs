/**
 * The test harness: assertions, suites, and the shared bits every level needs.
 *
 * No framework. This project has no test runner, and adding one to get
 * `describe`/`it` would mean a dependency, a config file and a watch mode for
 * something a hundred lines does exactly as well. What matters in a test suite
 * is that a failure tells you what broke and why — not which library printed it.
 *
 * Every assertion prints the value it got beside the value it wanted, because
 * "expected true, got false" is the least useful sentence in testing.
 */
import { readFileSync } from "node:fs";

// --- Reporting ---------------------------------------------------------------

const state = { suite: "", passed: 0, failed: 0, skipped: 0, failures: [] };

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

export function suite(name) {
  state.suite = name;
  console.log(`\n${C.bold(name)}`);
}

/** A note that isn't a pass or a fail — context the reader needs. */
export function note(message) {
  console.log(`  ${C.dim("·")} ${C.dim(message)}`);
}

function pass(what) {
  state.passed++;
  console.log(`  ${C.green("ok")}   ${what}`);
}

function fail(what, detail) {
  state.failed++;
  state.failures.push({ suite: state.suite, what, detail });
  console.log(`  ${C.red("FAIL")} ${what}`);
  for (const line of String(detail).split("\n")) console.log(`       ${C.red(line)}`);
}

/** Skipped, with the reason. A silent skip is a lie by omission. */
export function skip(what, why) {
  state.skipped++;
  console.log(`  ${C.yellow("skip")} ${what}  ${C.dim(`(${why})`)}`);
}

// --- Assertions --------------------------------------------------------------

export function ok(what, condition, detail = "") {
  if (condition) pass(what);
  else fail(what, detail || "expected truthy");
}

export function is(what, got, want) {
  if (Object.is(got, want)) pass(what);
  else fail(what, `got:  ${fmt(got)}\nwant: ${fmt(want)}`);
}

export function isNot(what, got, notWant) {
  if (!Object.is(got, notWant)) pass(what);
  else fail(what, `got the value it must not be: ${fmt(got)}`);
}

/** For "roughly", where an exact number is noise: timings, averages. */
export function near(what, got, want, tolerance) {
  if (Math.abs(got - want) <= tolerance) pass(what);
  else fail(what, `got:  ${fmt(got)}\nwant: ${fmt(want)} ±${tolerance}`);
}

export function includes(what, haystack, needle) {
  const has = Array.isArray(haystack) ? haystack.includes(needle) : String(haystack).includes(needle);
  if (has) pass(what);
  else fail(what, `not found: ${fmt(needle)}\nin: ${fmt(haystack).slice(0, 300)}`);
}

export function excludes(what, haystack, needle) {
  const has = Array.isArray(haystack) ? haystack.includes(needle) : String(haystack).includes(needle);
  if (!has) pass(what);
  else fail(what, `found something that must not be there: ${fmt(needle)}`);
}

/** Asserts the callback throws. A test that silently doesn't is worthless. */
export async function throws(what, fn) {
  try {
    await fn();
    fail(what, "expected it to throw, and it returned normally");
  } catch {
    pass(what);
  }
}

function fmt(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (v instanceof Set) return `Set(${[...v].join(", ")})`;
  if (v instanceof Map) return `Map(${[...v.entries()].map(([k, x]) => `${k}=${x}`).join(", ")})`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// --- Finishing ---------------------------------------------------------------

export function report() {
  const { passed, failed, skipped } = state;
  console.log(
    `\n${C.bold("─".repeat(52))}\n` +
      `${C.green(`${passed} passed`)}` +
      (failed ? `  ${C.red(`${failed} failed`)}` : "") +
      (skipped ? `  ${C.yellow(`${skipped} skipped`)}` : ""),
  );
  if (failed) {
    console.log(`\n${C.red(C.bold("Failures"))}`);
    for (const f of state.failures) console.log(`  ${f.suite} → ${f.what}`);
  }
  console.log();
  return failed === 0;
}

export function finish() {
  process.exit(report() ? 0 : 1);
}

// --- Shared helpers ----------------------------------------------------------

/** .env as an object. Tests that need real credentials read them from here. */
export function env() {
  const out = {};
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env: the integration and system suites will skip themselves.
  }
  return out;
}

/** A REST caller for the live project. `as` picks which key to present. */
export function db(as = "service") {
  const e = env();
  const url = (e.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = as === "anon" ? e.SUPABASE_ANON_KEY : e.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

  return {
    url,
    ready: Boolean(url && key),
    async get(path) {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers });
      return { status: r.status, ok: r.ok, body: await r.json().catch(() => null) };
    },
    async rpc(fn, args) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(args ?? {}),
      });
      return { status: r.status, ok: r.ok, body: await r.json().catch(() => null) };
    },
    async post(path, rows, prefer = "return=representation") {
      const r = await fetch(`${url}/rest/v1/${path}`, {
        method: "POST",
        headers: { ...headers, Prefer: prefer },
        body: JSON.stringify(rows),
      });
      return { status: r.status, ok: r.ok, body: await r.json().catch(() => null) };
    },
    async patch(path, patchBody) {
      const r = await fetch(`${url}/rest/v1/${path}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(patchBody),
      });
      return { status: r.status, ok: r.ok };
    },
    async del(path) {
      const r = await fetch(`${url}/rest/v1/${path}`, { method: "DELETE", headers });
      return { status: r.status, ok: r.ok };
    },
  };
}

/** Where the app under test is. Defaults to the dev server. */
export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:4399";

/** Is something serving at BASE? Suites that need it skip rather than fail. */
export async function appUp(base = BASE) {
  try {
    const r = await fetch(`${base}/menu`, {
      signal: AbortSignal.timeout(4000),
      redirect: "manual",
    });
    return r.status > 0;
  } catch {
    return false;
  }
}

/** One HTTP call against the app, never following redirects — a 302 to the
 *  login page is frequently the thing being asserted. */
export async function http(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...init,
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
  });
  const text = await res.text().catch(() => "");
  return {
    status: res.status,
    location: res.headers.get("location"),
    headers: res.headers,
    text,
    json: () => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  };
}

/** Median, because one slow sample should not decide a performance test. */
export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The value below which `p` of the samples fall. p95 catches what median hides. */
export function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** Time one call, in milliseconds. */
export async function timed(fn) {
  const t = process.hrtime.bigint();
  const value = await fn();
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, value };
}
