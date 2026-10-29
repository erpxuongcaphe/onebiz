-- CREATE OR REPLACE VIEW resets reloptions unless explicitly retained.
-- Restore the pre-existing barrier; ACL and branch/cost predicates remain unchanged.
begin;
set local lock_timeout='5s';
alter view public.invoice_items_scoped set (security_barrier=true);
commit;
