-- ============================================================
-- 00243: Harden atomic internal sales
--
-- Schema-only. Existing business rows are not updated or deleted.
-- The function keeps its old signature for application compatibility,
-- but tenant, actor, branches and internal parties are derived/validated
-- on the server.
-- ============================================================

begin;

create or replace function public.create_internal_sale_atomic(
  p_tenant_id uuid,
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_created_by uuid,
  p_int_customer_id uuid,
  p_int_customer_name text,
  p_int_supplier_id uuid,
  p_int_supplier_name text,
  p_items jsonb,
  p_payment_method text default 'transfer',
  p_paid_full boolean default true,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_tenant_id uuid;
  v_is_service_role boolean :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_customer record;
  v_supplier record;
  v_product record;
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_product_code text;
  v_unit text;
  v_qty numeric;
  v_unit_price numeric;
  v_vat_rate numeric;
  v_line_amount numeric;
  v_line_tax numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric;
  v_paid numeric;
  v_debt numeric;
  v_invoice_code text;
  v_input_inv_code text;
  v_sale_code text;
  v_invoice_id uuid;
  v_input_inv_id uuid;
  v_sale_id uuid;
  v_cash_code text;
  v_requested_payment_method text;
  v_pay_method text;
begin
  v_actor := case when v_is_service_role then p_created_by else auth.uid() end;

  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not v_is_service_role
     and p_created_by is not null
     and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);

  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_tenant_id is not null and p_tenant_id <> v_tenant_id then
    raise exception 'TENANT_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.internal_export') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  if p_from_branch_id is null
     or p_to_branch_id is null
     or p_from_branch_id = p_to_branch_id then
    raise exception 'INVALID_BRANCH_PAIR' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.branches b
    where b.id = p_from_branch_id
      and b.tenant_id = v_tenant_id
  ) or not exists (
    select 1
    from public.branches b
    where b.id = p_to_branch_id
      and b.tenant_id = v_tenant_id
  ) then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, p_from_branch_id)
     or not public.user_has_branch_access(v_actor, p_to_branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'INTERNAL_SALE_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;
  v_requested_payment_method := coalesce(nullif(trim(p_payment_method), ''), 'transfer');
  if v_requested_payment_method not in ('cash', 'transfer', 'debt') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
  end if;

  select c.id, c.name
    into v_customer
    from public.customers c
   where c.tenant_id = v_tenant_id
     and c.is_internal = true
     and c.branch_id = p_to_branch_id
   limit 1;
  if not found then
    raise exception 'INTERNAL_CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select s.id, s.name
    into v_supplier
    from public.suppliers s
   where s.tenant_id = v_tenant_id
     and s.is_internal = true
     and s.branch_id = p_from_branch_id
   limit 1;
  if not found then
    raise exception 'INTERNAL_SUPPLIER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Validate every line and calculate totals from server-owned product rows.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item->>'productId', '')::uuid;
      v_qty := (v_item->>'quantity')::numeric;
      v_unit_price := (v_item->>'unitPrice')::numeric;
      v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    exception when others then
      raise exception 'INVALID_INTERNAL_SALE_ITEM' using errcode = 'P0001';
    end;

    if v_product_id is null
       or v_qty is null or v_qty <= 0
       or v_unit_price is null or v_unit_price < 0
       or v_vat_rate < 0 or v_vat_rate > 100 then
      raise exception 'INVALID_INTERNAL_SALE_ITEM' using errcode = 'P0001';
    end if;

    select p.id, p.code, p.name, p.unit, p.inventory_role
      into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);

    if not found then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_product.inventory_role = 'fnb_menu_item' then
      raise exception 'FNB_MENU_ITEM_NOT_TRANSFERABLE' using errcode = 'P0001';
    end if;

    v_line_amount := round(v_qty * v_unit_price);
    v_line_tax := round(v_line_amount * v_vat_rate / 100);
    v_subtotal := v_subtotal + v_line_amount;
    v_tax_total := v_tax_total + v_line_tax;
  end loop;

  v_total := v_subtotal + v_tax_total;
  v_pay_method := case
    when v_requested_payment_method = 'debt' then 'cash'
    else v_requested_payment_method
  end;
  v_paid := case
    when v_requested_payment_method = 'debt' then 0
    when coalesce(p_paid_full, false) then v_total
    else 0
  end;
  v_debt := v_total - v_paid;

  v_invoice_code := public.next_code(v_tenant_id, 'invoice');
  v_input_inv_code := public.next_code(v_tenant_id, 'input_invoice');
  v_sale_code := public.next_code(v_tenant_id, 'internal_sale');

  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name,
    status, subtotal, discount_amount, tax_amount, total, paid, debt,
    payment_method, source, note, created_by
  ) values (
    v_tenant_id, p_from_branch_id, v_invoice_code,
    v_customer.id, v_customer.name,
    'completed', v_subtotal, 0, v_tax_total, v_total, v_paid, v_debt,
    v_pay_method, 'internal',
    'Ban noi bo ' || v_sale_code || ' -> ' || v_customer.name,
    v_actor
  )
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unitPrice')::numeric;
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);

    select p.code, p.name, p.unit
      into v_product_code, v_product_name, v_unit
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id;

    v_line_amount := round(v_qty * v_unit_price);
    v_line_tax := round(v_line_amount * v_vat_rate / 100);

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, v_product_id, v_product_name, coalesce(v_unit, 'Cai'),
      v_qty, v_unit_price, 0, v_vat_rate, v_line_tax,
      v_line_amount + v_line_tax
    );

    perform public.internal_sale_apply_stock_out(
      v_tenant_id, p_from_branch_id, v_product_id, v_qty,
      v_invoice_id, v_sale_code, v_actor
    );
  end loop;

  insert into public.input_invoices (
    tenant_id, branch_id, code, supplier_id, supplier_name,
    total_amount, tax_amount, status, note, created_by
  ) values (
    v_tenant_id, p_to_branch_id, v_input_inv_code,
    v_supplier.id, v_supplier.name,
    v_total, v_tax_total, 'recorded',
    'Mua noi bo ' || v_sale_code || ' <- ' || v_supplier.name,
    v_actor
  )
  returning id into v_input_inv_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    select p.code, p.name, p.unit
      into v_product_code, v_product_name, v_unit
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, p_to_branch_id, v_product_id, 'in', v_qty,
      'internal_sale', v_input_inv_id,
      'Nhap noi bo ' || v_sale_code || ' - ' || v_product_name,
      v_actor
    );

    perform public.increment_product_stock(v_product_id, v_qty);
    perform public.upsert_branch_stock(
      v_tenant_id, p_to_branch_id, v_product_id, v_qty
    );
  end loop;

  if v_paid > 0 then
    v_cash_code := public.next_cash_code(v_tenant_id, 'receipt');
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      payment_method, reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, p_from_branch_id, v_cash_code, 'receipt',
      'Ban hang noi bo', v_paid, v_pay_method, 'invoice', v_invoice_id,
      'Giao dich noi bo ' || v_sale_code, v_actor
    );

    v_cash_code := public.next_cash_code(v_tenant_id, 'payment');
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      payment_method, reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, p_to_branch_id, v_cash_code, 'payment',
      'Mua hang noi bo', v_paid, v_pay_method,
      'input_invoice', v_input_inv_id,
      'Giao dich noi bo ' || v_sale_code, v_actor
    );
  end if;

  insert into public.internal_sales (
    tenant_id, code, from_branch_id, to_branch_id,
    invoice_id, input_invoice_id, status,
    subtotal, tax_amount, total, note, created_by
  ) values (
    v_tenant_id, v_sale_code, p_from_branch_id, p_to_branch_id,
    v_invoice_id, v_input_inv_id, 'completed',
    v_subtotal, v_tax_total, v_total, nullif(trim(p_note), ''), v_actor
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unitPrice')::numeric;
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_amount := round(v_qty * v_unit_price);

    select p.code, p.name, p.unit
      into v_product_code, v_product_name, v_unit
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id;

    insert into public.internal_sale_items (
      internal_sale_id, product_id, product_code, product_name, unit,
      quantity, unit_price, vat_rate, amount, note
    ) values (
      v_sale_id, v_product_id, v_product_code, v_product_name,
      coalesce(v_unit, 'Cai'), v_qty, v_unit_price, v_vat_rate,
      v_line_amount, nullif(v_item->>'note', '')
    );
  end loop;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'create',
    'internal_sale',
    v_sale_id,
    jsonb_build_object(
      'code', v_sale_code,
      'from_branch_id', p_from_branch_id,
      'to_branch_id', p_to_branch_id,
      'invoice_id', v_invoice_id,
      'input_invoice_id', v_input_inv_id,
      'total', v_total,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'internal_sale_id', v_sale_id,
    'code', v_sale_code,
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'input_invoice_id', v_input_inv_id,
    'input_invoice_code', v_input_inv_code,
    'total', v_total
  );
end;
$$;

revoke all on function public.create_internal_sale_atomic(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, boolean, text
) from public, anon;
grant execute on function public.create_internal_sale_atomic(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, boolean, text
) to authenticated, service_role;

-- This helper trusts its caller because it is only an implementation detail
-- of the hardened atomic RPC. Authenticated clients must not call it directly.
revoke all on function public.internal_sale_apply_stock_out(
  uuid, uuid, uuid, numeric, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.internal_sale_apply_stock_out(
  uuid, uuid, uuid, numeric, uuid, text, uuid
) to service_role;

commit;

-- Verification only. Expected: all booleans are true.
select
  p.proname,
  p.prosecdef as security_definer_ok,
  p.prosrc like '%inventory.internal_export%' as permission_check_ok,
  p.prosrc like '%TENANT_SPOOF_BLOCKED%' as tenant_check_ok,
  p.prosrc like '%user_has_branch_access%' as branch_check_ok,
  p.prosrc like '%next_cash_code%' as collision_safe_cash_code_ok,
  p.prosrc like '%insert into public.audit_log%' as atomic_audit_ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_internal_sale_atomic';

select
  not has_function_privilege(
    'authenticated',
    'public.internal_sale_apply_stock_out(uuid,uuid,uuid,numeric,uuid,text,uuid)',
    'execute'
  ) as direct_stock_helper_blocked;
