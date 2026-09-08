-- BERLIN — SECURITY FIX. Apply immediately after 011_rbac.sql.
--
-- has_permission() could return NULL instead of false, and one caller treated
-- that as "allowed".
--
-- WHY IT RETURNED NULL: current_role_name() is NULL for a caller with no
-- profile — anyone anonymous. `NULL = 'owner'` is NULL, not false, and
-- `NULL or false` is NULL, so the whole function returned NULL.
--
-- WHY THAT WAS EXPLOITABLE: in an RLS policy, `USING (NULL)` is treated as
-- false, so reads and writes stayed safe. But PL/pgSQL's IF does not take a
-- NULL branch, so in set_item_availability:
--
--     if not has_permission('kitchen.availability') then
--       raise exception 'not authorised';
--     end if;
--
-- `not NULL` is NULL, the branch was skipped, no exception was raised, and the
-- UPDATE ran. Verified against a live project: an anonymous caller holding only
-- the publishable key — which every page ships — could 86 any dish off the menu.
--
-- Fixed three ways, so no single mistake brings it back:
--   1. has_permission() can no longer return NULL.
--   2. The caller tests `is not true`, which is false for both false and NULL.
--   3. anon loses EXECUTE on the function outright; it is staff-only work.

-- --- 1. Never NULL ----------------------------------------------------------
create or replace function has_permission(perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    -- coalesce, because current_role_name() is NULL for a caller with no
    -- profile and `NULL = 'owner'` is NULL rather than false.
    coalesce(current_role_name() = 'owner', false)
    or exists (
      select 1
        from role_permissions rp
       where rp.role = current_role_name()
         and rp.permission = perm
    );
$$;

-- --- 2. A caller that cannot be fooled by NULL -------------------------------
create or replace function set_item_availability(item uuid, available boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- `is not true` rather than `not`: false and NULL both refuse, so this stays
  -- closed even if the check above ever returns NULL again.
  if has_permission('kitchen.availability') is not true then
    raise exception 'not authorised';
  end if;
  update menu_items set is_available = available where id = item;
end;
$$;

-- --- 3. Don't expose it to the public role at all ----------------------------
-- These are security definer functions doing staff work. PostgREST publishes
-- everything in `public`, so an unauthenticated caller could at least invoke
-- them. Only signed-in users need to.
revoke execute on function set_item_availability(uuid, boolean) from anon, public;
grant  execute on function set_item_availability(uuid, boolean) to authenticated;

revoke execute on function has_permission(text) from anon, public;
grant  execute on function has_permission(text) to authenticated;

-- --- Check it worked ---------------------------------------------------------
-- Run this after applying. Both must be false, never null:
--
--   select has_permission('menu.manage')          as should_be_false,
--          has_permission('kitchen.availability') as also_false;
--
-- Then, signed out, calling set_item_availability must raise 'not authorised'
-- rather than silently succeeding. `npm run verify-rbac` checks both.
