-- BERLIN — lock down role provisioning + gate RLS on real staff roles.
-- Apply after 006_pending_role.sql (which adds the 'pending' enum value in a
-- prior transaction — required, see that file's note).
--
-- What this does:
--   1. New signups default to 'pending' (not 'server'), in both the column
--      default and the handle_new_user() trigger. A manager promotes an account
--      to a working role explicitly.
--   2. is_staff() — the single source of truth for "may touch orders/tabs".
--      Only manager/kitchen/server count; 'pending' (and any future non-working
--      role) does not. All order/tab/menu policies switch from the old
--      `current_role_name() is not null` to is_staff().
--
-- Existing accounts keep whatever role they already have; only NEW signups get
-- 'pending'. After applying, confirm your real staff rows in `profiles` still
-- carry manager/kitchen/server.

-- --- 1. Default new accounts to 'pending' -----------------------------------
alter table profiles alter column role set default 'pending';

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  -- Signups land as 'pending' — no access until a manager promotes them.
  insert into profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), 'pending');
  return new;
end;
$$;

-- --- 2. is_staff(): only working roles count as staff -----------------------
create or replace function is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select current_role_name() in ('manager', 'kitchen', 'server');
$$;

-- --- 3. Re-gate every policy that used `current_role_name() is not null` -----
-- menu_items: a pending account must NOT see unavailable (staff-only) items.
drop policy if exists "items readable" on menu_items;
create policy "items readable" on menu_items
  for select to anon, authenticated
  using (is_available = true or is_staff());

-- orders
drop policy if exists "staff read orders" on orders;
create policy "staff read orders" on orders
  for select to authenticated using (is_staff());
drop policy if exists "staff write orders" on orders;
create policy "staff write orders" on orders
  for all to authenticated
  using (is_staff())
  with check (is_staff());

-- order_items
drop policy if exists "staff read order items" on order_items;
create policy "staff read order items" on order_items
  for select to authenticated using (is_staff());
drop policy if exists "staff write order items" on order_items;
create policy "staff write order items" on order_items
  for all to authenticated
  using (is_staff())
  with check (is_staff());

-- tabs (from 003_tabs.sql)
drop policy if exists "staff read tabs" on tabs;
create policy "staff read tabs" on tabs
  for select to authenticated using (is_staff());
drop policy if exists "staff write tabs" on tabs;
create policy "staff write tabs" on tabs
  for all to authenticated
  using (is_staff())
  with check (is_staff());
