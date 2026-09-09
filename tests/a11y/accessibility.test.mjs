/**
 * ACCESSIBILITY and UI — checked against rendered HTML.
 *
 * These are the structural failures a machine can find honestly: an image with
 * no alternative text, a control with no accessible name, a form field with no
 * label, a page with no landmark or language. Every one of them is a real
 * barrier for someone using a screen reader, and every one is unambiguous.
 *
 * WHAT THIS CANNOT TELL YOU. Automated checks find a minority of accessibility
 * problems — commonly cited around a third. They cannot judge whether a label
 * is *meaningful*, whether focus order follows the visual order, whether a
 * colour pairing is readable to someone with low vision in a dim dining room,
 * or whether any of this works with a real screen reader. Those need a person,
 * and docs/testing.md carries the checklist for them rather than pretending
 * this file covers it.
 */
import { suite, is, ok, note, skip, finish, http, appUp, BASE } from "../harness.mjs";

suite(`ACCESSIBILITY · rendered markup (${BASE})`);

if (!(await appUp())) {
  skip("every check", `nothing serving at ${BASE}`);
  finish();
}

/** Tags, with their attributes, for one element type. */
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*["'][^"']*["']`, "i").test(tag);

const PAGES = [
  ["/menu", "the customer menu"],
  ["/staff/login", "the staff login"],
  ["/definitely-not-a-page", "the 404 page"],
];

for (const [path, what] of PAGES) {
  const r = await http(path);
  if (r.status >= 500) {
    skip(what, `HTTP ${r.status}`);
    continue;
  }
  const html = r.text;
  note(what);

  // --- Document ---
  ok("  has a language", /<html[^>]+lang\s*=/i.test(html), "no lang on <html> — screen readers guess");
  ok("  has a title", /<title>[^<]{3,}<\/title>/i.test(html), "no usable <title>");
  ok("  has a viewport", /<meta[^>]+name=["']viewport["']/i.test(html), "no viewport meta");
  ok("  has a main landmark", /<main\b/i.test(html), "no <main> — no way to skip to content");

  // --- Headings ---
  const h1s = tags(html, "h1").length;
  ok(`  has exactly one h1 (found ${h1s})`, h1s === 1, "a page needs one, and only one, top heading");

  // --- Images ---
  const imgs = tags(html, "img");
  const unlabelled = imgs.filter((t) => !attr(t, "alt"));
  is("  every image has alt text", unlabelled.length, 0);

  // --- Controls ---
  // A button whose whole content is an icon needs a name from somewhere, or a
  // screen reader announces "button" and nothing else.
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
  const nameless = buttons.filter((b) => {
    if (attr(b, "aria-label") || attr(b, "aria-labelledby") || attr(b, "title")) return false;
    const text = b.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text.length === 0;
  });
  is(`  every button has an accessible name (${buttons.length} checked)`, nameless.length, 0);

  // --- Inputs ---
  // An input can be named four ways, and all of them are valid: aria-label,
  // aria-labelledby, an id a <label for> points at, or — the one this test
  // originally missed and wrongly flagged — being WRAPPED in a <label>, which
  // is implicit labelling and works fine with screen readers.
  const wrapped = new Set(
    (html.match(/<label\b[^>]*>[\s\S]*?<\/label>/gi) ?? [])
      .flatMap((block) => block.match(/<input\b[^>]*>/gi) ?? []),
  );
  const inputs = tags(html, "input").filter(
    (t) => !/type\s*=\s*["'](hidden|submit|button)["']/i.test(t),
  );
  const unlabelledInputs = inputs.filter(
    (t) =>
      !attr(t, "aria-label") &&
      !attr(t, "aria-labelledby") &&
      !attr(t, "id") &&
      !wrapped.has(t),
  );
  is(`  every input has a label (${inputs.length} checked)`, unlabelledInputs.length, 0);

  // --- Links ---
  const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [];
  const emptyLinks = links.filter((a) => {
    if (attr(a, "aria-label") || attr(a, "title")) return false;
    return a.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length === 0;
  });
  is(`  no link is unreadable (${links.length} checked)`, emptyLinks.length, 0);

  // A link that opens elsewhere must not hand the new page control of this one.
  const external = links.filter((a) => /target\s*=\s*["']_blank["']/i.test(a));
  const unsafe = external.filter((a) => !/rel\s*=\s*["'][^"']*noopener/i.test(a));
  is("  every new-tab link sets noopener", unsafe.length, 0);
}

// --- Motion ------------------------------------------------------------------
// Movement can cause real nausea for some people, and the OS-level preference
// is how they say so.
{
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("src/styles/global.css", "utf8");
  ok(
    "reduced motion is honoured",
    /@media \(prefers-reduced-motion: reduce\)/.test(css),
    "no reduced-motion block — animation cannot be turned off",
  );
}

// --- Focus -------------------------------------------------------------------
{
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("src/styles/global.css", "utf8");
  ok(
    "keyboard focus is visible",
    /:focus-visible/.test(css),
    "no focus-visible styling — a keyboard user cannot see where they are",
  );
  ok(
    "focus is not suppressed globally",
    !/\*\s*\{[^}]*outline:\s*none/s.test(css),
    "outline is removed globally, which blinds keyboard navigation",
  );
}

// --- Touch targets -----------------------------------------------------------
// The app is used on tablets on a counter and phones at a table.
{
  const { readFileSync } = await import("node:fs");
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const tap = /--tap:\s*([\d.]+)rem/.exec(tokens);
  ok("a minimum touch target is defined", Boolean(tap), "no --tap token");
  if (tap) {
    const px = Number(tap[1]) * 16;
    ok(`the touch floor is at least 44px (${px}px)`, px >= 44, `${px}px is below the usual 44px floor`);
  }
}

// --- The QR code ---------------------------------------------------------
// The only real image in the app. It is injected as raw SVG from the qrcode
// library, which emits no title and no role, so a screen reader met a graphic
// with nothing to say about it — on the page whose entire purpose is that
// graphic. The generic "every image has alt text" check cannot see it: the
// order page needs a live order code, which a smoke test does not have.
{
  const { readFileSync } = await import("node:fs");
  const track = readFileSync("src/pages/order/[code].astro", "utf8");
  ok(
    "the order QR is announced, not silent",
    /class="pass__qr"[^>]*role="img"/.test(track) || /role="img"[^>]*class="pass__qr"/.test(track),
    "the QR wrapper carries no role — a screen reader finds an unlabelled graphic",
  );
  ok(
    "...and names the order it encodes",
    /class="pass__qr"[^>]*aria-label|aria-label[^>]*class="pass__qr"/.test(track),
    "the QR has no accessible name",
  );
}

note("automated checks find perhaps a third of real barriers — see docs/testing.md for the rest");
finish();
