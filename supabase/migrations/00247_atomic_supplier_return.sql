-- ============================================================
-- 00247: Atomic supplier return
--
-- Schema/function changes only. This migration does not update or delete
-- existing business rows. New returns are committed as one transaction:
-- document + items + stock + supplier debt/cash + audit.
-- ============================================================

begin;

alter table public.supplier_return_items
  add column if not exists purchase_order_item_id uuid
    references public.purchase_order_items(id) on delete restrict;

create index if not exists idx_supplier_return_items_po_item
  on public.supplier_return_items(purchase_order_item_id)
  where purchase_order_item_id is not null;

create or replace function public.create_supplier_return_atomic(
  p_purchase_order_id uuid,
  p_items jsonb,
  p_reason text default null,
  p_note text default null,
  p_payment_method text default 'cash'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_po record;
  v_line record;
  v_item jsonb;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_po_item_id uuid;
  v_qty numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_return_id uuid;
  v_return_code text;
  v_cash_code text;
  v_payment_method text := coalesce(nullif(trim(p_payment_method), ''), 'cash');
  v_prior_exact numeric;
  v_prior_product numeric;
  v_received_product numeric;
  v_requested_product numeric;
  v_debt_before numeric;
  v_debt_reduce numeric;
  v_cash_refund numeric;
  v_rows integer;
  v_lot_result jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;

  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select po.id, po.code, po.tenant_id, po.branch_id, po.supplier_id,
         po.supplier_name, po.status, coalesce(po.debt, 0) as debt
    into v_po
    from public.purchase_orders po
   where po.id = p_purchase_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_po.status not in ('partial', 'completed') then
    raise exception 'PURCHASE_ORDER_NOT_RECEIVED' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_po.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'RETURN_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;
  if v_payment_method not in ('cash', 'transfer', 'card') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
  end if;

  -- First pass validates every browser value and locks each source line.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_po_item_id := nullif(v_item->>'purchaseOrderItemId', '')::uuid;
      v_qty := (v_item->>'quantity')::numeric;
    exception when others then
      raise exception 'INVALID_RETURN_ITEM' using errcode = 'P0001';
    end;

    if v_po_item_id is null or v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_RETURN_ITEM' using errcode = 'P0001';
    end if;
    if v_po_item_id = any(v_seen_item_ids) then
      raise exception 'DUPLICATE_RETURN_ITEM' using errcode = 'P0001';
    end if;
    v_seen_item_ids := array_append(v_seen_item_ids, v_po_item_id);

    select poi.id, poi.product_id, poi.product_name, poi.unit,
           coalesce(poi.received_quantity, 0) as received_quantity,
           coalesce(poi.unit_price, 0) as unit_price
      into v_line
      from public.purchase_order_items poi
     where poi.id = v_po_item_id
       and poi.purchase_order_id = v_po.id
     for update;
    if not found then
      raise exception 'PURCHASE_ORDER_ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_line.received_quantity <= 0 or v_qty > v_line.received_quantity then
      raise exception 'RETURN_QUANTITY_EXCEEDED' using errcode = 'P0001';
    end if;
  end loop;

  -- The PO row lock serializes every return for this PO. Exact tracking applies
  -- to new rows; product-level tracking also covers legacy rows without source IDs.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_po_item_id := (v_item->>'purchaseOrderItemId')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    select poi.id, poi.product_id, poi.product_name, poi.unit,
           coalesce(poi.received_quantity, 0) as received_quantity,
           coalesce(poi.unit_price, 0) as unit_price
      into v_line
      from public.purchase_order_items poi
     where poi.id = v_po_item_id
       and poi.purchase_order_id = v_po.id
     for update;

    select coalesce(sum(sri.quantity), 0)
      into v_prior_exact
      from public.supplier_return_items sri
      join public.supplier_returns sr on sr.id = sri.return_id
     where sr.purchase_order_id = v_po.id
       and sr.tenant_id = v_tenant_id
       and sr.status = 'completed'
       and sri.purchase_order_item_id = v_line.id;

    if v_prior_exact + v_qty > v_line.received_quantity + 0.000001 then
      raise exception 'RETURN_LINE_QUANTITY_EXCEEDED' using errcode = 'P0001';
    end if;

    select coalesce(sum(poi.received_quantity), 0)
      into v_received_product
      from public.purchase_order_items poi
     where poi.purchase_order_id = v_po.id
       and poi.product_id = v_line.product_id;

    select coalesce(sum(sri.quantity), 0)
      into v_prior_product
      from public.supplier_return_items sri
      join public.supplier_returns sr on sr.id = sri.return_id
     where sr.purchase_order_id = v_po.id
       and sr.tenant_id = v_tenant_id
       and sr.status = 'completed'
       and sri.product_id = v_line.product_id;

    select coalesce(sum((requested.item->>'quantity')::numeric), 0)
      into v_requested_product
      from jsonb_array_elements(p_items) as requested(item)
      join public.purchase_order_items poi
        on poi.id = (requested.item->>'purchaseOrderItemId')::uuid
       and poi.purchase_order_id = v_po.id
     where poi.product_id = v_line.product_id;

    if v_prior_product + v_requested_product > v_received_product + 0.000001 then
      raise exception 'RETURN_PRODUCT_QUANTITY_EXCEEDED' using errcode = 'P0001';
    end if;

    v_line_total := round(v_qty * v_line.unit_price, 2);
    v_total := v_total + v_line_total;
  end loop;

  v_total := round(v_total, 2);
  if v_total <= 0 then
    raise exception 'RETURN_TOTAL_MUST_BE_POSITIVE' using errcode = 'P0001';
  end if;

  v_return_code := public.next_code(v_tenant_id, 'purchase_return');
  if nullif(v_return_code, '') is null then
    raise exception 'RETURN_CODE_GENERATION_FAILED' using errcode = 'P0001';
  end if;

  insert into public.supplier_returns (
    tenant_id, branch_id, code, purchase_order_id, import_code,
    supplier_id, supplier_name, status, total, note, created_by
  ) values (
    v_tenant_id, v_po.branch_id, v_return_code, v_po.id, v_po.code,
    v_po.supplier_id, v_po.supplier_name, 'completed', v_total,
    nullif(concat_ws(' - ', nullif(trim(p_reason), ''), nullif(trim(p_note), '')), ''),
    v_actor
  ) returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_po_item_id := (v_item->>'purchaseOrderItemId')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    select poi.id, poi.product_id, poi.product_name, poi.unit,
           coalesce(poi.unit_price, 0) as unit_price
      into v_line
      from public.purchase_order_items poi
     where poi.id = v_po_item_id
       and poi.purchase_order_id = v_po.id;

    v_line_total := round(v_qty * v_line.unit_price, 2);

    insert into public.supplier_return_items (
      return_id, purchase_order_item_id, product_id, product_name,
      unit, quantity, unit_price, total
    ) values (
      v_return_id, v_line.id, v_line.product_id, v_line.product_name,
      v_line.unit, v_qty, v_line.unit_price, v_line_total
    );

    update public.branch_stock
       set quantity = quantity - v_qty,
           updated_at = now()
     where tenant_id = v_tenant_id
       and branch_id = v_po.branch_id
       and product_id = v_line.product_id
       and variant_id is null
       and quantity >= v_qty;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'INSUFFICIENT_BRANCH_STOCK' using errcode = 'P0001';
    end if;

    perform public.increment_product_stock(v_line.product_id, -v_qty);

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_po.branch_id, v_line.product_id, 'out', v_qty,
      'supplier_return', v_return_id,
      v_return_code || ' - Tra NCC - ' || v_line.product_name,
      v_actor
    );

    v_lot_result := public.allocate_lots_fifo(
      v_tenant_id, v_line.product_id, v_po.branch_id, v_qty,
      'supplier_return', v_return_id, v_actor
    );
    if coalesce((v_lot_result->>'shortage')::numeric, 0) > 0 then
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'LOT_LEDGER_SHORTAGE',
        'product_id', v_line.product_id,
        'product_name', v_line.product_name,
        'quantity', (v_lot_result->>'shortage')::numeric
      );
    end if;
  end loop;

  v_debt_before := greatest(coalesce(v_po.debt, 0), 0);
  v_debt_reduce := least(v_debt_before, v_total);
  v_cash_refund := v_total - v_debt_reduce;

  if v_debt_reduce > 0 then
    update public.purchase_orders
       set debt = debt - v_debt_reduce,
           updated_at = now()
     where id = v_po.id
       and tenant_id = v_tenant_id
       and debt >= v_debt_reduce;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'PURCHASE_ORDER_DEBT_RACE_DETECTED' using errcode = 'P0001';
    end if;
  end if;

  if v_cash_refund > 0 then
    v_cash_code := public.next_cash_code(v_tenant_id, 'receipt');
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount, counterparty,
      payment_method, reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_po.branch_id, v_cash_code, 'receipt', 'Tra hang nhap',
      v_cash_refund, v_po.supplier_name, v_payment_method,
      'supplier_return', v_return_id,
      'Hoan tien ' || v_return_code || ' (phieu nhap: ' || v_po.code || ')',
      v_actor
    );
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'create',
    'supplier_return',
    v_return_id,
    jsonb_build_object(
      'code', v_return_code,
      'purchase_order_id', v_po.id,
      'purchase_order_code', v_po.code,
      'branch_id', v_po.branch_id,
      'supplier_id', v_po.supplier_id,
      'total', v_total,
      'debt_reduced', v_debt_reduce,
      'cash_refund', v_cash_refund,
      'warnings', v_warnings,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'return_id', v_return_id,
    'code', v_return_code,
    'total', v_total,
    'debt_reduced', v_debt_reduce,
    'cash_refund', v_cash_refund,
    'warnings', v_warnings
  );
end;
$$;

revoke all on function public.create_supplier_return_atomic(
  uuid, jsonb, text, text, text
) from public, anon;
grant execute on function public.create_supplier_return_atomic(
  uuid, jsonb, text, text, text
) to authenticated;

commit;

-- Verification only. Every boolean must be true after applying this migration.
select
  p.prosecdef as security_definer_ok,
  p.prosrc like '%auth.uid()%' as auth_actor_ok,
  p.prosrc like '%user_has_permission%' as permission_check_ok,
  p.prosrc like '%user_has_branch_access%' as branch_check_ok,
  p.prosrc like '%for update%' as row_lock_ok,
  p.prosrc like '%RETURN_PRODUCT_QUANTITY_EXCEEDED%' as over_return_blocked,
  p.prosrc like '%INSUFFICIENT_BRANCH_STOCK%' as negative_stock_blocked,
  p.prosrc like '%insert into public.audit_log%' as atomic_audit_ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_supplier_return_atomic';
