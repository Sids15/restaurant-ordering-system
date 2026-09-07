# Setup — Supabase + local dev

One-time setup to run the ordering app.

## 1. Create a Supabase project
- Go to [supabase.com](https://supabase.com) → **New project** (free tier is fine).
- Note the project **URL** and the **anon** and **service_role** keys from
  *Project Settings → API*.

## 2. Apply the schema, RLS, and seed
In the Supabase dashboard → **SQL Editor**, run in order:
1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_rls.sql`
3. `supabase/seed.sql`

(Or, with the Supabase CLI: `supabase db push` then run the seed.)

> **One restaurant per Supabase project.** Setting up a second restaurant means
> a second Supabase project and a second deployment, never a second deployment
> against this database — RLS gates on *being staff*, not on which venue, so
> they would see each other's orders and takings. See `docs/architecture.md`.

## 3. Create staff accounts
- Dashboard → **Authentication → Users → Add user** (email + password) for each
  staff member. Tick **Auto Confirm User** so they can sign in straight away.
  A `profiles` row is created automatically with role **`pending`**.
- `pending` is not a working role: the account exists but can't open any staff
  page and can't read orders or tabs (see `007_role_lockdown.sql`). Promote it
  in **SQL Editor** — by email, so you never have to copy a uuid:
  ```sql
  update profiles set role = 'manager', name = 'Owner'
   where id = (select id from auth.users where email = 'owner@example.com');

  update profiles set role = 'kitchen', name = 'Kitchen'
   where id = (select id from auth.users where email = 'kitchen@example.com');

  update profiles set role = 'server', name = 'Priya'
   where id = (select id from auth.users where email = 'priya@example.com');
  ```
- Check what you've got:
  ```sql
  select u.email, p.name, p.role
    from profiles p join auth.users u on u.id = p.id
   order by p.role;
  ```

### What each role can open
| | manager | server | kitchen |
|---|---|---|---|
| Order desk `/staff`, Build order, Open tabs | ✅ | ✅ | — |
| Kitchen board `/kitchen` | ✅ | — | ✅ |
| Menu manager `/admin` | ✅ | — | — |
| Table QR codes `/staff/tables` | ✅ | — | — |
| Today `/staff/today` | ✅ | — | — |

Sign in at **`/staff/login`**. There is no self-serve signup on purpose: a
public one would let anyone provision themselves a working staff role.

## 4. Configure env
```bash
cp .env.example .env
# fill SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```
`.env` is gitignored — never commit real keys.

## 5. Run
```bash
npm run dev      # app at http://localhost:4321
```
- Customer menu: `/menu` (per-table entry: `/menu/[token]`) — `/` redirects here
- Staff / Kitchen: `/staff`, `/kitchen`

## Deploy
Push to a Vercel project; set the three env vars in Vercel → Project Settings →
Environment Variables. The build (`npm run build`) targets the Vercel serverless
adapter.
