/**
 * design-lint — keeps the design system from drifting back apart.
 *
 * The app had drifted to eight breakpoints, five pill implementations, three
 * ad-hoc micro type sizes, and the same three diet colours written out in two
 * files. Sweeping that up once only helps if the next page can't reintroduce
 * it, so three rules run over every stylesheet and every <style> block:
 *
 *   1. breakpoint  — comes from the three tiers documented in tokens.css
 *   2. type-scale  — font-size uses a --fs-* token
 *   3. raw-color   — colour comes from a token, not a hex literal
 *
 * Some exceptions are real: thermal roll printing is 1-bit, and a QR has to be
 * pure black on white to scan. They declare themselves and say why —
 *
 *   design-lint: allow-raw-color — thermal paper has no greys
 *   design-lint: allow-raw-type  — sized in mm against an 80mm roll
 *
 * in the file's header comment to cover the whole file, or on the two lines
 * above a declaration to cover just that one.
 *
 * Run: node scripts/design-lint.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "src");
const TIERS = ["36rem", "48rem", "60rem"];
/** How far into a file a blanket exemption may be declared (the header). */
const HEADER_LINES = 40;

const directive = (rule) => new RegExp(String.raw`design-lint:\s*allow-raw-${rule}\b`);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The CSS in a file: the whole thing for .css, the <style> blocks otherwise. */
function cssBlocks(path, text) {
  if (path.endsWith(".css")) return [{ text, offset: 0 }];
  const out = [];
  const re = /<style>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(text))) out.push({ text: m[1], offset: m.index + m[0].indexOf(m[1]) });
  return out;
}

const problems = [];

for (const path of walk(SRC)) {
  if (!/\.(css|astro|tsx)$/.test(path)) continue;
  const rel = relative(ROOT, path).split(sep).join("/");
  if (rel === "src/styles/tokens.css") continue; // where the values are defined

  const full = readFileSync(path, "utf8");
  const lines = full.split("\n");
  const header = lines.slice(0, HEADER_LINES).join("\n");
  const lineAt = (i) => full.slice(0, i).split("\n").length;
  const exempt = (rule, line) =>
    directive(rule).test(header) ||
    directive(rule).test(lines.slice(Math.max(0, line - 3), line).join("\n"));
  const add = (line, rule, detail) => problems.push({ file: rel, line, rule, detail });

  for (const block of cssBlocks(path, full)) {
    const css = block.text;
    const at = (i) => lineAt(block.offset + i);

    for (const m of css.matchAll(/@media[^{]*?\((?:max|min)-width:\s*([^)]+)\)/g)) {
      const w = m[1].trim();
      if (!TIERS.includes(w)) add(at(m.index), "breakpoint", `${w} — use ${TIERS.join(" / ")}`);
    }

    for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) {
      const v = m[1].trim();
      // mm and pt are print units, sized against paper rather than the scale.
      if (v.includes("var(--fs-") || v === "inherit" || /\d(mm|pt)\b/.test(v)) continue;
      if (exempt("type", at(m.index))) continue;
      add(at(m.index), "type-scale", `font-size: ${v}`);
    }

    // Skip HTML entities (&#8203;), which are not colours.
    for (const m of css.matchAll(/(^|[^&#\w])(#[0-9a-fA-F]{3,8})\b/g)) {
      const line = at(m.index);
      if (exempt("color", line)) continue;
      add(line, "raw-color", m[2]);
    }
  }
}

if (problems.length === 0) {
  console.log("\n🎨 design-lint — breakpoints, type scale and colour all come from tokens.\n");
  process.exit(0);
}

console.log("\n🎨 design-lint\n");
for (const p of problems) console.log(`  ${p.rule.padEnd(11)} ${p.file}:${p.line}  ${p.detail}`);
console.log(
  `\n${problems.length} to fix. A genuine exception declares itself:\n` +
    `  design-lint: allow-raw-color — why   (or allow-raw-type)\n` +
    `  in the file header to cover the file, or just above the line for one value.\n`,
);
process.exit(1);
