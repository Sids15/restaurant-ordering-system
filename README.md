# Restaurant Ordering App

A **real-time QR ordering + kitchen app** for a restaurant. Customers scan a
table QR to browse the menu and order; staff confirm and track orders; the
kitchen works a live board. Built on a warm-light, white-label design system —
re-skinnable per restaurant via `src/data/brand.ts`.

Server-rendered on serverless (Vercel), backed by Supabase (Postgres + Realtime
+ Auth). See [`docs/architecture.md`](docs/architecture.md) for the full design,
data model, roles, and build sequence, and [`docs/setup.md`](docs/setup.md) to
get running.

> **Setup:** copy `.env.example` to `.env` and fill in your Supabase project
> keys, then `npm run dev`. The production build targets Vercel serverless
> (`npm run build`).

## Stack

- **Astro** (`output: "server"`) — server-rendered app pages as serverless
  functions; near-zero JS elsewhere.
- **React islands** — the customer menu / cart (`MenuApp`) and other interactive
  surfaces only.
- **Supabase** — Postgres + row-level security, Realtime (live kitchen board),
  and Auth (staff logins with roles).
- **Self-hosted variable fonts** — Fraunces (display) + DM Sans (UI).

## Commands

```bash
npm install       # install dependencies
npm run dev       # local dev server (http://localhost:4321)
npm run build     # production build → dist/
npm run preview   # serve the production build
npm run scan      # safety scan of STAGED files (run before every commit)
npm run scan:all  # safety scan of the whole repo
```

## Design tokens

All colors, type sizes, spacing, and motion live in `src/styles/tokens.css`.
Components consume these tokens — they never invent their own values.

## Media

Images live in `src/assets/` and are **optimized at build** (AVIF + WebP + JPG
fallback with responsive `srcset`). Commit the highest-quality original; the
build handles compression. See [`src/assets/README.md`](src/assets/README.md).

## Safety scan

`scripts/safety-scan.mjs` runs before every commit and blocks it if it finds
secrets, credentials, or local filesystem paths. See the file header for the
allowlist mechanism (`.safetyscanignore` / inline `safety-scan-ignore`).

## Structure

```
src/
├── assets/        # optimized-at-build imagery (currently empty — see its README)
├── components/
│   ├── order/     # customer menu, cart, order builder
│   └── staff/     # staff / kitchen surfaces
├── data/brand.ts  # brand + public contact details (no secrets)
├── layouts/       # AppLayout — the app document shell
├── lib/           # supabase clients, orders, menu, auth, http helpers
├── pages/         # menu · order/[code] · staff/* · kitchen/* · admin/* · api/*
└── styles/        # tokens.css + global.css + surface styles
```
