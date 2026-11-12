-- Respect branch-specific order-view exceptions on the user-facing print path.
-- Checkout, kitchen and branch-management alternatives remain independent.
-- The printer agent, queue protocol and device credentials are unchanged.
-- Do not activate this permission for branch editing until all readers pass audit.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target oid; source text; patched text; n integer;
begin
 for item in select * from (values
  ('_fnb_print_access_v1'),('fnb_print_enqueue_v1')
 ) as entries(name) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_FNB_PRINT_VIEW_CONSUMER_AMBIGUOUS: %',item.name; end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_fnb\.view_orders''\)',
   '_staff_permission_at_scope(\1,''pos_fnb.view_orders'',p_branch)','g');
  if patched=source then raise exception 'STAFF_FNB_PRINT_VIEW_CONSUMER_CHANGED: %',item.name; end if;
  execute patched;
 end loop;
end $migration$;
commit;
