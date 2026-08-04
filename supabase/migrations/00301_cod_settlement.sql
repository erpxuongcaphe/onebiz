-- ============================================================
-- 00301 — ĐỐI SOÁT COD với đối tác giao hàng (Đợt A3, kiểu KiotViet)
--
-- Một màn: chọn đối tác → tick các vận đơn ĐÃ GIAO chưa đối soát → xác nhận.
-- RPC settle_cod_atomic làm trọn trong 1 giao dịch:
--   · tạo phiếu đối soát DS000001…
--   · từng hóa đơn gắn vận đơn: thu COD (phiếu thu PT + cộng paid trừ debt)
--     — NHÂN BẢN đúng khối record_invoice_payment 00213/00242, nợ khách
--     trigger 00130 tự tính lại
--   · 1 phiếu chi PC gộp phí trả đối tác (category 'delivery_partner_fee')
--   · đóng dấu vận đơn: settlement_id + cod_collected_at + partner_fee
--
-- An toàn: không đụng kho; không sửa dữ liệu cũ; bảng/cột mới đều
-- IF NOT EXISTS — chạy lại không sao.
-- ============================================================


-- ============================================================
-- 1. Bảng phiếu đối soát
-- ============================================================
create table if not exists public.shipping_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  -- null = đối soát nhóm vận đơn chưa gán đối tác (shipper riêng)
  partner_id uuid references public.delivery_partners(id),
  branch_id uuid references public.branches(id),
  total_cod numeric not null default 0,
  total_partner_fee numeric not null default 0,
  net_amount numeric not null default 0,
  payment_method text not null default 'cash',
  note text,
  -- phiếu chi phí giao (nếu có); phiếu thu nằm ở cash_transactions
  -- reference_type='invoice' như thu nợ thường, note mang mã DS để truy ngược
  fee_cash_tx_id uuid references public.cash_transactions(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists idx_shipping_settlements_tenant
  on public.shipping_settlements (tenant_id, created_at desc);
create index if not exists idx_shipping_settlements_partner
  on public.shipping_settlements (partner_id);

alter table public.shipping_settlements enable row level security;

drop policy if exists "shipping_settlements_select" on public.shipping_settlements;
create policy "shipping_settlements_select" on public.shipping_settlements
  for select using (tenant_id = public.get_user_tenant_id());
-- Không có policy ghi: mọi đường ghi đi qua RPC security definer bên dưới.


-- ============================================================
-- 2. Ba cột thêm vào vận đơn
-- ============================================================
alter table public.shipping_orders
  add column if not exists settlement_id uuid references public.shipping_settlements(id),
  add column if not exists cod_collected_at timestamptz,
  -- phí TRẢ ĐỐI TÁC — tách hẳn shipping_fee (phí thu của khách)
  add column if not exists partner_fee numeric not null default 0;

create index if not exists idx_shipping_orders_settlement
  on public.shipping_orders (settlement_id);


-- ============================================================
-- 3. Bộ đếm mã DS000001 — khai tường minh, không rơi vào tiền tố tự sinh
-- ============================================================
insert into public.code_sequences (tenant_id, entity_type, prefix, current_number, padding)
select t.id, 'shipping_settlement', 'DS', 0, 6
  from public.tenants t
 where not exists (
   select 1 from public.code_sequences cs
    where cs.tenant_id = t.id and cs.entity_type = 'shipping_settlement'
 );


-- ============================================================
-- 4. RPC đối soát nguyên tử
-- ============================================================
create or replace function public.settle_cod_atomic(
  p_partner_id uuid,
  p_items jsonb,               -- [{"shipment_id":"…","partner_fee":15000}, …]
  p_payment_method text,
  p_note text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_actor_tenant uuid;
  v_is_service_role boolean :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_item record;
  v_ship record;
  v_invoice record;
  v_settlement_id uuid := gen_random_uuid();
  v_code text;
  v_partner_name text;
  v_branch_id uuid;
  v_total_cod numeric := 0;
  v_total_fee numeric := 0;
  v_pay numeric;
  v_cash_code text;
  v_fee_cash_id uuid;
  v_receipts int := 0;
begin
  -- ── Xác thực + quyền: đúng khuôn 00242 ──
  v_actor := case when v_is_service_role then p_user_id else auth.uid() end;
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not v_is_service_role
     and p_user_id is not null
     and p_user_id <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_actor_tenant
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  -- ai thu nợ được thì đối soát được — không đẻ mã quyền mới
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_SHIPMENTS_SELECTED' using errcode = 'P0001';
  end if;

  if p_partner_id is not null then
    select name into v_partner_name
      from public.delivery_partners
     where id = p_partner_id and tenant_id = v_actor_tenant;
    if not found then
      raise exception 'PARTNER_NOT_FOUND' using errcode = 'P0001';
    end if;
  else
    v_partner_name := 'Chua gan doi tac';
  end if;

  v_code := public.next_code(v_actor_tenant, 'shipping_settlement');

  -- Tạo phiếu TRƯỚC (số 0) để vận đơn trỏ FK vào được; chốt tổng ở cuối.
  insert into public.shipping_settlements (
    id, tenant_id, code, partner_id, payment_method, note, created_by
  ) values (
    v_settlement_id, v_actor_tenant, v_code, p_partner_id,
    p_payment_method, nullif(trim(coalesce(p_note, '')), ''), v_actor
  );

  for v_item in
    select (e->>'shipment_id')::uuid as shipment_id,
           greatest(coalesce((e->>'partner_fee')::numeric, 0), 0) as partner_fee
      from jsonb_array_elements(p_items) e
  loop
    select s.* into v_ship
      from public.shipping_orders s
     where s.id = v_item.shipment_id and s.tenant_id = v_actor_tenant
     for update;
    if not found then
      raise exception 'SHIPMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_ship.status <> 'delivered' then
      raise exception 'SHIPMENT_NOT_DELIVERED|%', v_ship.code using errcode = 'P0001';
    end if;
    if v_ship.settlement_id is not null then
      raise exception 'SHIPMENT_ALREADY_SETTLED|%', v_ship.code using errcode = 'P0001';
    end if;
    if v_ship.partner_id is distinct from p_partner_id then
      raise exception 'SHIPMENT_PARTNER_MISMATCH|%', v_ship.code using errcode = 'P0001';
    end if;

    v_total_fee := v_total_fee + v_item.partner_fee;

    -- ── Thu COD vào hóa đơn — nhân bản khối record_invoice_payment ──
    select i.id, i.branch_id, i.code, i.customer_id, i.customer_name,
           i.paid, i.debt, i.status
      into v_invoice
      from public.invoices i
     where i.id = v_ship.invoice_id and i.tenant_id = v_actor_tenant
     for update;
    if not found then
      raise exception 'INVOICE_NOT_FOUND|%', v_ship.code using errcode = 'P0001';
    end if;
    -- kỷ luật 00213: KHÔNG thu tiền trên chứng từ chưa hoàn tất
    if v_invoice.status <> 'completed' then
      raise exception 'INVOICE_NOT_COMPLETED|%', v_invoice.code using errcode = 'P0001';
    end if;
    if v_branch_id is null then
      v_branch_id := v_invoice.branch_id;
    end if;

    -- thu tối đa phần nợ còn lại (nếu đã thu nợ tay trước thì không thu trùng)
    v_pay := least(coalesce(v_ship.cod_amount, 0), greatest(coalesce(v_invoice.debt, 0), 0));
    if v_pay > 0 then
      v_cash_code := public.next_cash_code(v_actor_tenant, 'receipt');
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount, counterparty,
        payment_method, reference_type, reference_id, customer_id,
        note, created_by, status, transaction_date
      ) values (
        v_actor_tenant, v_invoice.branch_id, v_cash_code, 'receipt',
        'customer_payment', v_pay, v_invoice.customer_name,
        p_payment_method, 'invoice', v_invoice.id, v_invoice.customer_id,
        'Thu COD ' || v_ship.code || ' - doi soat ' || v_code,
        v_actor, 'completed', current_date
      );

      update public.invoices
         set paid = coalesce(paid, 0) + v_pay,
             debt = coalesce(debt, 0) - v_pay,
             updated_at = now()
       where id = v_invoice.id and tenant_id = v_actor_tenant;

      v_total_cod := v_total_cod + v_pay;
      v_receipts := v_receipts + 1;
    end if;

    update public.shipping_orders
       set settlement_id = v_settlement_id,
           cod_collected_at = now(),
           partner_fee = v_item.partner_fee,
           updated_at = now()
     where id = v_ship.id and tenant_id = v_actor_tenant;
  end loop;

  -- ── 1 phiếu chi gộp phí trả đối tác ──
  if v_total_fee > 0 then
    v_cash_code := public.next_cash_code(v_actor_tenant, 'payment');
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount, counterparty,
      payment_method, reference_type, reference_id,
      note, created_by, status, transaction_date
    ) values (
      v_actor_tenant, v_branch_id, v_cash_code, 'payment',
      'delivery_partner_fee', v_total_fee, v_partner_name,
      p_payment_method, 'shipping_settlement', v_settlement_id,
      'Phi giao hang - doi soat ' || v_code,
      v_actor, 'completed', current_date
    )
    returning id into v_fee_cash_id;
  end if;

  update public.shipping_settlements
     set branch_id = v_branch_id,
         total_cod = v_total_cod,
         total_partner_fee = v_total_fee,
         net_amount = v_total_cod - v_total_fee,
         fee_cash_tx_id = v_fee_cash_id
   where id = v_settlement_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_actor_tenant, v_actor, 'settle', 'shipping_settlement', v_settlement_id,
    jsonb_build_object(
      'code', v_code, 'partner_id', p_partner_id,
      'total_cod', v_total_cod, 'total_partner_fee', v_total_fee,
      'net_amount', v_total_cod - v_total_fee, 'receipts', v_receipts
    )
  );

  return jsonb_build_object(
    'settlement_id', v_settlement_id,
    'code', v_code,
    'total_cod', v_total_cod,
    'total_partner_fee', v_total_fee,
    'net_amount', v_total_cod - v_total_fee,
    'receipts', v_receipts
  );
end;
$$;

revoke all on function public.settle_cod_atomic(uuid, jsonb, text, text, uuid)
  from public, anon;
grant execute on function public.settle_cod_atomic(uuid, jsonb, text, text, uuid)
  to authenticated, service_role;


-- ============================================================
-- 5. Kiểm sau khi chạy (chỉ đọc)
-- ============================================================
-- a) Bảng + 3 cột mới có mặt:
--   select count(*) from information_schema.columns
--    where table_name = 'shipping_orders'
--      and column_name in ('settlement_id','cod_collected_at','partner_fee');
--   -- kỳ vọng: 3
-- b) Bộ đếm DS đã seed đủ tenant:
--   select count(*) from code_sequences where entity_type = 'shipping_settlement';
-- c) RPC có mặt:
--   select proname from pg_proc where proname = 'settle_cod_atomic';
--
-- Lùi lại (nếu cần):
--   drop function if exists public.settle_cod_atomic(uuid, jsonb, text, text, uuid);
--   alter table public.shipping_orders
--     drop column if exists settlement_id,
--     drop column if exists cod_collected_at,
--     drop column if exists partner_fee;
--   drop table if exists public.shipping_settlements;
--   delete from code_sequences where entity_type = 'shipping_settlement';
