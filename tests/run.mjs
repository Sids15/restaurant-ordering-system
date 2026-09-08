/**
 * The test runner.
 *
 * Each suite is its own process, so one crashing cannot take the others with
 * it and a slow level can be skipped without touching the rest.
 *
 *   npm test                    unit + integration + security  (the default gate)
 *   npm run test:all            everything, including the slow levels
 *   npm run test:unit           one level
 *   node tests/run.mjs unit security
 *
 * Levels that need something running or reachable say so and skip, rather than
 * failing — a red suite should mean the app is wrong, not that a dev server
 * happens to be down.
 */
import { readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const LEVELS = {
  unit: { dir: "tests/unit", what: "pure logic, no network" },
  integration: { dir: "tests/integration", what: "the live database" },
  security: { dir: "tests/security", what: "probes that try to get in" },
  system: { dir: "tests/system", what: "end-to-end HTTP; needs the app running" },
  regression: { dir: "tests/regression", what: "bugs that were real once" },
  a11y: { dir: "tests/a11y", what: "accessibility; needs the app running" },
  compat: { dir: "tests/compat", what: "browsers and platforms" },
  performance: { dir: "tests/performance", what: "load, stress, spike, soak — slow" },
};

/** What `npm test` runs: fast, and everything it checks is deterministic. */
const DEFAULT = ["unit", "integration", "security", "regression"];

const asked = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const levels = asked.length ? asked : DEFAULT;

for (const level of levels) {
  if (!LEVELS[level]) {
    console.error(`Unknown level "${level}". Try: ${Object.keys(LEVELS).join(", ")}`);
    process.exit(2);
  }
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: "inherit" });
    child.on("close", (code) => resolve(code === 0));
  });
}

let failed = 0;
let ran = 0;
const started = Date.now();

for (const level of levels) {
  const { dir, what } = LEVELS[level];
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();
  if (files.length === 0) continue;

  console.log(`\n${bold(`━━ ${level.toUpperCase()}`)} ${dim(`— ${what}`)}`);
  for (const f of files) {
    ran++;
    if (!(await run(join(dir, f)))) failed++;
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `\n${bold("═".repeat(52))}\n` +
    (failed
      ? `\x1b[31m${failed} of ${ran} suites failed\x1b[0m  ${dim(`(${secs}s)`)}`
      : `\x1b[32mAll ${ran} suites passed\x1b[0m  ${dim(`(${secs}s)`)}`) +
    "\n",
);
process.exit(failed ? 1 : 0);
