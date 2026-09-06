# Frontend Redesign — Standardized, White-Label Restaurant UI

**Date:** 2026-09-06
**Status:** Approved design → ready for implementation planning

## Goal

Replace the "Berlin — Haus de Gourmet" nocturnal editorial design across the
**entire** app with a standardized, warm-and-appetizing, **white-label**
restaurant UI that any restaurant can adopt by editing a single brand config.
No brand-specific content, aesthetics, or interaction machinery baked into
components — they consume design tokens only.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Aesthetic | **Warm & appetizing** — cream/off-white grounds, warm neutrals, one brand accent, rounded cards, soft shadows, food-forward |
| Scope | **Everything** — customer menu/cart/order-tracking, staff desk + tables + tabs, kitchen board, admin editor, login, table-QR, print slip |
| White-label mechanism | **Brand config file** (`src/data/brand.ts`) + CSS token overrides written onto `<body>` by `AppLayout` |
| Fonts | **Fraunces Variable** (display serif, headings) + **DM Sans Variable** (UI/body) — both self-hosted via `@fontsource-variable`; drop Bodoni Moda |
| Theme | **Light-only** now; tokens structured so a `[data-theme="dark"]` layer can be added later without touching components |
| Login panel | **Warm branded color/gradient panel** driven by `brand.accent` — no photo; remove the rooftop image |

## Design principles

- Warm light theme only: cream/off-white surfaces, warm charcoal ink, warm-gray
  borders, one brand accent. Rounded, soft-shadowed cards; generous spacing.
- Nothing brand-specific in components: no "Berlin", no roman-numeral courses,
  no scroll-driven day→night ramp, no magnetic cursor. Components read tokens.
- Calm, standard interaction: normal scrolling, a static palette, tasteful
  reveals/transitions at most.

## The white-label layer

### `src/data/brand.ts` (new — single source of a restaurant's identity)

```ts
export const brand = {
  name: "Your Restaurant",
  tagline: "Fresh, made to order",
  accent: "#C2410C",     // one hex → drives --accent + hover/subtle derivations
  radius: "medium",       // "sharp" | "medium" | "soft" → --radius scale
  currency: "INR",        // formatINR stays; currency label swappable
  contact: { phone, whatsapp, maps, address, hours },
};
```

Replaces `src/data/site.ts` (its `brand` + `contact` fold into here). A
restaurant changes these values and the whole app re-skins.

### `src/layouts/AppLayout.astro`

- Body class becomes plain `app` (drop `mode-night`).
- Reads `brand.accent` / `brand.radius` and writes them as CSS custom
  properties on `<body>` (inline style), so the accent flows into `tokens.css`
  without touching component CSS.
- `<meta name="theme-color">` → warm surface color (not `#090908`).

### `src/styles/tokens.css` — rewritten (neutral warm light system)

Replaces all Berlin tokens. Organized so a future `[data-theme="dark"]` block
can redefine the same names without component edits.

- **Surfaces:** `--surface`, `--surface-raised`, `--surface-sunken`.
- **Ink:** `--ink`, `--ink-muted`.
- **Borders:** `--border`, `--border-strong`.
- **Accent (from `brand.accent`):** `--accent`, `--accent-hover`,
  `--accent-soft`, `--on-accent`.
- **Status (order states):** pending / confirmed / preparing / ready / served
  + danger.
- **Type scale:** keep fluid `clamp()` approach but calmer (no ~8rem display).
- **Radius scale:** driven by `brand.radius`.
- **Spacing / containers / motion / z-index:** keep structure, retune values.

### Fonts

Drop `@fontsource-variable/bodoni-moda`. Add `@fontsource-variable/fraunces`
(display) and `@fontsource-variable/dm-sans` (UI). `--font-display` → Fraunces,
`--font-ui` → DM Sans, each with a real fallback stack.

## Per-surface treatment

### Customer

- **`/menu`, `/menu/[table]` → `MenuApp.tsx`**: stripped to a clean standard
  ordering UI. Static warm-paper background. Simple sticky header (restaurant
  name + tagline + table badge). Keep search, dietary chips, category jump-nav.
  Courses become plain titled sections (no roman numerals). Dish rows (name,
  veg dot, description, price, Add/stepper) on soft-shadowed cards. Cart stays a
  sticky bar → bottom-sheet (restyle; drop magnetic effect).
  **Delete the entire palette engine:** `BG_RAMP`, `paletteAt`, `paletteVars`,
  `applyPalette`, `magnetize`/`demagnetize`, roman-numeral helpers, the Lenis
  import and its scroll-ramp effect, and the `menu__progress` bar.
- **`/order/[code]` → `OrderStatus.tsx`**: restyled tracking — large status chip
  (status tokens), clean stepper timeline (pending → … → served), code + QR,
  line items on cards.
- `menu-app.css` (719 lines) largely rewritten; `order-builder.css` restyled.

### Staff order desk

`/staff`, `/staff/tables`, `/staff/tabs/*`, `/staff/new`, `PendingQueue.tsx`,
`DishForm.astro`, `StationMasthead.astro`: light back-of-house workspace on the
same tokens. Clean top masthead (station name + role + sign-out), pending queue
as cards with confirm/act buttons, table/tab management as tidy lists/cards.
Denser than the customer side, same warm system. `staff.css` restyled.

### Kitchen board

`/kitchen`, `KitchenBoard.tsx`, `AvailabilityPanel.tsx`: realtime board as
legible status-column cards (pending/preparing/ready) with clear state colors
and big touch targets for advancing status and 86-ing dishes. Light warm system
(light-only per decision). `kitchen-board.css` / `availability-panel.css`
restyled.

### Admin menu editor

`/admin`, `/admin/items/new`, `/admin/items/[id]`: standard light form/CRUD UI —
item list, add/edit forms as proper form controls on the token system. Shares
form styles with `order-builder.css` / `staff.css`.

### Login, table-QR, print slip

- **`/staff/login`**: keep split-panel pattern; replace rooftop night image with
  a warm branded color/gradient panel driven by `brand.accent` (no photo).
  Remove `src/assets/rooftop/` and its `src/assets/README.md` entry.
- **`/staff/tables.astro`** (`table-qr.css`): clean printable QR cards.
- **`/staff/orders/[code]/slip.astro`**: keep minimal ink-on-white print slip;
  light touch only.

## Removals

- Scroll-linked palette engine in `MenuApp.tsx` (see Customer above).
- `lenis` dependency (only MenuApp used it).
- `.mode-editorial` / `.mode-after-dark` theme modes and `mode-night` /
  `--color-void` chrome.
- `src/data/site.ts` (folded into `brand.ts`).
- `src/assets/rooftop/` image + its README table row.

## Verification

- `npm run build` passes.
- `npm run scan:all` passes.
- Repo-wide grep confirms **no** remaining references to deleted tokens/classes
  (`--color-void`, `mode-night`, `mode-editorial`, `mode-after-dark`, old token
  names) in any component or page.
- Manual smoke: every surface renders on the new tokens.

## Sequencing (each step a coherent commit-sized unit)

1. Tokens + `brand.ts` + fonts + `AppLayout`.
2. Customer menu + order tracking.
3. Staff desk.
4. Kitchen board.
5. Admin editor.
6. Login + table-QR + slip + cleanup + build/scan.

## Non-goals

- Dark mode (structure only; not built now).
- Backend / API / data-model / auth changes — this is presentation-layer only.
- New product features; behavior and flows stay as they are.
