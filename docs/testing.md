# Testing

```bash
npm test                  # the gate: unit + integration + security + regression
npm run test:all          # everything, including the slow levels
npm run test:unit         # one level
npm run test:system       # needs the app running on :4399
```

Suites live in `tests/<level>/*.test.mjs`. Each runs in its own process, so one
crashing cannot take the others with it. There is no framework — the harness in
`tests/harness.mjs` is about a hundred lines and prints the value it got beside
the value it wanted, which is the only thing a failing test needs to do.

---

## Two rules these tests are built on

**A test that cannot fail is not a test.** Several suites here mirror app logic,
because the real modules import through Astro's alias and node cannot resolve
them standalone. A mirror tested against itself always passes — the first
version of `unit/money.test.mjs` used 5% service and 2dp rounding when the app
uses 10% and whole rupees, and every assertion was green. So every mirror is
**pinned to its source**: the constants and the critical lines are read out of
the real file and asserted before anything else runs. Change a rate, and the
tests fail rather than quietly measuring an app that no longer exists.

**Assert on the effect, not the response.** `security/rls.test.mjs` originally
checked HTTP status codes, and reported a breach where there was none: PostgREST
answers an `UPDATE` that matched zero rows with the same `204` it returns for
one that changed everything. It now snapshots the data, attempts the write, and
compares — which is the only version of that test that can tell the two apart.

---

## Levels

### Unit — `tests/unit/`
Pure logic, no network, milliseconds. Money and billing arithmetic, timezone day
boundaries, month grids and date ranges, table-token signing and verification,
session-token hashing, the RBAC rules, and the optional-column fallback.

The token tests are written adversarially: forged signatures, truncated and
extended tokens, a valid signature stapled to a different table's label, a token
signed with a rotated secret, and verification with no secret configured at all.

### Integration — `tests/integration/`
The app's **real select strings** against the real database. This level exists
because of one specific failure mode: PostgREST names an embed after the foreign
key behind it, and if a name is wrong the app's fallback retries *without* the
embed, the query succeeds, and a whole feature silently never appears. Nothing
logs an error. Only running the real query finds it.

Also checks the constraints that protect money — one open tab per table, unique
order codes, no orphaned grants, an owner exists.

### System — `tests/system/`
Smoke, sanity and API contract over real HTTP. Smoke asks the only question
worth asking first: does the build stand up, and does anything 500? Sanity then
covers what a deploy most often breaks — protected routes still redirect,
endpoints still refuse anonymous callers, error pages still render, security
headers are actually on the response rather than merely in the config.

Needs the app running: `npm run dev` (port 4399), or set `TEST_BASE_URL` to
smoke-test a deployment.

### Regression — `tests/regression/`
Every bug that shipped broken this cycle, pinned. The stacking-context fill-mode,
the toggle knob escaping its track, tonight's tabs appearing on past days,
table-less server orders, the login page demanding a permission to reach the
login page, `has_permission()` returning NULL, the non-atomic permission save,
polling that never stopped, and the kitchen's last role check.

These assert against the **source file**, not a mirror — each was a failure of a
specific line, and a mirror would happily keep passing after that line reverted.

### Security — `tests/security/`
Penetration probes, not policy review. They present the publishable key — the
one shipped in every page a guest loads — and try to take something: read
orders, tabs, profiles and the audit trail; insert an order; rewrite every
price; delete orders; forge an audit entry; grant themselves a permission; 86 a
dish. The 86 probe is the live exploit that was real (see `012`), and it
restores the dish whichever way it goes.

It also asserts the inverse, because denying everything is not the goal: anon
**can** read the public menu, and **cannot** see what is 86'd.

`npm run verify-rbac` complements this with installation checks.

### Performance — `tests/performance/`
Load, stress, spike, volume, scalability and a short soak, sized to **one
restaurant** — twenty tables, a phone each, a couple of staff devices. Not a
thousand concurrent users, because this app will never see them.

Thresholds are deliberately generous. They exist to catch a *regression* — a
tenfold change — not to police milliseconds, because a suite that goes red when
a laptop is busy trains everyone to ignore it.

Run against the dev server this measures the dev server, and says so. Point
`TEST_BASE_URL` at a deployment for numbers worth quoting. A longer soak:
`SOAK_SECONDS=600 npm run test:performance`.

### Accessibility — `tests/a11y/`
The structural failures a machine can find honestly: missing `lang`, no `main`
landmark, images without alt text, buttons with no accessible name, inputs with
no label (explicit *or* implicit — an input wrapped in a `<label>` is properly
labelled, and an earlier version of this test wrongly flagged those), links with
no text, `target="_blank"` without `noopener`, reduced-motion support, visible
focus, and a 44px touch floor.

**Automated checks find a minority of real barriers** — commonly cited around a
third. What follows below needs a person.

### Compatibility — `tests/compat/`
What the shipped bundle requires of a browser, CSS features and how gracefully
they fail, CRLF and absolute-path hazards across Windows and Linux, backward
compatibility with an unmigrated database, forward compatibility with a retired
enum value, and localisation consistency.

This machine has Chromium only, so **it makes no claim about Safari**. The
device matrix that needs real hardware is below.

---

## What is not automated, and why

These are the levels that need people or hardware. Writing a script that claimed
to cover them would be worse than admitting it does not.

### User Acceptance Testing — the restaurant, before going live

Run on the real deployment, with real accounts, ideally during a quiet service.

**Guest**
- [ ] Scan a table QR with a phone that has never seen the site. The menu opens,
      showing the right table.
- [ ] Place an order. It appears on the kitchen board within seconds.
- [ ] A second phone at the same table scans and orders. **Both phones keep
      working** and both rounds land on one bill.
- [ ] A dish is 86'd in the kitchen; it disappears from the guest's menu.
- [ ] Lock the phone for two minutes, unlock it: the menu is current, not stale.
- [ ] Scan a QR for a table that has already paid. The old session does not
      resurrect.

**Server**
- [ ] Take an order at the table on a staff device.
- [ ] Confirm a guest's order from the order desk.
- [ ] Void an order. Confirm `npm run audit` names *you*.
- [ ] Move a tab to another table; the kitchen sees the new table.
- [ ] Merge two tables. Both sets of guests can still order onto the joint bill.
- [ ] Close the tab. Print the bill. **Check the printed total against a
      calculator** — this is the one number a guest will dispute.

**Kitchen**
- [ ] Tickets appear in the order they were confirmed.
- [ ] The wait timer turns amber, then red.
- [ ] Filter to Late, Just in, With notes — the counts match the tickets.
- [ ] 86 a dish and put it back.

**Manager / owner**
- [ ] Today's takings match the till at close.
- [ ] Pick a range covering a known week; the total matches.
- [ ] Analytics' busiest hour matches when the restaurant is actually busy —
      if it is off by 5½ hours, a timezone regression has shipped.
- [ ] Change a permission; the affected staff member gains or loses the page.
- [ ] `npm run audit` shows the shift.

### Alpha testing — staff only, before guests
One full service with staff placing every order themselves on real hardware, on
the restaurant's own wifi, at the real table positions. This is where signal
dead spots and QR codes stuck somewhere unreachable get found, and no amount of
localhost testing substitutes for it.

### Beta testing — real guests, limited blast radius
A handful of tables on a quiet weeknight, with paper menus still on the table
and a server watching. The failure worth catching is not a crash — it is a guest
who cannot work out how to order and gives up without saying so.

### Operational Acceptance Testing — can it be run?
- [ ] A rotated key can be swapped with no downtime (`npm run check-keys`).
- [ ] Migrations apply cleanly to a fresh database, in order.
- [ ] Deploying **before** applying a migration degrades rather than breaks —
      the fallbacks in `compat/` cover the code paths; this confirms it end to
      end.
- [ ] `npm run audit` answers on the production project.
- [ ] Supabase's backup/restore has actually been tried, not assumed.
- [ ] Someone other than the person who built it can follow `docs/setup.md`.

### Cross-browser / cross-platform — needs hardware
| Device | Why it matters |
|---|---|
| iPhone, Safari | Roughly half of guests. The only engine not testable here. |
| Android, Chrome | The other half. |
| iPad / Android tablet | The staff surfaces are designed for this. |
| Thermal printer | The KOT and the bill are 80mm roll output, and nothing about that can be checked on screen. |

### Usability — needs a person who has not seen it
Hand a phone to someone who does not work there and say nothing. Watch where
they hesitate. Every hesitation is a defect the tests above cannot see.

---

## Adding a test

Put it in the level it belongs to, import from `../harness.mjs`, and end with
`finish()`. If it mirrors app logic, pin the mirror to the source first. If it
asserts a policy holds, assert on the data, not the status code.
