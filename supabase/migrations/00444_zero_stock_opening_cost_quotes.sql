-- Confirm an explicit opening cost even at zero quantity. This is a quote,
-- not an inventory receipt; no cost quantity, value or movement is created.
begin;
create function public._confirm_zero_opening_cost_00444(
  p_tenant uuid, p_branch uuid, p_product uuid, p_cost numeric, p_actor uuid
) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_cost is null or p_cost<0 or exists(
    select 1 from public.fnb_branch_product_cost_events
    where tenant_id=p_tenant and branch_id=p_branch and product_id=p_product
  ) or exists(
    select 1 from public.branch_stock where tenant_id=p_tenant and branch_id=p_branch
      and product_id=p_product and (quantity<>0 or reserved<>0)
  ) then raise exception 'OPENING_ZERO_COST_QUOTE_INVALID'; end if;
  insert into public.fnb_branch_product_cost_balances
    (tenant_id,branch_id,product_id,costed_quantity,total_cost,unit_cost,opening_cost_confirmed,updated_by)
  values(p_tenant,p_branch,p_product,0,0,p_cost,true,p_actor)
  on conflict(tenant_id,branch_id,product_id) do update
    set unit_cost=excluded.unit_cost,opening_cost_confirmed=true,updated_by=p_actor,updated_at=now()
    where fnb_branch_product_cost_balances.costed_quantity=0 and fnb_branch_product_cost_balances.total_cost=0;
  if not found then raise exception 'OPENING_ZERO_COST_QUOTE_INVALID'; end if;
end; $$;
revoke all on function public._confirm_zero_opening_cost_00444(uuid,uuid,uuid,numeric,uuid) from public,anon,authenticated;

do $patch$
declare definition text; old_text text; new_text text;
begin
  definition:=pg_get_functiondef('public.commit_inventory_opening_00442(uuid,jsonb,jsonb,text,timestamptz,text,text)'::regprocedure);
  old_text:=$old$    if (v_row->>'fnb')::boolean then
      if not (v_row->>'costTracked')::boolean and (v_row->>'quantity')::numeric>0 then$old$;
  new_text:=$new$    if (v_row->>'fnb')::boolean then
      if not (v_row->>'costTracked')::boolean and (v_row->>'quantity')::numeric=0 then
        perform public._confirm_zero_opening_cost_00444(v_tenant,v_branch,(v_row->>'productId')::uuid,
          (v_row->>'costPrice')::numeric,v_actor);
      end if;
      if not (v_row->>'costTracked')::boolean and (v_row->>'quantity')::numeric>0 then$new$;
  if strpos(definition,old_text)=0 then raise exception 'OPENING_FUNCTION_PATCH_MISMATCH'; end if;
  execute replace(definition,old_text,new_text);

  definition:=pg_get_functiondef('public._capture_fnb_inventory_cost_event_00400()'::regprocedure);
  old_text:=$old$    if not found or v_costed_quantity <= 0 then
      raise exception using errcode = 'P0001', message = 'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED';
    end if;$old$;
  new_text:=$new$    if not found or (v_costed_quantity <= 0 and not (
      v_costed_quantity=0 and exists(
        select 1 from public.fnb_branch_product_cost_balances quote
        where quote.tenant_id=new.tenant_id and quote.branch_id=new.branch_id
          and quote.product_id=new.product_id and quote.opening_cost_confirmed
          and quote.total_cost=0 and quote.unit_cost=v_unit_cost
      ) and not exists(
        select 1 from public.fnb_branch_product_cost_events event
        where event.tenant_id=new.tenant_id and event.branch_id=new.branch_id
          and event.product_id=new.product_id
      )
    )) then
      raise exception using errcode = 'P0001', message = 'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED';
    end if;$new$;
  if strpos(definition,old_text)=0 then raise exception 'INVENTORY_COST_FUNCTION_PATCH_MISMATCH'; end if;
  execute replace(definition,old_text,new_text);
end $patch$;
commit;
