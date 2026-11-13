begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Owners can inspect all branches of their own tenant, not another tenant.
-- Preserve service-role maintenance calls and the existing function ACL.
do $migration$
declare
  original text;
  anchor constant text := 'and (select role from public.profiles where id = auth.uid()) <> ''owner'' then';
begin
  original := pg_get_functiondef('public.verify_stock_invariants(uuid,numeric)'::regprocedure);
  if position(anchor in original) = 0
     or position('v_tenant_id <> (select tenant_id from public.profiles where id = auth.uid())' in original) = 0 then
    raise exception 'STAFF_STOCK_INVARIANT_TENANT_GUARD_CHANGED';
  end if;
  execute replace(original, anchor,
    'and auth.uid() is not null and coalesce(auth.role(),'''') <> ''service_role'' then');
end
$migration$;
commit;
