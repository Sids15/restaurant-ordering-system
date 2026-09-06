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

## 3. Create staff accounts
- Dashboard → **Authentication → Users → Add user** (email + password) for each
  staff member. A `profiles` row is created automatically (default role
  `server`).
- Set roles in **SQL Editor**, e.g.:
  ```sql
  update profiles set role = 'manager', name = 'Owner'   where id = 'USER_UUID';
  update profiles set role = 'kitchen', name = 'Kitchen'  where id = 'USER_UUID';
  ```

## 4. Configure env
```bash
cp .env.example .env
# fill PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
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
