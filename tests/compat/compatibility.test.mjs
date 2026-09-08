/**
 * COMPATIBILITY — browsers, platforms, versions, and locale.
 *
 * BE CLEAR ABOUT WHAT THIS IS. Real cross-browser testing means running the app
 * in Safari on an actual iPhone, because that is what half the guests will hold.
 * This machine has Chromium only, so anything claiming Safari coverage here
 * would be a lie. What this file does instead is check the things that make a
 * browser fail — features used without a fallback, syntax an older engine
 * cannot parse — plus backward compatibility with a database that has not been
 * migrated yet. The device matrix that needs real hardware is in
 * docs/testing.md.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { suite, is, ok, note, skip, finish, db } from "../harness.mjs";

suite("COMPATIBILITY · browsers, platforms and versions");

// --- What the client bundle actually requires ---------------------------------
{
  const dir = ".vercel/output/static/_astro";
  if (!existsSync(dir)) {
    skip("client bundle checks", "no build output — run npm run build");
  } else {
    const js = readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");

    note("checking what the shipped bundle needs a browser to support");

    // Baseline for the guest side: iOS Safari 15+ and Chrome 90+, which is what
    // a phone in a restaurant realistically is. These are the APIs that would
    // break silently on the older end of that.
    const risky = [
      ["structuredClone", /\bstructuredClone\s*\(/, "Safari 15.4+"],
      ["Array.at", /\.at\s*\(\s*-?\d/, "Safari 15.4+"],
      ["Object.hasOwn", /Object\.hasOwn\s*\(/, "Safari 15.4+"],
      ["Array.findLast", /\.findLast\s*\(/, "Safari 15.4+"],
    ];
    for (const [name, re, since] of risky) {
      const used = re.test(js);
      if (used) note(`  uses ${name} — needs ${since}`);
      else ok(`  avoids ${name}`, true);
    }

    // A top-level await in a classic script is a hard parse error, not a
    // graceful degradation — the whole file fails to run.
    ok(
      "  no bare top-level await in a non-module chunk",
      !/^\s*await\s/m.test(js) || /type="module"/.test(js),
      "top-level await outside a module breaks the whole file on older engines",
    );
  }
}

// --- CSS that needs a fallback -----------------------------------------------
{
  const css = ["src/styles/tokens.css", "src/styles/global.css", "src/styles/staff.css"]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  note("CSS features and how gracefully they fail");

  // color-mix is Safari 16.2+. Used for every soft colour in the palette — on
  // an older phone those become nothing, which is a real visual break rather
  // than a subtle one.
  const usesColorMix = /color-mix\(/.test(css);
  if (usesColorMix) {
    note("  uses color-mix() — Safari 16.2+, Chrome 111+; older phones lose the soft tints");
  }

  // These degrade harmlessly: an unsupported aspect-ratio just means the box is
  // sized by content, and a missing :has() means a selector does not match.
  for (const [feature, re, note_] of [
    ["aspect-ratio", /aspect-ratio:/, "falls back to content sizing"],
    [":has()", /:has\(/, "the rule simply does not apply"],
    ["dvh units", /\d+dvh/, "falls back only if a vh fallback is present"],
  ]) {
    if (re.test(css)) note(`  uses ${feature} — ${note_}`);
  }

  // 100dvh without a fallback leaves a phone with a collapsed layout, which is
  // not graceful. This one is worth asserting rather than noting.
  const dvhLines = css.split("\n").filter((l) => /\d+dvh/.test(l));
  if (dvhLines.length) {
    const anyFallback = /min-height:\s*100vh/.test(css) || /height:\s*100vh/.test(css);
    ok(
      "  dvh units have a vh fallback nearby",
      anyFallback || dvhLines.length === 0,
      "100dvh with no vh fallback collapses the layout on older mobile browsers",
    );
  }
}

// --- Platform: this codebase is built and run on two different OSes -----------
{
  note("platform");
  // Windows writes CRLF. A shell script or SQL file with CRLF can fail on Linux,
  // which is where this actually deploys.
  const shellish = ["scripts/audit.mjs", "scripts/verify-rbac.mjs"];
  for (const f of shellish) {
    if (!existsSync(f)) continue;
    const src = readFileSync(f, "utf8");
    ok(
      `  ${f} has no shebang/CRLF hazard`,
      !src.startsWith("#!") || !src.slice(0, 200).includes("\r"),
      "a CRLF after a shebang makes the script unrunnable on Linux",
    );
  }

  // Paths must not be hard-coded to one machine.
  const sources = ["src/lib/env.ts", "scripts/audit.mjs", "tests/harness.mjs"];
  for (const f of sources) {
    if (!existsSync(f)) continue;
    const src = readFileSync(f, "utf8");
    is(`  ${f} has no absolute local path`, /[A-Z]:\\Users\\|\/home\/[a-z]+\//.test(src), false);
  }
}

// --- Backward compatibility: code ahead of the database ----------------------
// Migrations are applied by hand, so the deployed app is routinely newer than
// the schema. Every one of those windows must degrade rather than break.
{
  note("backward compatibility with an unmigrated database");
  const rbac = readFileSync("src/lib/auth/rbac.ts", "utf8");
  const session = readFileSync("src/lib/auth/session.ts", "utf8");
  const optional = readFileSync("src/lib/supabase/optional-columns.ts", "utf8");
  const audit = readFileSync("src/lib/audit/log.ts", "utf8");

  ok(
    "  a missing grants table falls back to the shipped defaults",
    /DEFAULT_GRANTS\[role\]/.test(session),
    "no fallback — the window before 011 would lock every role out at once",
  );
  ok(
    "  a missing column retries the query without it",
    /run\(false\)/.test(optional),
    "no fallback — a pending migration would blank the open-tabs list",
  );
  ok(
    "  a missing atomic function falls back to the two-step",
    /writeGrantsInTwoSteps/.test(rbac),
    "no fallback — saving permissions would fail until 013 is applied",
  );
  ok(
    "  a missing audit table does not break the action it logs",
    /isMissingTable/.test(audit),
    "no fallback — logging would fail the thing it logs",
  );
}

// --- Forward compatibility: the database ahead of the code -------------------
{
  const svc = db("service");
  if (!svc.ready) {
    skip("  unknown enum values do not crash the app", "no database credentials");
  } else {
    // ORDER_FLOW still carries 'preparing' even though nothing enters it, so a
    // ticket left in that state by an older deploy stays completable.
    const types = readFileSync("src/lib/types.ts", "utf8");
    ok(
      "  a retired status is still handled",
      /preparing: \["ready", "cancelled"\]/.test(types),
      "a ticket left in 'preparing' by an older deploy would be stranded",
    );
  }
}

// --- Localisation and internationalisation ------------------------------------
// The app is deliberately single-locale: en-IN, INR, Asia/Kolkata. That is a
// decision, not an oversight — but it has to be a CONSISTENT one, and the
// things that would need to change are the things worth pinning.
{
  note("localisation: single-locale by design (en-IN / INR / Asia/Kolkata)");

  const brand = readFileSync("src/data/brand.ts", "utf8");
  ok(
    "  the timezone is configuration, not a literal",
    /timezone:\s*"[A-Za-z_/]+"/.test(brand),
    "no timezone in brand.ts — a white-label copy could not be re-homed",
  );
  ok(
    "  the currency is named in configuration",
    /currency:\s*"[A-Z]{3}"/.test(brand),
    "no currency in brand.ts",
  );

  // Dates and times must never be formatted against the SERVER's clock: Vercel
  // runs UTC, which is 5:30 off, and that silently misfiles a night's takings.
  const dateFiles = [
    "src/lib/orders/day.ts",
    "src/lib/orders/analytics.ts",
    "src/pages/staff/today.astro",
  ];
  for (const f of dateFiles) {
    const src = readFileSync(f, "utf8");
    const formats = /toLocale(Date|Time|)String\(/.test(src) || /Intl\.DateTimeFormat/.test(src);
    if (!formats) continue;
    ok(
      `  ${f.split("/").pop()} formats in an explicit timezone`,
      /timeZone/.test(src),
      "a date formatted without an explicit timeZone uses the server's, which is UTC",
    );
  }

  // Non-ASCII must survive the whole round trip: table labels, dish names and
  // guest notes will all contain it.
  const sample = "बाहर · Café · ₹1,234 · Ξ";
  is("  UTF-8 survives an encode/decode round trip", Buffer.from(sample, "utf8").toString("utf8"), sample);

  // The rupee sign has to render, not become a box or a question mark.
  const money = readFileSync("src/lib/money.ts", "utf8");
  ok(
    "  currency comes from Intl rather than a hard-coded glyph",
    /Intl\.NumberFormat/.test(money),
    "a hard-coded ₹ breaks the moment the app is re-branded for another market",
  );
}

note("real device coverage — iOS Safari, Android Chrome — needs hardware; see docs/testing.md");
finish();
