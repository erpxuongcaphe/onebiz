-- ============================================================
-- OneBiz ERP - Functions & Triggers
-- ============================================================

-- ============================================================
-- 1. AUTO updated_at TRIGGER
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply updated_at trigger to all tables with updated_at column
do $$
declare
  t text;
begin
  for t in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'updated_at'
      and table_name != 'tenants'  -- tenants handled separately below
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.handle_updated_at()',
      t
    );
  end loop;
end;
$$;

-- Tenants updated_at
create trigger set_updated_at
  before update on public.tenants
  for each row execute function public.handle_updated_at();

-- ============================================================
-- 2. HANDLE NEW USER (tạo tenant + profile khi signup)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
  store_name text;
  user_name text;
begin
  store_name := coalesce(
    new.raw_user_meta_data ->> 'store_name',
    'Cửa hàng của ' || coalesce(new.raw_user_meta_data ->> 'full_name', 'tôi')
  );
  user_name := coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1));

  -- Tạo tenant
  insert into public.tenants (name, slug)
  values (
    store_name,
    'tenant-' || substr(new.id::text, 1, 8)
  )
  returning id into new_tenant_id;

  -- Tạo chi nhánh mặc định
  insert into public.branches (tenant_id, name, is_default)
  values (new_tenant_id, 'Chi nhánh chính', true);

  -- Tạo profile
  insert into public.profiles (id, tenant_id, full_name, email, role)
  values (new.id, new_tenant_id, user_name, new.email, 'owner');

  -- Tạo code sequences mặc định
  insert into public.code_sequences (tenant_id, entity_type, prefix, padding) values
    (new_tenant_id, 'product',         'SP',  6),
    (new_tenant_id, 'customer',        'KH',  6),
    (new_tenant_id, 'supplier',        'NCC', 5),
    (new_tenant_id, 'invoice',         'HD',  6),
    (new_tenant_id, 'purchase_order',  'PN',  6),
    (new_tenant_id, 'sales_order',     'DH',  6),
    (new_tenant_id, 'return',          'TH',  6),
    (new_tenant_id, 'shipping',        'VD',  6),
    (new_tenant_id, 'cash_receipt',    'PT',  5),
    (new_tenant_id, 'cash_payment',    'PC',  5),
    (new_tenant_id, 'inventory',       'KK',  5),
    -- Warehouse dialogs (Phase 2 — manual stock adjustments)
    (new_tenant_id, 'internal_export', 'XNB', 5),
    (new_tenant_id, 'disposal',        'XH',  5),
    (new_tenant_id, 'purchase_return', 'THN', 5),
    (new_tenant_id, 'manufacturing',   'SX',  5);

  return new;
end;
$$;

-- Trigger: khi user mới đăng ký
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 3. NEXT CODE (sinh mã tự động - atomic)
-- ============================================================
create or replace function public.next_code(
  p_tenant_id uuid,
  p_entity_type text
)
returns text
language plpgsql
security definer
as $$
declare
  v_prefix text;
  v_number int;
  v_padding int;
begin
  -- Lock row và increment
  update public.code_sequences
  set current_number = current_number + 1
  where tenant_id = p_tenant_id
    and entity_type = p_entity_type
  returning prefix, current_number, padding
  into v_prefix, v_number, v_padding;

  -- Nếu chưa có sequence, tạo mới
  if not found then
    insert into public.code_sequences (tenant_id, entity_type, prefix, current_number, padding)
    values (p_tenant_id, p_entity_type, upper(left(p_entity_type, 2)), 1, 6)
    returning prefix, current_number, padding
    into v_prefix, v_number, v_padding;
  end if;

  return v_prefix || lpad(v_number::text, v_padding, '0');
end;
$$;

-- ============================================================
-- 4. POS CHECKOUT (atomic: tạo invoice + trừ kho + ghi sổ quỹ)
-- ============================================================
create or replace function public.pos_checkout(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_items jsonb,  -- [{product_id, product_name, unit, quantity, unit_price, discount}]
  p_payment_method text,
  p_paid numeric,
  p_discount_amount numeric default 0,
  p_note text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_invoice_id uuid;
  v_code text;
  v_subtotal numeric := 0;
  v_total numeric;
  v_debt numeric;
  v_cash_code text;
  v_item jsonb;
  v_line_total numeric;
begin
  -- Sinh mã hóa đơn
  v_code := public.next_code(p_tenant_id, 'invoice');

  -- Tính subtotal
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line_total := (v_item ->> 'quantity')::numeric
                  * (v_item ->> 'unit_price')::numeric
                  - coalesce((v_item ->> 'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_total := v_subtotal - p_discount_amount;
  v_debt := greatest(0, v_total - p_paid);

  -- Tạo invoice
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name,
    status, subtotal, discount_amount, total, paid, debt,
    payment_method, note, created_by
  ) values (
    p_tenant_id, p_branch_id, v_code, p_customer_id, p_customer_name,
    'completed', v_subtotal, p_discount_amount, v_total, p_paid, v_debt,
    p_payment_method, p_note, auth.uid()
  )
  returning id into v_invoice_id;

  -- Tạo invoice items + trừ kho
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line_total := (v_item ->> 'quantity')::numeric
                  * (v_item ->> 'unit_price')::numeric
                  - coalesce((v_item ->> 'discount')::numeric, 0);

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, total
    ) values (
      v_invoice_id,
      (v_item ->> 'product_id')::uuid,
      v_item ->> 'product_name',
      coalesce(v_item ->> 'unit', 'Cái'),
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'discount')::numeric, 0),
      v_line_total
    );

    -- Trừ tồn kho
    update public.products
    set stock = stock - (v_item ->> 'quantity')::numeric
    where id = (v_item ->> 'product_id')::uuid;

    -- Ghi stock movement
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, (v_item ->> 'product_id')::uuid,
      'out', (v_item ->> 'quantity')::numeric,
      'invoice', v_invoice_id, 'POS checkout', auth.uid()
    );
  end loop;

  -- Ghi phiếu thu (nếu có thanh toán)
  if p_paid > 0 then
    v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      counterparty, payment_method, reference_type, reference_id,
      note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_cash_code, 'receipt', 'sales',
      p_paid, p_customer_name, p_payment_method,
      'invoice', v_invoice_id, 'Thanh toán ' || v_code, auth.uid()
    );
  end if;

  -- Cập nhật thống kê khách hàng
  if p_customer_id is not null then
    update public.customers
    set total_spent = total_spent + v_total,
        total_orders = total_orders + 1,
        debt = debt + v_debt
    where id = p_customer_id;
  end if;

  return v_invoice_id;
end;
$$;
