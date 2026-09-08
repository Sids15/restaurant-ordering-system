-- BERLIN — add the 'owner' role. Apply after 009_cancellation_audit.sql.
--
-- Until now 'manager' was the top of the tree. Role-based access control needs
-- one tier above it: someone who decides what every other role may do, and
-- whose own access can never be revoked by a permission toggle.
--
-- The enum value is added in its OWN migration, and therefore its own
-- transaction, because Postgres forbids referencing a newly added enum value in
-- the transaction that adds it. 011_rbac.sql is where 'owner' is first used.
-- This is the same two-step 006/007 used to introduce 'pending'.

alter type staff_role add value if not exists 'owner';
