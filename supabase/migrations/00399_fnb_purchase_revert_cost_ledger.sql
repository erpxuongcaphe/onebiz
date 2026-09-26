-- Keep the opted-in F&B branch cost ledger aligned when a received purchase
-- order is reopened. No historical rows are backfilled or rewritten.
begin;

do $migration$
begin
  if to_regclass('public.purchase_orders') is null
     or to_regprocedure('public._fnb_branch_cost_tracking_enabled_00390(uuid,uuid)') is null
     or to_regprocedure('public._post_fnb_branch_cost_out_00390(uuid,uuid,uuid,numeric,text,text,uuid,uuid,text,uuid)') is null then
    raise exception 'FNB_00399_PREREQUISITE_MISSING';
  end if;
end;
$migration$;

alter table public.fnb_branch_product_cost_events
  drop constraint fnb_branch_product_cost_events_source_type_check;
alter table public.fnb_branch_product_cost_events
  add constraint fnb_branch_product_cost_events_source_type_check
  check (source_type in (
    'opening', 'purchase_receipt', 'internal_sale_receipt',
    'production_consume', 'production_complete', 'bom_consume',
    'invoice_void_restore', 'return_bom_restore',
    'production_cancel_restore', 'purchase_order_revert'
  ));

create or replace function public._capture_fnb_purchase_revert_cost_00399()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_tenant uuid;
  v_po_branch uuid;
  v_receipt_quantity numeric(18,4);
  v_reverted_quantity numeric(18,4);
begin
  if new.reference_type <> 'purchase_order_revert' or new.type <> 'out' then
    return new;
  end if;

  if not public._fnb_branch_cost_tracking_enabled_00390(new.tenant_id, new.branch_id) then
    return new;
  end if;

  select po.tenant_id, po.branch_id
    into v_po_tenant, v_po_branch
    from public.purchase_orders po
   where po.id = new.reference_id
   for update;
  if not found or v_po_tenant is distinct from new.tenant_id
     or v_po_branch is distinct from new.branch_id then
    raise exception using errcode = 'P0001', message = 'FNB_PURCHASE_REVERT_COST_SOURCE_REQUIRED';
  end if;

  select coalesce(sum(e.quantity), 0)
    into v_receipt_quantity
    from public.fnb_branch_product_cost_events e
   where e.tenant_id = new.tenant_id and e.branch_id = new.branch_id
     and e.product_id = new.product_id and e.direction = 'in'
     and e.source_type = 'purchase_receipt'
     and e.source_reference_type = 'purchase_order'
     and e.source_reference_id = new.reference_id;
  if v_receipt_quantity <= 0 then
    raise exception using errcode = 'P0001', message = 'FNB_PURCHASE_REVERT_COST_SOURCE_REQUIRED';
  end if;
  select coalesce(sum(e.quantity), 0)
    into v_reverted_quantity
    from public.fnb_branch_product_cost_events e
   where e.tenant_id = new.tenant_id and e.branch_id = new.branch_id
     and e.product_id = new.product_id and e.direction = 'out'
     and e.source_type = 'purchase_order_revert'
     and e.source_reference_id = new.reference_id;
  if v_reverted_quantity + new.quantity > v_receipt_quantity + 0.0001 then
    raise exception using errcode = 'P0001', message = 'FNB_PURCHASE_REVERT_COST_QUANTITY_EXCEEDED';
  end if;

  perform public._post_fnb_branch_cost_out_00390(
    new.tenant_id, new.branch_id, new.product_id, new.quantity,
    'purchase_order_revert', new.reference_type, new.reference_id,
    new.id, new.note, new.created_by
  );
  return new;
end;
$$;

drop trigger if exists capture_fnb_purchase_revert_cost_00399 on public.stock_movements;
create trigger capture_fnb_purchase_revert_cost_00399
  after insert on public.stock_movements
  for each row
  when (new.type = 'out' and new.reference_type = 'purchase_order_revert')
  execute function public._capture_fnb_purchase_revert_cost_00399();

commit;
