-- ============================================================
-- 00244: Atomic and variant-aware sales returns
--
-- Schema/config only at migration time. Existing invoices, returns, stock,
-- cash and debt rows are not updated or deleted.
-- ============================================================

begin;

-- Preserve the sold F&B variant on future invoice lines. Older rows remain null;
-- the return RPC also has a read-only fallback through the linked kitchen order.
alter table public.invoice_items
  add column if not exists variant_id uuid
  references public.product_variants(id) on delete set null;

create index if not exists idx_invoice_items_variant
  on public.invoice_items(variant_id)
  where variant_id is not null;

create or replace function public.sync_fnb_invoice_item_variants()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.invoice_id is null then
    return new;
  end if;

  update public.invoice_items ii
     set variant_id = koi.variant_id
    from public.kitchen_order_items koi
   where koi.kitchen_order_id = new.id
     and koi.variant_id is not null
     and ii.invoice_id = new.invoice_id
     and ii.product_id = koi.product_id
     and ii.variant_id is null
     and ii.product_name = case
       when nullif(koi.variant_label, '') is not null
         then koi.product_name || ' (' || koi.variant_label || ')'
       else koi.product_name
     end;

  return new;
end;
$$;

revoke all on function public.sync_fnb_invoice_item_variants()
  from public, anon, authenticated;

drop trigger if exists trg_sync_fnb_invoice_item_variants
  on public.kitchen_orders;
create trigger trg_sync_fnb_invoice_item_variants
after update of invoice_id on public.kitchen_orders
for each row
when (new.invoice_id is not null and old.invoice_id is distinct from new.invoice_id)
execute function public.sync_fnb_invoice_item_variants();

create or replace function public.create_sales_return_atomic(
  p_invoice_id uuid,
  p_items jsonb,
  p_refund_amount numeric,
  p_refund_payment_method text default 'cash',
  p_reason text default null,
  p_note text default null,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_invoice record;
  v_line record;
  v_product record;
  v_item jsonb;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_invoice_item_id uuid;
  v_variant_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_refund numeric := coalesce(p_refund_amount, 0);
  v_debt_credit numeric;
  v_return_id uuid;
  v_return_code text;
  v_cash_code text;
  v_payment_method text := coalesce(nullif(trim(p_refund_payment_method), ''), 'cash');
  v_restore_result jsonb;
  v_bom_found boolean;
  v_warnings jsonb := '[]'::jsonb;
  v_rows integer;
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

  -- Keep authorization capability-based. Either POS capability currently maps
  -- to the existing return workflow; a dedicated permission can be split later
  -- without relying on profile titles.
  if not public.user_has_permission(v_actor, 'pos_retail.checkout')
     and not public.user_has_permission(v_actor, 'pos_fnb.view_orders') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select i.id, i.code, i.tenant_id, i.branch_id, i.customer_id,
         i.customer_name, i.status, i.debt
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_invoice.status <> 'completed' then
    raise exception 'INVOICE_NOT_COMPLETED' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'RETURN_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;
  if v_refund < 0 then
    raise exception 'INVALID_REFUND_AMOUNT' using errcode = 'P0001';
  end if;
  if v_payment_method not in ('cash', 'transfer', 'card') then
    raise exception 'INVALID_REFUND_PAYMENT_METHOD' using errcode = 'P0001';
  end if;

  if p_shift_id is not null and not exists (
    select 1
      from public.shifts s
     where s.id = p_shift_id
       and s.tenant_id = v_tenant_id
       and s.branch_id = v_invoice.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN_FOR_USER_BRANCH' using errcode = 'P0001';
  end if;

  -- First pass: lock and validate every source line, reject duplicates and
  -- calculate the server-owned return total.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_invoice_item_id := nullif(v_item->>'invoiceItemId', '')::uuid;
      v_qty := (v_item->>'quantity')::numeric;
    exception when others then
      raise exception 'INVALID_RETURN_ITEM' using errcode = 'P0001';
    end;

    if v_invoice_item_id is null or v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_RETURN_ITEM' using errcode = 'P0001';
    end if;
    if v_invoice_item_id = any(v_seen_item_ids) then
      raise exception 'DUPLICATE_RETURN_ITEM' using errcode = 'P0001';
    end if;
    v_seen_item_ids := array_append(v_seen_item_ids, v_invoice_item_id);

    select ii.id, ii.product_id, ii.product_name, ii.unit, ii.quantity,
           ii.total, coalesce(ii.returned_qty, 0) as returned_qty,
           ii.variant_id
      into v_line
      from public.invoice_items ii
     where ii.id = v_invoice_item_id
       and ii.invoice_id = v_invoice.id
     for update;
    if not found then
      raise exception 'INVOICE_ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_qty > v_line.quantity - v_line.returned_qty then
      raise exception 'RETURN_QUANTITY_EXCEEDED' using errcode = 'P0001';
    end if;
    if v_line.quantity <= 0 then
      raise exception 'INVALID_SOURCE_ITEM_QUANTITY' using errcode = 'P0001';
    end if;

    v_unit_price := v_line.total / v_line.quantity;
    v_total := v_total + round(v_qty * v_unit_price, 2);
  end loop;

  v_total := round(v_total, 2);
  if v_refund > v_total then
    raise exception 'REFUND_EXCEEDS_RETURN_TOTAL' using errcode = 'P0001';
  end if;
  v_debt_credit := v_total - v_refund;
  if v_debt_credit > coalesce(v_invoice.debt, 0) then
    raise exception 'DEBT_CREDIT_EXCEEDS_INVOICE_DEBT' using errcode = 'P0001';
  end if;

  v_return_code := public.next_code(v_tenant_id, 'sales_return');
  if nullif(v_return_code, '') is null then
    raise exception 'RETURN_CODE_GENERATION_FAILED' using errcode = 'P0001';
  end if;

  insert into public.sales_returns (
    tenant_id, branch_id, code, invoice_id, customer_id, customer_name,
    status, total, refunded, reason, note, created_by
  ) values (
    v_tenant_id, v_invoice.branch_id, v_return_code, v_invoice.id,
    v_invoice.customer_id, v_invoice.customer_name,
    'completed', v_total, v_refund, nullif(trim(p_reason), ''),
    nullif(trim(p_note), ''), v_actor
  )
  returning id into v_return_id;

  -- Second pass: insert lines, restore stock/BOM and advance returned_qty.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_invoice_item_id := (v_item->>'invoiceItemId')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    select ii.id, ii.product_id, ii.product_name, ii.unit, ii.quantity,
           ii.total, coalesce(ii.returned_qty, 0) as returned_qty,
           ii.variant_id
      into v_line
      from public.invoice_items ii
     where ii.id = v_invoice_item_id
       and ii.invoice_id = v_invoice.id
     for update;

    v_unit_price := v_line.total / v_line.quantity;
    v_line_total := round(v_qty * v_unit_price, 2);

    insert into public.return_items (
      return_id, product_id, product_name, unit, quantity, unit_price, total
    ) values (
      v_return_id, v_line.product_id, v_line.product_name, v_line.unit,
      v_qty, v_unit_price, v_line_total
    );

    select p.id, coalesce(p.has_bom, false) as has_bom,
           p.inventory_role
      into v_product
      from public.products p
     where p.id = v_line.product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);
    if not found then
      raise exception 'RETURN_PRODUCT_NOT_FOUND' using errcode = 'P0001';
    end if;

    v_variant_id := v_line.variant_id;
    if v_variant_id is null then
      select koi.variant_id
        into v_variant_id
        from public.kitchen_orders ko
        join public.kitchen_order_items koi
          on koi.kitchen_order_id = ko.id
       where ko.invoice_id = v_invoice.id
         and koi.product_id = v_line.product_id
         and v_line.product_name = case
           when nullif(koi.variant_label, '') is not null
             then koi.product_name || ' (' || koi.variant_label || ')'
           else koi.product_name
         end
       limit 1;
    end if;

    if v_product.inventory_role = 'fnb_menu_item' or v_product.has_bom then
      v_restore_result := public.restore_bom_for_return(
        v_tenant_id,
        v_invoice.branch_id,
        v_line.product_id,
        v_qty,
        v_return_id,
        v_actor,
        v_return_code,
        v_variant_id
      );
      v_bom_found := coalesce((v_restore_result->>'bom_found')::boolean, false);

      if not v_bom_found and v_product.inventory_role = 'fnb_menu_item' then
        v_warnings := v_warnings || jsonb_build_object(
          'code', 'MENU_RECIPE_NOT_FOUND',
          'invoice_item_id', v_invoice_item_id,
          'product_id', v_line.product_id,
          'product_name', v_line.product_name
        );
      elsif not v_bom_found then
        insert into public.stock_movements (
          tenant_id, branch_id, product_id, type, quantity,
          reference_type, reference_id, note, created_by
        ) values (
          v_tenant_id, v_invoice.branch_id, v_line.product_id, 'in', v_qty,
          'sales_return', v_return_id,
          v_return_code || ' - Tra hang (SKU chua co BOM) - ' || v_line.product_name,
          v_actor
        );
        perform public.increment_product_stock(v_line.product_id, v_qty);
        perform public.upsert_branch_stock(
          v_tenant_id, v_invoice.branch_id, v_line.product_id, v_qty
        );
      end if;
    else
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity,
        reference_type, reference_id, note, created_by
      ) values (
        v_tenant_id, v_invoice.branch_id, v_line.product_id, 'in', v_qty,
        'sales_return', v_return_id,
        v_return_code || ' - Tra hang - ' || v_line.product_name,
        v_actor
      );
      perform public.increment_product_stock(v_line.product_id, v_qty);
      perform public.upsert_branch_stock(
        v_tenant_id, v_invoice.branch_id, v_line.product_id, v_qty
      );
    end if;

    update public.invoice_items
       set returned_qty = coalesce(returned_qty, 0) + v_qty
     where id = v_invoice_item_id
       and invoice_id = v_invoice.id
       and coalesce(returned_qty, 0) + v_qty <= quantity;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'RETURN_QUANTITY_RACE_DETECTED' using errcode = 'P0001';
    end if;
  end loop;

  if v_refund > 0 then
    v_cash_code := public.next_cash_code(v_tenant_id, 'payment');
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount, counterparty,
      payment_method, reference_type, reference_id, note, created_by, shift_id
    ) values (
      v_tenant_id, v_invoice.branch_id, v_cash_code, 'payment', 'Tra hang',
      v_refund, v_invoice.customer_name, v_payment_method,
      'sales_return', v_return_id,
      'Hoan tien ' || v_return_code || ' (HD goc: ' || v_invoice.code || ')',
      v_actor, p_shift_id
    );
  end if;

  if v_debt_credit > 0 then
    update public.invoices
       set debt = debt - v_debt_credit
     where id = v_invoice.id
       and tenant_id = v_tenant_id
       and debt >= v_debt_credit;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'INVOICE_DEBT_RACE_DETECTED' using errcode = 'P0001';
    end if;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'create',
    'sales_return',
    v_return_id,
    jsonb_build_object(
      'code', v_return_code,
      'invoice_id', v_invoice.id,
      'invoice_code', v_invoice.code,
      'branch_id', v_invoice.branch_id,
      'total', v_total,
      'refunded', v_refund,
      'debt_credit', v_debt_credit,
      'warnings', v_warnings,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'return_id', v_return_id,
    'code', v_return_code,
    'total', v_total,
    'refunded', v_refund,
    'debt_credit', v_debt_credit,
    'warnings', v_warnings
  );
end;
$$;

revoke all on function public.create_sales_return_atomic(
  uuid, jsonb, numeric, text, text, text, uuid
) from public, anon;
grant execute on function public.create_sales_return_atomic(
  uuid, jsonb, numeric, text, text, text, uuid
) to authenticated;

-- These are implementation helpers. Leaving them callable from a browser lets a
-- user alter returned quantities or stock without a sales-return document.
revoke all on function public.increment_returned_qty(uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.restore_bom_for_return(
  uuid, uuid, uuid, numeric, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.restore_bom_for_return(
  uuid, uuid, uuid, numeric, uuid, uuid, text, uuid
) to service_role;

commit;

-- Verification only. Expected: all booleans are true.
select
  p.prosecdef as security_definer_ok,
  p.prosrc like '%auth.uid()%' as auth_actor_ok,
  p.prosrc like '%for update%' as row_lock_ok,
  p.prosrc like '%RETURN_QUANTITY_EXCEEDED%' as over_return_blocked,
  p.prosrc like '%p_variant_id%' or p.prosrc like '%v_variant_id%' as variant_aware_ok,
  p.prosrc like '%next_cash_code%' as cash_code_ok,
  p.prosrc like '%insert into public.audit_log%' as atomic_audit_ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_sales_return_atomic';

select
  not has_function_privilege(
    'authenticated',
    'public.increment_returned_qty(uuid,numeric)',
    'execute'
  ) as legacy_return_counter_blocked,
  not has_function_privilege(
    'authenticated',
    'public.restore_bom_for_return(uuid,uuid,uuid,numeric,uuid,uuid,text,uuid)',
    'execute'
  ) as direct_bom_restore_blocked;
