-- ============================================================
-- 00158 (v2) — VÁ complete_production_order (23505 variant-null) + đối soát SX000011
-- ============================================================
-- CEO 06/07/2026: SX000011 (SX 7 chai Yaourt, đã làm THẬT) không hoàn thành được.
--
-- NGUYÊN NHÂN GỐC (xác định lại — không phải "nhất thời"): migration 00156 (04/07)
-- thêm partial unique index idx_branch_stock_base_unique trên
-- (tenant_id, branch_id, product_id) WHERE variant_id IS NULL. Nhưng hàm
-- complete_production_order vẫn dùng `ON CONFLICT (branch_id, product_id,
-- variant_id)` — arbiter này KHÔNG khớp index mới khi variant_id NULL (NULL coi
-- là distinct) → cố INSERT dòng thứ 2 → vi phạm idx_branch_stock_base_unique →
-- 23505. SX000011 là lệnh hoàn thành ĐẦU TIÊN sau 00156 nên là ca đầu dính.
-- (Lỗi này cũng ảnh hưởng RPC atomic 00159 vì nó gọi complete_production_order.)
--
-- BẢN VÁ (PHẦN A): CREATE OR REPLACE complete_production_order — upsert branch_stock
-- rẽ nhánh theo variant_id, ON CONFLICT khớp ĐÚNG partial index (base vs variant).
-- Giữ nguyên mọi logic khác của 00150/00069 (WAC, lô, created_by fallback).
--
-- ĐỐI SOÁT (PHẦN B, atomic — idempotent theo status):
--   ① Hoàn NVL trừ dư 2/3 vòng của SX000011 (giữ 1 vòng cho mẻ thật; cả
--      branch_stock LẪN products.stock).
--   ② Hoàn thành SX000011 đúng 1 lần → nhập 7 chai Yaourt (NVL-SST-019 -5 → +2), lô.
--   ③ Heal drift products.stock sữa chua NVL-SST-015 (15.12 → 0.99; verify
--      ledger=branch). Sữa đặc bỏ qua (ledger≠branch, mixed state — xử riêng).
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- PHẦN A: vá complete_production_order (branch_stock upsert khớp index 00156)
-- ────────────────────────────────────────────────────────────────
create or replace function public.complete_production_order(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_lot_id uuid;
  v_lot_number text;
  v_unit_cogs numeric(15, 4);
  v_wac_result jsonb;
  v_actor uuid;
begin
  select * into v_order from public.production_orders
  where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  -- 00150: người ghi sổ — fallback chủ tenant (chống NULL stock_movements.created_by)
  v_actor := coalesce(
    v_order.created_by,
    (select id from public.profiles
      where tenant_id = v_order.tenant_id and role = 'owner'
      order by created_at limit 1)
  );
  if v_actor is null then
    raise exception 'Không xác định được người thực hiện (created_by null & không có owner)';
  end if;

  -- Generate lot number nếu không có
  v_lot_number := coalesce(
    p_lot_number,
    'LOT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(uuid_generate_v4()::text, 1, 4)
  );

  -- Auto-calculate expiry nếu SP có shelf_life_days
  if p_expiry_date is null then
    select
      case
        when shelf_life_unit = 'day' then p_manufactured_date + shelf_life_days
        when shelf_life_unit = 'month' then p_manufactured_date + (shelf_life_days || ' months')::interval
        when shelf_life_unit = 'year' then p_manufactured_date + (shelf_life_days || ' years')::interval
        else null
      end
    into p_expiry_date
    from public.products
    where id = v_order.product_id and shelf_life_days is not null;
  end if;

  -- Tạo lot
  insert into public.product_lots (
    tenant_id, product_id, variant_id, lot_number,
    source_type, production_order_id,
    manufactured_date, expiry_date, received_date,
    initial_qty, current_qty, branch_id, status
  ) values (
    v_order.tenant_id, v_order.product_id, v_order.variant_id, v_lot_number,
    'production', p_production_order_id,
    p_manufactured_date, p_expiry_date, current_date,
    p_completed_qty, p_completed_qty, v_order.branch_id, 'active'
  ) returning id into v_lot_id;

  -- GAP #2 FIX (00069): Apply WAC cho SKU thành phẩm TRƯỚC khi increment stock
  if v_order.cogs_amount is not null
     and v_order.cogs_amount > 0
     and p_completed_qty > 0 then
    v_unit_cogs := round(v_order.cogs_amount / p_completed_qty, 4);

    v_wac_result := public.apply_weighted_avg_cost(
      v_order.product_id,
      p_completed_qty,
      v_unit_cogs,
      'production_complete',
      'production_order',
      p_production_order_id
    );
  end if;

  -- Nhập kho thành phẩm (tổng công ty)
  update public.products
  set stock = stock + p_completed_qty
  where id = v_order.product_id;

  -- Nhập kho thành phẩm (branch_stock) — 00158v2 FIX: rẽ nhánh theo variant_id để
  -- ON CONFLICT khớp ĐÚNG partial unique index của 00156 (base variant-null vs
  -- variant). Trước đây `on conflict (branch_id, product_id, variant_id)` không
  -- khớp index nào khi variant_id NULL → 23505.
  if v_order.variant_id is null then
    insert into public.branch_stock (tenant_id, branch_id, product_id, variant_id, quantity)
    values (v_order.tenant_id, v_order.branch_id, v_order.product_id, null, p_completed_qty)
    on conflict (tenant_id, branch_id, product_id) where variant_id is null
    do update set quantity = public.branch_stock.quantity + p_completed_qty, updated_at = now();
  else
    insert into public.branch_stock (tenant_id, branch_id, product_id, variant_id, quantity)
    values (v_order.tenant_id, v_order.branch_id, v_order.product_id, v_order.variant_id, p_completed_qty)
    on conflict (tenant_id, branch_id, product_id, variant_id) where variant_id is not null
    do update set quantity = public.branch_stock.quantity + p_completed_qty, updated_at = now();
  end if;

  -- Log stock movement IN (00150: created_by = v_actor)
  insert into public.stock_movements (
    tenant_id, branch_id, product_id, type, quantity,
    reference_type, reference_id, note, created_by
  ) values (
    v_order.tenant_id, v_order.branch_id, v_order.product_id, 'in', p_completed_qty,
    'production_order', p_production_order_id,
    'SX hoàn thành: ' || v_order.code || ' | Lot: ' || v_lot_number,
    v_actor
  );

  -- Update production order
  update public.production_orders
  set completed_qty = p_completed_qty,
      lot_number = v_lot_number,
      status = 'completed',
      actual_end = now(),
      updated_at = now()
  where id = p_production_order_id;

  return v_lot_id;
end;
$$;

grant execute on function public.complete_production_order(uuid, numeric, text, date, date) to authenticated;

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────
-- PHẦN B: đối soát SX000011 (dùng complete_production_order vừa vá)
-- ────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_po     uuid := '9c2b78d3-6db1-4778-8ee5-04d8042604da'; -- SX000011
  v_nvl    uuid := '468e83b5-2398-49ee-9702-e80f29ac701b'; -- NVL-SST-019 thành phẩm Yaourt
  v_sua    uuid := 'ba1c3afa-750a-4195-9909-663f46120968'; -- NVL-SST-015 sữa chua (heal an toàn)
  v_kho    uuid := '558adc8f-a629-4ae6-90a6-d13c2a83896c'; -- Kho Tổng
  v_owner  uuid;
  v_status text;
  r record;
  v_reverse numeric;
  v_lot uuid;
  v_ledger numeric;
  v_branch numeric;
  v_prod numeric;
begin
  select status into v_status from public.production_orders where id = v_po;
  if not found then
    raise notice '00158 SKIP: không tìm thấy SX000011 (DB khác / fresh replay)';
    return;
  end if;
  if v_status = 'completed' then
    raise notice '00158 SKIP: SX000011 đã completed trước đó';
    return;
  end if;

  select id into v_owner from public.profiles
   where tenant_id = v_tenant and role = 'owner' order by created_at limit 1;
  if v_owner is null then
    raise exception '00158: không tìm thấy owner của tenant';
  end if;

  -- ① HOÀN NVL TRỪ DƯ: giữ 1 vòng, hoàn (n-1)/n phần đã trừ cho từng NVL.
  for r in
    select product_id,
           sum(quantity) as total_out,
           count(*)      as n_rounds
    from public.stock_movements
    where reference_id = v_po
      and reference_type = 'production_order'
      and type = 'out'
    group by product_id
  loop
    if r.n_rounds <= 1 then
      continue;
    end if;
    v_reverse := round(r.total_out * (r.n_rounds - 1) / r.n_rounds, 4);
    if v_reverse <= 0 then
      continue;
    end if;

    update public.products
      set stock = stock + v_reverse, updated_at = now()
      where id = r.product_id;
    update public.branch_stock
      set quantity = quantity + v_reverse, updated_at = now()
      where product_id = r.product_id and branch_id = v_kho and variant_id is null;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant, v_kho, r.product_id, 'in', v_reverse,
      'production_reconcile', v_po,
      'Đối soát SX000011: hoàn NVL bị trừ dư ' || (r.n_rounds - 1)::text
        || '/' || r.n_rounds::text || ' lần (lỗi hoàn thành SX không nguyên tử) — giữ 1 vòng cho mẻ SX thật',
      v_owner
    );
    raise notice '00158 ① hoàn % đơn vị NVL % (đã trừ % qua % lần)', v_reverse, r.product_id, r.total_out, r.n_rounds;
  end loop;

  -- ② HOÀN THÀNH SX000011 đúng 1 lần: nhập 7 chai Yaourt, tạo lô, set completed.
  v_lot := public.complete_production_order(
    v_po, 7,
    'SX000011-20260706',
    '2026-07-06'::date,
    null
  );
  raise notice '00158 ② SX000011 completed — lô % (7 chai Yaourt vào kho)', v_lot;

  -- ③ HEAL drift products.stock sữa chua (CHỈ khi ledger=branch — an toàn).
  select coalesce(sum(case when type='out' then -quantity else quantity end),0)
    into v_ledger from public.stock_movements where product_id = v_sua;
  select coalesce(sum(quantity),0) into v_branch
    from public.branch_stock where product_id = v_sua;
  select stock into v_prod from public.products where id = v_sua;

  if abs(v_ledger - v_branch) < 0.001 then
    update public.products set stock = v_branch, updated_at = now() where id = v_sua;
    raise notice '00158 ③ HEAL sữa chua products.stock: % → % (=branch=ledger)', v_prod, v_branch;
  else
    raise notice '00158 ③ BỎ QUA heal sữa chua: ledger(%) ≠ branch(%) — state hỗn hợp', v_ledger, v_branch;
  end if;

  raise notice '00158 XONG. Kiểm: Yaourt NVL-SST-019 kỳ vọng +2; sữa chua products=branch.';
end $$;

-- ============================================================
-- VERIFY sau khi áp:
--   select code, status, completed_qty, lot_number from public.production_orders where code='SX000011';
--     -- kỳ vọng completed / 7 / SX000011-20260706
--   select code, name, stock from public.products where code='NVL-SST-019';  -- kỳ vọng 2
--   select p.code, p.stock as products_stock,
--          (select sum(quantity) from public.branch_stock b where b.product_id=p.id) as branch_sum
--   from public.products p where p.code in ('NVL-SST-015','NVL-SUA-002','NVL-SUA-001');
--   select lot_number, current_qty, status from public.product_lots
--   where production_order_id='9c2b78d3-6db1-4778-8ee5-04d8042604da';  -- 1 lô, 7 chai
-- LƯU Ý CÒN LẠI (ngoài phạm vi): drift products.stock sữa đặc NVL-SUA-002 (mixed state).
-- ============================================================
