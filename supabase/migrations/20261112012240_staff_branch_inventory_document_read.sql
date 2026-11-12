begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local search_path = public;

-- With an exception configured, a line whose parent is hidden must also
-- be hidden. A null parent branch therefore cannot fall back to a global grant.
create or replace function public._staff_inventory_row_visible(p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.user_branch_permission_overrides o
    where o.user_id = auth.uid() and o.permission_code = 'inventory.view'
  ) or (p_branch is not null and public._staff_permission_at_scope(auth.uid(), 'inventory.view', p_branch))
$$;

do $migration$
declare
  item record;
  source text;
  permission_anchor text;
  row_anchor text;
  scope_anchor constant text := '_can_read_branch_inventory_00476(auth.uid(), o.tenant_id, o.branch_id)';
begin
  for item in select * from (values
    ('get_disposal_export_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,numeric,numeric,uuid)', 'd', 'd.tenant_id=v_tenant', false),
    ('get_input_invoice_list_workspace(integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid)', 'ii', 'ii.tenant_id = v_tenant', true),
    ('get_internal_export_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,numeric,numeric,uuid)', 'e', 'e.tenant_id=v_tenant', false),
    ('get_inventory_check_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,uuid)', 'c', 'c.tenant_id=v_tenant', false),
    ('get_purchase_order_list_workspace(integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid)', 'po', 'po.tenant_id = v_tenant', true),
    ('get_supplier_return_list_workspace(integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid)', 'sr', 'sr.tenant_id=v_tenant', false)
  ) as readers(signature, row_alias, tenant_predicate, spaced_permission) loop
    source := pg_get_functiondef(('public.' || item.signature)::regprocedure);
    permission_anchor := case when item.spaced_permission
      then 'public.user_has_permission(v_actor, ''inventory.view'')'
      else 'public.user_has_permission(v_actor,''inventory.view'')' end;
    row_anchor := 'where ' || item.tenant_predicate;
    if position(permission_anchor in source) = 0 or position(row_anchor in source) = 0 then
      raise exception 'STAFF_INVENTORY_DOCUMENT_READER_CHANGED: %', item.signature;
    end if;
    execute replace(
      replace(source, permission_anchor, 'public._staff_my_inventory_view(p_branch_id)'),
      row_anchor, row_anchor || format(' and public._staff_my_inventory_view(%s.branch_id)', item.row_alias)
    );
  end loop;

  source := pg_get_functiondef('public.get_inventory_check_change_source(uuid)'::regprocedure);
  permission_anchor := 'public.user_has_permission(actor,''inventory.view'')';
  row_anchor := 'if not public.user_has_branch_access(actor,c.branch_id)';
  if position(permission_anchor in source) = 0 or position(row_anchor in source) = 0 then
    raise exception 'STAFF_INVENTORY_CHECK_DETAIL_CHANGED';
  end if;
  execute replace(
    replace(source, permission_anchor, 'public._staff_my_inventory_view(null::uuid)'),
    row_anchor, 'if not public._staff_my_inventory_view(c.branch_id) or not public.user_has_branch_access(actor,c.branch_id)'
  );

  source := pg_get_viewdef('public.inventory_check_items_scoped'::regclass, true);
  if position(scope_anchor in source) = 0 then
    raise exception 'STAFF_INVENTORY_CHECK_ITEM_VIEW_CHANGED';
  end if;
  execute 'create or replace view public.inventory_check_items_scoped as ' ||
    replace(source, scope_anchor, '(' || scope_anchor || ' and public._staff_inventory_row_visible(o.branch_id))');

  for item in select * from (values
    ('disposal_exports', 'disposal_export_items', 'disposal_id'),
    ('input_invoices', null, null),
    ('internal_exports', 'internal_export_items', 'export_id'),
    ('inventory_checks', null, null),
    ('purchase_orders', 'purchase_order_items', 'purchase_order_id'),
    ('supplier_returns', 'supplier_return_items', 'return_id')
  ) as documents(header_table, item_table, parent_key) loop
    execute format(
      'create policy staff_inventory_document_read on public.%I as restrictive for select to authenticated using (public._staff_inventory_row_visible(branch_id))',
      item.header_table
    );
    if item.item_table is not null then
      execute format(
        'create policy staff_inventory_document_read on public.%1$I as restrictive for select to authenticated using (public._staff_inventory_row_visible((select h.branch_id from public.%2$I h where h.id = %1$I.%3$I)))',
        item.item_table, item.header_table, item.parent_key
      );
    end if;
  end loop;
end
$migration$;

commit;
