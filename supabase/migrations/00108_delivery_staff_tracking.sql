-- ============================================================
-- 00108: Delivery staff tracking + km-tier delivery fee policy
-- ============================================================
-- CEO 21/05/2026: Nhân viên quán đi giao đơn cho khách → cần ghi nhận:
--   (a) Ai là người đi giao (delivery_staff_id) — khác với cashier
--   (b) Phí giao theo tiers km (gần / vừa / xa) — chính sách thu khách
--   (c) Thời điểm gán shipper + thời điểm giao xong → tính tốc độ
--   (d) Có thể gán shipper sau (cashier không nhất thiết phải biết ngay)
--
-- Phương án CEO chọn:
--   - Policy phí: Theo cấp ngưỡng km (3 tier: near/mid/far) — cấu hình
--     được tại /cai-dat/fnb-delivery
--   - Gán shipper: Cho phép gán sau (kitchen order list có nút gán)
--
-- Sau migration này:
--   - kitchen_orders + invoices có 2 field mới: delivery_staff_id, delivery_distance_tier
--   - kitchen_orders thêm timeline: delivery_assigned_at, delivery_completed_at
--   - Bảng mới fnb_delivery_fee_tiers (per-tenant, optional per-branch)
--   - RPC mới: assign_delivery_staff_to_order, complete_delivery
--   - RPC cũ fnb_complete_payment_atomic auto-copy 2 field mới sang invoice

-- ============================================================
-- 1. Add columns to kitchen_orders
-- ============================================================

alter table public.kitchen_orders
  add column if not exists delivery_staff_id uuid references auth.users(id) on delete set null;

alter table public.kitchen_orders
  add column if not exists delivery_distance_tier text;

alter table public.kitchen_orders
  add column if not exists delivery_assigned_at timestamptz;

alter table public.kitchen_orders
  add column if not exists delivery_completed_at timestamptz;

-- Tier check: near/mid/far/custom (custom = nhập thủ công vẫn cho phép legacy)
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where constraint_name = 'kitchen_orders_delivery_distance_tier_check'
  ) then
    alter table public.kitchen_orders
      add constraint kitchen_orders_delivery_distance_tier_check
      check (delivery_distance_tier is null or delivery_distance_tier in ('near', 'mid', 'far', 'custom'));
  end if;
end $$;

-- Index để query "đơn của shipper X" trong báo cáo
create index if not exists idx_kitchen_orders_delivery_staff
  on public.kitchen_orders(delivery_staff_id)
  where delivery_staff_id is not null;

create index if not exists idx_kitchen_orders_order_type_delivery
  on public.kitchen_orders(branch_id, order_type, created_at)
  where order_type = 'delivery';

-- ============================================================
-- 2. Add columns to invoices
-- ============================================================

alter table public.invoices
  add column if not exists delivery_staff_id uuid references auth.users(id) on delete set null;

alter table public.invoices
  add column if not exists delivery_distance_tier text;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where constraint_name = 'invoices_delivery_distance_tier_check'
  ) then
    alter table public.invoices
      add constraint invoices_delivery_distance_tier_check
      check (delivery_distance_tier is null or delivery_distance_tier in ('near', 'mid', 'far', 'custom'));
  end if;
end $$;

create index if not exists idx_invoices_delivery_staff
  on public.invoices(delivery_staff_id)
  where delivery_staff_id is not null;

-- ============================================================
-- 3. Bảng cấu hình tier phí giao hàng
-- ============================================================
-- Mỗi tenant có 3 tier mặc định (near/mid/far). Optional override per branch.

create table if not exists public.fnb_delivery_fee_tiers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- null = áp dụng cho TẤT CẢ branch trong tenant; khác null = override cho branch cụ thể
  branch_id uuid references public.branches(id) on delete cascade,
  tier_code text not null check (tier_code in ('near', 'mid', 'far')),
  tier_label text not null,        -- vd "Dưới 2km", "2-5km", "Trên 5km"
  fee numeric(15,2) not null default 0 check (fee >= 0),
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Mỗi tier_code chỉ 1 row per (tenant, branch). Branch null cũng unique riêng.
  unique (tenant_id, branch_id, tier_code)
);

create index if not exists idx_fnb_delivery_fee_tiers_tenant
  on public.fnb_delivery_fee_tiers(tenant_id, is_active);

-- Updated_at trigger
create or replace function public.tg_fnb_delivery_fee_tiers_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fnb_delivery_fee_tiers_updated_at on public.fnb_delivery_fee_tiers;
create trigger fnb_delivery_fee_tiers_updated_at
  before update on public.fnb_delivery_fee_tiers
  for each row execute function public.tg_fnb_delivery_fee_tiers_updated_at();

-- Seed 3 tier mặc định cho mọi tenant đang có (an toàn idempotent qua unique)
insert into public.fnb_delivery_fee_tiers (tenant_id, branch_id, tier_code, tier_label, fee, display_order, is_active)
select
  t.id,
  null::uuid,
  tier.code,
  tier.label,
  tier.fee,
  tier.ord,
  true
from public.tenants t
cross join (values
  ('near', 'Dưới 2km',  15000, 1),
  ('mid',  '2 - 5km',   25000, 2),
  ('far',  'Trên 5km',  35000, 3)
) as tier(code, label, fee, ord)
on conflict (tenant_id, branch_id, tier_code) do nothing;

-- ============================================================
-- 4. RPC: Gán shipper cho 1 đơn (gọi từ UI khi cashier chọn sau)
-- ============================================================

create or replace function public.assign_delivery_staff_to_order(
  p_kitchen_order_id uuid,
  p_staff_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
begin
  select * into v_order from public.kitchen_orders where id = p_kitchen_order_id;
  if not found then
    raise exception 'Kitchen order % not found', p_kitchen_order_id;
  end if;

  -- Cho phép gán cho dine_in/takeaway luôn (vd quán nhỏ chủ giao tận bàn) — không ép order_type
  update public.kitchen_orders
  set delivery_staff_id = p_staff_id,
      delivery_assigned_at = coalesce(delivery_assigned_at, now()),
      updated_at = now()
  where id = p_kitchen_order_id;

  -- Nếu đã thanh toán → update luôn invoice
  if v_order.invoice_id is not null then
    update public.invoices
    set delivery_staff_id = p_staff_id
    where id = v_order.invoice_id;
  end if;

  return jsonb_build_object(
    'kitchen_order_id', p_kitchen_order_id,
    'delivery_staff_id', p_staff_id,
    'invoice_updated', v_order.invoice_id is not null
  );
end;
$$;

grant execute on function public.assign_delivery_staff_to_order(uuid, uuid) to authenticated;

-- ============================================================
-- 5. RPC: Đánh dấu giao xong (timestamp để tính avg time)
-- ============================================================

create or replace function public.complete_delivery_for_order(
  p_kitchen_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_duration_sec int;
begin
  select * into v_order from public.kitchen_orders where id = p_kitchen_order_id;
  if not found then
    raise exception 'Kitchen order % not found', p_kitchen_order_id;
  end if;
  if v_order.delivery_staff_id is null then
    raise exception 'Đơn % chưa có shipper — không thể đánh dấu giao xong', p_kitchen_order_id;
  end if;

  update public.kitchen_orders
  set delivery_completed_at = now(),
      updated_at = now()
  where id = p_kitchen_order_id;

  v_duration_sec :=
    extract(epoch from (now() - coalesce(v_order.delivery_assigned_at, v_order.created_at)))::int;

  return jsonb_build_object(
    'kitchen_order_id', p_kitchen_order_id,
    'completed_at', now(),
    'duration_seconds', v_duration_sec
  );
end;
$$;

grant execute on function public.complete_delivery_for_order(uuid) to authenticated;

-- ============================================================
-- 6. Override fnb_complete_payment_atomic — copy delivery_staff + tier
-- ============================================================
-- Cùng signature 11-params như 00100. Chỉ thêm 2 column vào INSERT invoices.

create or replace function public.fnb_complete_payment_atomic(
  p_kitchen_order_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_payment_method text,
  p_payment_breakdown jsonb,
  p_paid numeric,
  p_discount_amount numeric,
  p_note text,
  p_created_by uuid,
  p_shift_id uuid default null,
  p_tip_amount numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_invoice_code text;
  v_items_subtotal numeric := 0;
  v_total_discount numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_commission_percent numeric;
  v_commission_amount numeric;
  v_total numeric;
  v_total_gross numeric;
  v_tax_total numeric := 0;
  v_cash_code text;
  v_customer_name text;
  v_note text;
  v_actual_paid numeric;
  r record;
  t jsonb;
  v_vat_rate numeric;
  v_vat_amt numeric;
  v_line_before_tax numeric;
  v_topping_qty numeric;
  v_topping_price numeric;
  v_topping_product_id uuid;
  v_topping_name text;
  v_topping_total numeric;
  v_breakdown_item jsonb;
  v_method text;
  v_amount numeric;
  v_method_label text;
  v_payment_method_effective text;
  v_has_bom boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
begin
  select * into v_order from public.kitchen_orders where id = p_kitchen_order_id;
  if not found then
    raise exception 'Kitchen order % not found', p_kitchen_order_id;
  end if;
  if v_order.status = 'completed' then
    raise exception 'Kitchen order % already paid (invoice_id=%)', p_kitchen_order_id, v_order.invoice_id;
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'Kitchen order % was cancelled — cannot pay', p_kitchen_order_id;
  end if;

  v_tenant_id := v_order.tenant_id;
  v_branch_id := v_order.branch_id;
  v_delivery_fee := coalesce(v_order.delivery_fee, 0);
  v_tip := greatest(0, coalesce(p_tip_amount, 0));
  v_commission_percent := coalesce(v_order.platform_commission_percent, 0);
  v_customer_name := coalesce(nullif(p_customer_name, ''), 'Khách lẻ');
  v_note := coalesce(p_note, 'F&B - ' || v_order.order_number);

  if p_shift_id is not null then
    if not exists (
      select 1 from public.shifts
      where id = p_shift_id and status = 'open' and branch_id = v_branch_id
    ) then
      raise exception 'Ca % không tồn tại hoặc đã đóng', p_shift_id;
    end if;
  end if;

  v_invoice_code := public.next_code(v_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

  for r in
    select product_id, product_name, variant_label, quantity, unit_price, toppings
    from public.kitchen_order_items where kitchen_order_id = p_kitchen_order_id
  loop
    v_line_before_tax := r.quantity * r.unit_price;
    select coalesce(vat_rate, 0) into v_vat_rate from public.products where id = r.product_id;
    v_vat_rate := coalesce(v_vat_rate, 0);
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);
    v_items_subtotal := v_items_subtotal + v_line_before_tax;
    v_tax_total := v_tax_total + v_vat_amt;

    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0);
        if v_topping_qty > 0 then
          v_topping_price := coalesce((t->>'price')::numeric, 0);
          v_items_subtotal := v_items_subtotal + (v_topping_qty * v_topping_price * r.quantity);
        end if;
      end loop;
    end if;
  end loop;

  v_total_discount := coalesce(v_order.discount_amount, 0) + coalesce(p_discount_amount, 0);

  v_total_gross := v_items_subtotal - v_total_discount + v_delivery_fee + v_tip;
  v_commission_amount := round(v_total_gross * v_commission_percent / 100);
  v_total := v_total_gross - v_commission_amount;
  if v_total < 0 then v_total := 0; end if;

  if v_commission_amount > 0 then
    v_actual_paid := v_total;
    v_payment_method_effective := 'transfer';
  else
    v_actual_paid := p_paid;
    v_payment_method_effective := p_payment_method;
  end if;

  -- INSERT invoice — Day 21/05/2026 (CEO): thêm 2 column delivery_staff_id + delivery_distance_tier
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name, status,
    subtotal, discount_amount, tax_amount, total, paid, debt,
    delivery_fee, platform_commission, platform_commission_percent,
    payment_method, source, note, created_by, shift_id, tip_amount,
    delivery_staff_id, delivery_distance_tier
  ) values (
    v_tenant_id, v_branch_id, v_invoice_code, p_customer_id, v_customer_name, 'completed',
    v_items_subtotal, v_total_discount, v_tax_total, v_total, v_actual_paid,
    greatest(0, v_total - v_actual_paid),
    v_delivery_fee, v_commission_amount, v_commission_percent,
    v_payment_method_effective, 'fnb', v_note, p_created_by, p_shift_id, v_tip,
    v_order.delivery_staff_id, v_order.delivery_distance_tier
  ) returning id into v_invoice_id;

  update public.kitchen_orders
  set platform_commission_amount = v_commission_amount
  where id = p_kitchen_order_id;

  -- Items + BOM (giữ logic 00100)
  for r in
    select product_id, product_name, variant_label, quantity, unit_price, toppings
    from public.kitchen_order_items where kitchen_order_id = p_kitchen_order_id
  loop
    v_line_before_tax := r.quantity * r.unit_price;
    select coalesce(vat_rate, 0) into v_vat_rate from public.products where id = r.product_id;
    v_vat_rate := coalesce(v_vat_rate, 0);
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, r.product_id,
      case when r.variant_label is not null and r.variant_label <> ''
           then r.product_name || ' (' || r.variant_label || ')'
           else r.product_name end,
      'Cái', r.quantity, r.unit_price, 0, v_vat_rate, v_vat_amt, v_line_before_tax
    );

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
      'invoice', v_invoice_id,
      'F&B bán hàng - ' || v_invoice_code, p_created_by
    );

    perform public.increment_product_stock(r.product_id, -r.quantity);
    perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

    begin
      perform public.allocate_lots_fifo(v_tenant_id, r.product_id, v_branch_id, r.quantity, 'invoice', v_invoice_id);
    exception when others then null;
    end;

    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = r.product_id;

    if v_has_bom then
      v_bom_result := public.consume_bom_for_sale(
        v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', r.product_id,
        'product_name', r.product_name,
        'sale_qty', r.quantity,
        'result', v_bom_result
      );
    end if;

    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0);
        if v_topping_qty > 0 then
          v_topping_product_id := nullif(t->>'product_id', '')::uuid;
          if v_topping_product_id is not null then
            v_topping_name := coalesce(t->>'name', 'Topping');
            v_topping_price := coalesce((t->>'price')::numeric, 0);
            v_topping_total := v_topping_qty * v_topping_price * r.quantity;

            insert into public.stock_movements (
              tenant_id, branch_id, product_id, type, quantity,
              reference_type, reference_id, note, created_by
            ) values (
              v_tenant_id, v_branch_id, v_topping_product_id, 'out',
              v_topping_qty * r.quantity, 'invoice', v_invoice_id,
              'Topping ' || v_topping_name || ' - ' || v_invoice_code, p_created_by
            );

            perform public.increment_product_stock(v_topping_product_id, -(v_topping_qty * r.quantity));
            perform public.upsert_branch_stock(v_tenant_id, v_branch_id, v_topping_product_id, -(v_topping_qty * r.quantity));

            begin
              perform public.allocate_lots_fifo(v_tenant_id, v_topping_product_id, v_branch_id, v_topping_qty * r.quantity, 'invoice', v_invoice_id);
            exception when others then null;
            end;

            select coalesce(has_bom, false) into v_has_bom
            from public.products where id = v_topping_product_id;
            if v_has_bom then
              v_bom_result := public.consume_bom_for_sale(
                v_tenant_id, v_branch_id, v_topping_product_id, v_topping_qty * r.quantity,
                v_invoice_id, p_created_by, v_invoice_code
              );
              v_bom_results := v_bom_results || jsonb_build_object(
                'product_id', v_topping_product_id,
                'product_name', v_topping_name,
                'sale_qty', v_topping_qty * r.quantity,
                'topping', true,
                'result', v_bom_result
              );
            end if;
          end if;
        end if;
      end loop;
    end if;
  end loop;

  -- Cash transactions (giữ logic 00100)
  if v_actual_paid > 0 then
    if p_payment_method = 'mixed'
       and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0
       and v_commission_amount = 0
    then
      for v_breakdown_item in select * from jsonb_array_elements(p_payment_breakdown) loop
        v_amount := coalesce((v_breakdown_item->>'amount')::numeric, 0);
        v_method := v_breakdown_item->>'method';
        if v_amount > 0 and v_method in ('cash', 'transfer', 'card') then
          v_cash_code := public.next_code(v_tenant_id, 'cash_receipt');
          if v_cash_code is null or v_cash_code = '' then
            v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
          end if;
          v_method_label := case v_method
            when 'cash' then 'tiền mặt'
            when 'transfer' then 'chuyển khoản'
            when 'card' then 'thẻ' else v_method end;
          insert into public.cash_transactions (
            tenant_id, branch_id, code, type, category, amount,
            counterparty, payment_method,
            reference_type, reference_id, note, created_by, shift_id
          ) values (
            v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', v_amount,
            v_customer_name, v_method,
            'invoice', v_invoice_id,
            'Thu tiền HĐ ' || v_invoice_code || ' (' || v_method_label || ')',
            p_created_by, p_shift_id
          );
        end if;
      end loop;
    else
      v_cash_code := public.next_code(v_tenant_id, 'cash_receipt');
      if v_cash_code is null or v_cash_code = '' then
        v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
      end if;
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount,
        counterparty, payment_method,
        reference_type, reference_id, note, created_by, shift_id
      ) values (
        v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng',
        v_actual_paid, v_customer_name,
        case
          when v_commission_amount > 0 then 'transfer'
          when p_payment_method = 'mixed' then 'cash'
          else p_payment_method
        end,
        'invoice', v_invoice_id,
        case
          when v_commission_amount > 0
          then 'Thu thực HĐ ' || v_invoice_code
               || ' (gross ' || v_total_gross::text
               || ' - phí sàn ' || v_commission_amount::text || ')'
          else 'Thu tiền HĐ ' || v_invoice_code
        end,
        p_created_by, p_shift_id
      );
    end if;
  end if;

  update public.kitchen_orders
  set invoice_id = v_invoice_id, status = 'completed', updated_at = now()
  where id = p_kitchen_order_id;

  if v_order.table_id is not null then
    update public.restaurant_tables
    set status = 'available', current_order_id = null, updated_at = now()
    where id = v_order.table_id and current_order_id = p_kitchen_order_id;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'total', v_total,
    'total_gross', v_total_gross,
    'platform_commission', v_commission_amount,
    'platform_commission_percent', v_commission_percent,
    'paid', v_actual_paid,
    'debt', greatest(0, v_total - v_actual_paid),
    'bom_consume_results', v_bom_results
  );
end;
$$;

grant execute on function public.fnb_complete_payment_atomic(uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric) to authenticated;

comment on function public.fnb_complete_payment_atomic is
  'FnB payment v5 — full features (commission + tip + shift) + BOM consume + delivery_staff tracking. CEO 21/05/2026.';

comment on table public.fnb_delivery_fee_tiers is
  'Tier phí giao hàng FnB (near/mid/far) per tenant, override được per branch. CEO 21/05/2026.';

comment on column public.kitchen_orders.delivery_staff_id is
  'Nhân viên quán đi giao đơn (KHÁC created_by là cashier tạo đơn). CEO 21/05/2026.';

comment on column public.kitchen_orders.delivery_distance_tier is
  'Cấp ngưỡng km áp dụng phí giao: near/mid/far/custom. CEO 21/05/2026.';

notify pgrst, 'reload schema';
