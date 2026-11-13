begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  item record;
  source text;
begin
  for item in select * from (values
    ('get_fnb_purchase_order_links(uuid[])', 'public.user_has_permission(auth.uid(),''inventory.view'')', 'p.branch_id'),
    ('get_fnb_warehouse_order_for_change(uuid)', 'public.user_has_permission(auth.uid(),''inventory.view'')', 'p.branch_id'),
    ('get_internal_receiving_workspace(uuid)', 'user_has_permission(v_actor,''inventory.view'')', 'p_branch_id'),
    ('get_internal_stock_returns(uuid,uuid)', 'public.user_has_permission(actor,''inventory.view'')', 'p_branch_id')
  ) as readers(signature, permission_anchor, branch_expression) loop
    source := pg_get_functiondef(('public.' || item.signature)::regprocedure);
    if position(item.permission_anchor in source) = 0 then
      raise exception 'STAFF_INVENTORY_RELATED_READER_CHANGED: %', item.signature;
    end if;
    execute replace(source, item.permission_anchor,
      format('public._staff_my_inventory_view(%s)', item.branch_expression));
  end loop;
end
$migration$;

commit;
