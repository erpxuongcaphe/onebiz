-- Cost-only production corrections restate the receipt value, not a physical issue.
-- Keep the correction at its actual posting time, preserving historical period balances.
-- Reverse/replacement quantities cancel; stock, cost events and financial documents stay unchanged.
begin;
create or replace function public._inventory_value_timeline_00540(p_from timestamptz,p_to timestamptz,p_branch uuid,p_tenant uuid)
returns table(product_id uuid,branch_id uuid,created_at timestamptz,direction text,reference_type text,quantity numeric,amount numeric)
language sql stable security definer set search_path='' as $$
 select e.product_id,e.branch_id,e.created_at,
 case when e.source_reference_type='production_correction' and e.source_type='production_complete' then 'in' else e.direction end,
 case when e.source_reference_type='production_correction' and e.source_type='production_complete' then 'production_complete' else e.source_reference_type end,
 case when e.source_reference_type='production_correction' and e.source_type='production_complete' and e.direction='out' then -e.quantity else e.quantity end,
 case when e.source_reference_type='production_correction' and e.source_type='production_complete' and e.direction='out' then -e.total_cost else e.total_cost end
 from public.fnb_branch_product_cost_events e
 where e.tenant_id=p_tenant and e.created_at>=p_from and e.created_at<p_to
 and (p_branch is null or e.branch_id=p_branch)
 and public._can_read_branch_inventory_00476(auth.uid(),e.tenant_id,e.branch_id)
 and public._fnb_branch_cost_tracking_enabled_00390(e.tenant_id,e.branch_id)

 union all
 select s.product_id,s.branch_id,s.created_at,s.type,lower(coalesce(s.reference_type,'')),s.quantity,
 case when e.id is not null and e.direction=s.type and abs(e.quantity-s.quantity)<0.0000001 then e.total_cost
 when e.id is not null then null
 when s.unit_cost>=0 then s.quantity*s.unit_cost
 when s.type='in' and s.unit_price>=0 then s.quantity*s.unit_price else null end
 from public.stock_movements s left join public.fnb_branch_product_cost_events e
 on e.tenant_id=s.tenant_id and e.source_stock_movement_id=s.id
 where s.tenant_id=p_tenant and s.created_at>=p_from and s.created_at<p_to and s.type in ('in','out')
 and (p_branch is null or s.branch_id=p_branch)
 and public._can_read_branch_inventory_00476(auth.uid(),s.tenant_id,s.branch_id)
 and not public._fnb_branch_cost_tracking_enabled_00390(s.tenant_id,s.branch_id)
$$;
commit;
