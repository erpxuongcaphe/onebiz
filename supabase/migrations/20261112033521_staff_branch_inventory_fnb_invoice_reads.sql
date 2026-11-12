-- F&B invoice details have independent invoice, order and inventory entry
-- permissions. Scope only the inventory alternative to the document branch.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public._staff_fnb_invoice_inventory_alternative(p_actor uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor is not distinct from auth.uid() and coalesce((
    public.user_has_permission(p_actor,'invoices.view') or
    public.user_has_permission(p_actor,'pos_fnb.view_orders') or
    public.user_has_permission(p_actor,'orders.view') or
    public._staff_permission_at_scope(p_actor,'inventory.view',p_branch)
  ),false)
$$;
revoke all on function public._staff_fnb_invoice_inventory_alternative(uuid,uuid) from public,anon;
grant execute on function public._staff_fnb_invoice_inventory_alternative(uuid,uuid) to authenticated;

do $migration$
declare item record; source text; anchor text; replacement text;
begin
  for item in select * from (values
    ('public.fnb_invoice_option_items_20261023(public.invoices)','($1).branch_id',null::text,null::text),
    ('public.get_fnb_invoice_choice_catalog_20261023(uuid)','null::uuid',
     'where i.tenant_id=tenant and i.deleted_at is null and (p_branch_id is null or i.branch_id=p_branch_id)',
     'where i.tenant_id=tenant and i.deleted_at is null and public._staff_fnb_invoice_inventory_alternative(actor,i.branch_id) and (p_branch_id is null or i.branch_id=p_branch_id)'),
    ('public.get_fnb_invoice_filter_options_20261023(uuid)','null::uuid',
     'and (p_branch_id is null or i.branch_id=p_branch_id)',
     'and public._staff_fnb_invoice_inventory_alternative(actor,i.branch_id) and (p_branch_id is null or i.branch_id=p_branch_id)'),
    ('public.get_fnb_invoice_item_details_20261023(uuid[])','null::uuid',
     'and (public.user_has_permission(actor,''reports.view_all_branches'') or public.user_has_branch_access(actor,i.branch_id)))<>cardinality(ids)',
     'and public._staff_fnb_invoice_inventory_alternative(actor,i.branch_id) and (public.user_has_permission(actor,''reports.view_all_branches'') or public.user_has_branch_access(actor,i.branch_id)))<>cardinality(ids)'),
    ('public.get_fnb_invoice_item_notes_20261023(uuid)','null::uuid',
     'if inv.source is distinct from ''fnb'' then return;end if;',
     'if not public._staff_fnb_invoice_inventory_alternative(actor,inv.branch_id) then raise exception ''INVOICE_VIEW_REQUIRED'' using errcode=''42501''; end if; if inv.source is distinct from ''fnb'' then return;end if;')
  ) as t(signature,scope,filter_anchor,filter_replacement) loop
    source := pg_get_functiondef(item.signature::regprocedure);
    anchor := 'public.user_has_permission(actor,''inventory.view'')';
    if (length(source)-length(replace(source,anchor,''))) / length(anchor) <> 1 then
      raise exception 'STAFF_FNB_INVENTORY_PERMISSION_CHANGED: %',item.signature;
    end if;
    replacement := format('public._staff_my_inventory_view(%s)',item.scope);
    source := replace(source,anchor,replacement);
    if item.filter_anchor is not null then
      if (length(source)-length(replace(source,item.filter_anchor,''))) / length(item.filter_anchor) <> 1 then
        raise exception 'STAFF_FNB_INVENTORY_FILTER_CHANGED: %',item.signature;
      end if;
      source := replace(source,item.filter_anchor,item.filter_replacement);
    end if;
    execute source;
  end loop;
end $migration$;
commit;
