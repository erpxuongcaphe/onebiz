-- ============================================================
-- 00236 — NỐI giá vốn công thức vào thẻ sản phẩm
-- ============================================================
-- CEO 29/07: "dữ liệu hệ thống nhiều chỗ chưa link với nhau" — đúng.
-- Đây là sợi dây đứt gây ra chuỗi lỗi giá vốn.
--
-- HỆ THỐNG ĐÃ CÓ SẴN (chạy tốt, không phải sửa):
--   00069 dựng bom.cached_cost + 2 trigger tự tính lại mỗi khi
--   bom_items đổi hoặc giá NVL đổi. Đo hôm nay: 613/623 công thức có
--   cached_cost > 0, cập nhật gần nhất 29/07 04:53. Máy chạy đúng.
--
-- CHỖ ĐỨT:
--   KHÔNG có một dòng nào chép bom.cached_cost sang products.cost_price
--   của chính sản phẩm mà công thức đó làm ra. 00069 cố ý để cho
--   complete_production_order chốt giá vốn thành phẩm — đúng với hàng
--   SẢN XUẤT, nhưng SKU bán lẻ đóng gói lại KHÔNG BAO GIỜ qua lệnh sản
--   xuất (bán tới đâu nổ công thức tới đó), nên giá vốn nằm mãi ở 0.
--
-- ĐO THẬT: 286/287 SKU có công thức tính ra tiền đang ghi giá vốn 0đ.
--   SKU-CPH-025 công thức ra 190.000đ/túi — thẻ sản phẩm ghi 0đ.
--
-- BỐN NƠI ĐỌC products.cost_price ĐỀU NHẬN 0 VÌ CHỖ ĐỨT NÀY:
--   1. 00196 trigger chốt giá vốn dòng bán   → ghi 0 vào hoá đơn
--   2. 00206 trigger ghi giá vào sổ kho      → sổ kho mất giá
--   3. 00026 chốt giá vốn NVL cho lệnh SX    → COGS sản xuất sai
--   4. Định giá tồn kho                      → (không ảnh hưởng, xem dưới)
--
-- ⚠️ KHÔNG đụng giá vốn NVL (giá bình quân từ mua hàng) và KHÔNG đụng
-- sản phẩm đã có lệnh sản xuất hoàn thành (giá vốn do sản xuất chốt).
-- ============================================================

-- ── 1. Giá vốn 1 đơn vị theo công thức ───────────────────────
-- Dùng lại cache 00069, KHÔNG viết lại công thức → không bao giờ lệch nhau.
create or replace function public.bom_unit_cost(p_bom_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
           when coalesce(b.yield_qty, 1) = 0 then null
           else round(coalesce(b.cached_cost, 0) / coalesce(b.yield_qty, 1), 4)
         end
    from public.bom b
   where b.id = p_bom_id;
$$;

comment on function public.bom_unit_cost(uuid) is
  'Giá vốn 1 đơn vị thành phẩm theo công thức = cached_cost / yield_qty (00236).';

grant execute on function public.bom_unit_cost(uuid) to authenticated;

-- ── 2. Chép giá vốn công thức sang thẻ sản phẩm ──────────────
create or replace function public.sync_product_cost_from_bom(p_product_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bom_code  text;
  v_tenant_id uuid;
  v_gia       numeric;
  v_so_gia    int;
  v_cu        numeric;
begin
  select bom_code, cost_price, tenant_id
    into v_bom_code, v_cu, v_tenant_id
    from public.products where id = p_product_id;

  if v_tenant_id is null then
    return null;
  end if;

  -- Giá vốn do lệnh sản xuất chốt thì để nguyên — chính xác hơn lý thuyết.
  if exists (
    select 1 from public.production_orders
     where product_id = p_product_id and status = 'completed'
  ) then
    return null;
  end if;

  -- Gom mọi giá vốn khác nhau từ các công thức ĐANG BẬT của sản phẩm này.
  -- Nhiều chi nhánh cùng một giá → vẫn chốt được. Khác giá → bỏ qua, để
  -- lúc bán chốt theo chi nhánh (chính xác hơn 1 con số chung).
  -- ⚠️ Luôn khoá theo tenant: bom.code chỉ duy nhất TRONG một tenant.
  with ct as (
    select b.id
      from public.bom b
     where b.is_active = true
       and b.tenant_id = v_tenant_id
       and (
         (v_bom_code is not null and b.code = v_bom_code)
         or (v_bom_code is null and b.product_id = p_product_id)
       )
       -- Chặn công thức tự chứa chính nó (sự cố Sting/Bò húc 10/06):
       -- để lọt sẽ thành vòng lặp giá vốn tự nuôi chính nó.
       and not exists (
         select 1 from public.bom_items bi
          where bi.bom_id = b.id and bi.material_id = p_product_id
       )
  )
  select count(distinct round(public.bom_unit_cost(ct.id), 2)),
         min(round(public.bom_unit_cost(ct.id), 2))
    into v_so_gia, v_gia
    from ct
   where coalesce(public.bom_unit_cost(ct.id), 0) > 0;

  if v_so_gia is null or v_so_gia <> 1 or coalesce(v_gia, 0) <= 0 then
    return null;
  end if;

  if v_cu is distinct from v_gia then
    update public.products set cost_price = v_gia, updated_at = now()
     where id = p_product_id;
    return v_gia;
  end if;

  return null;
end;
$$;

comment on function public.sync_product_cost_from_bom(uuid) is
  'Chép giá vốn từ công thức sang products.cost_price (00236). Bỏ qua SP có lệnh SX hoàn thành, SP có nhiều công thức khác giá, và công thức tự chứa chính nó.';

-- Hàm này GHI vào products → chỉ để trigger và migration gọi, không mở cho app.
revoke all on function public.sync_product_cost_from_bom(uuid) from public, anon, authenticated;

-- ── 3. Giữ dây luôn nối — công thức đổi giá thì thẻ SP đổi theo ──
create or replace function public.trg_bom_cost_to_product()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  -- Chặn vòng lặp: cập nhật giá vốn SP sẽ kích lại trigger 00069 để tính
  -- lại các công thức DÙNG SP đó làm nguyên liệu (đúng ý đồ, công thức
  -- nhiều tầng), nhưng phải có đáy.
  if pg_trigger_depth() > 4 then
    return null;
  end if;

  for r in
    select p.id
      from public.products p
     where p.tenant_id = NEW.tenant_id
       and (
         (NEW.code is not null and p.bom_code = NEW.code)
         or (NEW.product_id is not null and p.id = NEW.product_id and p.bom_code is null)
       )
  loop
    perform public.sync_product_cost_from_bom(r.id);
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_bom_cost_to_product on public.bom;
create trigger trg_bom_cost_to_product
  after insert or update of cached_cost, is_active, code, product_id on public.bom
  for each row
  execute function public.trg_bom_cost_to_product();

-- ── 4. Nối lại toàn bộ dữ liệu đang có ───────────────────────
do $$
declare
  r            record;
  v_moi        numeric;
  v_so         int := 0;
  v_gt_truoc   numeric;
  v_gt_sau     numeric;
  v_ton_truoc  numeric;
begin
  -- Giá trị tồn kho TRƯỚC — để chứng minh không xê dịch
  select coalesce(sum(stock * coalesce(cost_price, 0)), 0),
         coalesce(sum(stock), 0)
    into v_gt_truoc, v_ton_truoc
    from public.products;

  -- Quét cả 3 đường dẫn tới công thức, không chỉ tin cờ has_bom
  for r in
    select distinct p.id, p.code
      from public.products p
     where p.has_bom = true
        or p.bom_code is not null
        or exists (
             select 1 from public.bom b
              where b.product_id = p.id and b.is_active = true
           )
  loop
    v_moi := public.sync_product_cost_from_bom(r.id);
    if v_moi is not null then
      v_so := v_so + 1;
    end if;
  end loop;

  select coalesce(sum(stock * coalesce(cost_price, 0)), 0) into v_gt_sau
    from public.products;

  raise notice '00236: đã nối giá vốn cho % sản phẩm', v_so;
  raise notice '00236: giá trị tồn kho % → % (lệch %)',
    round(v_gt_truoc), round(v_gt_sau), round(v_gt_sau - v_gt_truoc);
  raise notice '00236: tổng số lượng tồn % (KHÔNG đụng tới)', round(v_ton_truoc, 2);

  if v_gt_sau <> v_gt_truoc then
    raise notice '00236: LƯU Ý — giá trị tồn đổi vì có SP vừa được nối giá vốn mà đang giữ tồn. Số lượng tồn không đổi.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- ĐỐI CHIẾU — chạy sau khi áp
-- ============================================================
-- 1) Còn SP nào có công thức tính ra tiền mà thẻ vẫn ghi 0đ không?
--    (Chỉ còn lại: SP có lệnh SX hoàn thành, hoặc nhiều công thức khác giá.)
-- select p.code, p.name, p.cost_price,
--        round(public.bom_unit_cost(b.id), 2) as gia_theo_cong_thuc
--   from public.products p
--   join public.bom b
--     on (p.bom_code is not null and b.code = p.bom_code)
--     or (p.bom_code is null and b.product_id = p.id)
--  where b.is_active
--    and coalesce(p.cost_price, 0) = 0
--    and public.bom_unit_cost(b.id) > 0
--  order by 4 desc;
--
-- 2) Thử đổi giá 1 nguyên liệu rồi xem thẻ SP có tự đổi theo không:
-- select code, name, cost_price from public.products where code = 'SKU-CPH-025';
