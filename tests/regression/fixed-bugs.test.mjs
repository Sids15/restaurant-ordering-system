/**
 * REGRESSION — bugs that were real, pinned so they cannot come back.
 *
 * Every case here is something that shipped broken and was found by someone
 * looking at the app, not by a test. That is what makes them worth keeping: a
 * bug that reached production once has already proved the reasoning that
 * allowed it is easy to repeat.
 *
 * Each is written against the source file rather than a mirror where possible,
 * because the failures below were failures of a specific line, and a mirror
 * would happily keep passing after that line changed back.
 */
import { readFileSync } from "node:fs";
import { suite, is, ok, note, finish } from "../harness.mjs";

const read = (p) => readFileSync(p, "utf8");

/**
 * Source with comments stripped, for assertions about what the code DOES.
 *
 * Needed because several of these files explain in prose the very construct
 * they avoid — use-poll.ts documents why it does not use setInterval — and a
 * naive search would fail on the comment that proves the fix is understood.
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

suite("REGRESSION · bugs that were real");

// --- The day picker painted under the page -----------------------------------
// An ANIMATED transform always computes to a matrix — including the identity
// matrix that `translateY(0)` and `none` both produce — and any transform that
// is not the `none` keyword makes the element a stacking context. With
// fill-mode `both` that matrix stayed applied for the life of the page, so the
// masthead trapped its own dropdown behind the content below it.
//
// The fix was the FILL MODE, not the keyframe. Changing `to:` alone did
// nothing, which is why this pins the fill mode specifically.
{
  const css = read("src/styles/staff.css");
  const fills = [...css.matchAll(/animation:\s*st-rise[^;]*;/g)].map((m) => m[0]);
  ok("st-rise is still used", fills.length > 0, "the reveal animation vanished");
  is(
    "no reveal animation uses fill-mode `both`",
    fills.some((f) => /\bboth\b/.test(f)),
    false,
  );
  is(
    "every reveal animation uses `backwards`",
    fills.every((f) => /\bbackwards\b/.test(f)),
    true,
  );

  // The same latent bug lived in three other animations.
  for (const [what, file] of [
    ["pending queue", "src/components/order/pending-queue.css"],
    ["login stage", "src/pages/staff/login.astro"],
    ["admin toast", "src/pages/admin/index.astro"],
  ]) {
    const src = read(file);
    const both = /animation:[^;]*\bboth\b[^;]*;/.test(src);
    is(`${what} does not use fill-mode both`, both, false);
  }

  // And the masthead states its layering rather than relying on nothing
  // downstream forming a context.
  const masthead = read("src/components/staff/StationMasthead.astro");
  ok(
    "the masthead declares its own stacking context",
    /position:\s*relative/.test(masthead) && /z-index:\s*1/.test(masthead),
    "the masthead no longer pins itself above the content it floats over",
  );
}

// --- The toggle knob escaped its track ---------------------------------------
// The travel was a hand-picked 1.1rem with no relation to the track width, and
// the track had no shrink guard — so a narrow column squeezed the track while
// the knob kept its size and slid straight out of the far end.
{
  const access = read("src/pages/staff/access.astro");
  ok(
    "the knob's travel is derived, not hand-picked",
    /translateX\(calc\(var\(--track-w\) - var\(--knob\) - var\(--pad\) \* 2\)\)/.test(access),
    "the toggle travel is a magic number again — it will overshoot at some width",
  );
  ok(
    "the track cannot be shrunk by its flex parent",
    /\.toggle__track \{[^}]*flex:\s*0 0 auto/s.test(access),
    "the track can shrink again, which is half of how the knob escaped",
  );
}

// --- The manager's day view showed tonight's tabs on every past day ----------
// The open-tab read had no date filter at all, so it returned whatever was open
// right now and dropped it into every historical day.
{
  const src = read("src/lib/orders/manager.ts");
  ok(
    "a period that has already closed filters open tabs by date",
    /isToday \? q : q\.gte\("opened_at", from\)\.lt\("opened_at", to\)/.test(src),
    "open tabs are unfiltered again — every past day will show tonight's floor",
  );
  ok(
    "'is this period current' is derived from the bounds, not a date key",
    /range\.start\.getTime\(\) <= now && now < range\.end\.getTime\(\)/.test(src),
    "the today check went back to comparing a date key, which has no meaning for a range",
  );
}

// --- A server-built order could be created with no table ---------------------
// Without a table the order opens no tab, so it never joins the collective
// bill, never inherits the assigned server, and shows as "No table".
{
  const api = read("src/pages/api/staff/orders/new.ts");
  ok(
    "the endpoint refuses an order with no table",
    /if \(!table_label\) return context\.redirect\("\/staff\/new\?err=table", 303\);/.test(api),
    "a server-built order can be created with no table again",
  );
  const page = read("src/pages/staff/new.astro");
  ok("the form marks the table required", /\brequired\b/.test(page), "the required attribute is gone");
  ok(
    "the submit button waits for a table too",
    /hasTable/.test(page),
    "the order bar no longer tracks whether a table was entered",
  );
}

// --- /staff/login demanded a permission to reach the login page --------------
// It sits under /staff, so it inherited that prefix's permission: you had to
// already be signed in to reach the page that signs you in.
{
  const perms = read("src/lib/auth/permissions.ts");
  ok(
    "the login page is exempt from the /staff prefix",
    /UNGATED = new Set\(\["\/staff\/login"\]\)/.test(perms),
    "the login page is permission-gated again",
  );
}

// --- has_permission() returned NULL, and a caller read that as allowed -------
// SQL's three-valued logic met PL/pgSQL's IF, which does not take a NULL
// branch — so `if not has_permission(...) then raise` skipped the raise and
// fell through to the UPDATE.
{
  const sql = read("supabase/migrations/012_has_permission_null.sql");
  ok(
    "has_permission coalesces so it cannot return NULL",
    /coalesce\(current_role_name\(\) = 'owner', false\)/.test(sql),
    "the NULL guard is gone",
  );
  ok(
    "the caller tests `is not true`, which refuses on NULL as well as false",
    /has_permission\('kitchen\.availability'\) is not true/.test(sql),
    "the caller went back to plain `not`, which does nothing on NULL",
  );
  ok(
    "anon has no EXECUTE on the privileged functions",
    /revoke execute on function set_item_availability\(uuid, boolean\) from anon, public;/.test(sql),
    "the revoke is gone",
  );
}

// --- Saving permissions could strip every role -------------------------------
// Delete-then-insert across two round trips leaves every role holding nothing
// in between, and there if the insert never lands.
{
  const sql = read("supabase/migrations/013_set_grants_atomic.sql");
  ok(
    "the matrix is written in one transaction",
    /create or replace function set_role_permissions/.test(sql),
    "the atomic write is gone",
  );
  ok(
    "the function refuses a non-owner NULL-safely",
    /coalesce\(current_role_name\(\) = 'owner', false\) is not true/.test(sql),
    "the owner check is not NULL-safe — the same shape as the 012 hole",
  );
  const rbac = read("src/lib/auth/rbac.ts");
  ok(
    "the app calls the atomic function first",
    /supabase\.rpc\("set_role_permissions"/.test(rbac),
    "writeGrants no longer uses the transactional path",
  );
}

// --- Polling never stopped ---------------------------------------------------
// Every island polled forever, including on a phone face-down with the tab in
// the background.
{
  const poll = read("src/components/order/use-poll.ts");
  ok(
    "polling stops while the document is hidden",
    /document\.visibilityState === "visible"/.test(poll),
    "the visibility guard is gone",
  );
  ok(
    "it catches up when the tab is looked at again",
    /visibilitychange/.test(poll),
    "returning to the tab no longer refreshes",
  );
  ok(
    "chained timeout, not setInterval, so slow responses cannot stack",
    /setTimeout\(run, delay\)/.test(poll) && !/setInterval\(/.test(stripComments(poll)),
    "usePoll went back to setInterval",
  );

  // Every island must be on the shared hook, or it is polling forever again.
  for (const island of [
    "KitchenBoard",
    "OrderStatus",
    "PendingQueue",
    "AvailabilityPanel",
    "MenuApp",
  ]) {
    const src = read(`src/components/order/${island}.tsx`);
    const rogue = /setInterval\(/.test(src);
    is(`${island} has no bare setInterval`, rogue, false);
  }
}

// --- Kitchen "mark ready" was still gated on a role --------------------------
// After the move to permissions, this one line kept checking role === "kitchen",
// so a manager granted kitchen.view could see the board but not work it.
{
  const page = read("src/pages/kitchen/index.astro");
  is(
    "the board's complete action is permission-gated",
    /canComplete=\{profile!\.role === "kitchen"\}/.test(page),
    false,
  );
  ok(
    "...and uses can()",
    /canComplete=\{can\(grants, "kitchen\.view"\)\}/.test(page),
    "the kitchen board's complete gate is not a permission check",
  );
}

// --- Guest session tokens were stored in plaintext ---------------------------
{
  const tabs = read("src/lib/orders/tabs.ts");
  const session = read("src/lib/orders/session.ts");
  is("tabs.ts never writes a plaintext token", /session_token\b(?!_hash)/.test(tabs), false);
  ok(
    "sessions resolve by hash",
    /hashSessionToken\(token\)/.test(session),
    "the session lookup is not hashing the cookie value",
  );
  ok(
    "one tab can hold many devices",
    /tab_sessions/.test(tabs),
    "sessions are back on the tab row, which means one device per table",
  );
}

// --- The Place button stuck on "Placing…" ------------------------------------
// placeOrder deliberately leaves `placing` true on success and navigates away,
// so a double-tap mid-navigation cannot send a second order. But pressing Back
// restores the page from the back-forward cache with its JavaScript state
// intact — `placing` still true — and the button sat disabled forever. It was
// never a hung request; it was a page that was never re-created.
{
  const menu = read("src/components/order/MenuApp.tsx");
  ok(
    "a bfcache restore resets the placing state",
    /addEventListener\("pageshow"/.test(menu) && /e\.persisted/.test(menu),
    "no pageshow/persisted handler — the Place button will stick again after Back",
  );
  ok(
    "...and clears the confirmation step with it",
    /setPlacing\(false\);[\s\S]{0,80}setConfirming\(false\);/.test(menu),
    "a restored page could come back mid-confirmation",
  );

  // Nothing may reach the kitchen on a single tap.
  ok(
    "the first tap only asks",
    /onClick=\{onConfirm\}/.test(menu),
    "Place order posts directly again — an accidental tap becomes a real round",
  );
  ok(
    "only the confirm actually places",
    /className="place confirm__go"[\s\S]{0,120}onClick=\{onPlace\}/.test(menu),
    "the confirm button is not the one that posts",
  );
  ok(
    "an empty cart cannot be sent",
    /disabled=\{placing \|\| count === 0\}/.test(menu),
    "the Place button is enabled with nothing in the cart",
  );
  ok(
    "a failed send returns to the summary, not the cart",
    // Comments stripped: the two calls sit either side of an explanatory
    // comment, and measuring the gap in raw characters would break the moment
    // someone reworded it.
    /setPlacing\(false\);\s*setConfirming\(true\);/.test(stripComments(menu)),
    "after an error the guest is dropped back to the cart, which reads as if it half-worked",
  );
}

note("each of these shipped broken once; the assertions are what stop a repeat");
finish();
