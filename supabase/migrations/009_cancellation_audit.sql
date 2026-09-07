-- BERLIN — record who cancelled an order. Apply after 008_tab_assignment.sql.
--
-- Voiding a paid round and pocketing the cash is the oldest front-of-house
-- fraud there is, and until now a cancellation left no trace of who did it:
-- orders recorded confirmed_by and tabs recorded closed_by, but the one action
-- that makes money disappear recorded nobody.
--
-- Nullable because every order cancelled before this migration has no author to
-- attribute it to, and inventing one would be worse than an honest blank.

alter table orders
  add column cancelled_by uuid references profiles (id) on delete set null,
  add column cancelled_at timestamptz;

-- "What was voided during this shift, and by whom" — the manager's day view.
create index orders_cancelled_idx on orders (cancelled_at) where cancelled_at is not null;
