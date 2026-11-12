begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public._staff_my_inventory_view(p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when p_branch is null
    then public._staff_permission_any_branch(auth.uid(), 'inventory.view')
    else public._staff_permission_at_scope(auth.uid(), 'inventory.view', p_branch)
  end
$$;

-- Direct lot readers also serve existing inventory and production workflows.
-- Apply additional row restrictions only to staff with an inventory exception.
create function public._staff_inventory_row_visible(p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.user_branch_permission_overrides o
    where o.user_id = auth.uid() and o.permission_code = 'inventory.view'
  ) or public._staff_permission_at_scope(auth.uid(), 'inventory.view', p_branch)
$$;

revoke all on function public._staff_my_inventory_view(uuid),
  public._staff_inventory_row_visible(uuid) from public, anon;
grant execute on function public._staff_my_inventory_view(uuid),
  public._staff_inventory_row_visible(uuid) to authenticated;

create policy staff_inventory_lot_scope on public.product_lots
as restrictive for select to authenticated
using (public._staff_inventory_row_visible(branch_id));

do $migration$
declare
  item record;
  source text;
begin
  for item in select * from (values
    (
      'public.get_product_lot_list_workspace(integer,integer,text,text,text[],text[],text,integer,date,date,uuid)',
      'public.user_has_permission(v_actor,''inventory.view'')',
      'p_branch_id',
      'where l.tenant_id=v_tenant and (',
      'where l.tenant_id=v_tenant and public._staff_my_inventory_view(l.branch_id) and ('
    ),
    (
      'public.get_lots_for_product(uuid,uuid)',
      'public.user_has_permission(auth.uid(),''inventory.view'')',
      'p_branch_id',
      'and public._can_read_branch_inventory_00476(auth.uid(),v_tenant,pl.branch_id)',
      'and public._staff_my_inventory_view(pl.branch_id) and public._can_read_branch_inventory_00476(auth.uid(),v_tenant,pl.branch_id)'
    ),
    (
      'public.check_expiring_lots(uuid,integer)',
      'public.user_has_permission(auth.uid(),''inventory.view'')',
      'null::uuid',
      'and public._can_read_branch_inventory_00476(auth.uid(),p_tenant_id,pl.branch_id)',
      'and public._staff_my_inventory_view(pl.branch_id) and public._can_read_branch_inventory_00476(auth.uid(),p_tenant_id,pl.branch_id)'
    ),
    (
      'public.get_prepared_stock_unit_history_00517(text,uuid)',
      'user_has_permission(auth.uid(),''inventory.view'')',
      'null::uuid',
      'if not _can_read_branch_inventory_00476(auth.uid(),tenant,branch)',
      'if not public._staff_my_inventory_view(branch) or not _can_read_branch_inventory_00476(auth.uid(),tenant,branch)'
    )
  ) as readers(signature, permission_anchor, branch_expression, row_anchor, row_replacement) loop
    source := pg_get_functiondef(item.signature::regprocedure);
    if position(item.permission_anchor in source) = 0 or position(item.row_anchor in source) = 0 then
      raise exception 'STAFF_INVENTORY_LOT_READER_CHANGED: %', item.signature;
    end if;
    execute replace(
      replace(source, item.permission_anchor,
        format('public._staff_my_inventory_view(%s)', item.branch_expression)),
      item.row_anchor, item.row_replacement
    );
  end loop;
end
$migration$;

-- Enable the catalog entry after all inventory readers are covered.
commit;
