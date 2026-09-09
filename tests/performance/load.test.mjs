/**
 * PERFORMANCE — load, stress, spike, soak, volume and scalability.
 *
 * These measure a real system over real HTTP. Two honest caveats up front,
 * because a performance number without its conditions is decoration:
 *
 * 1. Run against the dev server, this measures the dev server — unminified, no
 *    edge cache, one machine. Useful for spotting a query that got quadratically
 *    worse; useless as a production capacity figure. Point TEST_BASE_URL at a
 *    real deployment for numbers that mean something.
 *
 * 2. The thresholds below are deliberately generous. A performance test that
 *    fails when a laptop is busy trains people to ignore it, and an ignored red
 *    test is worse than no test. These are set to catch a REGRESSION — a tenfold
 *    change — not to police milliseconds.
 *
 * Sized to one restaurant: ~20 tables, a phone at each, a couple of staff
 * devices. Not a thousand concurrent users, because this app will never see
 * them and testing for them would tell us nothing we would act on.
 */
import {
  suite, is, ok, note, skip, finish, http, appUp, BASE, median, percentile, timed,
} from "../harness.mjs";

suite(`PERFORMANCE · ${BASE}`);

// --- Round trips, which are readable without a running server ----------------
// The kitchen page loaded its queue, waited for it, then loaded the menu — two
// queries that never depended on each other, so the wait bought nothing. It was
// invisible while the function ran a continent from the database and every
// round trip cost ~300ms, because everything was slow. It is ~20ms now, and
// still a round trip nobody needs.
//
// Asserted on the source rather than the clock: 20ms does not survive the noise
// in an HTTP measurement, so a timing test for this would be a coin flip
// dressed up as a check.
{
  const { readFileSync } = await import("node:fs");
  const kitchen = readFileSync("src/pages/kitchen/index.astro", "utf8");
  // Only the frontmatter runs on the server; an `await` below it is markup.
  // \r?\n throughout: .gitattributes converts on checkout, so a Windows clone
  // sees CRLF here and an \n-only pattern would quietly match nothing and
  // report zero awaits — passing or failing for a reason that is not the code.
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(kitchen)?.[1] ?? "";
  ok(
    "the kitchen page's frontmatter is readable",
    frontmatter.length > 0,
    "no frontmatter matched — the assertions below would be measuring nothing",
  );
  const waits = (frontmatter.match(/\bawait\b/g) ?? []).length;
  is(
    `the kitchen page waits once, not twice (${waits} await${waits === 1 ? "" : "s"})`,
    waits,
    1,
    "each await here is a round trip that nothing else overlaps with",
  );
  ok(
    "...and that one wait covers both queries at once",
    /await Promise\.all\(/.test(frontmatter),
    "the queue and the menu are fetched one after the other again",
  );
}

if (!(await appUp())) {
  skip("every measurement", `nothing serving at ${BASE}`);
  finish();
}

const isLocal = BASE.includes("localhost") || BASE.includes("127.0.0.1");
if (isLocal) {
  note("measuring the DEV server — good for spotting regressions, not a capacity figure");
}

/** Fire `n` requests at once and report how they went. */
async function burst(path, n) {
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: n }, async () => {
      try {
        const { ms, value } = await timed(() => http(path));
        return { ms, status: value.status };
      } catch {
        return { ms: -1, status: 0 };
      }
    }),
  );
  const okCount = results.filter((r) => r.status > 0 && r.status < 500).length;
  const times = results.filter((r) => r.ms >= 0).map((r) => r.ms);
  return {
    wallMs: Date.now() - started,
    ok: okCount,
    failed: n - okCount,
    p50: median(times),
    p95: percentile(times, 95),
    max: Math.max(...times, 0),
  };
}

// --- Baseline ----------------------------------------------------------------
// One user, nothing else happening. Everything later is compared to this.
note("baseline: one request at a time");
const baseline = {};
for (const [what, path] of [
  ["the customer menu", "/menu"],
  ["the availability poll", "/api/menu/availability"],
]) {
  const times = [];
  for (let i = 0; i < 8; i++) times.push((await timed(() => http(path))).ms);
  const p50 = median(times);
  baseline[path] = p50;
  ok(`${what}: ${p50.toFixed(0)}ms median`, p50 < (isLocal ? 3000 : 2000), `${p50.toFixed(0)}ms`);
}

// --- LOAD: the restaurant on a normal night ----------------------------------
// Twenty tables with the menu open. The availability poll is the endpoint every
// one of those phones hits, so it is the one that matters.
{
  note("load: 20 phones polling availability at once — a full floor");
  const r = await burst("/api/menu/availability", 20);
  is("every request was answered", r.failed, 0);
  ok(
    `p95 stayed reasonable under a full floor (${r.p95.toFixed(0)}ms)`,
    r.p95 < (isLocal ? 6000 : 3000),
    `p50 ${r.p50.toFixed(0)}ms · p95 ${r.p95.toFixed(0)}ms · max ${r.max.toFixed(0)}ms`,
  );
}

// --- STRESS: well past what this restaurant can produce -----------------------
// The question is not whether it is fast here. It is whether it DEGRADES —
// slower but correct — rather than failing. A 500 under load is the finding.
{
  note("stress: 100 concurrent — far beyond a real floor");
  const r = await burst("/api/menu/availability", 100);
  ok(
    `nothing errored under 5× the real load (${r.ok}/100 answered)`,
    r.failed === 0,
    `${r.failed} request(s) failed outright`,
  );
  note(`degraded to p50 ${r.p50.toFixed(0)}ms · p95 ${r.p95.toFixed(0)}ms — slower is fine, failing is not`);
}

// --- SPIKE: everyone scans at once -------------------------------------------
// A real pattern: a party of twelve sits down and every phone hits the menu in
// the same second. Idle, then a wall, then idle.
{
  note("spike: idle → 30 menu loads at once → idle");
  const quiet = (await timed(() => http("/menu"))).ms;
  const r = await burst("/menu", 30);
  await new Promise((res) => setTimeout(res, 1000));
  const after = (await timed(() => http("/menu"))).ms;

  is("the spike was fully served", r.failed, 0);
  ok(
    `it recovered afterwards (${quiet.toFixed(0)}ms → spike → ${after.toFixed(0)}ms)`,
    after < Math.max(quiet * 4, 3000),
    `still slow after the spike: ${after.toFixed(0)}ms vs ${quiet.toFixed(0)}ms at rest`,
  );
}

// --- VOLUME: a heavy page over a lot of rows ----------------------------------
// Analytics reads a whole period plus the one before it. If it degrades badly
// as the restaurant accumulates history, it does so here first.
{
  const spans = [
    ["a day", "/staff/analytics?date=2026-09-08"],
    ["a month", "/staff/analytics?from=2026-08-09&to=2026-09-08"],
    ["a year", "/staff/analytics?from=2025-09-09&to=2026-09-08"],
  ];
  const timings = [];
  for (const [what, path] of spans) {
    const { ms, value } = await timed(() => http(path));
    timings.push(ms);
    // Signed out this redirects, which still exercises routing and middleware.
    ok(`${what} of analytics answers (${ms.toFixed(0)}ms)`, value.status < 500, `HTTP ${value.status}`);
  }
  // The point of a volume test: widening the window 365× must not cost 365×.
  ok(
    "a year does not cost proportionally more than a day",
    timings[2] < timings[0] * 20 + 2000,
    `day ${timings[0].toFixed(0)}ms → year ${timings[2].toFixed(0)}ms`,
  );
}

// --- SCALABILITY: does cost track concurrency linearly? ----------------------
{
  note("scalability: 5 → 10 → 20 concurrent, watching how throughput moves");
  const points = [];
  for (const n of [5, 10, 20]) {
    const r = await burst("/api/menu/availability", n);
    points.push({ n, wall: r.wallMs, perReq: r.wallMs / n });
    note(`  ${String(n).padStart(3)} concurrent → ${r.wallMs}ms wall, ${(r.wallMs / n).toFixed(0)}ms/request`);
  }
  // Serving more at once should not make each one dramatically worse. A sharp
  // rise here is the shape of a lock or a connection pool running out.
  ok(
    "per-request cost does not blow up with concurrency",
    points[2].perReq < points[0].perReq * 6 + 200,
    `${points[0].perReq.toFixed(0)}ms/req at 5 → ${points[2].perReq.toFixed(0)}ms/req at 20`,
  );
}

// --- ENDURANCE (soak) --------------------------------------------------------
// A short soak: enough to catch a leak or an unbounded map, not a real
// overnight run. `SOAK_SECONDS=600 npm run test:performance` for a proper one.
{
  const seconds = Number(process.env.SOAK_SECONDS ?? 12);
  note(`endurance: ${seconds}s of steady traffic, watching for drift`);
  const deadline = Date.now() + seconds * 1000;
  const early = [];
  const late = [];
  let errors = 0;

  while (Date.now() < deadline) {
    const { ms, value } = await timed(() => http("/api/menu/availability"));
    if (value.status >= 500 || value.status === 0) errors++;
    (Date.now() < deadline - (seconds * 1000) / 2 ? early : late).push(ms);
    await new Promise((r) => setTimeout(r, 60));
  }

  is("nothing errored during the soak", errors, 0);
  if (early.length && late.length) {
    const a = median(early);
    const b = median(late);
    // Steadily worsening response times over a sustained run is the signature
    // of something accumulating — a cache without a bound, a growing map.
    ok(
      `no drift over the run (${a.toFixed(0)}ms → ${b.toFixed(0)}ms)`,
      b < a * 2.5 + 150,
      `it got slower as it ran: ${a.toFixed(0)}ms early vs ${b.toFixed(0)}ms late`,
    );
  } else {
    skip("no drift over the run", "not enough samples");
  }
}

// --- What the caching should have bought -------------------------------------
// The grants cache means a burst of staff page loads should not cost a database
// round trip each. Signed out we only reach the redirect, but that still runs
// the middleware, which is where the saving lives.
{
  const times = [];
  for (let i = 0; i < 10; i++) times.push((await timed(() => http("/staff/today"))).ms);
  const first = times[0];
  const rest = median(times.slice(1));
  note(`middleware path: first ${first.toFixed(0)}ms, then ${rest.toFixed(0)}ms median`);
  ok("repeat requests are not slower than the first", rest <= first * 1.5 + 100, `${first.toFixed(0)} → ${rest.toFixed(0)}`);
}

finish();
