-- BERLIN — stop storing guest session tokens in plaintext. Apply after 014.
--
-- DEPLOY THE CODE FIRST, THEN THIS. Applying it ahead of the deploy breaks
-- ordering: the old code writes `tabs.session_token`, which this drops.
--
-- WHAT THIS FIXES. `tabs.session_token` held the exact value in the guest's
-- cookie, and every staff account can read `tabs` under RLS. A server could
-- lift a live token and act as that table's device. It granted nothing they
-- could not already do with their own account — and doing it as themselves is
-- at least attributable — but a stored credential readable by people it does
-- not belong to has no reason to stay that way.
--
-- AND IT FIXES A SECOND THING. One token lived on the tab, so two guests at one
-- table shared it: the second scan overwrote the first, and hashing a single
-- column would have turned that into "the second guest signs the first one
-- out". Sessions therefore move to their own table — one row per DEVICE, all
-- pointing at one tab. That is what the app always meant: one tab, one bill,
-- however many phones. Closing the tab deletes them all, so a settled table
-- unbinds every device at once, which is what the old `session_token = null`
-- was reaching for.
--
-- The token is 192 bits from a CSPRNG, so the hash needs no salt and no
-- stretching: there is no dictionary to run against it, and a per-row salt
-- would make the single lookup-by-value every guest request performs
-- impossible. SHA-256 is right for proving possession of an unguessable secret;
-- it would be wrong for a password.

create extension if not exists pgcrypto with schema extensions;

create table tab_sessions (
  id         uuid primary key default gen_random_uuid(),
  tab_id     uuid not null references tabs (id) on delete cascade,
  -- Only ever the hash. The token itself exists in the guest's cookie and
  -- nowhere else.
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

-- Every guest request resolves a cookie to a tab through this.
create index tab_sessions_tab_idx on tab_sessions (tab_id);

-- Carry existing sessions across rather than logging seated guests out
-- mid-meal: the hash derives from the token they already hold, so their cookie
-- keeps working.
insert into tab_sessions (tab_id, token_hash)
select id, encode(extensions.digest(session_token, 'sha256'), 'hex')
  from tabs
 where session_token is not null
on conflict (token_hash) do nothing;

alter table tabs drop column if exists session_token;

-- --- RLS --------------------------------------------------------------------
-- Nobody reaches this through the app. Guests have no authenticated identity,
-- and staff have no business reading device credentials — the whole point of
-- the change. RLS on with no policies denies every authenticated caller for
-- every operation; the service-role client, which resolves guest sessions
-- server-side, bypasses it.
alter table tab_sessions enable row level security;

-- --- Check it worked ---------------------------------------------------------
--   select count(*) from tab_sessions;                 -- carried-over sessions
--   select column_name from information_schema.columns
--    where table_name = 'tabs' and column_name = 'session_token';   -- empty
