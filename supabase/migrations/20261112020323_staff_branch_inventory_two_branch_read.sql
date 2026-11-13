begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Pair the existing access check and the exception on the same side.
-- Access to the sending side must not validate the receiving side's grant.
alter policy transaction_branch_read_00567 on public.stock_transfers
using (
  (public.can_read_branch_document_00567(tenant_id, from_branch_id)
    and public._staff_inventory_row_visible(from_branch_id))
  or (public.can_read_branch_document_00567(tenant_id, to_branch_id)
    and public._staff_inventory_row_visible(to_branch_id))
);
alter policy internal_sales_scope_00476 on public.internal_sales
using (
  (public._can_read_branch_inventory_00476((select auth.uid()), tenant_id, from_branch_id)
    and public._staff_inventory_row_visible(from_branch_id))
  or (public._can_read_branch_inventory_00476((select auth.uid()), tenant_id, to_branch_id)
    and public._staff_inventory_row_visible(to_branch_id))
);
-- Existing item policies require a visible parent and inherit these filters.

do $migration$
declare
  item record;
  source text;
  row_anchor text;
  permission_anchor constant text := 'public.user_has_permission(v_actor,''inventory.view'')';
begin
  for item in select * from (values
    ('get_stock_transfer_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,uuid,uuid,integer,integer,uuid)', 't'),
    ('get_internal_sale_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,uuid,uuid,numeric,numeric,uuid)', 's')
  ) as readers(signature, row_alias) loop
    source := pg_get_functiondef(('public.' || item.signature)::regprocedure);
    row_anchor := format('where %s.tenant_id=v_tenant', item.row_alias);
    if position(permission_anchor in source) = 0 or position(row_anchor in source) = 0 then
      raise exception 'STAFF_INVENTORY_TWO_BRANCH_READER_CHANGED: %', item.signature;
    end if;
    execute replace(
      replace(source, permission_anchor, 'public._staff_my_inventory_view(p_branch_id)'),
      row_anchor, row_anchor || format(
        ' and (p_branch_id is not null or
          ((v_all or %1$s.from_branch_id in (select x.branch_id from public.get_user_accessible_branches(v_actor) x))
            and public._staff_my_inventory_view(%1$s.from_branch_id))
          or ((v_all or %1$s.to_branch_id in (select x.branch_id from public.get_user_accessible_branches(v_actor) x))
            and public._staff_my_inventory_view(%1$s.to_branch_id)))',
        item.row_alias
      )
    );
  end loop;
end
$migration$;

commit;
