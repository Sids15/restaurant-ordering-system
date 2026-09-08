-- BERLIN — an audit trail. Apply after 013_set_grants_atomic.sql.
--
-- Who did what, when. The app already signed the three actions that move money
-- (confirmed_by, cancelled_by, closed_by), but those are columns on the rows
-- they describe: they say who cancelled an order that still exists, and nothing
-- at all about sign-ins, sign-outs, menu edits, price changes, or permission
-- grants.
--
-- SERVER-SIDE ONLY. No page in the app reads this, and no staff role can. It is
-- read in the Supabase SQL editor, or from a terminal with the service-role key
-- (`npm run audit`), and every entry is also echoed to the server log where the
-- hosting platform collects it. That is a deliberate choice rather than a
-- missing feature: an audit trail is evidence about the people using the app,
-- so it should not be one of the app's own screens.
--
-- Three decisions worth stating, because each is what makes an audit log either
-- trustworthy or theatre:
--
-- 1. THE ACTOR IS SNAPSHOTTED, not just referenced. A profile can be renamed,
--    demoted, or deleted; the log has to say who someone WAS at the time. A
--    foreign key alone would quietly rewrite history the moment a role changed,
--    which is precisely the history worth keeping.
--
-- 2. APPEND-ONLY, AND UNREADABLE FROM THE APP. There is no select, insert,
--    update or delete policy for `authenticated` at all. RLS denies by default,
--    so their absence IS the rule: a signed-in staff member — including an
--    owner — cannot read the log, add to it, or erase it through the app.
--    Everything goes through the service-role key, which lives only on the
--    server.
--
-- 3. WRITES COME FROM THE SERVER. Because no user can insert, the actor field
--    means something: nobody can forge an entry attributed to a colleague.

create table audit_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),

  -- Who. The id may go null if the profile is deleted; the snapshot survives.
  actor_id     uuid references profiles (id) on delete set null,
  actor_name   text not null default '',
  actor_role   text not null default '',

  -- What. A stable dotted verb: 'auth.signin', 'order.void', 'menu.item.update'.
  action       text not null,

  -- What it was done to, in the app's own terms: ('order', 'B7K2Q9RT'),
  -- ('tab', <uuid>), ('menu_item', <uuid>). Nullable — a sign-in has no subject.
  subject_type text,
  subject_id   text,

  -- A short human sentence, written at the call site, where the context is.
  summary      text not null default '',

  -- Anything structured worth keeping: amounts, before/after, the table label.
  detail       jsonb not null default '{}'::jsonb,

  -- Best-effort request context. Never trusted for authorisation.
  ip           text
);

-- Reading is by time, by person, or by kind of action — the three questions
-- anyone actually asks of a log.
create index audit_log_at_idx     on audit_log (at desc);
create index audit_log_actor_idx  on audit_log (actor_id, at desc);
create index audit_log_action_idx on audit_log (action, at desc);

-- RLS on with NO policies: that denies every authenticated caller by default,
-- for every operation. The service-role key bypasses RLS, which is exactly and
-- only how this table is meant to be reached.
alter table audit_log enable row level security;

-- --- Reading it -------------------------------------------------------------
-- From a terminal:            npm run audit
-- In the Supabase SQL editor, the questions worth having to hand:
--
--   -- everything today, newest first
--   select at, actor_name, actor_role, action, summary
--     from audit_log
--    where at >= date_trunc('day', now() at time zone 'Asia/Kolkata')
--    order by at desc;
--
--   -- who voided what, and for how much
--   select a.at, a.actor_name, a.subject_id as order_code, o.subtotal
--     from audit_log a
--     left join orders o on o.code = a.subject_id
--    where a.action = 'order.void'
--    order by a.at desc
--    limit 50;
--
--   -- failed sign-ins, grouped: a run against one account is the shape of an
--   -- attack, and it is invisible if only successes are recorded
--   select actor_name as email, count(*), max(at) as last_try
--     from audit_log
--    where action = 'auth.signin.failed'
--      and at > now() - interval '7 days'
--    group by 1 order by 2 desc;
--
--   -- one person's whole shift
--   select at, action, summary from audit_log
--    where actor_name = 'Priya' and at::date = current_date
--    order by at;
