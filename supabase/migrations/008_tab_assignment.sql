-- BERLIN — assign a server to a table. Apply after 007_role_lockdown.sql.
--
-- The assignment is a property of the TAB (one sitting), not of the table
-- label: it arrives when the table is seated and retires with the bill, which
-- is how a floor actually works. Keeping it on the tab also means the value
-- survives on a closed tab as a record of who worked it, and a later
-- section/shift model can populate this same column rather than replace it.
--
-- Nullable throughout — assignment is optional. Nothing in ordering, billing
-- or the kitchen depends on it; an unassigned tab behaves exactly as before.

alter table tabs
  add column assigned_to uuid references profiles (id) on delete set null;

-- "Which tables is this server on right now" — the only shape we query by.
create index tabs_assigned_idx on tabs (assigned_to) where status = 'open';

-- --- Let staff see staff names ----------------------------------------------
-- profiles was readable only as "your own row, or everything if you're a
-- manager" (002_rls.sql). That's too tight now: a server picking who is on a
-- table needs the roster, and every tab row wants to show a name rather than a
-- uuid. This grants staff read of OTHER STAFF rows only — a 'pending' signup
-- stays invisible to everyone but a manager, so the lockdown in 006/007 is
-- unchanged. Names and roles only; profiles holds no contact details.
create policy "staff read staff names" on profiles
  for select to authenticated
  using (is_staff() and role in ('manager', 'kitchen', 'server'));
