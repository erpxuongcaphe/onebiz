-- Stage 1: provide scoped, redacted document history while the old client is
-- still supported. Direct audit_log access is removed only after deployment.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function private.staff_audit_entity_allowed(p_type text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare a uuid:=auth.uid(); t uuid; result boolean:=false;
begin
 select p.tenant_id into t from public.profiles p where p.id=a and coalesce(p.is_active,false);
 if t is null or p_id is null then return false;end if;
 case p_type
 when 'cash_transaction' then
  select exists(select 1 from public.cash_transactions x where x.id=p_id and x.tenant_id=t
   and public.can_read_branch_document_00567(t,x.branch_id)
   and public._staff_my_cash_book_view(x.branch_id)) into result;
 when 'invoice' then
  select exists(select 1 from public.invoices x where x.id=p_id and x.tenant_id=t
   and public.can_read_branch_document_00567(t,x.branch_id)
   and (x.source is distinct from 'order' or public._staff_order_owner_unrestricted() or x.created_by=a
    or coalesce(x.branch_id=any(public._staff_order_independent_branches()),false))
   and (((public._staff_invoice_header_exception_flags() & 1)=0
      and (x.source is distinct from 'order' or (public._staff_invoice_header_exception_flags() & 2)=0)
      and (x.source is distinct from 'fnb' or (public._staff_invoice_header_exception_flags() & 4)=0))
     or coalesce((x.branch_id::text||':'||case when coalesce(x.source,'pos') in ('order','fnb','pos','internal') then coalesce(x.source,'pos') else 'other' end)
      =any(public._staff_invoice_header_allowed_scopes()),false))) into result;
 when 'shipping_order' then
  select coalesce((select private.staff_audit_entity_allowed('invoice',x.invoice_id) from public.shipping_orders x where x.id=p_id and x.tenant_id=t),false) into result;
 when 'sales_order' then
  select exists(select 1 from public.sales_orders x where x.id=p_id and x.tenant_id=t
   and public.can_read_branch_document_00567(t,x.branch_id)
   and (((public._staff_invoice_header_exception_flags() & 3)=0) or coalesce((x.branch_id::text||':order')=any(public._staff_invoice_header_allowed_scopes()),false))
   and (public._staff_order_owner_unrestricted() or x.created_by=a or coalesce(x.branch_id=any(public._staff_order_independent_branches()),false))) into result;
 when 'sales_return' then
  select exists(select 1 from public.sales_returns x where x.id=p_id and x.tenant_id=t and public.can_read_branch_document_00567(t,x.branch_id)) into result;
 when 'purchase_order' then
  select exists(select 1 from public.purchase_orders x where x.id=p_id and x.tenant_id=t and public.can_read_branch_document_00567(t,x.branch_id)
   and (public._staff_lot_has_no_view_exception() or coalesce(x.branch_id=any(public._staff_inventory_document_readable_branches()),false)
    or coalesce(x.branch_id=any(public._staff_purchase_action_branches()),false))) into result;
 when 'purchase_return' then
  select exists(select 1 from public.supplier_returns x where x.id=p_id and x.tenant_id=t and public.can_read_branch_document_00567(t,x.branch_id)
   and (public._staff_lot_has_no_view_exception() or coalesce(x.branch_id=any(public._staff_inventory_document_readable_branches()),false)
    or coalesce(x.branch_id=any(public._staff_purchase_action_branches()),false))) into result;
 when 'input_invoice' then
  select exists(select 1 from public.input_invoices x where x.id=p_id and x.tenant_id=t and public.can_read_branch_document_00567(t,x.branch_id)
   and (public._staff_lot_has_no_view_exception() or coalesce(x.branch_id=any(public._staff_inventory_document_readable_branches()),false)
    or coalesce(x.branch_id=any(public._staff_purchase_action_branches()),false))) into result;
 when 'inventory_check' then
  select exists(select 1 from public.inventory_checks x where x.id=p_id and x.tenant_id=t and public.can_read_branch_document_00567(t,x.branch_id)
   and public._can_read_branch_inventory_00476(a,t,x.branch_id)
   and (public._staff_lot_has_no_view_exception() or coalesce(x.branch_id=any(public._staff_inventory_document_readable_branches()),false)
    or coalesce(x.branch_id=any(public._staff_stocktake_action_branches()),false))) into result;
 when 'disposal_export' then
  select exists(select 1 from public.disposal_exports x where x.id=p_id and x.tenant_id=t and
   (((public.user_has_branch_access(a,x.branch_id) or public.user_has_permission(a,'reports.view_all_branches'))
      and public._staff_inventory_row_visible(x.branch_id) and public._staff_my_inventory_view(x.branch_id))
    or (public.user_has_branch_access(a,x.branch_id) and public._staff_permission_at_scope(a,'inventory.dispose',x.branch_id)))) into result;
 when 'internal_export' then
  select exists(select 1 from public.internal_exports x where x.id=p_id and x.tenant_id=t and
   (((public.user_has_branch_access(a,x.branch_id) or public.user_has_permission(a,'reports.view_all_branches'))
      and public._staff_inventory_row_visible(x.branch_id) and public._staff_my_inventory_view(x.branch_id))
    or (public.user_has_branch_access(a,x.branch_id) and public._staff_permission_at_scope(a,'inventory.internal_export',x.branch_id)))) into result;
 when 'stock_transfer' then
  select exists(select 1 from public.stock_transfers x where x.id=p_id and x.tenant_id=t and
   ((public.can_read_branch_document_00567(t,x.from_branch_id) and (public._staff_inventory_row_visible(x.from_branch_id) or coalesce(x.from_branch_id=any(public._staff_transfer_action_branches()),false)))
    or (public.can_read_branch_document_00567(t,x.to_branch_id) and (public._staff_inventory_row_visible(x.to_branch_id) or coalesce(x.to_branch_id=any(public._staff_transfer_action_branches()),false))))) into result;
 when 'internal_sale' then
  select exists(select 1 from public.internal_sales x where x.id=p_id and x.tenant_id=t and
   ((public._can_read_branch_inventory_00476(a,t,x.from_branch_id) and public._staff_inventory_row_visible(x.from_branch_id))
    or (public._can_read_branch_inventory_00476(a,t,x.to_branch_id) and public._staff_inventory_row_visible(x.to_branch_id)))) into result;
 when 'product_lot' then
  select exists(select 1 from public.product_lots x where x.id=p_id and x.tenant_id=t and public.can_read_branch_document_00567(t,x.branch_id)
   and public._can_read_branch_inventory_00476(a,t,x.branch_id)
   and (public._staff_lot_has_no_view_exception() or coalesce(x.branch_id=any(public._staff_lot_readable_branches()),false))) into result;
 when 'production_order' then select exists(select 1 from public.production_orders_scoped x where x.id=p_id and x.tenant_id=t) into result;
 when 'bom' then select exists(select 1 from public.bom_scoped x where x.id=p_id and x.tenant_id=t) into result;
 when 'product' then select exists(select 1 from public.products_scoped x where x.id=p_id and x.tenant_id=t) into result;
 when 'customer' then select exists(select 1 from public.customers x where x.id=p_id and x.tenant_id=t) into result;
 when 'supplier' then select exists(select 1 from public.suppliers x where x.id=p_id and x.tenant_id=t) into result;
 else return false;
 end case;
 return coalesce(result,false);
end$$;
revoke all on function private.staff_audit_entity_allowed(text,uuid) from public,anon,authenticated;

create function private.staff_audit_mask(p_value jsonb,p_cost boolean,p_profit boolean,p_debt boolean,p_stock_values boolean)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_value)='object' then
  select coalesce(jsonb_object_agg(e.key,private.staff_audit_mask(e.value,p_cost,p_profit,p_debt,p_stock_values)),'{}'::jsonb) into result
  from jsonb_each(p_value) e where e.key !~* '(otp|password|secret|token|code_hash|authorization|cookie)'
   and (p_cost or e.key !~* '(cost|cogs|gia_?von|giavon)')
   and (p_profit or e.key !~* '(profit|margin|lai_?gop)')
   and (p_debt or e.key !~* '(debt|cong_?no|congno)')
   and (p_stock_values or e.key !~* '^(unit_?price|total_?amount|amount|total|total_?value|unit_?value)$');
  return result;
 elsif jsonb_typeof(p_value)='array' then
  select coalesce(jsonb_agg(private.staff_audit_mask(e.value,p_cost,p_profit,p_debt,p_stock_values) order by e.ordinal),'[]'::jsonb) into result
  from jsonb_array_elements(p_value) with ordinality e(value,ordinal);
  return result;
 end if;
 return p_value;
end$$;
revoke all on function private.staff_audit_mask(jsonb,boolean,boolean,boolean,boolean) from public,anon,authenticated;

create function public.staff_audit_entity_history(p_entity_type text,p_entity_id uuid,p_limit integer default 50)
returns table(id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb,ip_address text,created_at timestamptz,profiles jsonb)
language plpgsql stable security definer set search_path='' as $$
declare a uuid:=auth.uid(); t uuid; owner boolean; show_cost boolean; show_profit boolean; show_debt boolean; show_ip boolean;
begin
 select p.tenant_id,p.role='owner' into t,owner from public.profiles p where p.id=a and coalesce(p.is_active,false);
 if t is null or p_limit is null or p_limit<1 or p_limit>100 or not private.staff_audit_entity_allowed(p_entity_type,p_entity_id) then
  raise exception 'AUDIT_ENTITY_DENIED' using errcode='42501';end if;
 show_cost:=public.user_has_permission(a,'products.view_cost');
 show_profit:=public.user_has_permission(a,'products.view_profit');
 show_debt:=owner or (public.user_has_permission(a,'reports.view_all_branches') and
  ((p_entity_type='customer' and public.user_has_permission(a,'customers.view_debt')) or
   (p_entity_type='supplier' and public.user_has_permission(a,'suppliers.view_debt'))));
 show_ip:=public.user_has_permission(a,'system.view_audit');
 return query select x.id,x.user_id,x.action,x.entity_type,x.entity_id,
  private.staff_audit_mask(x.old_data,show_cost,show_profit,show_debt,show_cost or p_entity_type not in ('disposal_export','internal_export')),
  private.staff_audit_mask(x.new_data,show_cost,show_profit,show_debt,show_cost or p_entity_type not in ('disposal_export','internal_export')),
  case when show_ip then x.ip_address else null end,x.created_at,
  case when p.id is null then null else jsonb_build_object('full_name',p.full_name) end
 from public.audit_log x left join public.profiles p on p.id=x.user_id and p.tenant_id=t
 where x.tenant_id=t and x.entity_type=p_entity_type and x.entity_id=p_entity_id
 order by x.created_at desc,x.id desc limit p_limit;
end$$;
revoke all on function public.staff_audit_entity_history(text,uuid,integer) from public,anon;
grant execute on function public.staff_audit_entity_history(text,uuid,integer) to authenticated;
commit;
