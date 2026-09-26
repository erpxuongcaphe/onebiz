-- Price future prepared-batch material returns at their recorded issue cost.
-- No business rows or historical costs are rewritten.
begin;

do $migration$
declare
  v_oid oid := to_regprocedure('public._capture_fnb_branch_cost_stock_movement_00390()');
  v_definition text;
  v_old text := $old$  elsif new.reference_type = 'production_order' and new.type = 'in' then
    select p.is_fnb_stock_item, po.cogs_amount
      into v_product_is_prepared, v_cogs
      from public.production_orders po join public.products p on p.id = po.product_id
     where po.id = new.reference_id and po.tenant_id = new.tenant_id;
    if coalesce(v_product_is_prepared, false) then
      if new.quantity <= 0 then
        raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_PRODUCTION_QTY_REQUIRED';
      end if;
      perform public._post_fnb_branch_cost_in_00390(
        new.tenant_id, new.branch_id, new.product_id, new.quantity,
        round(coalesce(v_cogs, 0) / new.quantity, 6),
        'production_complete', new.reference_type, new.reference_id, new.id, new.note, new.created_by
      );
    end if;
$old$;
  v_new text := $new$  elsif new.reference_type = 'production_order' and new.type = 'in' then
    select p.is_fnb_stock_item, po.cogs_amount
      into v_product_is_prepared, v_cogs
      from public.production_orders po join public.products p on p.id = po.product_id
     where po.id = new.reference_id and po.tenant_id = new.tenant_id;
    if coalesce(v_product_is_prepared, false) then
      if new.quantity <= 0 then
        raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_PRODUCTION_QTY_REQUIRED';
      end if;
      perform 1 from public.production_orders po
       where po.id = new.reference_id and po.tenant_id = new.tenant_id
       for update;
      if exists (
        select 1 from public.production_orders po
         where po.id = new.reference_id and po.tenant_id = new.tenant_id
           and po.branch_id = new.branch_id and po.product_id = new.product_id
      ) then
        perform public._post_fnb_branch_cost_in_00390(
          new.tenant_id, new.branch_id, new.product_id, new.quantity,
          round(coalesce(v_cogs, 0) / new.quantity, 6),
          'production_complete', new.reference_type, new.reference_id, new.id, new.note, new.created_by
        );
      else
        if not exists (
          select 1 from public.production_orders po
           where po.id = new.reference_id and po.tenant_id = new.tenant_id
             and po.branch_id = new.branch_id
        ) then
          raise exception using errcode = 'P0001', message = 'FNB_PRODUCTION_RETURN_SOURCE_REQUIRED';
        end if;
        select coalesce(sum(e.total_cost), 0), coalesce(sum(e.quantity), 0)
          into v_restore_total, v_restore_qty
          from public.fnb_branch_product_cost_events e
         where e.tenant_id = new.tenant_id and e.branch_id = new.branch_id
           and e.product_id = new.product_id and e.direction = 'out'
           and e.source_type = 'production_consume'
           and e.source_reference_type = 'production_order'
           and e.source_reference_id = new.reference_id;
        if v_restore_qty <= 0 then
          raise exception using errcode = 'P0001', message = 'FNB_PRODUCTION_RETURN_HISTORY_REQUIRED';
        end if;
        if new.quantity + coalesce((
          select sum(e.quantity) from public.fnb_branch_product_cost_events e
           where e.tenant_id = new.tenant_id and e.branch_id = new.branch_id
             and e.product_id = new.product_id and e.direction = 'in'
             and e.source_reference_type = 'production_order'
             and e.source_reference_id = new.reference_id
             and e.source_stock_movement_id is distinct from new.id
        ), 0) > v_restore_qty + 0.0001 then
          raise exception using errcode = 'P0001', message = 'FNB_PRODUCTION_RETURN_QUANTITY_EXCEEDED';
        end if;
        perform public._post_fnb_branch_cost_in_00390(
          new.tenant_id, new.branch_id, new.product_id, new.quantity,
          round(v_restore_total / v_restore_qty, 6),
          'production_cancel_restore', new.reference_type, new.reference_id,
          new.id, new.note, new.created_by
        );
      end if;
    end if;
$new$;
begin
  if v_oid is null
     or to_regprocedure('public._capture_fnb_return_bom_cost_00397()') is null then
    raise exception 'FNB_00398_PREREQUISITE_MISSING';
  end if;
  v_definition := replace(pg_get_functiondef(v_oid), E'\r\n', E'\n');
  if position(v_old in v_definition) = 0
     or length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception 'FNB_00398_TRIGGER_SOURCE_CHANGED';
  end if;
  alter table public.fnb_branch_product_cost_events
    drop constraint fnb_branch_product_cost_events_source_type_check;
  alter table public.fnb_branch_product_cost_events
    add constraint fnb_branch_product_cost_events_source_type_check
    check (source_type in (
      'opening', 'purchase_receipt', 'internal_sale_receipt',
      'production_consume', 'production_complete', 'bom_consume',
      'invoice_void_restore', 'return_bom_restore', 'production_cancel_restore'
    ));
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

commit;
