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

finish();
