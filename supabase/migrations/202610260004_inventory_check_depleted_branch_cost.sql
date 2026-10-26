-- Stocktakes can reconcile depleted/negative stock using a recorded branch
-- receipt cost. The existing posting function settles sale deficits FIFO.
-- No stock, cost balance, lot, invoice or historic snapshot is rewritten here.
begin;
set local lock_timeout = '3s';
do $patch$
declare definition text;
begin
  definition := pg_get_functiondef('public._capture_fnb_inventory_cost_event_00400()'::regprocedure);
  if strpos(definition, $old$    if not found or (v_costed_quantity <= 0 and not (
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
    end if;$old$) = 0 then
    raise exception 'STOCKTAKE_COST_PATCH_MISMATCH';
  end if;
  execute replace(definition, $old$    if not found or (v_costed_quantity <= 0 and not (
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
    end if;$old$, $new$    if new.reference_type = 'inventory_check' then
    if not found then
      raise exception using errcode = 'P0001', message = 'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED',
        detail = format('branch=%s product=%s', new.branch_id, new.product_id);
    end if;
    if v_costed_quantity <= 0 then
      -- The depleted balance retains branch WAC. Receipt history proves it is
      -- known; do not replace that average with the last receipt or global cost.
      perform 1
        from public.fnb_branch_product_cost_events event
       where event.tenant_id = new.tenant_id and event.branch_id = new.branch_id
         and event.product_id = new.product_id and event.direction = 'in'
       order by event.created_at desc, event.id desc limit 1;
      if not found then
        select quote.unit_cost into v_unit_cost
          from public.fnb_branch_product_cost_balances quote
         where quote.tenant_id = new.tenant_id and quote.branch_id = new.branch_id
           and quote.product_id = new.product_id and quote.opening_cost_confirmed
           and quote.costed_quantity = 0 and quote.total_cost = 0
           and not exists (
             select 1 from public.fnb_branch_product_cost_events event
              where event.tenant_id = new.tenant_id and event.branch_id = new.branch_id
                and event.product_id = new.product_id
           );
        if not found then
          raise exception using errcode = 'P0001', message = 'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED',
            detail = format('branch=%s product=%s', new.branch_id, new.product_id);
        end if;
      end if;
    end if;
    else
    if not found or (v_costed_quantity <= 0 and not (
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
    end if;
    end if;$new$);
end $patch$;
commit;
