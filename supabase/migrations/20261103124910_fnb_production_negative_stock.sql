-- F&B preparation may consume stock before its receipt is entered.
-- Preserve physical issues, known branch cost, shortage settlement and all ACLs.
-- No existing quantities, documents, prices, recipes or branch policies change.
begin;
set local lock_timeout='3s';

create or replace function public._production_negative_stock_allowed_20261103(p_tenant uuid,p_branch uuid,p_output uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.branches b join public.products p on p.tenant_id=b.tenant_id
 where b.tenant_id=p_tenant and b.id=p_branch and b.cascade_mode='outlet'
 and coalesce(b.is_active,true) and p.id=p_output and p.is_fnb_stock_item and coalesce(p.is_active,true));
$$;
revoke all on function public._production_negative_stock_allowed_20261103(uuid,uuid,uuid) from public,anon,authenticated;

-- Fail closed on unexpected deployed definitions; replace bodies in place so
-- dependencies keep their OIDs, grants and public permission wrappers.
create or replace function pg_temp.patch_production_20261103(p_signature text,p_old text,p_new text)
returns void language plpgsql as $$
declare d text;
begin
 d:=pg_get_functiondef(p_signature::regprocedure);
 if position(p_new in d)>0 then return; end if;
 if (length(d)-length(replace(d,p_old,'')))/length(p_old)<>1 then
   raise exception 'PRODUCTION_NEGATIVE_PATCH_MISMATCH: %',p_signature;
 end if;
 execute replace(d,p_old,p_new);
end; $$;

select pg_temp.patch_production_20261103('public._create_production_before_gram_00517(jsonb)',
 'v_balance_qty := coalesce(v_material.costed_quantity, 0);',
 'v_balance_qty := coalesce(v_material.costed_quantity, 0) - coalesce((select cb.deficit_quantity from public.fnb_branch_product_cost_balances cb where cb.tenant_id=v_order.tenant_id and cb.branch_id=v_order.branch_id and cb.product_id=v_material.product_id),0);');
select pg_temp.patch_production_20261103('public._create_production_before_gram_00517(jsonb)',
 $old$or v_balance_qty + 0.0001 < v_material.planned_qty then$old$,
 $new$or v_material.unit_cost is null
       or (v_balance_qty + 0.0001 < v_material.planned_qty and not public._production_negative_stock_allowed_20261103(v_order.tenant_id,v_order.branch_id,(select po.product_id from public.production_orders po where po.id=v_order_id))) then$new$);

select pg_temp.patch_production_20261103('public.complete_production_atomic(uuid,numeric,text,date,date)',
 'select b.costed_quantity, b.unit_cost',
 'select b.costed_quantity - b.deficit_quantity, b.unit_cost');
select pg_temp.patch_production_20261103('public.complete_production_atomic(uuid,numeric,text,date,date)',
 'select coalesce(bs.quantity, 0) into v_physical_qty',
 'if public._production_negative_stock_allowed_20261103(v_order.tenant_id,v_order.branch_id,(select po.product_id from public.production_orders po where po.id=p_production_order_id)) then
        perform public.upsert_branch_stock(v_order.tenant_id,v_order.branch_id,v_material.product_id,0);
      end if;
      select coalesce(bs.quantity, 0) into v_physical_qty');
select pg_temp.patch_production_20261103('public.complete_production_atomic(uuid,numeric,text,date,date)',
 $old$or v_costed_qty + 0.0001 < v_material.quantity then$old$,
 $new$or v_unit_cost is null
         or (v_costed_qty + 0.0001 < v_material.quantity and not public._production_negative_stock_allowed_20261103(v_order.tenant_id,v_order.branch_id,(select po.product_id from public.production_orders po where po.id=p_production_order_id))) then$new$);

select pg_temp.patch_production_20261103('public.consume_production_materials(uuid)',
 $old$if v_current_stock is null or v_current_stock < r.qty then$old$,
 $new$if (v_current_stock is null or v_current_stock < r.qty)
      and not public._production_negative_stock_allowed_20261103(v_order.tenant_id,v_order.branch_id,v_order.product_id) then$new$);
select pg_temp.patch_production_20261103('public.consume_production_materials(uuid)',
 $old$select coalesce(quantity, 0) into v_current_stock$old$,
 $new$if public._production_negative_stock_allowed_20261103(v_order.tenant_id,v_order.branch_id,v_order.product_id) then
      perform public.upsert_branch_stock(v_order.tenant_id,v_order.branch_id,r.product_id,0);
    end if;
    select coalesce(quantity, 0) into v_current_stock$new$);
-- Keep the branch's six-decimal ingredient snapshot for F&B batch COGS;
-- the legacy local variable is four-decimal and can otherwise lose a cent.
select pg_temp.patch_production_20261103('public.consume_production_materials(uuid)',
 'v_total_cogs := v_total_cogs + (v_unit_cost * r.qty);',
 'v_total_cogs := v_total_cogs + ((case when public._production_negative_stock_allowed_20261103(v_order.tenant_id,v_order.branch_id,v_order.product_id) then coalesce(r.existing_unit_cost,v_unit_cost) else v_unit_cost end) * r.qty);');

-- Reuse the established deficit ledger and receipt settlement. Production
-- deficits reference a cost event/production order, never a fictitious invoice.
select pg_temp.patch_production_20261103('public._post_fnb_branch_cost_out_00390(uuid,uuid,uuid,numeric,text,text,uuid,uuid,text,uuid)',
 $old$(p_source_type='bom_consume' and public._allow_negative_sale_00473(p_tenant_id,p_branch_id))$old$,
 $new$((p_source_type='bom_consume' and public._allow_negative_sale_00473(p_tenant_id,p_branch_id))
   or (p_source_type='production_consume' and p_source_reference_type='production_order' and exists(
     select 1 from public.production_orders po where po.id=p_source_reference_id and po.tenant_id=p_tenant_id and po.branch_id=p_branch_id
     and public._production_negative_stock_allowed_20261103(po.tenant_id,po.branch_id,po.product_id))))$new$);
select pg_temp.patch_production_20261103('public._post_fnb_branch_cost_out_00390(uuid,uuid,uuid,numeric,text,text,uuid,uuid,text,uuid)',
 'v_event,p_source_reference_id,v_short,v_short,v_unit,v_known',
 'v_event,case when p_source_type=''production_consume'' then null else p_source_reference_id end,v_short,v_short,v_unit,v_known');
select pg_temp.patch_production_20261103('public._post_fnb_branch_cost_out_00390(uuid,uuid,uuid,numeric,text,text,uuid,uuid,text,uuid)',
 $old$'fnb_sale_stock_shortfall','invoice',p_source_reference_id,$old$,
 $new$case when p_source_type='production_consume' then 'fnb_production_stock_shortfall' else 'fnb_sale_stock_shortfall' end,
 case when p_source_type='production_consume' then 'production_order' else 'invoice' end,p_source_reference_id,$new$);
select pg_temp.patch_production_20261103('public._post_fnb_branch_cost_in_00390(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid,text,uuid)',
 $old$'fnb_stock_shortfall_settled','invoice',s.invoice_id,$old$,
 $new$'fnb_stock_shortfall_settled',case when s.invoice_id is null then 'production_order' else 'invoice' end,
 coalesce(s.invoice_id,(select e.source_reference_id from public.fnb_branch_product_cost_events e where e.id=s.cost_event_id)),$new$);

-- The existing read RPC remains unchanged for old clients. New clients receive
-- deficit quantity alongside costed quantity, without exposing monetary costs.
create or replace function public.get_fnb_production_stock_health_20261103(p_branch_id uuid,p_product_ids uuid[])
returns table(product_id uuid,physical_quantity numeric,costed_quantity numeric,deficit_quantity numeric)
language sql stable security definer set search_path='' as $$
 select h.product_id,h.physical_quantity,h.costed_quantity,coalesce(b.deficit_quantity,0)
 from public.get_fnb_production_stock_health_00476(p_branch_id,p_product_ids) h
 left join public.fnb_branch_product_cost_balances b on b.tenant_id=(select p.tenant_id from public.profiles p where p.id=auth.uid() and coalesce(p.is_active,true))
 and b.branch_id=p_branch_id and b.product_id=h.product_id;
$$;
revoke all on function public.get_fnb_production_stock_health_20261103(uuid,uuid[]) from public,anon;
grant execute on function public.get_fnb_production_stock_health_20261103(uuid,uuid[]) to authenticated;
comment on function public.get_fnb_production_stock_health_20261103(uuid,uuid[]) is 'Quantity-only F&B production health: physical stock = costed stock minus unsettled deficit; retains original branch/permission checks.';
notify pgrst,'reload schema';
commit;
