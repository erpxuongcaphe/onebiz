-- ============================================================
-- 00152 — Chốt sổ tồn kho Yaourt: hoàn thành 7 lệnh SX + gỡ trừ-kép sữa
-- ============================================================
-- CEO 24/06/2026: 7 lệnh SX (SX000002–008) là sản xuất THẬT → phải hoàn thành
-- để nhập kho thành phẩm NVL-SST-019 (trừ sữa theo BOM sản xuất a655eeb6).
--
-- VƯỚNG: suốt tháng 6, 74 lần bán SKU yaourt (BOM cũ sai) đã trừ SỮA
-- (note "Công thức cho Yaourt") → (a) sữa chua còn ~7, không đủ để hoàn thành
-- (cần ~33); (b) nếu hoàn thành thì trừ sữa LẦN NỮA = trừ kép; (c) 74 chai đã
-- bán nhưng chưa trừ vào thành phẩm → nếu chỉ hoàn thành, NVL-SST-019 sẽ dư.
--
-- BUG PHỤ phát hiện khi chạy (24/06): complete_production_order → apply_weighted_avg_cost
-- ghi audit_log.user_id = auth.uid(); chạy trong SQL Editor thì auth.uid()=null →
-- fallback uuid rỗng → vỡ FK audit_log_user_id_fkey. PHẦN 0 vá gốc: dùng owner tenant.
--
-- XỬ LÝ (atomic — lỗi giữa chừng tự rollback toàn bộ):
--   ① HOÀN SỮA: đảo bom_consume "Công thức cho Yaourt" (74 lần bán cũ trừ nhầm).
--   ② HOÀN THÀNH 7 lệnh SX: consume_production_materials + complete_production_order.
--   ③ PHẢN ÁNH ĐÃ BÁN: 80 − 6 = 74 chai → trừ vào thành phẩm NVL-SST-019.
-- Kết quả: NVL-SST-019 = 1 + 77 − 74 = 4 chai. Sữa trừ 1 lần theo sản xuất.
-- Idempotent: đã chạy → có movement 'production_reconcile' → skip.
-- ============================================================

-- ── PHẦN 0: vá apply_weighted_avg_cost — actor hợp lệ (owner) thay uuid rỗng ──
create or replace function public.apply_weighted_avg_cost(
  p_product_id uuid,
  p_new_qty numeric,
  p_new_unit_price numeric,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_product record;
  v_old_cost numeric(15, 4);
  v_old_stock numeric(15, 4);
  v_new_cost numeric(15, 4);
  v_actor uuid;
begin
  if p_new_qty is null or p_new_qty <= 0 then
    return jsonb_build_object('skipped', true, 'reason', 'INVALID_QTY');
  end if;
  if p_new_unit_price is null or p_new_unit_price <= 0 then
    return jsonb_build_object('skipped', true, 'reason', 'INVALID_UNIT_PRICE');
  end if;

  select id, tenant_id, code, name, cost_price, stock
    into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  -- 00152: actor hợp lệ — auth.uid() (app) hoặc owner tenant (SQL Editor/service-role)
  v_actor := coalesce(
    auth.uid(),
    (select id from public.profiles
      where tenant_id = v_product.tenant_id and role = 'owner'
      order by created_at limit 1)
  );

  v_old_cost := coalesce(v_product.cost_price, 0);
  v_old_stock := coalesce(v_product.stock, 0);

  if v_old_stock <= 0 or v_old_cost <= 0 then
    v_new_cost := p_new_unit_price;
  else
    v_new_cost := round(
      (v_old_stock * v_old_cost + p_new_qty * p_new_unit_price)
      / (v_old_stock + p_new_qty),
      4
    );
  end if;

  update public.products
  set cost_price = v_new_cost, updated_at = now()
  where id = p_product_id;

  -- Audit log — chỉ khi có actor hợp lệ (tránh vỡ FK audit_log_user_id_fkey)
  if v_actor is not null then
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      v_product.tenant_id, v_actor, 'cost_price_update', 'product', p_product_id,
      jsonb_build_object('cost_price', v_old_cost, 'stock', v_old_stock),
      jsonb_build_object(
        'cost_price', v_new_cost, 'qty_added', p_new_qty,
        'unit_price_in', p_new_unit_price, 'reason', p_reason,
        'reference_type', p_reference_type, 'reference_id', p_reference_id,
        'product_code', v_product.code, 'product_name', v_product.name
      )
    );
  end if;

  return jsonb_build_object(
    'updated', true, 'product_id', p_product_id,
    'old_cost', v_old_cost, 'new_cost', v_new_cost,
    'old_stock', v_old_stock, 'new_stock', v_old_stock + p_new_qty
  );
end;
$$;

grant execute on function public.apply_weighted_avg_cost(uuid, numeric, numeric, text, text, uuid) to authenticated;

-- ── PHẦN 1: chốt sổ Yaourt (atomic) ──
do $$
declare
  v_tenant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_nvl    uuid := '468e83b5-2398-49ee-9702-e80f29ac701b'; -- NVL-SST-019 (thành phẩm)
  v_sku    uuid := '7249ef9f-da79-4b77-a23a-f316b5965ca4'; -- SKU-SST-019 (mã bán)
  v_kho    uuid := '558adc8f-a629-4ae6-90a6-d13c2a83896c'; -- Kho Tổng
  v_owner  uuid;
  r record;
  v_sold_total numeric;
  v_nvl_consumed numeric;
  v_reflect_qty numeric;
  v_final_stock numeric;
begin
  if exists (
    select 1 from public.stock_movements
    where product_id = v_nvl and reference_type = 'production_reconcile'
  ) then
    raise notice '00152 SKIP: đã chốt sổ Yaourt trước đó';
    return;
  end if;

  select id into v_owner from public.profiles
   where tenant_id = v_tenant and role = 'owner' order by created_at limit 1;
  if v_owner is null then
    raise exception '00152: không tìm thấy owner của tenant';
  end if;

  -- ① HOÀN SỮA bị 74 lần bán cũ trừ nhầm
  for r in
    select product_id, branch_id, sum(quantity) as qty
    from public.stock_movements
    where reference_type = 'bom_consume'
      and note ilike '%Công thức cho Yaourt%'
    group by product_id, branch_id
  loop
    update public.products set stock = stock + r.qty, updated_at = now()
     where id = r.product_id;
    update public.branch_stock set quantity = quantity + r.qty, updated_at = now()
     where product_id = r.product_id and branch_id = r.branch_id and variant_id is null;
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant, r.branch_id, r.product_id, 'in', r.qty,
      'production_reconcile', v_nvl,
      'Chốt sổ Yaourt: hoàn lại NVL bị bán-yaourt-cũ trừ nhầm (chuyển sang trừ thành phẩm)',
      v_owner
    );
  end loop;

  -- ② HOÀN THÀNH 7 lệnh SX còn lại (trừ sữa theo BOM SX + nhập kho NVL)
  for r in
    select id, planned_qty, code
    from public.production_orders
    where tenant_id = v_tenant and product_id = v_nvl and status <> 'completed'
    order by code
  loop
    perform public.consume_production_materials(r.id);
    perform public.complete_production_order(
      r.id, r.planned_qty,
      r.code || '-' || to_char(current_date, 'YYYYMMDD'),
      current_date, null
    );
  end loop;

  -- ③ PHẢN ÁNH 74 chai yaourt đã bán → trừ thành phẩm NVL-SST-019
  select coalesce(sum(quantity), 0) into v_sold_total
    from public.invoice_items where product_id = v_sku;
  select coalesce(sum(quantity), 0) into v_nvl_consumed
    from public.stock_movements
    where product_id = v_nvl and reference_type = 'bom_consume';
  v_reflect_qty := v_sold_total - v_nvl_consumed;  -- 80 − 6 = 74

  if v_reflect_qty > 0 then
    update public.products set stock = stock - v_reflect_qty, updated_at = now()
     where id = v_nvl;
    update public.branch_stock set quantity = quantity - v_reflect_qty, updated_at = now()
     where product_id = v_nvl and branch_id = v_kho and variant_id is null;
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant, v_kho, v_nvl, 'out', v_reflect_qty,
      'production_reconcile', v_sku,
      'Chốt sổ Yaourt: phản ánh ' || v_reflect_qty::text
        || ' chai đã bán T6 trừ vào thành phẩm (trước trừ nhầm sữa)',
      v_owner
    );
  end if;

  select stock into v_final_stock from public.products where id = v_nvl;
  raise notice '00152 OK: NVL-SST-019 (thành phẩm Yaourt) tồn cuối = % chai', v_final_stock;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY sau khi áp:
--   select code, name, stock from public.products where code='NVL-SST-019';  -- kỳ vọng 4
--   select code, status, completed_qty from public.production_orders where code like 'SX%';  -- completed
--   select code, stock from public.products where code in ('NVL-SST-015','NVL-SUA-001','NVL-SUA-002');
-- ============================================================
