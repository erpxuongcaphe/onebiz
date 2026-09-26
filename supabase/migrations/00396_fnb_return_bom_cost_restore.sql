-- 00396: Restore F&B BOM ingredients to the branch cost ledger at the
-- original invoice's weighted issue cost. This is future-only and does not
-- rewrite product cost, historic movements, or shared Retail stock.
begin;

do $preflight$
begin
  if to_regclass('public.fnb_branch_product_cost_events') is null
     or to_regclass('public.fnb_branch_product_cost_balances') is null
     or to_regclass('public.stock_movements') is null
     or to_regclass('public.sales_returns') is null
     or to_regprocedure('public._fnb_branch_cost_tracking_enabled_00390(uuid,uuid)') is null
     or to_regprocedure('public._post_fnb_branch_cost_in_00390(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid,text,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00396_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

alter table public.fnb_branch_product_cost_events
  drop constraint if exists fnb_branch_product_cost_events_source_type_check;

alter table public.fnb_branch_product_cost_events
  add constraint fnb_branch_product_cost_events_source_type_check
  check (source_type in (
    'opening', 'purchase_receipt', 'internal_sale_receipt',
    'production_consume', 'production_complete', 'bom_consume',
    'invoice_void_restore', 'return_bom_restore'
  ));

create function public._capture_fnb_return_bom_cost_00396()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_source_quantity numeric(18,4);
  v_source_total_cost numeric(18,4);
  v_prior_return_quantity numeric(18,4);
  v_unit_cost numeric(18,6);
begin
  if new.type <> 'in' or new.reference_type <> 'return_bom_restore' then
    return new;
  end if;

  if not public._fnb_branch_cost_tracking_enabled_00390(new.tenant_id, new.branch_id) then
    return new;
  end if;

  select sr.invoice_id into v_invoice_id
    from public.sales_returns sr
    join public.invoices i
      on i.id = sr.invoice_id
     and i.tenant_id = sr.tenant_id
     and i.branch_id = sr.branch_id
   where sr.id = new.reference_id
     and sr.tenant_id = new.tenant_id
     and sr.branch_id = new.branch_id
     and sr.status = 'completed'
     and i.status = 'completed';
  if v_invoice_id is null then
    raise exception using errcode = 'P0001', message = 'FNB_RETURN_COST_REFERENCE_INVALID';
  end if;

  -- Return RPCs already lock the source invoice. This key also serializes any
  -- other writer that reaches this stock-movement path directly.
  perform pg_advisory_xact_lock(hashtextextended('fnb-return-cost:' || v_invoice_id::text, 0));

  -- Legacy returns were not costed by 00390. Do not silently treat them as
  -- zero-cost or let a later return exceed the unreturned source consumption.
  if exists (
    select 1
      from public.stock_movements prior
      join public.sales_returns previous_return
        on previous_return.id = prior.reference_id
       and previous_return.tenant_id = prior.tenant_id
       and previous_return.branch_id = prior.branch_id
       and previous_return.invoice_id = v_invoice_id
      left join public.fnb_branch_product_cost_events prior_cost
        on prior_cost.source_stock_movement_id = prior.id
     where prior.tenant_id = new.tenant_id
       and prior.branch_id = new.branch_id
       and prior.product_id = new.product_id
       and prior.type = 'in'
       and prior.reference_type = 'return_bom_restore'
       and prior.id <> new.id
       and prior_cost.id is null
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_RETURN_COST_HISTORY_REQUIRED';
  end if;

  select coalesce(sum(e.quantity), 0), coalesce(sum(e.total_cost), 0)
    into v_source_quantity, v_source_total_cost
    from public.fnb_branch_product_cost_events e
   where e.tenant_id = new.tenant_id
     and e.branch_id = new.branch_id
     and e.product_id = new.product_id
     and e.direction = 'out'
     and e.source_type = 'bom_consume'
     and e.source_reference_type = 'bom_consume'
     and e.source_reference_id = v_invoice_id;

  if coalesce(v_source_quantity, 0) <= 0 then
    raise exception using errcode = 'P0001', message = 'FNB_RETURN_COST_SOURCE_REQUIRED';
  end if;

  select coalesce(sum(prior.quantity), 0)
    into v_prior_return_quantity
    from public.stock_movements prior
    join public.sales_returns previous_return
      on previous_return.id = prior.reference_id
     and previous_return.tenant_id = prior.tenant_id
     and previous_return.branch_id = prior.branch_id
     and previous_return.invoice_id = v_invoice_id
   where prior.tenant_id = new.tenant_id
     and prior.branch_id = new.branch_id
     and prior.product_id = new.product_id
     and prior.type = 'in'
     and prior.reference_type = 'return_bom_restore'
     and prior.id <> new.id;

  if v_prior_return_quantity + new.quantity > v_source_quantity + 0.0001 then
    raise exception using errcode = 'P0001', message = 'FNB_RETURN_COST_QUANTITY_EXCEEDED';
  end if;

  v_unit_cost := round(v_source_total_cost / v_source_quantity, 6);
  perform public._post_fnb_branch_cost_in_00390(
    new.tenant_id,
    new.branch_id,
    new.product_id,
    new.quantity,
    v_unit_cost,
    'return_bom_restore',
    new.reference_type,
    new.reference_id,
    new.id,
    coalesce(new.note, 'Hoan NVL theo gia von tieu hao cua hoa don goc'),
    new.created_by
  );

  return new;
end;
$$;

alter function public._capture_fnb_return_bom_cost_00396() owner to postgres;
revoke all on function public._capture_fnb_return_bom_cost_00396()
  from public, anon, authenticated;

drop trigger if exists capture_fnb_return_bom_cost_00396 on public.stock_movements;
create trigger capture_fnb_return_bom_cost_00396
  after insert on public.stock_movements
  for each row
  when (new.type = 'in' and new.reference_type = 'return_bom_restore')
  execute function public._capture_fnb_return_bom_cost_00396();

comment on function public._capture_fnb_return_bom_cost_00396() is
  '00396: Cost future F&B BOM return movements at original invoice issue WAC; fail closed on missing or over-returned cost history.';

do $verify$
begin
  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.stock_movements'::regclass
       and t.tgname = 'capture_fnb_return_bom_cost_00396'
       and not t.tgisinternal
  ) or not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.fnb_branch_product_cost_events'::regclass
       and c.conname = 'fnb_branch_product_cost_events_source_type_check'
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_00396_INSTALL_INCOMPLETE';
  end if;
end;
$verify$;

commit;
