-- The product stock/expiry picker is always for one explicit branch.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $migration$
declare source text; anchor text := 'public.user_has_permission(auth.uid(),''inventory.view'')';
begin
  source := pg_get_functiondef('public.get_products_with_branch_stock(uuid,uuid,uuid,boolean)'::regprocedure);
  if (length(source)-length(replace(source,anchor,''))) / length(anchor) <> 1 then
    raise exception 'STAFF_INVENTORY_STOCK_PRODUCTS_CONSUMER_CHANGED';
  end if;
  execute replace(source,anchor,'public._staff_my_inventory_view(p_branch_id)');
end $migration$;
commit;
