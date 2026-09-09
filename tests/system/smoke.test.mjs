/**
 * SYSTEM — smoke, sanity and API contract, over real HTTP.
 *
 * SMOKE asks the one question worth asking first: does the build stand up at
 * all? Every route answers something, nothing 500s, the security headers are
 * present. If this suite is red, no other result means anything.
 *
 * SANITY then checks the handful of behaviours a deploy most often breaks:
 * protected routes still redirect, endpoints still refuse an unauthenticated
 * caller, error pages still render.
 *
 * Needs the app running. Start it with `npm run dev` (port 4399), or point
 * TEST_BASE_URL at a deployment to smoke-test that instead.
 */
import { suite, is, ok, note, skip, finish, http, appUp, BASE } from "../harness.mjs";

suite(`SYSTEM · smoke and sanity (${BASE})`);

if (!(await appUp())) {
  skip("every check", `nothing serving at ${BASE} — start the dev server on 4399`);
  finish();
}

// --- Smoke: does anything 500? -----------------------------------------------
note("a 500 anywhere here means the build does not stand up");

const ROUTES = [
  ["/menu", "the customer menu"],
  ["/orders", "a guest's own orders"],
  ["/staff/login", "the staff login"],
  ["/staff", "the order desk"],
  ["/staff/today", "the day view"],
  ["/staff/analytics", "analytics"],
  ["/staff/tabs", "open tabs"],
  ["/staff/tables", "the QR sheet"],
  ["/staff/new", "the order builder"],
  ["/staff/access", "roles and access"],
  ["/kitchen", "the kitchen board"],
  ["/admin", "the menu manager"],
];

for (const [path, what] of ROUTES) {
  const r = await http(path);
  ok(`${what} does not error`, r.status < 500, `HTTP ${r.status} at ${path}`);
}

// --- Smoke: the front door ---------------------------------------------------
{
  const r = await http("/");
  ok("/ redirects to the menu", r.status === 301 || r.status === 302, `HTTP ${r.status}`);
  ok("...and points at /menu", (r.location ?? "").includes("/menu"), r.location ?? "no location");
}

// --- Sanity: protected routes are protected ----------------------------------
note("signed out, every staff surface must send you to the login page");

for (const path of ["/staff", "/staff/today", "/staff/analytics", "/kitchen", "/admin", "/staff/access"]) {
  const r = await http(path);
  const redirected = r.status === 302 && (r.location ?? "").includes("/staff/login");
  ok(`${path} redirects when signed out`, redirected, `HTTP ${r.status} → ${r.location ?? "-"}`);
}

// The login page itself must NOT redirect, or nobody can ever sign in. This is
// the bug that shipped once: /staff/login inherited the /staff prefix.
{
  const r = await http("/staff/login");
  is("the login page renders rather than redirecting", r.status, 200);
}

// --- Sanity: the API refuses an unauthenticated caller -----------------------
for (const [method, path] of [
  ["POST", "/api/staff/orders/new"],
  ["POST", "/api/staff/access/permissions"],
  ["POST", "/api/staff/access/role"],
  ["POST", "/api/staff/kitchen/availability"],
  ["GET", "/api/staff/orders/pending"],
  ["GET", "/api/staff/kitchen/active"],
]) {
  const r = await http(path, { method, headers: { accept: "application/json" } });
  // 401 is the honest answer; a redirect to login is acceptable for form posts.
  const refused = r.status === 401 || r.status === 403 || r.status === 302 || r.status === 303;
  ok(`${method} ${path} refuses an anonymous caller`, refused, `HTTP ${r.status}`);
}

// --- Sanity: public endpoints stay public ------------------------------------
{
  const r = await http("/api/menu/availability");
  is("menu availability is public", r.status, 200);
  const body = r.json();
  ok("...and returns an ids array", Array.isArray(body?.ids), JSON.stringify(body)?.slice(0, 120));
}

// --- Contract: order tracking ------------------------------------------------
{
  const r = await http("/api/orders/NOSUCHCODE");
  is("an unknown order code is 404, not 500", r.status, 404);
  ok("...with a JSON body", r.json() !== null, r.text.slice(0, 120));
}

// --- Error pages -------------------------------------------------------------
{
  const r = await http("/definitely-not-a-page");
  is("an unmatched route is 404", r.status, 404);
  // The apostrophe arrives HTML-escaped, so match the halves around it rather
  // than the rendered entity — an assertion that depends on how a framework
  // escapes text is testing the framework.
  ok(
    "...and renders the custom page",
    r.text.includes("This page doesn") && r.text.includes("t exist"),
    "not the custom 404",
  );
  ok("...offering the guest a way back", r.text.includes("Back to the menu"), "no guest exit");
}

// --- Security headers --------------------------------------------------------
note("headers are asserted on a real response, not on the config that sets them");
{
  const r = await http("/menu");
  const h = r.headers;
  ok("Content-Security-Policy is set", Boolean(h.get("content-security-policy")), "missing");
  is("framing is denied", h.get("x-frame-options"), "DENY");
  is("MIME sniffing is off", h.get("x-content-type-options"), "nosniff");
  ok("a referrer policy is set", Boolean(h.get("referrer-policy")), "missing");
  ok("a permissions policy is set", Boolean(h.get("permissions-policy")), "missing");

  const csp = h.get("content-security-policy") ?? "";
  ok("the CSP forbids framing", csp.includes("frame-ancestors 'none'"), csp.slice(0, 160));
  ok("the CSP pins form targets", csp.includes("form-action 'self'"), csp.slice(0, 160));
  ok("the CSP blocks plugins", csp.includes("object-src 'none'"), csp.slice(0, 160));
}

// --- No secret ever reaches the browser --------------------------------------
{
  const r = await http("/menu");
  ok("no service-role key in the HTML", !r.text.includes("sb_secret_"), "a secret key is in the page");
  ok("no service_role JWT in the HTML", !/"role":"service_role"/.test(r.text), "a service JWT is in the page");
  ok("no table-token secret in the HTML", !r.text.includes("TABLE_TOKEN_SECRET"), "the signing secret is named in the page");
}

// --- What a crawler is told --------------------------------------------------
// The app is noindex by default, deliberately: per-table QR links and order
// codes are per-guest and have no business in a public index. The browse menu
// is the one exception — a restaurant wants its menu findable — so the sitemap
// lists exactly that one URL and robots.txt closes everything else.
note("only the browse menu is public to a crawler; everything else is per-guest");
{
  const r = await http("/sitemap.xml");
  is("the sitemap is served", r.status, 200);
  ok(
    "...as XML",
    (r.headers.get("content-type") ?? "").includes("xml"),
    `content-type was ${r.headers.get("content-type")}`,
  );
  ok("...listing the browse menu", /<loc>[^<]*\/menu<\/loc>/.test(r.text), "the menu is not in the sitemap");
  for (const path of ["/staff", "/kitchen", "/admin", "/order/"]) {
    ok(
      `...and not ${path}`,
      !new RegExp(`<loc>[^<]*${path}`).test(r.text),
      `${path} is advertised to crawlers`,
    );
  }
}
{
  const r = await http("/robots.txt");
  is("robots.txt is served", r.status, 200);
  ok("...pointing at the sitemap", /Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/i.test(r.text), r.text.slice(0, 120));
  // /menu/ with a segment is a signed per-table token. Crawling one would not
  // just read a page — resolveMenuAccess opens a tab on first visit.
  for (const path of ["/staff", "/kitchen", "/admin", "/order/", "/menu/"]) {
    ok(`...disallowing ${path}`, new RegExp(`Disallow:\\s*${path}`).test(r.text), `${path} is not disallowed`);
  }
}
{
  const menu = await http("/menu");
  ok(
    "the browse menu is indexable",
    !/name=["']robots["'][^>]*noindex/.test(menu.text),
    "the one page worth indexing still says noindex",
  );
  const login = await http("/staff/login");
  ok(
    "...while the staff surfaces are not",
    /name=["']robots["'][^>]*noindex/.test(login.text),
    "a staff page lost its noindex",
  );
}

// --- The document itself -----------------------------------------------------
// View source was two meta tags and a title. A restaurant page that shares to
// WhatsApp with no name, no description and no image is a page nobody opens.
{
  const r = await http("/menu");
  const head = r.text;
  ok("there is a favicon", /rel=["'][^"']*icon/.test(head), "no icon link — the browser asks for /favicon.ico and 404s");
  ok("there is a canonical URL", /rel=["']canonical["']/.test(head), "no canonical — duplicate URLs compete");
  ok("Open Graph names the page", /property=["']og:title["']/.test(head), "no og:title — shared links show a bare URL");
  ok("...and describes it", /property=["']og:description["']/.test(head), "no og:description");
  ok("...and gives its type", /property=["']og:type["']/.test(head), "no og:type");
  ok("...and its own URL", /property=["']og:url["']/.test(head), "no og:url");
  ok("a Twitter card is declared", /name=["']twitter:card["']/.test(head), "no twitter:card");
  ok(
    "the restaurant is described as structured data",
    /application\/ld\+json/.test(head) && /"@type"\s*:\s*"Restaurant"/.test(head),
    "no JSON-LD Restaurant — search engines cannot read the address or hours",
  );
}
// --- A door into a room with nothing in it -----------------------------------
// Astro 7.2.4 carried a critical RCE in AVIF image optimization
// (GHSA-26w7-cxv4-gfx2), and /_image was routed to the render function on the
// deployment. The upgrade closes that specific hole; this closes the endpoint.
//
// There is not one <img>, <Image> or getImage() in the source. The app was
// exposing an image-processing surface — historically a rich source of memory
// bugs, in a library that decodes attacker-supplied bytes — for a feature it
// has never used once.
{
  const r = await http("/_image?href=/favicon.svg&w=10&f=avif");
  ok(
    `the image endpoint is not exposed (HTTP ${r.status})`,
    r.status === 404,
    `HTTP ${r.status} — /_image still reaches the image service, which decodes bytes a stranger chose`,
  );
}

// --- The endpoint a full floor hammers ---------------------------------------
// Every guest phone polls availability every five seconds. Twenty tables is
// four requests a second, each waking a function and reading the database, and
// that is what put p95 at 1624ms under a full floor in the load test.
//
// Every guest gets a byte-identical answer, so exactly one of those reads is
// useful and the rest are the same query repeated. Letting the edge hold it for
// a few seconds collapses them. The cost is that an 86'd dish stays VISIBLE a
// few seconds longer — which is cosmetic only, because createOrder re-reads
// availability and refuses a sold-out dish however stale the menu looked.
// Asserted differently in the two places this suite runs, because the header
// the origin sends is NOT the header a client sees through the CDN. Vercel
// consumes s-maxage and stale-while-revalidate at the edge and passes
// `max-age=0` downstream, so checking the directives against a deployment fails
// while the caching works perfectly. What is observable there is the edge
// answering from memory, so that is what gets checked there.
{
  const r = await http("/api/menu/availability");
  const cc = r.headers.get("cache-control") ?? "";
  const behindCDN = r.headers.has("x-vercel-cache");

  ok(
    "the availability poll is not held by the browser itself",
    /(^|,|\s)max-age=0/.test(cc),
    `cache-control was "${cc}" — a phone could sit on its own stale copy past the window`,
  );

  if (behindCDN) {
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const again = await http("/api/menu/availability");
      seen.push(again.headers.get("x-vercel-cache"));
    }
    ok(
      `the edge answers the poll rather than the database (${seen.join(", ")})`,
      seen.some((s) => s === "HIT" || s === "STALE"),
      "every poll reached the origin — a full floor is hitting the database four times a second",
    );
  } else {
    ok(
      "the availability poll is shared-cacheable",
      /s-maxage=\d+/.test(cc),
      `cache-control was "${cc}" — every phone's poll reaches the database`,
    );
    ok(
      "...and the window is short enough for a dish selling out",
      Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? 999) <= 5,
      `s-maxage was ${/s-maxage=(\d+)/.exec(cc)?.[1]}s — too long for a menu that changes mid-service`,
    );
    ok(
      "...and a refresh never costs a guest the wait",
      /stale-while-revalidate=\d+/.test(cc),
      `cache-control was "${cc}" — the unlucky poll that lands on expiry pays the full query`,
    );
  }
}
{
  const r = await http("/favicon.svg");
  is("the favicon is served", r.status, 200);
  ok(
    "...as SVG",
    (r.headers.get("content-type") ?? "").includes("svg"),
    `content-type was ${r.headers.get("content-type")}`,
  );
}

finish();
