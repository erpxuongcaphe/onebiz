-- Forward-only, opt-in adjustment of a completed/used batch. No historic business data is migrated.
begin;
set local lock_timeout='3s';
create table if not exists public.production_used_adjustments (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id), production_order_id uuid not null references public.production_orders(id),
  request_id uuid not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  reason text not null check(length(trim(reason)) between 1 and 1000), request jsonb not null,
  before_data jsonb not null, preview jsonb not null, after_data jsonb not null,
  inventory_cost_delta numeric(18,4) not null, used_cost_delta numeric(18,4) not null,
  unique(tenant_id,request_id)
);
alter table public.production_used_adjustments enable row level security;
revoke all on public.production_used_adjustments from public,anon,authenticated;
grant select on public.production_used_adjustments to authenticated;
drop policy if exists production_used_adjustments_read on public.production_used_adjustments;
create policy production_used_adjustments_read on public.production_used_adjustments for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.tenant_id=production_used_adjustments.tenant_id and coalesce(p.is_active,true))
  and public.user_has_branch_access(auth.uid(),branch_id) and public.user_has_permission(auth.uid(),'production.view')
);
create index if not exists production_used_adjustments_order on public.production_used_adjustments(tenant_id,production_order_id,created_at desc);

-- Preview and apply share validation/calculation. The apply path recalculates under
-- the same locks and accepts only the exact preview fingerprint. Helper has NO client grant.
create or replace function public._production_used_adjustment(
 p_order_id uuid,p_expected_updated_at timestamptz,p_output_quantity numeric,p_materials jsonb,p_reason text,
 p_apply boolean,p_request_id uuid default null,p_preview_token text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 actor uuid:=auth.uid(); tenant uuid; po record; lot record; m record; p record; bs record; bal record; item jsonb;
 old_materials jsonb; snapshots jsonb:='[]'; state jsonb; prior record; result jsonb; plan jsonb; token text;
 output_qty numeric; used_qty numeric; remain_qty numeric; output_delta numeric; factor numeric; q numeric; d numeric;
 old_cost numeric; new_cost numeric:=0; old_remaining_cost numeric; new_remaining_cost numeric;
 inventory_delta numeric; used_delta numeric; tracked boolean; new_total numeric; new_balance_qty numeric;
 allocation_qty numeric; rows_changed integer; movement_id uuid; adjustment_id uuid:=gen_random_uuid();
begin
 perform set_config('lock_timeout','3s',true);
 select tenant_id into tenant from profiles where id=actor and coalesce(is_active,true);
 if tenant is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into po from production_orders where id=p_order_id and tenant_id=tenant for update;
 if not found or not user_has_branch_access(actor,po.branch_id) then raise exception 'PRODUCTION_BRANCH_ACCESS_DENIED' using errcode='42501'; end if;
 if not user_has_permission(actor,'production.create_order') or not user_has_permission(actor,'production.complete_order') then
  raise exception 'PRODUCTION_CORRECTION_PERMISSION_REQUIRED' using errcode='42501'; end if;
 if nullif(trim(p_reason),'') is null or length(p_reason)>1000 or (p_apply and p_request_id is null) then raise exception 'PRODUCTION_CORRECTION_REASON_REQUIRED'; end if;
 if p_apply then
  select * into prior from production_used_adjustments where tenant_id=tenant and request_id=p_request_id;
  if found then
   if prior.production_order_id<>po.id or prior.request is distinct from jsonb_build_object('output',p_output_quantity,'materials',p_materials,'reason',trim(p_reason),'token',p_preview_token) then
    raise exception 'PRODUCTION_CORRECTION_REQUEST_CHANGED'; end if;
   return prior.after_data;
  end if;
 end if;
 if po.updated_at is distinct from p_expected_updated_at then raise exception 'PRODUCTION_CORRECTION_STALE' using errcode='40001'; end if;
 if po.status<>'completed' then raise exception 'PRODUCTION_ADJUSTMENT_COMPLETED_REQUIRED'; end if;
 if p_output_quantity is null or p_output_quantity::text in ('NaN','Infinity','-Infinity') or round(p_output_quantity,4)<=0 then
  raise exception 'PRODUCTION_CORRECTION_QUANTITY_INVALID'; end if;
 output_qty:=round(p_output_quantity,4);
 if jsonb_typeof(p_materials) is distinct from 'array' then raise exception 'PRODUCTION_CORRECTION_MATERIALS_INVALID'; end if;
 perform 1 from production_order_materials where production_order_id=po.id order by product_id for update;
 select jsonb_agg(to_jsonb(x) order by product_id) into old_materials from production_order_materials x where production_order_id=po.id;
 if old_materials is null or jsonb_array_length(p_materials)<>jsonb_array_length(old_materials)
  or jsonb_array_length(p_materials)<>(select count(distinct value->>'productId') from jsonb_array_elements(p_materials))
  or exists(select 1 from jsonb_array_elements(p_materials) x where not exists(select 1 from production_order_materials y where y.production_order_id=po.id and y.product_id=(x->>'productId')::uuid)) then
  raise exception 'PRODUCTION_CORRECTION_MATERIALS_INVALID'; end if;
 -- Match existing production lock order. This never locks invoice/payment rows.
 perform 1 from products where tenant_id=tenant and (id=po.product_id or id in(select product_id from production_order_materials where production_order_id=po.id)) order by id for update;
 perform 1 from branch_stock where tenant_id=tenant and branch_id=po.branch_id and (product_id=po.product_id or product_id in(select product_id from production_order_materials where production_order_id=po.id)) order by product_id for update;
 perform 1 from fnb_branch_product_cost_balances where tenant_id=tenant and branch_id=po.branch_id and (product_id=po.product_id or product_id in(select product_id from production_order_materials where production_order_id=po.id)) order by product_id for update;
 select * into p from products where id=po.product_id and tenant_id=tenant;
 if not found then raise exception 'PRODUCTION_CORRECTION_HISTORY_INVALID'; end if;
 select * into lot from product_lots where tenant_id=tenant and branch_id=po.branch_id and production_order_id=po.id for update;
 if not found or (select count(*) from product_lots where tenant_id=tenant and production_order_id=po.id)<>1
  or lot.product_id is distinct from po.product_id or lot.variant_id is distinct from po.variant_id
  or lot.status not in ('active','expired','consumed') or po.completed_qty is null or po.completed_qty::text in ('NaN','Infinity','-Infinity') or po.completed_qty<=0
  or abs(lot.initial_qty-po.completed_qty)>.0001 or lot.current_qty::text in ('NaN','Infinity','-Infinity') or lot.current_qty<0 or lot.current_qty>lot.initial_qty then
  raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED'; end if;
 perform 1 from lot_allocations where tenant_id=tenant and lot_id=lot.id order by id for update;
 select coalesce(sum(quantity),0) into allocation_qty from lot_allocations where tenant_id=tenant and lot_id=lot.id and reverted_at is null;
 used_qty:=lot.initial_qty-lot.current_qty;
 if abs(allocation_qty-used_qty)>.0001 then raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED'; end if;
 if output_qty<used_qty then raise exception 'PRODUCTION_ADJUSTMENT_BELOW_USED'; end if;
 remain_qty:=output_qty-used_qty; output_delta:=output_qty-po.completed_qty;
 select * into bs from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is not distinct from po.variant_id;
 if not found or abs(bs.quantity-coalesce((select sum(current_qty) from product_lots where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is not distinct from po.variant_id and status in ('active','expired')),0))>.0001 then
  raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED'; end if;
 if bs.quantity+output_delta<0 or p.stock+output_delta<0 then raise exception 'PRODUCTION_CORRECTION_STOCK_REQUIRED'; end if;
 tracked:=_fnb_branch_cost_tracking_enabled_00390(tenant,po.branch_id);
 if tracked and po.variant_id is not null then raise exception 'PRODUCTION_ADJUSTMENT_VARIANT_COST_REQUIRED'; end if;
 state:=jsonb_build_object('order',to_jsonb(po),'lot',to_jsonb(lot),'materials',old_materials,'output_stock',to_jsonb(bs),'product',to_jsonb(p),
  'allocations',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from lot_allocations a where tenant_id=tenant and lot_id=lot.id));
 for m in select x.*,v.unit stock_unit,v.name,v.code from production_order_materials x join products v on v.id=x.product_id and v.tenant_id=tenant where x.production_order_id=po.id order by x.product_id loop
  if m.product_id=po.product_id or m.actual_qty is null or m.actual_qty<0 or m.unit is distinct from m.stock_unit or m.unit_cost is null or m.unit_cost::text in ('NaN','Infinity','-Infinity') or m.unit_cost<0 then raise exception 'PRODUCTION_CORRECTION_HISTORY_INVALID'; end if;
  select value into item from jsonb_array_elements(p_materials) where value->>'productId'=m.product_id::text;
  if (item->>'quantity')::numeric is null or (item->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') or (item->>'quantity')::numeric<0 then raise exception 'PRODUCTION_CORRECTION_QUANTITY_INVALID'; end if;
  factor:=resolve_product_uom_factor(tenant,m.product_id,item->>'unit');
  if factor is null or factor::text in ('NaN','Infinity','-Infinity') or factor<=0 or not(item ? 'expectedFactor') or round((item->>'expectedFactor')::numeric,12) is distinct from round(factor,12) then raise exception 'UOM_CONVERSION_CHANGED'; end if;
  q:=round((item->>'quantity')::numeric*factor,4); d:=q-m.actual_qty;
  select * into bs from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=m.product_id and variant_id is null;
  if not found or bs.quantity-d<0 or (select stock from products where id=m.product_id and tenant_id=tenant)-d<0 then raise exception 'PRODUCTION_CORRECTION_STOCK_REQUIRED'; end if;
  if d<>0 and abs(bs.quantity-coalesce((select sum(current_qty) from product_lots where tenant_id=tenant and branch_id=po.branch_id and product_id=m.product_id and variant_id is null and status in ('active','expired')),0))>.0001 then
   raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED'; end if;
  select * into bal from fnb_branch_product_cost_balances where tenant_id=tenant and branch_id=po.branch_id and product_id=m.product_id;
  if tracked and (not found or abs(bal.costed_quantity-bs.quantity)>.0001 or coalesce(bal.deficit_quantity,0)>0 or bal.total_cost-d*m.unit_cost<-.0001
    or (bs.quantity-d=0 and abs(bal.total_cost-d*m.unit_cost)>.01)) then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
  if not tracked and exists(select 1 from products where id=m.product_id and tenant_id=tenant and
    (stock*cost_price-d*m.unit_cost<-.0001 or (stock-d=0 and abs(stock*cost_price-d*m.unit_cost)>.01))) then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
  new_cost:=new_cost+q*m.unit_cost;
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object('productId',m.product_id,'productName',m.name,'unit',m.unit,'before',m.actual_qty,'after',q,
    'stockBefore',bs.quantity,'stockDelta',-d,'stockAfter',bs.quantity-d,'costDelta',round(-d*m.unit_cost,4),'unitCost',m.unit_cost,
    'inputQuantity',(item->>'quantity')::numeric,'inputUnit',item->>'unit','conversionFactor',factor));
  state:=state||jsonb_build_object(m.product_id::text,jsonb_build_object('stock',to_jsonb(bs),'balance',case when tracked then to_jsonb(bal) else null end,'product_stock',(select jsonb_build_object('stock',stock,'cost',cost_price) from products where id=m.product_id and tenant_id=tenant),'lots',(select jsonb_agg(to_jsonb(pl) order by id) from product_lots pl where tenant_id=tenant and branch_id=po.branch_id and product_id=m.product_id)));
 end loop;
 if jsonb_array_length(snapshots)<>jsonb_array_length(old_materials) then raise exception 'PRODUCTION_CORRECTION_MATERIALS_INVALID'; end if;
 old_cost:=po.cogs_amount; new_cost:=round(new_cost,2);
 if old_cost is null or old_cost::text in ('NaN','Infinity','-Infinity') or old_cost<0 then raise exception 'PRODUCTION_CORRECTION_HISTORY_INVALID'; end if;
 old_remaining_cost:=round(old_cost*lot.current_qty/po.completed_qty,4);
 new_remaining_cost:=round(new_cost*remain_qty/output_qty,4);
 inventory_delta:=new_remaining_cost-old_remaining_cost;
 used_delta:=round(new_cost-old_cost-inventory_delta,4);
 select * into bal from fnb_branch_product_cost_balances where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id;
 if tracked and (not found or abs(bal.costed_quantity-(select quantity from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is null))>.0001
  or coalesce(bal.deficit_quantity,0)>0 or bal.total_cost+inventory_delta<-.0001
  or (bal.costed_quantity+output_delta=0 and abs(bal.total_cost+inventory_delta)>.01)) then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
 if not tracked and (p.stock*p.cost_price+inventory_delta<-.0001 or (p.stock+output_delta=0 and abs(p.stock*p.cost_price+inventory_delta)>.01)) then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
 state:=state||jsonb_build_object('output_balance',case when tracked then to_jsonb(bal) else null end);
 plan:=jsonb_build_object('orderCode',po.code,'productName',p.name,'unit',p.unit,'outputBefore',po.completed_qty,'outputAfter',output_qty,
  'usedQuantity',used_qty,'remainingBefore',lot.current_qty,'remainingAfter',remain_qty,'stockDelta',output_delta,
  'stockBefore',(select quantity from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is not distinct from po.variant_id),
  'stockAfter',(select quantity+output_delta from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is not distinct from po.variant_id),
  'batchCostBefore',old_cost,'batchCostAfter',new_cost,'inventoryCostDelta',inventory_delta,'usedCostDelta',used_delta,'materials',snapshots);
 token:=md5(jsonb_build_object('state',state,'plan',plan,'reason',trim(p_reason),'actor',actor,'materials',p_materials)::text);
 plan:=plan||jsonb_build_object('token',token);
 if not p_apply then return plan; end if;
 if p_preview_token is distinct from token then raise exception 'PRODUCTION_ADJUSTMENT_PREVIEW_STALE' using errcode='40001'; end if;
 if output_delta=0 and not exists(select 1 from jsonb_array_elements(snapshots) x where (x->>'stockDelta')::numeric<>0) then raise exception 'PRODUCTION_ADJUSTMENT_NO_CHANGE'; end if;
 -- Apply ONLY deltas. No invoice/items/payment/allocation UPDATE occurs here.
 for item in select value from jsonb_array_elements(snapshots) loop
  d:=-(item->>'stockDelta')::numeric;
  if d=0 then continue; end if;
  if tracked then
   update fnb_branch_product_cost_balances set costed_quantity=costed_quantity-d,total_cost=greatest(0,round(total_cost-d*(item->>'unitCost')::numeric,4)),
    unit_cost=case when costed_quantity-d=0 then 0 else round(greatest(0,total_cost-d*(item->>'unitCost')::numeric)/(costed_quantity-d),6) end,updated_by=actor,updated_at=now()
    where tenant_id=tenant and branch_id=po.branch_id and product_id=(item->>'productId')::uuid;
  end if;
  update branch_stock set quantity=quantity-d,updated_at=now() where tenant_id=tenant and branch_id=po.branch_id and product_id=(item->>'productId')::uuid and variant_id is null;
  update products set stock=stock-d,cost_price=case when tracked then cost_price when stock-d=0 then 0 else
   round(greatest(0,stock*cost_price-d*(item->>'unitCost')::numeric)/(stock-d),4) end
   where tenant_id=tenant and id=(item->>'productId')::uuid;
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,unit_cost,reference_type,reference_id,note,created_by)
   values(tenant,po.branch_id,(item->>'productId')::uuid,case when d>0 then 'out' else 'in' end,abs(d),(item->>'unitCost')::numeric,'production_correction',po.id,po.code||': '||trim(p_reason),actor) returning id into movement_id;
  if tracked then insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost,note,created_by)
   values(tenant,po.branch_id,(item->>'productId')::uuid,case when d>0 then 'out' else 'in' end,'production_cancel_restore','production_used_adjustment',adjustment_id,movement_id,abs(d),(item->>'unitCost')::numeric,round(abs(d)*(item->>'unitCost')::numeric,4),trim(p_reason),actor); end if;
  perform _reconcile_product_lots_to_branch_00284(tenant,po.branch_id,(item->>'productId')::uuid,'production_used_adjustment',adjustment_id,actor,trim(p_reason));
 end loop;
 if tracked then
  -- Reverse/replace the remaining portion only. Used portion variance lives in
  -- production_used_adjustments.used_cost_delta at adjustment time, never in old bills.
  if lot.current_qty>0 then insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,quantity,unit_cost,total_cost,note,created_by)
   values(tenant,po.branch_id,po.product_id,'out','production_complete','production_used_adjustment',adjustment_id,lot.current_qty,old_cost/po.completed_qty,old_remaining_cost,trim(p_reason),actor); end if;
  if remain_qty>0 then insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,quantity,unit_cost,total_cost,note,created_by)
   values(tenant,po.branch_id,po.product_id,'in','production_complete','production_used_adjustment',adjustment_id,remain_qty,new_cost/output_qty,new_remaining_cost,trim(p_reason),actor); end if;
  update fnb_branch_product_cost_balances set costed_quantity=costed_quantity+output_delta,total_cost=greatest(0,round(total_cost+inventory_delta,4)),
   unit_cost=case when costed_quantity+output_delta=0 then 0 else round(greatest(0,total_cost+inventory_delta)/(costed_quantity+output_delta),6) end,updated_by=actor,updated_at=now()
   where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id;
 end if;
 update branch_stock set quantity=quantity+output_delta,updated_at=now() where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is not distinct from po.variant_id;
 update products set stock=stock+output_delta,cost_price=case when tracked then cost_price when stock+output_delta=0 then 0 else round(greatest(0,stock*cost_price+inventory_delta)/(stock+output_delta),4) end where tenant_id=tenant and id=po.product_id;
 if output_delta<>0 then insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,unit_cost,reference_type,reference_id,note,created_by)
  values(tenant,po.branch_id,po.product_id,case when output_delta>0 then 'in' else 'out' end,abs(output_delta),new_cost/output_qty,'production_correction',po.id,po.code||': '||trim(p_reason),actor); end if;
 update product_lots set initial_qty=output_qty,current_qty=remain_qty,status=case when remain_qty=0 then 'consumed' when lot.status='expired' then 'expired' else 'active' end,updated_at=now() where id=lot.id;
 update production_order_materials x set actual_qty=(s->>'after')::numeric from jsonb_array_elements(snapshots) s where x.production_order_id=po.id and x.product_id=(s->>'productId')::uuid;
 update production_orders set completed_qty=output_qty,cogs_amount=new_cost,updated_at=clock_timestamp() where id=po.id;
 result:=jsonb_build_object('id',adjustment_id,'orderId',po.id,'preview',plan);
 insert into production_used_adjustments(id,tenant_id,branch_id,production_order_id,request_id,created_by,reason,request,before_data,preview,after_data,inventory_cost_delta,used_cost_delta)
  values(adjustment_id,tenant,po.branch_id,po.id,p_request_id,actor,trim(p_reason),jsonb_build_object('output',p_output_quantity,'materials',p_materials,'reason',trim(p_reason),'token',p_preview_token),state,plan,result,inventory_delta,used_delta);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data) values(tenant,actor,'production_used_adjustment','production_order',po.id,state,
  jsonb_build_object('adjustment_id',adjustment_id,'reason',trim(p_reason),'preview',plan,'bills_unchanged',true));
 return result;
end; $$;
revoke all on function public._production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,boolean,uuid,text) from public,anon,authenticated;
create or replace function public.preview_production_used_adjustment(p_order_id uuid,p_expected_updated_at timestamptz,p_output_quantity numeric,p_materials jsonb,p_reason text)
 returns jsonb language sql security definer set search_path=public as $$select public._production_used_adjustment($1,$2,$3,$4,$5,false)$$;
create or replace function public.apply_production_used_adjustment(p_order_id uuid,p_expected_updated_at timestamptz,p_output_quantity numeric,p_materials jsonb,p_reason text,p_request_id uuid,p_preview_token text)
 returns jsonb language sql security definer set search_path=public as $$select public._production_used_adjustment($1,$2,$3,$4,$5,true,$6,$7)$$;
revoke all on function public.preview_production_used_adjustment(uuid,timestamptz,numeric,jsonb,text),public.apply_production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,uuid,text) from public,anon;
grant execute on function public.preview_production_used_adjustment(uuid,timestamptz,numeric,jsonb,text),public.apply_production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,uuid,text) to authenticated;
-- Keep the existing cancel path usable if an adjustment corrected a mistaken
-- ingredient to zero. Preserve all other #765 guards and refuse concurrent replacement.
do $cancel_zero$
declare body text;
begin
 select pg_get_functiondef('public.correct_production_order_quantities(uuid,timestamptz,uuid,numeric,jsonb,text,boolean)'::regprocedure) into body;
 if position('old_qty<=0' in body)>0 then
  if (select md5(replace(btrim(prosrc),E'\r','')) from pg_proc where oid='public.correct_production_order_quantities(uuid,timestamptz,uuid,numeric,jsonb,text,boolean)'::regprocedure)<>'6bf564e2aa3f696bccc40e8b519cae1b' then
   raise exception 'PRODUCTION_CORRECTION_FUNCTION_CHANGED'; end if;
  body:=replace(body,'if old_qty is null or old_qty<=0 then',
   'if old_qty is null or old_qty<0 or (old_qty=0 and not (po.status=''completed'' and exists(select 1 from production_used_adjustments where tenant_id=tenant and production_order_id=po.id))) then');
  execute body;
 elsif position('exists(select 1 from production_used_adjustments' in body)=0 then
  raise exception 'PRODUCTION_CORRECTION_FUNCTION_CHANGED';
 end if;
end;
$cancel_zero$;
commit;
