# BERLIN — Architecture

This repo is a **real-time QR ordering + kitchen app** built as an Astro
project (server-rendered on serverless). The customer menu, staff surfaces, and
kitchen board all share the design system (`src/styles/tokens.css`).

---

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | **Astro** (`output: "server"`) | App pages render server-side as serverless functions. |
| Hosting | **Serverless** (Vercel adapter) | No always-on server to run or babysit. |
| Database | **Supabase (Postgres)** | Managed — nothing to host. |
| Realtime | **Supabase Realtime** | Kitchen board updates live via table subscriptions — no server-held sockets. |
| Auth | **Supabase Auth** + `profiles.role` | Per-user staff logins with roles. |
| QR | `qrcode` (generate) + camera scan (staff) | Order codes → QR; staff scan/enter to pull up an order. |

**Rendering:** `output: "server"`. App pages render per request as serverless
functions; `/` redirects to the customer menu. The kitchen board subscribes
directly to Supabase Realtime from the browser, so no persistent connection
lives on our side.

---

## The three surfaces & the order lifecycle

```
CUSTOMER (no login)              SERVER (role: server)          KITCHEN (role: kitchen)
scan table QR → /menu            /staff (login)                 /kitchen (login)
browse · filter · sort · cart    ├─ look up by code / scan QR   live board (realtime)
"Place order"                    │   → review → CONFIRM ───────► confirmed order appears
  → pending order + CODE + QR ◄──┘                              advance status; 86 a dish
                                 └─ build order manually
                                     → auto-confirmed ──────────►
```

**Order states:** `pending → confirmed → preparing → ready → served` (+ `cancelled`).
- Customer orders start `pending` and wait for a server to confirm.
- Server-made orders skip straight to `confirmed` (auto-accepted).

---

## Roles & permissions (enforced by Postgres RLS)

| Action | manager | kitchen | server |
| --- | :---: | :---: | :---: |
| Add / edit / delete dishes, prices, categories | ✅ | — | — |
| Toggle dish availability (86 / sold out) | ✅ | ✅ | — |
| See & advance orders | ✅ | ✅ | ✅ |
| Take / confirm orders | ✅ | — | ✅ |

Menu is **public-read** (available items only). Orders are **staff-only**, except
a customer creating and tracking **their own** order — which goes through our
API routes, not broad anon access.

---

## Data model (Postgres)

- **`profiles`** — `id` (→ `auth.users`), `role` (`manager|kitchen|server`), `name`
- **`menu_categories`** — `id`, `name`, `sort_order`
- **`menu_items`** — `id`, `category_id`, `name`, `description`, `price`,
  `veg_type` (`veg|non_veg|egg`), `tags[]`, `image_url`, `is_available`,
  `is_signature`, `sort_order`
- **`orders`** — `id`, `code` (short unique), `table_label`, `status`, `source`
  (`customer|server`), `subtotal`, `notes`, `created_at`, `confirmed_at`,
  `confirmed_by`
- **`order_items`** — `order_id`, `menu_item_id`, `name_snapshot`,
  `price_snapshot`, `qty`, `notes`

Line items snapshot the name & price so historical orders stay correct if the
menu later changes.

---

## Repo structure

```
src/
├─ components/
│  ├─ order/    customer menu, cart, order builder
│  └─ staff/    staff / kitchen surfaces
├─ layouts/    AppLayout (app document shell)
├─ lib/
│  ├─ supabase/  browser + admin clients
│  ├─ orders/    create / confirm / state-machine
│  ├─ menu/      queries
│  └─ types.ts   shared Order / MenuItem types
├─ pages/        menu · order/[code] · staff/* · kitchen/* · admin/* · api/* (/ → /menu)
├─ middleware.ts auth guard for /staff and /kitchen
supabase/
├─ migrations/   schema + RLS (versioned SQL)
└─ seed.sql      sample menu
```

---

## Secrets

Every key lives in **`.env` (gitignored)**; `.env.example` documents the shape.
Nothing is hardcoded.

| Var | Exposure |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | public (in the browser) |
| `PUBLIC_SUPABASE_ANON_KEY` | public by design; data guarded by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret — server only, never in the client** |

`scripts/safety-scan.mjs` blocks commits containing Supabase keys, JWTs, or
Postgres connection strings.

---

## Build order (each = one scanned commit)

1. **Foundation** — adapter, Supabase clients, env, scanner upgrade, structure
2. **Data layer** — migrations + RLS + seed menu + types
3. **Customer menu + cart** — filters/sort/search, cart, place-order → code + QR
4. **Staff auth + panels** — login, lookup/scan + confirm, manual order builder
5. **Kitchen board** — realtime orders + 86 toggle
6. **Admin menu panel** — manager-only dish CRUD
7. **Polish** — realtime/empty/error states, a11y, responsive, design match
