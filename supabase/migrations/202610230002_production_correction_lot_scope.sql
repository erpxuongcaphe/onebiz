-- Scope production correction use checks to the actual output lot, not later unrelated sales.
-- Replaces the function only; no production order, stock or cost rows change on installation.
begin;
set local lock_timeout = '3s';
-- Refuse to overwrite a concurrent change; applying this migration twice is safe.
do $preflight$
declare body_hash text;
begin
  select md5(replace(btrim(prosrc), E'\r', '')) into body_hash from pg_proc
    where oid='public.correct_production_order_quantities(uuid,timestamptz,uuid,numeric,jsonb,text,boolean)'::regprocedure;
  if body_hash not in ('bdf0fda7887a75a0edc8ba176add27cc','6bf564e2aa3f696bccc40e8b519cae1b') then
    raise exception 'PRODUCTION_CORRECTION_FUNCTION_CHANGED: review the live function before applying this migration';
  end if;
end;
$preflight$;
create or replace function public.correct_production_order_quantities(
  p_order_id uuid, p_expected_updated_at timestamptz, p_request_id uuid,
  p_output_quantity numeric, p_materials jsonb, p_reason text,
  p_cancel boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid(); tenant uuid; po record; material record; item jsonb;
  output_product record; lot record; balance record; old_materials jsonb;
  old_qty numeric; new_qty numeric; delta numeric; factor numeric;
  old_cost numeric; new_cost numeric := 0; cost_delta numeric; new_balance_qty numeric;
  new_balance_cost numeric; tracked boolean; movement_id uuid; snapshots jsonb := '[]';
  prior jsonb; result jsonb; output_delta numeric; global_cost numeric;
begin
  select tenant_id into tenant from profiles where id=actor and coalesce(is_active,true);
  if tenant is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into po from production_orders where id=p_order_id and tenant_id=tenant for update;
  if not found or not user_has_branch_access(actor,po.branch_id) then
    raise exception 'PRODUCTION_BRANCH_ACCESS_DENIED' using errcode='42501';
  end if;
  if not user_has_permission(actor,case when p_cancel then 'production.cancel_order' else 'production.create_order' end)
    or (po.status='completed' and not p_cancel and not user_has_permission(actor,'production.complete_order')) then
    raise exception 'PRODUCTION_CORRECTION_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  if p_request_id is null or nullif(trim(p_reason),'') is null or length(p_reason)>1000 then
    raise exception 'PRODUCTION_CORRECTION_REASON_REQUIRED' using errcode='22023';
  end if;
  select new_data into prior from audit_log where tenant_id=tenant and entity_type='production_order'
    and entity_id=po.id and action='production_quantity_correction'
    and new_data->>'request_id'=p_request_id::text limit 1;
  if found then
    if prior->'request' is distinct from jsonb_build_object('output',p_output_quantity,'materials',p_materials,'reason',p_reason,'cancel',p_cancel) then
      raise exception 'PRODUCTION_CORRECTION_REQUEST_CHANGED' using errcode='22023';
    end if;
    return prior->'result';
  end if;
  if po.updated_at is distinct from p_expected_updated_at then
    raise exception 'PRODUCTION_CORRECTION_STALE' using errcode='40001';
  end if;
  if po.status='cancelled' then raise exception 'PRODUCTION_CORRECTION_STATUS_INVALID' using errcode='22023'; end if;
  if not p_cancel and (p_output_quantity is null or round(p_output_quantity,4)<=0
    or p_output_quantity::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'PRODUCTION_CORRECTION_QUANTITY_INVALID' using errcode='22023';
  end if;
  perform 1 from production_order_materials where production_order_id=po.id order by product_id for update;
  select jsonb_agg(to_jsonb(m) order by product_id) into old_materials from production_order_materials m where production_order_id=po.id;
  if not p_cancel and jsonb_typeof(p_materials) is distinct from 'array' then
    raise exception 'PRODUCTION_CORRECTION_MATERIALS_INVALID' using errcode='22023';
  end if;
  if old_materials is null or exists(select 1 from production_order_materials m where m.production_order_id=po.id and
    (m.product_id=po.product_id or not exists(select 1 from products p where p.id=m.product_id and p.tenant_id=tenant))) then
    raise exception 'PRODUCTION_CORRECTION_MATERIALS_INVALID' using errcode='22023';
  end if;
  if not p_cancel and (jsonb_array_length(p_materials)<>(select count(*) from production_order_materials where production_order_id=po.id)
    or jsonb_array_length(p_materials)<>(select count(distinct value->>'productId') from jsonb_array_elements(p_materials))
    or exists(select 1 from jsonb_array_elements(p_materials) x where not exists(
      select 1 from production_order_materials m where m.production_order_id=po.id and m.product_id=(x->>'productId')::uuid))) then
    raise exception 'PRODUCTION_CORRECTION_MATERIALS_INVALID' using errcode='22023';
  end if;
  perform 1 from products where tenant_id=tenant and (id=po.product_id or id in(
    select product_id from production_order_materials where production_order_id=po.id)) order by id for update;
  perform 1 from branch_stock where tenant_id=tenant and branch_id=po.branch_id and (product_id=po.product_id or product_id in(
    select product_id from production_order_materials where production_order_id=po.id)) order by product_id for update;
  select * into output_product from products where id=po.product_id and tenant_id=tenant;
  tracked := _fnb_branch_cost_tracking_enabled_00390(tenant,po.branch_id);
  if po.status='completed' then
    select * into lot from product_lots where tenant_id=tenant and production_order_id=po.id and branch_id=po.branch_id for update;
    -- A later sale may have consumed a DIFFERENT FIFO lot of the same product.
    -- Only the selected production lot and its unreverted allocations determine use.
    if not found or (select count(*) from product_lots where tenant_id=tenant and production_order_id=po.id)<>1
      or lot.product_id is distinct from po.product_id or lot.variant_id is distinct from po.variant_id
      or lot.status not in ('active','expired','consumed','disposed') or po.completed_qty is null or po.completed_qty<=0
      or abs(lot.initial_qty-po.completed_qty)>0.0001 or lot.current_qty>lot.initial_qty+0.0001 then
      raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED' using errcode='22023';
    end if;
    if lot.status in ('consumed','disposed') or lot.current_qty<lot.initial_qty-0.0001
      or exists(select 1 from lot_allocations la where la.tenant_id=tenant and la.lot_id=lot.id
        and la.reverted_at is null and la.quantity>0) then
      raise exception 'PRODUCTION_CORRECTION_OUTPUT_USED' using errcode='22023';
    end if;
    -- Do not rely on a stale/full lot when an unallocated issue left the ledger inconsistent.
    if not exists(select 1 from branch_stock bs where bs.tenant_id=tenant and bs.branch_id=po.branch_id
      and bs.product_id=po.product_id and bs.variant_id is not distinct from po.variant_id
      and abs(bs.quantity-coalesce((select sum(pl.current_qty) from product_lots pl where pl.tenant_id=tenant
        and pl.branch_id=po.branch_id and pl.product_id=po.product_id and pl.variant_id is not distinct from po.variant_id
        and pl.status in ('active','expired')),0))<=0.0001) then
      raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED' using errcode='22023';
    end if;
    old_cost := coalesce(po.cogs_amount,0);
  elsif exists(select 1 from production_order_materials where production_order_id=po.id and coalesce(actual_qty,0)>0) then
    raise exception 'PRODUCTION_CORRECTION_LEGACY_ISSUE' using errcode='22023';
  end if;
  for material in select m.*,p.unit stock_unit,p.name,p.code from production_order_materials m
    join products p on p.id=m.product_id and p.tenant_id=tenant where m.production_order_id=po.id order by m.product_id loop
    old_qty := case when po.status='completed' then material.actual_qty else material.planned_qty end;
    if old_qty is null or old_qty<=0 then raise exception 'PRODUCTION_CORRECTION_MATERIALS_INVALID' using errcode='22023'; end if;
    if p_cancel then new_qty := 0;
    else
      select value into item from jsonb_array_elements(p_materials) where value->>'productId'=material.product_id::text;
      if (item->>'quantity')::numeric is null or (item->>'quantity')::numeric<=0
        or (item->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') then
        raise exception 'PRODUCTION_CORRECTION_QUANTITY_INVALID' using errcode='22023';
      end if;
      factor := resolve_product_uom_factor(tenant,material.product_id,item->>'unit');
      if item ? 'expectedFactor' and round((item->>'expectedFactor')::numeric,12) is distinct from round(factor,12) then
        raise exception 'UOM_CONVERSION_CHANGED' using errcode='22023';
      end if;
      new_qty := round((item->>'quantity')::numeric*factor,4);
      if new_qty<=0 then raise exception 'PRODUCTION_CORRECTION_QUANTITY_INVALID' using errcode='22023'; end if;
      snapshots:=snapshots||jsonb_build_array(jsonb_build_object('productId',material.product_id,'productName',material.name,
        'inputQuantity',(item->>'quantity')::numeric,'inputUnit',item->>'unit','stockQuantity',new_qty,'stockUnit',material.stock_unit,'conversionFactor',factor));
    end if;
    delta := new_qty-old_qty;
    if po.status='completed' then
      if material.unit is distinct from material.stock_unit or material.unit_cost is null or material.unit_cost<0 then
        raise exception 'PRODUCTION_CORRECTION_HISTORY_INVALID' using errcode='22023';
      end if;
      new_cost := new_cost + new_qty*material.unit_cost;
      if delta<>0 then
        if not exists(select 1 from branch_stock where tenant_id=tenant and branch_id=po.branch_id
          and product_id=material.product_id and variant_id is null and quantity-delta>=0) then
          raise exception 'PRODUCTION_CORRECTION_STOCK_REQUIRED' using errcode='22023';
        end if;
        if tracked then
          select * into balance from fnb_branch_product_cost_balances where tenant_id=tenant and branch_id=po.branch_id
            and product_id=material.product_id for update;
          if not found or abs(balance.costed_quantity-(select quantity from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=material.product_id and variant_id is null))>0.0001 then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
          new_balance_qty:=balance.costed_quantity-delta;
          new_balance_cost:=round(balance.total_cost-delta*material.unit_cost,4);
          if new_balance_qty<0 or new_balance_cost< -0.01 then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
          update fnb_branch_product_cost_balances set costed_quantity=new_balance_qty,total_cost=greatest(0,new_balance_cost),
            unit_cost=case when new_balance_qty=0 then 0 else round(greatest(0,new_balance_cost)/new_balance_qty,6) end,
            updated_by=actor,updated_at=now() where tenant_id=tenant and branch_id=po.branch_id and product_id=material.product_id;
        end if;
        update branch_stock set quantity=quantity-delta,updated_at=now() where tenant_id=tenant and branch_id=po.branch_id and product_id=material.product_id and variant_id is null;
        update products set stock=stock-delta where id=material.product_id and tenant_id=tenant;
        insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,unit_cost,reference_type,reference_id,note,created_by)
          values(tenant,po.branch_id,material.product_id,case when delta>0 then 'out' else 'in' end,abs(delta),material.unit_cost,
            'production_correction',po.id,po.code||': '||trim(p_reason),actor) returning id into movement_id;
        if tracked then insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,
          source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost,note,created_by)
          values(tenant,po.branch_id,material.product_id,case when delta>0 then 'out' else 'in' end,'production_cancel_restore',
            'production_correction',po.id,movement_id,abs(delta),material.unit_cost,round(abs(delta)*material.unit_cost,4),trim(p_reason),actor); end if;
        perform _reconcile_product_lots_to_branch_00284(tenant,po.branch_id,material.product_id,'production_cancel',po.id,actor,trim(p_reason));
      end if;
      if not p_cancel then update production_order_materials set planned_qty=new_qty,actual_qty=new_qty where id=material.id; end if;
    elsif not p_cancel then update production_order_materials set planned_qty=new_qty where id=material.id;
    end if;
  end loop;
  new_qty := case when p_cancel then 0 else round(p_output_quantity,4) end;
  if po.status='completed' then
    new_cost:=round(new_cost,2); output_delta:=new_qty-po.completed_qty; cost_delta:=new_cost-old_cost;
    if not exists(select 1 from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id
      and variant_id is null and quantity+output_delta>=0) then raise exception 'PRODUCTION_CORRECTION_STOCK_REQUIRED'; end if;
    if tracked then
      select * into balance from fnb_branch_product_cost_balances where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id for update;
    if not found or abs(balance.costed_quantity-(select quantity from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is null))>0.0001 then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
      new_balance_qty:=balance.costed_quantity+output_delta; new_balance_cost:=round(balance.total_cost+cost_delta,4);
      if new_balance_qty<0 or new_balance_cost< -0.01 then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
      if new_balance_qty=0 then new_balance_cost:=0; end if;
      -- Journal a full cost reversal + replacement, including cost-only corrections.
      insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,
        quantity,unit_cost,total_cost,note,created_by) values(tenant,po.branch_id,po.product_id,'out','production_complete','production_correction',po.id,
        po.completed_qty,old_cost/po.completed_qty,old_cost,trim(p_reason),actor);
      if new_qty>0 then insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,
        quantity,unit_cost,total_cost,note,created_by) values(tenant,po.branch_id,po.product_id,'in','production_complete','production_correction',po.id,
        new_qty,new_cost/new_qty,new_cost,trim(p_reason),actor); end if;
      update fnb_branch_product_cost_balances set costed_quantity=new_balance_qty,total_cost=greatest(0,new_balance_cost),
        unit_cost=case when new_balance_qty=0 then 0 else round(greatest(0,new_balance_cost)/new_balance_qty,6) end,
        updated_by=actor,updated_at=now() where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id;
    end if;
    global_cost:=case when output_product.stock+output_delta>0 then greatest(0,round((output_product.stock*output_product.cost_price+cost_delta)/(output_product.stock+output_delta),4)) else 0 end;
    update products set stock=stock+output_delta,cost_price=global_cost where id=po.product_id and tenant_id=tenant;
    update branch_stock set quantity=quantity+output_delta,updated_at=now() where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is null;
    if output_delta<>0 then insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,unit_cost,reference_type,reference_id,note,created_by)
      values(tenant,po.branch_id,po.product_id,case when output_delta>0 then 'in' else 'out' end,abs(output_delta),
        case when new_qty>0 then new_cost/new_qty else old_cost/po.completed_qty end,'production_correction',po.id,po.code||': '||trim(p_reason),actor); end if;
    update product_lots set initial_qty=new_qty,current_qty=new_qty,status=case when p_cancel then 'cancelled' else lot.status end,updated_at=now() where id=lot.id;
  end if;
  update production_orders set status=case when p_cancel then 'cancelled' else status end,
    planned_qty=case when p_cancel then planned_qty else case when po.status='completed' then planned_qty else new_qty end end,
    completed_qty=case when po.status='completed' then new_qty else completed_qty end,
    cogs_amount=case when po.status='completed' then new_cost else cogs_amount end,
    notes=concat_ws(E'\n',nullif(notes,''),'[ĐIỀU CHỈNH] '||trim(p_reason)),updated_at=now() where id=po.id;
  result:=jsonb_build_object('order_id',po.id,'status',case when p_cancel then 'cancelled' else po.status end,'completed_qty',new_qty,'snapshots',snapshots);
  if not p_cancel then
    insert into operational_uom_requests(reference_type,request_id,tenant_id,branch_id,reference_id,payload,snapshots,result,created_by)
      values('production',p_request_id,tenant,po.branch_id,po.id,jsonb_build_object('correction',true,'output',p_output_quantity,'materials',p_materials),
        jsonb_build_array(jsonb_build_object('productId',po.product_id,'productName',output_product.name,'inputQuantity',new_qty,
          'inputUnit',output_product.unit,'stockQuantity',new_qty,'stockUnit',output_product.unit,'conversionFactor',1))||snapshots,
        jsonb_build_object('code',po.code,'correction',true),actor);
  end if;
  insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data) values(tenant,actor,
    'production_quantity_correction','production_order',po.id,jsonb_build_object('order',to_jsonb(po),'materials',old_materials,'lot',case when po.status='completed' then to_jsonb(lot) else null end),
    jsonb_build_object('request_id',p_request_id,'request',jsonb_build_object('output',p_output_quantity,'materials',p_materials,'reason',p_reason,'cancel',p_cancel),
      'result',result,'materials',snapshots,'completed_qty',new_qty,'cogs_amount',new_cost,'atomic',true));
  return result;
end; $$;
revoke all on function public.correct_production_order_quantities(uuid,timestamptz,uuid,numeric,jsonb,text,boolean) from public,anon;
grant execute on function public.correct_production_order_quantities(uuid,timestamptz,uuid,numeric,jsonb,text,boolean) to authenticated;
commit;
