-- The legacy no-exception path must still respect the assigned branch scope.
-- An independent all-branches reporting grant may widen read-only reporting.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare source text; anchor text := 'where b.tenant_id=tenant and b.is_active and (not has_exception or (';
begin
 source:=pg_get_functiondef('public.get_inventory_product_breakdown_scoped(uuid)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_STOCK_BREAKDOWN_BRANCH_SCOPE_CHANGED';end if;
 execute replace(source,anchor,'where b.tenant_id=tenant and b.is_active and (all_branches or public.user_has_branch_access(actor,b.id)) and (not has_exception or (');
end $migration$;
commit;
