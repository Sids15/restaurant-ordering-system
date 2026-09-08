-- BERLIN — role-based access control. Apply after 010_owner_role.sql.
--
-- Replaces "which roles are hard-coded into this route" with a table the owner
-- edits. A permission is a capability in the language of the restaurant
-- ("close tabs", "mark dishes 86"), not a URL, so whoever grants it can tell
-- what they are granting.
--
-- THE OWNER IS NOT STORED HERE. has_permission() returns true for an owner
-- before it consults any row, so no combination of toggles can lock the owner
-- out of the page that manages the toggles. That is the one guarantee this
-- design has to make.
--
-- The app enforces the same permissions on routes and endpoints; these policies
-- are the backstop underneath, so a direct API call cannot do what the UI
-- refuses to offer.

-- --- Catalogue --------------------------------------------------------------
-- The permissions the app knows about, so the management page and the database
-- agree on the vocabulary.
create table permissions (
  name        text primary key,
  label       text not null,
  description text not null default '',
  grouping    text not null default 'Other',
  sort_order  int  not null default 0
);

-- --- Grants -----------------------------------------------------------------
create table role_permissions (
  role       staff_role not null,
  permission text not null references permissions (name) on delete cascade,
  primary key (role, permission)
);
create index role_permissions_role_idx on role_permissions (role);

-- --- The check --------------------------------------------------------------
-- security definer so it reads the grants regardless of the caller's own
-- policies; stable so a query evaluates it once rather than once per row.
create or replace function has_permission(perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    current_role_name() = 'owner'
    or exists (
      select 1
        from role_permissions rp
       where rp.role = current_role_name()
         and rp.permission = perm
    );
$$;

-- is_staff() gains 'owner' — it lists the working roles, and the owner works.
create or replace function is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select current_role_name() in ('owner', 'manager', 'kitchen', 'server');
$$;

-- --- Seed the catalogue -----------------------------------------------------
insert into permissions (name, label, description, grouping, sort_order) values
  ('orders.view',          'See orders',          'Look up any order by its code on the order desk.',                 'Orders',            10),
  ('orders.take',          'Take orders',         'Build an order at the table, and accept one a guest sent.',        'Orders',            20),
  ('orders.void',          'Void orders',         'Cancel a round. Always recorded against whoever did it.',          'Orders',            30),
  ('kitchen.view',         'Kitchen board',       'See the live queue and mark rounds ready.',                        'Kitchen',           10),
  ('kitchen.availability', 'Mark dishes 86',      'Take a dish off the menu when it sells out, and put it back.',     'Kitchen',           20),
  ('tabs.view',            'Open tabs',           'See the floor''s open tabs and their bills.',                      'Tabs and billing',  10),
  ('tabs.close',           'Close tabs',          'Mark a tab paid and free the table.',                              'Tabs and billing',  20),
  ('tabs.move',            'Move and merge tabs', 'Move a tab to another table, or settle two tables on one bill.',   'Tabs and billing',  30),
  ('tabs.assign',          'Assign servers',      'Put a server on a table.',                                         'Tabs and billing',  40),
  ('menu.manage',          'Manage the menu',     'Add, edit, price and remove dishes and categories.',               'Menu',              10),
  ('tables.manage',        'Table QR codes',      'Generate and print the codes guests scan.',                        'Menu',              20),
  ('reports.day',          'Daily takings',       'The day view: takings, orders, and open and closed tabs.',         'Reports',           10),
  ('reports.analytics',    'Analytics',           'Trading performance, menu mix, staff and void figures.',           'Reports',           20)
on conflict (name) do update
  set label       = excluded.label,
      description = excluded.description,
      grouping    = excluded.grouping,
      sort_order  = excluded.sort_order;

-- --- Default grants ---------------------------------------------------------
-- These reproduce exactly what each role could already do, so applying this
-- migration changes nobody's access until the owner changes it deliberately.
insert into role_permissions (role, permission)
select 'manager'::staff_role, name from permissions
union all
select 'server'::staff_role, name
  from permissions
 where name in ('orders.view', 'orders.take', 'orders.void',
                'tabs.view', 'tabs.close', 'tabs.move', 'tabs.assign')
union all
select 'kitchen'::staff_role, name
  from permissions
 where name in ('kitchen.view', 'kitchen.availability', 'orders.view')
on conflict do nothing;

-- --- RLS on the RBAC tables themselves --------------------------------------
alter table permissions      enable row level security;
alter table role_permissions enable row level security;

-- Any signed-in staff member may READ the catalogue and the grants: the app
-- needs them to decide what to render, and "servers can close tabs" is not a
-- secret. Only the owner may change them.
create policy "staff read permissions" on permissions
  for select to authenticated using (is_staff());
create policy "staff read grants" on role_permissions
  for select to authenticated using (is_staff());

create policy "owner writes permissions" on permissions
  for all to authenticated
  using (current_role_name() = 'owner')
  with check (current_role_name() = 'owner');
create policy "owner writes grants" on role_permissions
  for all to authenticated
  using (current_role_name() = 'owner')
  with check (current_role_name() = 'owner');

-- --- Re-gate the policies that hard-coded a role ----------------------------
-- Menu writing was `current_role_name() = 'manager'`. As a permission, an owner
-- can hand it to a head chef without making them a manager.
drop policy if exists "manager writes categories" on menu_categories;
create policy "menu writers write categories" on menu_categories
  for all to authenticated
  using (has_permission('menu.manage'))
  with check (has_permission('menu.manage'));

drop policy if exists "manager writes items" on menu_items;
create policy "menu writers write items" on menu_items
  for all to authenticated
  using (has_permission('menu.manage'))
  with check (has_permission('menu.manage'));

-- Profiles: the owner administers people. A manager keeps READ access, because
-- the day view and analytics name who served a table and who voided a round.
drop policy if exists "manager manages profiles" on profiles;
create policy "owner manages profiles" on profiles
  for all to authenticated
  using (current_role_name() = 'owner')
  with check (current_role_name() = 'owner');

drop policy if exists "read own or manager reads all" on profiles;
create policy "read own or privileged reads all" on profiles
  for select using (
    id = auth.uid() or current_role_name() in ('owner', 'manager')
  );

-- The 86 toggle checked a role list; it now checks the permission.
create or replace function set_item_availability(item uuid, available boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not has_permission('kitchen.availability') then
    raise exception 'not authorised';
  end if;
  update menu_items set is_available = available where id = item;
end;
$$;

-- --- One thing you must do by hand ------------------------------------------
-- Nobody is an owner yet. Promote yourself, or nobody can open the access page.
--
-- The app lets a MANAGER in while no owner exists, purely so you cannot be
-- locked out of your own restaurant. That door closes the moment the first
-- owner is created, so do this now:
--
--   update profiles set role = 'owner'
--    where id = (select id from auth.users where email = 'you@example.com');
