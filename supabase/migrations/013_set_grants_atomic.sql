-- BERLIN — save the permission matrix in one transaction. Apply after 012.
--
-- writeGrants() deleted every editable role's grants and then inserted the new
-- set, in two separate round trips. Between them the roles hold NOTHING, and
-- if the insert never lands — a dropped connection, a transient error, a
-- deploy — that is where they stay: every manager, server and kitchen account
-- loses every permission at once, mid-service. The old error message admitted
-- as much ("Permissions were cleared but not re-applied").
--
-- A function body is a single transaction, so here the delete and the insert
-- either both happen or neither does.
--
-- Owner-only, checked in the body rather than left to RLS: this is SECURITY
-- INVOKER, so the caller's own policies still apply underneath, but failing
-- loudly beats a silent no-op that looks like it saved.

create or replace function set_role_permissions(grants jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  editable staff_role[] := array['manager', 'server', 'kitchen']::staff_role[];
begin
  if coalesce(current_role_name() = 'owner', false) is not true then
    raise exception 'only an owner may change permissions';
  end if;

  delete from role_permissions where role = any (editable);

  -- `grants` is {"manager": ["orders.view", ...], "server": [...]}. The join
  -- against `permissions` is what stops an unknown capability being inserted,
  -- and restricting to `editable` is what stops anything being granted to
  -- 'owner' (which holds everything implicitly) or to 'pending' (which must
  -- hold nothing).
  insert into role_permissions (role, permission)
  select r.key::staff_role, p.value #>> '{}'
    from jsonb_each(grants) as r
    cross join lateral jsonb_array_elements(r.value) as p(value)
   where r.key::staff_role = any (editable)
     and exists (select 1 from permissions x where x.name = p.value #>> '{}')
  on conflict do nothing;
end;
$$;

revoke execute on function set_role_permissions(jsonb) from anon, public;
grant  execute on function set_role_permissions(jsonb) to authenticated;
