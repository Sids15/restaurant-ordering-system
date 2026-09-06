# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Berlin nocturnal design across every app surface with a standardized, warm-and-appetizing, white-label restaurant UI re-skinnable from a single brand config.

**Architecture:** A rewritten `tokens.css` (warm light system) is the single styling contract. A new `src/data/brand.ts` holds a restaurant's identity (name, tagline, accent, radius, currency, contact); `AppLayout.astro` reads it and injects `--brand-accent` / `--radius-base` as CSS custom properties on `<body>`, which the tokens derive from. Every component/page consumes tokens only — no brand-specific values, no scroll-driven palette engine.

**Tech Stack:** Astro 7 (`output: "server"`, Vercel adapter), React 19 islands, self-hosted variable fonts via `@fontsource-variable` (Fraunces + DM Sans), CSS custom properties, `color-mix()` for accent/status derivations.

**Spec:** `docs/superpowers/specs/2026-09-06-frontend-redesign-design.md`

## Testing note (read before starting)

This is a presentation-layer redesign; there is no logic to unit-test. Each task's verification cycle is therefore:
1. **`npm run build`** must pass (from the repo root).
2. **Targeted grep** confirming no forbidden leftovers (dead tokens/classes) remain in the files that task touched — exact commands given per task.
3. **Visual smoke** (`npm run dev`, open the named routes) — a human/reviewer check, not automated.

Do not treat a passing build alone as done; the grep gate is what proves the Berlin design is actually gone from each surface. Behavior, flows, APIs, and data model must not change — this is styling + markup only.

## Global Constraints

- **Node:** `22.x` (package.json `engines`). Dev machine runs v24 — the `EBADENGINE` warning is benign; do not "fix" it.
- **No brand-specific content in components.** No `"Berlin"`, `"Haus de Gourmet"`, roman numerals, rooftop imagery, `mode-night`/`mode-editorial`/`mode-after-dark`, `--color-void` (or any `--color-*` Berlin raw palette) anywhere after the plan completes.
- **Components consume tokens only** — never hard-coded hex/spacing/type values (accent, surfaces, ink, borders, radius, status colors, spacing, type all come from `tokens.css`).
- **Light-only.** Structure tokens so a future `[data-theme="dark"]` block could redefine the same names, but do not build dark mode.
- **Behavior frozen.** No changes to `src/pages/api/**`, `src/lib/**`, `src/middleware.ts`, `supabase/**`, order lifecycle, auth, or props/data contracts. Markup may change; the data it renders may not.
- **Safety:** `npm run scan:all` must pass before the final commit. Never commit secrets.
- **Attribution (only when the user asks to commit):** end commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` then
  `Claude-Session: https://claude.ai/code/session_01NkWFyKXWfJVq58wJ7pEq8S`.
  Currently on `main` — branch first before any commit.

## File structure (created / modified across the plan)

- **Create:** `src/data/brand.ts` — restaurant identity (name, tagline, accent, radius, currency, contact).
- **Rewrite:** `src/styles/tokens.css` — warm light white-label token system.
- **Rewrite/edit:** `src/styles/global.css` — base on new tokens; drop Berlin/Lenis-only bits as their consumers go.
- **Edit:** `src/layouts/AppLayout.astro` — fonts, body class, theme-color, inject brand vars, `.app` surface.
- **Delete:** `src/data/site.ts` (folded into `brand.ts`); `src/assets/rooftop/` (login photo) + its row in `src/assets/README.md`.
- **Edit:** `package.json` — swap font deps; drop `lenis` (Task 2); update `description`.
- **Rewrite styles:** `menu-app.css`, `order-builder.css`, `staff.css`, `kitchen-board.css`, `availability-panel.css`, `pending-queue.css`, `table-qr.css`.
- **Restyle components/pages:** `MenuApp.tsx`, `OrderStatus.tsx`, `MenuView.astro`, `PendingQueue.tsx`, `KitchenBoard.tsx`, `AvailabilityPanel.tsx`, `DishForm.astro`, `StationMasthead.astro`, and all pages under `src/pages/{menu,order,staff,kitchen,admin}/**` + `src/pages/orders.astro`.

---

## Task 1: Foundation — tokens, brand config, fonts, layout

**Files:**
- Create: `src/data/brand.ts`
- Rewrite: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: `src/layouts/AppLayout.astro`
- Modify: `src/components/order/MenuApp.tsx:29` (import path only)
- Modify: `package.json`
- Delete: `src/data/site.ts` (after confirming importers)

**Interfaces:**
- Produces: `brand` object from `src/data/brand.ts` with shape
  `{ name: string; tagline: string; accent: string /* hex */; radius: "sharp"|"medium"|"soft"; currency: string; contact: { phoneDisplay, phoneHref, whatsappHref, mapsHref, address:{line1,line2,line3}, hours } }`.
- Produces: token contract every later task consumes — surfaces `--surface`, `--surface-raised`, `--surface-sunken`; ink `--ink`, `--ink-muted`; borders `--border`, `--border-strong`; accent `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent`; status `--status-pending|confirmed|preparing|ready|served` (+ each `-soft`) and `--danger` (+ `--danger-soft`); radius `--radius-sm|md|lg|pill`; plus existing spacing/type/container/motion/z tokens (retuned).

- [ ] **Step 1: Find every importer of `site.ts`**

Run:
```bash
grep -rn "data/site" src
```
Expected importers: `src/layouts/AppLayout.astro` (imports `brand`) and `src/components/order/MenuApp.tsx` (imports `contact`). If grep shows others, add them to Step 6's edit list.

- [ ] **Step 2: Create `src/data/brand.ts`**

```ts
/**
 * Restaurant identity for the white-label ordering app. Edit these values to
 * re-skin the whole app for a different restaurant — nothing brand-specific is
 * hard-coded in components. Everything here is public (it shows in the UI); no
 * secrets belong in this file.
 */
export const brand = {
  name: "Your Restaurant",
  tagline: "Fresh, made to order",
  /** One hex. Drives --accent and its hover/soft derivations across the app. */
  accent: "#C2410C",
  /** Corner roundness for the whole UI. */
  radius: "medium" as "sharp" | "medium" | "soft",
  /** Currency label; formatINR handling lives in lib/money. */
  currency: "INR",
  contact: {
    phoneDisplay: "+91 78801 56565",
    phoneHref: "tel:+917880156565",
    whatsappHref: "https://wa.me/917880156565",
    mapsHref:
      "https://www.google.com/maps/search/?api=1&query=High+Street+Apollo+Vijay+Nagar+Indore",
    address: {
      line1: "Level 06, High Street Apollo",
      line2: "Vijay Nagar, Indore",
      line3: "Madhya Pradesh 452010",
    },
    hours: "12:00 PM – 11:30 PM · Everyday",
  },
} as const;
```

- [ ] **Step 3: Rewrite `src/styles/tokens.css`** (replace the entire file)

```css
/* =============================================================================
   Standardized restaurant UI — Design Tokens (white-label, warm light)
   Single source of truth. Components consume these; they never invent their own
   colors, spacing, or type. A restaurant re-skins via src/data/brand.ts, which
   AppLayout injects as --brand-accent and --radius-base (with fallbacks below).
   Light-only for now; a future [data-theme="dark"] block can redefine the same
   semantic names without touching components.
   ========================================================================== */

:root {
  /* --- Brand inputs (AppLayout overrides these from brand.ts) --------------- */
  --brand-accent: #c2410c;
  --radius-base: 0.75rem; /* "medium"; sharp=0.25rem, soft=1.25rem */

  /* --- Surfaces (warm cream) ---------------------------------------------- */
  --surface: #fbf8f3;
  --surface-raised: #ffffff;
  --surface-sunken: #f3ede3;

  /* --- Ink ---------------------------------------------------------------- */
  --ink: #2a2521;
  --ink-muted: #6b6259;

  /* --- Borders ------------------------------------------------------------ */
  --border: rgba(42, 37, 33, 0.1);
  --border-strong: rgba(42, 37, 33, 0.18);

  /* --- Accent (derived from brand) ---------------------------------------- */
  --accent: var(--brand-accent);
  --accent-hover: color-mix(in srgb, var(--accent) 85%, #000);
  --accent-soft: color-mix(in srgb, var(--accent) 12%, var(--surface));
  --on-accent: #ffffff;

  /* --- Status (order lifecycle) ------------------------------------------- */
  --status-pending: #c2740c;
  --status-confirmed: #2563eb;
  --status-preparing: #7c3aed;
  --status-ready: #15803d;
  --status-served: #6b6259;
  --danger: #b91c1c;
  --status-pending-soft: color-mix(in srgb, var(--status-pending) 14%, var(--surface));
  --status-confirmed-soft: color-mix(in srgb, var(--status-confirmed) 14%, var(--surface));
  --status-preparing-soft: color-mix(in srgb, var(--status-preparing) 14%, var(--surface));
  --status-ready-soft: color-mix(in srgb, var(--status-ready) 14%, var(--surface));
  --status-served-soft: color-mix(in srgb, var(--status-served) 14%, var(--surface));
  --danger-soft: color-mix(in srgb, var(--danger) 12%, var(--surface));

  /* --- Typography --------------------------------------------------------- */
  --font-display: "Fraunces Variable", "Fraunces", Georgia, "Times New Roman", serif;
  --font-ui: "DM Sans Variable", "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif;

  --tracking-display: -0.01em;
  --tracking-label: 0.08em;

  /* Calm fluid scale — no oversized display. */
  --fs-display-xl: clamp(2.5rem, 5vw, 3.5rem);
  --fs-display-l: clamp(2rem, 4vw, 2.75rem);
  --fs-display-m: clamp(1.75rem, 3vw, 2.25rem);
  --fs-heading-l: clamp(1.5rem, 2.4vw, 1.875rem);
  --fs-heading-m: 1.375rem;
  --fs-heading-s: 1.125rem;
  --fs-body-l: 1.0625rem;
  --fs-body: 0.9375rem;
  --fs-caption: 0.8125rem;
  --fs-label: 0.6875rem;

  --lh-heading: 1.15;
  --lh-body: 1.6;

  /* --- Radius scale (derived from --radius-base) -------------------------- */
  --radius-sm: calc(var(--radius-base) * 0.5);
  --radius-md: var(--radius-base);
  --radius-lg: calc(var(--radius-base) * 1.5);
  --radius-pill: 999px;

  /* --- Elevation ---------------------------------------------------------- */
  --shadow-sm: 0 1px 2px rgba(42, 37, 33, 0.06);
  --shadow-md: 0 4px 16px rgba(42, 37, 33, 0.08);
  --shadow-lg: 0 12px 32px rgba(42, 37, 33, 0.12);

  /* --- Spacing · 8px base ------------------------------------------------- */
  --space-4: 0.25rem;
  --space-8: 0.5rem;
  --space-12: 0.75rem;
  --space-16: 1rem;
  --space-24: 1.5rem;
  --space-32: 2rem;
  --space-40: 2.5rem;
  --space-48: 3rem;
  --space-64: 4rem;
  --space-80: 5rem;
  --space-96: 6rem;
  --space-section: clamp(3rem, 7vw, 5rem);

  /* --- Containers --------------------------------------------------------- */
  --container-lg: 75rem;   /* 1200px */
  --container-md: 48rem;   /* 768px  */
  --measure: 34rem;
  --gutter: clamp(1rem, 4vw, 2rem);

  /* --- Controls ----------------------------------------------------------- */
  --btn-height: 2.875rem;
  --btn-padding-inline: 1.5rem;
  --field-height: 2.75rem;

  /* --- Motion ------------------------------------------------------------- */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-fast: 140ms;
  --dur-reveal: 360ms;

  /* --- Layering ----------------------------------------------------------- */
  --z-header: 100;
  --z-cartbar: 150;
  --z-overlay: 200;
}
```

- [ ] **Step 4: Update `src/styles/global.css`**

Make these exact changes (keep the file's reset + primitives; retarget Berlin bits):
1. Change the top comment banner from "BERLIN — Haus de Gourmet · Global base" to "Standardized restaurant UI · Global base".
2. In `::selection`, change `color: var(--color-void);` → `color: var(--on-accent);`.
3. In `.section`, it currently sets `background-color: var(--bg); color: var(--text);` — change to `background-color: var(--surface); color: var(--ink);`.
4. `body` currently uses `--bg`/`--text` — change to `background-color: var(--surface); color: var(--ink);`.
5. In base typography `h1,h2,h3`, change `color: var(--text);` → `color: var(--ink);`.
6. Leave the Lenis smooth-scroll classes (`html.lenis`, `.lenis.lenis-smooth`, `[data-lenis-prevent]`, `.lenis.lenis-stopped`) in place for now — MenuApp still imports Lenis until Task 2, which removes both.
7. Leave `.eyebrow` but change its `color: var(--text-muted);` → `color: var(--ink-muted);`.

Then verify no `--color-*`, `--bg`, `--text`, `--accent-muted`, `--text-muted` remain in this file (grep in Step 8).

- [ ] **Step 5: Rewrite `src/layouts/AppLayout.astro`**

```astro
---
/**
 * AppLayout — document shell for the ordering app (menu, order tracking, staff,
 * kitchen, admin). Reads the restaurant's brand config and injects it as CSS
 * custom properties so the whole app re-skins from src/data/brand.ts.
 */
import "@fontsource-variable/fraunces";
import "@fontsource-variable/dm-sans";
import "../styles/global.css";
import { brand } from "../data/brand";

interface Props {
  title?: string;
  description?: string;
  /** Ordering-app pages should not be indexed. */
  noindex?: boolean;
}

const {
  title = `${brand.name} — Order`,
  description = `Order at ${brand.name}.`,
  noindex = true,
} = Astro.props;

const RADIUS: Record<typeof brand.radius, string> = {
  sharp: "0.25rem",
  medium: "0.75rem",
  soft: "1.25rem",
};
const brandVars = `--brand-accent:${brand.accent};--radius-base:${RADIUS[brand.radius]};`;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={description} />
    <meta name="theme-color" content="#fbf8f3" />
    {noindex && <meta name="robots" content="noindex, nofollow" />}
    <title>{title}</title>
  </head>
  <body class="app" style={brandVars}>
    <slot />
  </body>
</html>

<style>
  .app {
    min-height: 100svh;
    background-color: var(--surface);
    color: var(--ink);
  }
</style>
```

- [ ] **Step 6: Point `MenuApp.tsx` at the new module**

In `src/components/order/MenuApp.tsx`, change line 29 `import { contact } from "../../data/site";` → `import { brand } from "../../data/brand";` and change the one usage `contact.hours` (around line 474) → `brand.contact.hours`. (MenuApp is fully rewritten in Task 2; this keeps the build green in between.) Apply the same rename to any other importer grep found in Step 1.

- [ ] **Step 7: Swap font/deps in `package.json`, install, delete `site.ts`**

1. In `devDependencies`, remove `@fontsource-variable/bodoni-moda` and `@fontsource-variable/manrope`; add `"@fontsource-variable/fraunces": "^5.1.0"` and `"@fontsource-variable/dm-sans": "^5.1.0"`.
2. Change `description` to `"A real-time QR ordering app — standardized white-label restaurant UI."`.
3. Delete `src/data/site.ts`.
4. Run:
```bash
npm install
```

- [ ] **Step 8: Verify — build + no dead tokens leak from the foundation**

```bash
npm run build
```
Expected: build succeeds.
```bash
grep -rn "color-void\|mode-night\|mode-editorial\|mode-after-dark\|data/site\|bodoni\|manrope" src astro.config.mjs package.json
```
Expected: **no matches** except inside files scheduled for later tasks that still reference legacy semantic tokens (`--bg`, `--text`, `--accent`, `--accent-muted`) — those are retired surface-by-surface. There must be **zero** matches for `color-void`, `mode-night`, `mode-editorial`, `mode-after-dark`, `data/site`, `bodoni`, `manrope`.

- [ ] **Step 9: Commit** (only if the user has authorized committing; branch off `main` first)

```bash
git add -A && git commit -m "$(cat <<'EOF'
Redesign foundation: white-label warm-light tokens, brand config, fonts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NkWFyKXWfJVq58wJ7pEq8S
EOF
)"
```

---

## Task 2: Customer surfaces — menu, cart, order tracking

**Files:**
- Rewrite: `src/components/order/MenuApp.tsx`
- Rewrite: `src/components/order/menu-app.css`
- Modify: `src/components/order/OrderStatus.tsx` + its styles in `src/styles/order-builder.css`
- Modify: `src/components/order/MenuView.astro`
- Modify: `src/pages/menu/index.astro`, `src/pages/menu/[table].astro`, `src/pages/order/[code].astro`
- Modify: `src/styles/global.css` (remove Lenis classes), `package.json` (drop `lenis`)

**Interfaces:**
- Consumes: token contract from Task 1. `MenuApp` keeps its existing props `{ categories: {id,name,items:[{id,name,description,price,veg_type,tags,is_signature}]}[]; table: string | null }` and its behavior (localStorage cart keyed by table, `/api/menu/availability` poll, POST `/api/orders` → redirect to `/order/<code>`). `formatINR` from `../../lib/money` stays. `brand` from `../../data/brand` for name/tagline/hours.
- Produces: no new interfaces (leaf UI).

- [ ] **Step 1: Read what you're changing**

Read `src/components/order/MenuApp.tsx`, `src/components/order/menu-app.css`, `src/components/order/OrderStatus.tsx`, `src/components/order/MenuView.astro`, and the three pages listed. Note every CSS class the JSX uses so the rewritten CSS covers all of them.

- [ ] **Step 2: Rewrite `MenuApp.tsx` — strip the palette engine, keep the ordering logic**

Delete entirely: the "day → night ramp" block (all of `RGBA`, `hex`, `a`, `lerp`, `lerpRGBA`, `css`, `smoothstep`, `shade`, `lum`, `BG_RAMP`, `rampBg`, `LIGHT`, `DARK`, `Palette`, `paletteAt`, `paletteVars`, `DAY_VARS`, `themeMeta`, `applyPalette`), `magnetize`/`demagnetize`, the `ROMAN`/`roman` helpers, the `import Lenis from "lenis"`, the entire scroll-ramp `useEffect` (the one building `Lenis`/`frame`/`applyPalette`), the `progressRef` + `.menu__progress` element, and the `style={DAY_VARS}` on the root.

Keep and re-render with clean markup: the availability poll effect, cart hydrate/persist effects, `setQty/inc/dec/setNote`, `count`/`subtotal`, filtering (`visibleCategories`), the reveal `IntersectionObserver` (optional — keep a lightweight fade-in via `[data-reveal]`, or drop it; do not keep it scroll-palette-linked), `toggleVeg`, `jumpTo`, `placeOrder`, `MenuRow`, `Stepper`, `CartSheet`, `VegDot`.

Replace the header block: use `brand.name` + `brand.tagline` + `brand.contact.hours` and the table badge (no "Berlin · Haus de Gourmet", no roman numerals). Course sections render `<h2>{c.name}</h2>` with no `course__index`. Keep the sticky `cartbar` → `CartSheet` bottom-sheet pattern (remove `onPointerMove/Leave` magnetic handlers). Keep `storageKey` but rename the prefix from `berlin.cart.` to `cart.` (it only affects localStorage keying).

- [ ] **Step 3: Rewrite `menu-app.css`** for the warm light system

Restyle every class the new JSX renders (menu, header, controls, search, chips/filters, jump-nav, course sections, dish cards, stepper, add button, cartbar, sheet/scrim/panel/list/line/foot, vegdot variants, empty state). Rules:
- Tokens only — surfaces via `--surface`/`--surface-raised`/`--surface-sunken`, text via `--ink`/`--ink-muted`, `--accent*`, `--border*`, `--radius-*`, `--shadow-*`, spacing/type tokens.
- Dish rows as soft cards (`--surface-raised`, `--radius-md`, `--shadow-sm`), generous spacing. Warm paper page background comes from `.app`/`--surface`.
- Remove any `--bg`/`--text`/`--accent-muted`/`--color-*` references and any `dish__leader` dotted-leader / roman-numeral / `menu__progress` styles that no longer have markup.
- Keep `data-lenis-prevent` off — Lenis is gone; the sheet list scrolls with normal `overflow:auto`.

- [ ] **Step 4: Restyle `OrderStatus.tsx` + `order-builder.css` (tracking view)**

Read `OrderStatus.tsx` first. Restyle to: a large status chip colored by state using `--status-*` (+ `-soft` background), a clean horizontal/vertical stepper timeline for `pending → confirmed → preparing → ready → served`, the order code + QR, and line items on cards. Tokens only. Do not change what data is shown or the polling behavior.

- [ ] **Step 5: Restyle `MenuView.astro` and the three pages**

Update `MenuView.astro`, `menu/index.astro`, `menu/[table].astro`, `order/[code].astro` so any inline markup/classes/copy use the new system and `brand` (no "Berlin" strings, no `mode-*` body/section classes). These are thin wrappers around the islands; keep their data-loading untouched.

- [ ] **Step 6: Remove Lenis**

Delete the Lenis smooth-scroll classes from `src/styles/global.css` (the `html.lenis`, `.lenis.lenis-smooth`, `[data-lenis-prevent]`, `.lenis.lenis-stopped` block) and its explanatory comment about Lenis/GSAP in the `html { overflow-x: clip }` rule (keep `overflow-x: clip`). Remove `"lenis"` from `package.json` dependencies, then:
```bash
npm install
```

- [ ] **Step 7: Verify**

```bash
npm run build
```
Expected: build succeeds.
```bash
grep -rn "lenis\|Lenis\|BG_RAMP\|roman\|Berlin\|--bg\b\|--text\b\|--accent-muted\|color-void\|magnet\|menu__progress" src/components/order src/pages/menu src/pages/order src/styles/global.css package.json
```
Expected: **no matches.** Then `npm run dev` and smoke `/menu`, `/menu/T1`, place an order → `/order/<code>`: browse/filter/search, add to cart, sheet opens, order places, tracking renders.

- [ ] **Step 8: Commit** (if authorized) — message subject: `Redesign customer surfaces: menu, cart, order tracking` + attribution trailer as in Task 1 Step 9.

---

## Task 3: Staff order desk

**Files:**
- Rewrite: `src/styles/staff.css`
- Modify: `src/components/order/PendingQueue.tsx` + `src/components/order/pending-queue.css`
- Modify: `src/components/order/DishForm.astro`, `src/components/staff/StationMasthead.astro`
- Modify: `src/pages/staff/index.astro`, `src/pages/staff/new.astro`, `src/pages/staff/tables.astro`, `src/pages/staff/tabs/index.astro`, `src/pages/staff/tabs/[id].astro`
- Modify: `src/styles/order-builder.css` (shared form styles used by the manual order builder)

**Interfaces:**
- Consumes: Task 1 tokens; Task 2's restyled `order-builder.css` form primitives (reuse them — do not fork a second form style). Keep all props/data contracts and the existing API calls in `PendingQueue.tsx` (confirm/act endpoints) unchanged.

- [ ] **Step 1: Read** every file listed plus `staff.css`, `pending-queue.css`, `order-builder.css`. Inventory classes and copy strings.
- [ ] **Step 2: Restyle `StationMasthead.astro`** — clean back-of-house top bar: station/surface name, signed-in role, sign-out. Tokens only; no `mode-*`, no Berlin copy. Uses `brand.name`.
- [ ] **Step 3: Restyle `PendingQueue.tsx` + `pending-queue.css`** — pending orders as cards (`--surface-raised`, `--shadow-sm`, `--radius-md`) with status chip (`--status-pending*`), line items, and confirm/act buttons (`--accent` primary, `--danger` for reject). Behavior unchanged.
- [ ] **Step 4: Restyle `staff.css`, `DishForm.astro`, and the staff pages** — order desk index, manual order builder (`new.astro` + `DishForm`), table-QR management (`tables.astro`), tabs list/detail. Tidy lists/cards, denser than customer side, same warm tokens. Reuse `order-builder.css` form controls.
- [ ] **Step 5: Verify**
```bash
npm run build && grep -rn "mode-night\|mode-editorial\|mode-after-dark\|color-void\|--accent-muted\|Berlin\|Haus de Gourmet" src/pages/staff src/components/staff src/components/order/PendingQueue.tsx src/components/order/pending-queue.css src/styles/staff.css
```
Expected: build succeeds; **no matches.** Smoke: log in as a server, view `/staff` (pending queue), `/staff/new`, `/staff/tables`, `/staff/tabs`.
- [ ] **Step 6: Commit** (if authorized) — subject `Redesign staff order desk` + trailer.

---

## Task 4: Kitchen board

**Files:**
- Rewrite: `src/components/order/kitchen-board.css`, `src/components/order/availability-panel.css`
- Modify: `src/components/order/KitchenBoard.tsx`, `src/components/order/AvailabilityPanel.tsx`
- Modify: `src/pages/kitchen/index.astro`

**Interfaces:**
- Consumes: Task 1 tokens. Keep the Supabase Realtime subscription, status-advance calls, and 86-toggle behavior in `KitchenBoard.tsx` / `AvailabilityPanel.tsx` exactly as they are.

- [ ] **Step 1: Read** all five files; inventory classes and status handling.
- [ ] **Step 2: Restyle `KitchenBoard.tsx` + `kitchen-board.css`** — status columns (pending / preparing / ready) of order cards; each card uses the matching `--status-*` accent, large legible dish text, big touch targets for advancing status. Light warm system (light-only per decision). Behavior unchanged.
- [ ] **Step 3: Restyle `AvailabilityPanel.tsx` + `availability-panel.css`** — clear available/86'd toggle rows with obvious state (use `--danger`/`--status-served-soft` for 86'd). Behavior unchanged.
- [ ] **Step 4: Restyle `kitchen/index.astro`** wrapper + masthead usage.
- [ ] **Step 5: Verify**
```bash
npm run build && grep -rn "mode-night\|mode-editorial\|mode-after-dark\|color-void\|--accent-muted\|--bg\b\|--text\b\|Berlin" src/pages/kitchen src/components/order/KitchenBoard.tsx src/components/order/kitchen-board.css src/components/order/AvailabilityPanel.tsx src/components/order/availability-panel.css
```
Expected: build succeeds; **no matches.** Smoke: log in as kitchen, open `/kitchen`; place a customer order in another tab and confirm it appears live; advance a status; 86 a dish and confirm it drops from `/menu`.
- [ ] **Step 6: Commit** (if authorized) — subject `Redesign kitchen board` + trailer.

---

## Task 5: Admin menu editor

**Files:**
- Modify: `src/pages/admin/index.astro`, `src/pages/admin/items/new.astro`, `src/pages/admin/items/[id].astro`
- Modify: shared form styles in `src/styles/order-builder.css` / `src/styles/staff.css` as needed (extend, don't fork)

**Interfaces:**
- Consumes: Task 1 tokens; the form primitives established in Tasks 2–3. Keep all form actions/endpoints (`/api/admin/**`) and field names unchanged.

- [ ] **Step 1: Read** the three admin pages and the shared form CSS.
- [ ] **Step 2: Restyle the item list (`admin/index.astro`)** — table/list of dishes with availability + signature indicators, edit/new actions, on cards/rows using tokens.
- [ ] **Step 3: Restyle the add/edit forms (`items/new.astro`, `items/[id].astro`)** — proper labeled fields (`--field-height`, `--radius-sm`, `--border`), primary save (`--accent`), destructive delete (`--danger`). Same warm system. No field/name/behavior changes.
- [ ] **Step 4: Verify**
```bash
npm run build && grep -rn "mode-night\|mode-editorial\|mode-after-dark\|color-void\|--accent-muted\|--bg\b\|--text\b\|Berlin" src/pages/admin
```
Expected: build succeeds; **no matches.** Smoke: log in as manager, `/admin`, create an item, edit it, toggle availability, delete it.
- [ ] **Step 5: Commit** (if authorized) — subject `Redesign admin menu editor` + trailer.

---

## Task 6: Login, table-QR, print slip, and final cleanup

**Files:**
- Rewrite: `src/styles/table-qr.css`
- Modify: `src/pages/staff/login.astro`
- Modify: `src/pages/staff/orders/[code]/slip.astro`
- Modify: `src/pages/staff/tables.astro` (QR-card styling, if not fully covered in Task 3)
- Modify: `src/pages/orders.astro`
- Delete: `src/assets/rooftop/` (all files) + its row in `src/assets/README.md`

**Interfaces:**
- Consumes: Task 1 tokens + `brand`. Keep the login POST to `/api/auth/login`, the `next` param handling, and all error states unchanged.

- [ ] **Step 1: Read** `staff/login.astro`, `slip.astro`, `tables.astro`, `orders.astro`, `src/assets/README.md`, and confirm the rooftop image importer is only `login.astro`:
```bash
grep -rn "assets/rooftop\|rooftop" src
```
- [ ] **Step 2: Rewrite `staff/login.astro`** — keep the split-panel layout, but replace the imported rooftop `<Picture>`/`<Image>` with a warm branded panel: a CSS gradient built from `--accent` / `--accent-soft` / `--surface-sunken`, showing `brand.name` + `brand.tagline`. Remove the image import. Keep the form (fields, submit, error/throttled messaging) on the new tokens.
- [ ] **Step 3: Delete the rooftop asset** — remove `src/assets/rooftop/` and delete its row from the "Contents" table in `src/assets/README.md`. If that leaves the README describing an empty folder, adjust the surrounding copy so it still reads correctly (asset dir may now be empty — say so).
- [ ] **Step 4: Restyle `table-qr.css` + `tables.astro`** — clean printable QR cards (dish/table label + QR + code), print-friendly (readable ink-on-white). Restyle `orders.astro` (order lookup/list) to tokens.
- [ ] **Step 5: Light-touch `slip.astro`** — keep it a minimal ink-on-white print slip; only swap any `--color-*`/`mode-*`/Berlin copy for tokens/`brand`. Don't over-design a thermal receipt.
- [ ] **Step 6: Full-repo final sweep**
```bash
grep -rn "color-void\|color-charcoal\|color-warm-black\|color-ivory\|color-champagne\|berlin-red\|mode-night\|mode-editorial\|mode-after-dark\|Haus de Gourmet\|bodoni\|manrope\|\blenis\b\|data/site" src astro.config.mjs package.json README.md docs
```
Expected: **no matches** (docs may mention the redesign spec/plan filenames — that's fine; the forbidden strings above must be gone from code). Also confirm no stray legacy semantic tokens remain:
```bash
grep -rn "var(--bg)\|var(--bg-elevated)\|var(--text)\|var(--text-muted)\|var(--text-strong)\|var(--accent-muted)\|var(--border-subtle)" src
```
Expected: **no matches.**
- [ ] **Step 7: Update docs to match**

`README.md` + `docs/architecture.md`: change the "Self-hosted variable fonts — Bodoni Moda + Manrope" line to "Fraunces + DM Sans", update the design-system description from "dark architectural surfaces / warm ivory / brass" to "warm light, white-label, re-skinnable via `src/data/brand.ts`", and retitle "BERLIN — …" headers to a generic name. Update `docs/setup.md` if it references removed assets. Update `src/assets/README.md` `login.astro` reference if the pattern example changed.

- [ ] **Step 8: Final verify — build + safety scan**
```bash
npm run build && npm run scan:all
```
Expected: build succeeds; safety scan passes ("No secrets, credentials, or local paths detected"). Smoke every surface one more time: `/menu`, `/order/<code>`, `/staff`, `/staff/login`, `/staff/tables`, `/kitchen`, `/admin`.
- [ ] **Step 9: Commit** (if authorized) — subject `Redesign login, QR, slip; remove rooftop asset; docs + final cleanup` + trailer.

---

## Self-review (completed during authoring)

- **Spec coverage:** warm-light aesthetic → Task 1 tokens; brand config → Task 1 `brand.ts`; fonts → Task 1; all surfaces → Tasks 2–6 (customer, staff, kitchen, admin, login/QR/slip); removals (palette engine, lenis, mode-*, site.ts, rooftop) → Tasks 2 & 6; verification (build, grep, scan) → every task + Task 6; sequencing matches spec's six steps. No spec section left without a task.
- **Placeholder scan:** foundation code (tokens, brand.ts, AppLayout) is written in full; surface tasks specify exact files, the token contract to consume, explicit deletions, and grep/build gates rather than vague "style it nicely" — appropriate for a visual redesign where the pixel-level CSS is the implementer's craft, bounded by the token contract and the no-leftover greps.
- **Type/name consistency:** token names used in Tasks 2–6 (`--surface*`, `--ink*`, `--accent*`, `--status-*`, `--radius-*`, `--shadow-*`) all defined in Task 1 Step 3; `brand` shape used in AppLayout/MenuApp/login matches `brand.ts`; `storageKey` prefix change noted where it's made.
