-- Correct a fully settled production receipt while the product remains in deficit.
create function public._plan_production_shortfall_correction(
  batch public.production_orders, batch_lot public.product_lots, quantity_delta numeric, unit_cost numeric
) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
  allocation record;
  shortage record;
  allocations jsonb := '[]';
  remaining numeric := abs(quantity_delta);
  take numeric;
  cost_delta numeric := 0;
  row_cost numeric;
begin
  select id,quantity into allocation from lot_allocations
  where tenant_id=batch.tenant_id and lot_id=batch_lot.id and reverted_at is null
    and source_type='reconciliation';
  if not found or allocation.quantity<>batch.completed_qty or
    (select count(*) from lot_allocations where tenant_id=batch.tenant_id and lot_id=batch_lot.id and reverted_at is null)<>1 or
    (select coalesce(sum((new_data->>'quantity')::numeric),0) from audit_log
      where tenant_id=batch.tenant_id and action='fnb_stock_shortfall_settled' and new_data->>'source_id'=batch.id::text
        and new_data->>'branch_id'=batch.branch_id::text and new_data->>'product_id'=batch.product_id::text)<>batch.completed_qty then
    raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED';
  end if;
  for shortage in
    with original as (
      select entity_id invoice_id, (new_data->>'quantity')::numeric quantity,
        (new_data->>'received_unit_cost')::numeric rate, count(*) matches, max(created_at) settled_at
      from audit_log where tenant_id=batch.tenant_id and action='fnb_stock_shortfall_settled'
        and entity_type='invoice' and new_data->>'source_id'=batch.id::text
        and new_data->>'branch_id'=batch.branch_id::text and new_data->>'product_id'=batch.product_id::text
      group by 1,2,3
    ), matched as (
      select s.*, o.rate, o.matches, count(*) over (partition by o.invoice_id,o.quantity,o.rate) candidate_count
      from original o join fnb_sale_cost_shortfalls_00473 s
        on s.tenant_id=batch.tenant_id and s.branch_id=batch.branch_id and s.product_id=batch.product_id
        and s.invoice_id=o.invoice_id and s.quantity=o.quantity and s.pending_quantity=0
        and s.created_at<=o.settled_at and s.settled_actual_cost=round(s.quantity*o.rate,4)
      where o.rate>0 and not exists (
        select 1 from audit_log a where a.tenant_id=batch.tenant_id and a.action='fnb_stock_shortfall_settled'
          and a.entity_id=o.invoice_id and a.new_data->>'branch_id'=batch.branch_id::text
          and a.new_data->>'product_id'=batch.product_id::text and a.new_data->>'source_id' is distinct from batch.id::text
      )
    )
    select id,tenant_id,branch_id,product_id,cost_event_id,invoice_id,quantity,pending_quantity,
      estimated_unit_cost,cost_known,settled_actual_cost,created_at,updated_at,unit_cost rate
    from fnb_sale_cost_shortfalls_00473 s
    where quantity_delta>0 and s.tenant_id=batch.tenant_id and s.branch_id=batch.branch_id
      and s.product_id=batch.product_id and s.pending_quantity>0
    union all
    select id,tenant_id,branch_id,product_id,cost_event_id,invoice_id,quantity,pending_quantity,
      estimated_unit_cost,cost_known,settled_actual_cost,created_at,updated_at,rate
    from matched where quantity_delta<0 and candidate_count=matches
    order by created_at,id
  loop
    exit when remaining=0;
    if quantity_delta>0 then
      take:=least(remaining,shortage.pending_quantity);
      row_cost:=round(take*shortage.rate,4);
    else
      take:=least(remaining,shortage.quantity);
      row_cost:=round((shortage.quantity-take)*shortage.rate,4)-shortage.settled_actual_cost;
    end if;
    allocations:=allocations||jsonb_build_array(jsonb_build_object(
      'id',shortage.id,'invoiceId',shortage.invoice_id,'pendingBefore',shortage.pending_quantity,
      'costBefore',shortage.settled_actual_cost,'quantity',take,'costDelta',row_cost));
    cost_delta:=cost_delta+row_cost;
    remaining:=remaining-take;
  end loop;
  if remaining<>0 then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;
  return jsonb_build_object('lotAllocationId',allocation.id,'rows',allocations,'costDelta',cost_delta);
end;
$$;
revoke all on function public._plan_production_shortfall_correction(public.production_orders,public.product_lots,numeric,numeric) from public,anon,authenticated;

do $migration$
declare
  definition text := replace(pg_get_functiondef(
    'public._production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,boolean,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  substitutions text[][] := array[
    array['actor uuid:=auth.uid(); tenant uuid; po record; lot record;',
      'actor uuid:=auth.uid(); tenant uuid; po production_orders%rowtype; lot product_lots%rowtype;'],
    array['output_lot_gap numeric;',
      'output_lot_gap numeric; settles_shortfall boolean:=false; shortfall_plan jsonb; shortfall_row jsonb; receipt_rate numeric; output_stock_before numeric;'],
    array['if output_qty<used_qty then raise exception ''PRODUCTION_ADJUSTMENT_BELOW_USED''; end if;',
      ''],
    array['if output_lot_gap<-.0001 or (output_lot_gap>.0001 and (output_delta>=0 or po.variant_id is not null)) then',
      $sql$settles_shortfall:=po.variant_id is null and lot.current_qty=0 and output_delta<>0
   and bs.quantity<0 and bs.quantity+output_delta<=0 and output_lot_total=0
   and _fnb_branch_cost_tracking_enabled_00390(tenant,po.branch_id)
   and exists(select 1 from lot_allocations where tenant_id=tenant and lot_id=lot.id and reverted_at is null and source_type='reconciliation');
 if settles_shortfall then remain_qty:=0;
 elsif output_qty<used_qty then raise exception 'PRODUCTION_ADJUSTMENT_BELOW_USED'; end if;
 if not settles_shortfall and (output_lot_gap<-.0001 or (output_lot_gap>.0001 and (output_delta>=0 or po.variant_id is not null))) then$sql$],
    array['if bs.quantity+output_delta<0 or (p.stock+output_delta<0 and not branch_balance_only) then',
      'if not settles_shortfall and (bs.quantity+output_delta<0 or (p.stock+output_delta<0 and not branch_balance_only)) then'],
    array['if tracked and (not found or abs(bal.costed_quantity-(select quantity',
      $sql$if settles_shortfall then
  if not found or bal.costed_quantity<>0 or abs(bal.total_cost)>.01 or bal.deficit_quantity<>-output_stock_before
     or bal.deficit_quantity<>(select coalesce(sum(pending_quantity),0) from fnb_sale_cost_shortfalls_00473
       where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and pending_quantity>0)
     or new_cost<>old_cost or exists(select 1 from jsonb_array_elements(snapshots) s where (s->>'stockDelta')::numeric<>0) then
    raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED';
  end if;
  receipt_rate:=round(new_cost/output_qty,6);
  shortfall_plan:=_plan_production_shortfall_correction(po,lot,output_delta,receipt_rate);
  used_delta:=-((shortfall_plan->>'costDelta')::numeric);
 end if;
 if tracked and not settles_shortfall and (not found or abs(bal.costed_quantity-(select quantity$sql$],
    array['select * into bs from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is not distinct from po.variant_id;',
      $sql$select * into bs from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id and variant_id is not distinct from po.variant_id;
 if found then output_stock_before:=bs.quantity; end if;$sql$],
    array['if output_lot_gap>.0001 then',
      $sql$if settles_shortfall then
  state:=state||jsonb_build_object('shortfall_plan',shortfall_plan);
  plan:=plan||jsonb_build_object('shortfallQuantityDelta',-output_delta,'shortfallCostDelta',(shortfall_plan->>'costDelta')::numeric);
 elsif output_lot_gap>.0001 then$sql$],
    array['if tracked then' || E'\n  -- Reverse/replace',
      $sql$if tracked and not settles_shortfall then
  -- Reverse/replace$sql$],
    array[$sql$abs(output_delta),new_cost/output_qty,'production_correction'$sql$,
      $sql$abs(output_delta),case when settles_shortfall then abs((shortfall_plan->>'costDelta')::numeric/output_delta)
     else new_cost/output_qty end,'production_correction'$sql$],
    array[$sql$'preview',plan,'bills_unchanged',true$sql$,
      $sql$'preview',plan,'bills_unchanged',not settles_shortfall$sql$],
    array[$sql$trim(p_reason),actor); end if;
 update product_lots set initial_qty=output_qty$sql$,
      $sql$trim(p_reason),actor) returning id into movement_id; end if;
 if settles_shortfall then
  if output_delta>0 then
   perform _post_fnb_branch_cost_in_00390(tenant,po.branch_id,po.product_id,output_delta,receipt_rate,
     'production_complete','production_used_adjustment',adjustment_id,movement_id,trim(p_reason),actor);
  else
   for shortfall_row in select value from jsonb_array_elements(shortfall_plan->'rows') loop
    update fnb_sale_cost_shortfalls_00473 set
      pending_quantity=pending_quantity+(shortfall_row->>'quantity')::numeric,
      settled_actual_cost=settled_actual_cost+(shortfall_row->>'costDelta')::numeric, updated_at=now()
    where id=(shortfall_row->>'id')::uuid and tenant_id=tenant;
    insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
    values(tenant,actor,'fnb_stock_shortfall_reopened','invoice',(shortfall_row->>'invoiceId')::uuid,
      shortfall_row||jsonb_build_object('branch_id',po.branch_id,'product_id',po.product_id,'source_id',adjustment_id,'production_order_id',po.id));
   end loop;
   update fnb_branch_product_cost_balances set deficit_quantity=deficit_quantity-output_delta,updated_by=actor,updated_at=now()
   where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id;
   insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,
     source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost,note,created_by)
   values(tenant,po.branch_id,po.product_id,'out','production_complete','production_used_adjustment',adjustment_id,
     movement_id,-output_delta,(shortfall_plan->>'costDelta')::numeric/output_delta,
     -(shortfall_plan->>'costDelta')::numeric,trim(p_reason),actor);
  end if;
  update lot_allocations set quantity=output_qty where id=(shortfall_plan->>'lotAllocationId')::uuid and tenant_id=tenant;
 end if;
 update product_lots set initial_qty=output_qty$sql$]
  ];
  patch text[];
begin
  foreach patch slice 1 in array substitutions loop
    if strpos(definition,patch[1])=0 then raise exception 'PRODUCTION_SHORTFALL_CORRECTION_SOURCE_CHANGED'; end if;
    definition:=replace(definition,patch[1],patch[2]);
  end loop;
  execute definition;
end;
$migration$;
