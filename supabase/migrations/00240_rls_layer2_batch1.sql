-- ============================================================
-- 00240 — LỚP 2 đợt 1: bật lại lớp bảo vệ trên 29 bảng ĐỦ QUY TẮC
-- ============================================================
-- Nối tiếp 00239 (đã đóng cửa với người chưa đăng nhập). Việc còn lại là
-- cách ly dữ liệu GIỮA CÁC DOANH NGHIỆP cho người ĐÃ đăng nhập.
--
-- ═══ SỰ THẬT ĐO ĐƯỢC (CEO chạy SELECT trên pg_class/pg_policy 30/07) ═══
-- 59 bảng đang TẮT bảo vệ, gồm hết bảng cốt lõi. Xác nhận đúng những gì
-- 00010_dev_disable_rls.sql để lại — bước bật lại chưa bao giờ làm.
--
-- Phân nhóm theo SỐ QUY TẮC đang có:
--     29 bảng có 4 quy tắc  ← ĐỢT NÀY
--     13 bảng có 3 quy tắc  ← đợt sau, phải xem thiếu lệnh nào
--     10 bảng có 2 quy tắc  ← đợt sau
--      2 bảng có 1 quy tắc  (audit_log, tenants) ← đợt sau
--      5 bảng có 0 quy tắc  (3 bảng sao lưu + stock_transfers/_items) ← phải
--                             viết quy tắc TRƯỚC, bật bây giờ là khoá sạch
--
-- ═══ VÌ SAO ĐỢT NÀY AN TOÀN ═══
-- Chỉ chọn bảng có quy tắc phủ ĐỦ CẢ 4 LỆNH đọc/thêm/sửa/xoá. Bật bảo vệ
-- lên bảng như vậy KHÔNG chặn thêm việc gì của nhân viên — quy tắc đã mô tả
-- sẵn ai được làm gì.
--
-- ⚠️ ĐẾM 4 QUY TẮC LÀ KHÔNG ĐỦ TIN: 4 quy tắc có thể đều là quy tắc ĐỌC.
-- Nên migration này KHÔNG tin danh sách gõ tay — nó tự đọc pg_policy, kiểm
-- từng bảng có đủ cả 4 lệnh hay không, thiếu một lệnh là DỪNG TOÀN BỘ.
--
-- ⚠️ KHÔNG đụng một dòng dữ liệu nào. Chỉ đổi cờ bảo vệ.
-- ⚠️ Đường lùi ở cuối file — một câu, tắt lại ngay.
-- ============================================================

do $$
declare
  v_bang text;
  v_lenh text[];
  v_thieu text[];
  v_loi   text := '';
  v_so    int := 0;
  -- 29 bảng có 4 quy tắc, theo đúng kết quả CEO đo
  v_ds text[] := array[
    'bom', 'bom_items', 'branch_stock', 'categories', 'coupons',
    'customer_groups', 'customers', 'group_code_sequences', 'lot_allocations',
    'loyalty_tiers', 'online_orders', 'pipeline_automations', 'pipeline_history',
    'pipeline_items', 'pipeline_stages', 'pipeline_transitions', 'pipelines',
    'price_books', 'price_tier_items', 'price_tiers', 'product_lots',
    'product_prices', 'product_variants', 'production_order_materials',
    'production_orders', 'products', 'promotions', 'suppliers', 'uom_conversions'
  ];
begin
  -- ── Bước 1: KIỂM TRƯỚC, chưa đổi gì ──
  foreach v_bang in array v_ds
  loop
    if to_regclass('public.' || v_bang) is null then
      v_loi := v_loi || format('  %s: không có bảng này%s', v_bang, chr(10));
      continue;
    end if;

    -- Gom các lệnh mà quy tắc của bảng này phủ. polcmd: r=đọc a=thêm w=sửa d=xoá *=tất cả
    select array_agg(distinct c) into v_lenh
      from (
        select case p.polcmd when '*' then unnest(array['r','a','w','d']) else p.polcmd::text end as c
          from pg_policy p
          join pg_class cl on cl.oid = p.polrelid
          join pg_namespace n on n.oid = cl.relnamespace
         where n.nspname = 'public' and cl.relname = v_bang
      ) t;

    v_thieu := array(
      select x from unnest(array['r','a','w','d']) x
       where not (x = any(coalesce(v_lenh, array[]::text[])))
    );

    if array_length(v_thieu, 1) > 0 then
      v_loi := v_loi || format('  %s: thiếu quy tắc cho lệnh %s%s',
                               v_bang, array_to_string(v_thieu, ','), chr(10));
    end if;
  end loop;

  if v_loi <> '' then
    raise exception E'00240 DỪNG — có bảng chưa đủ quy tắc, bật lên là chặn nhân viên:\n%', v_loi;
  end if;

  -- ── Bước 2: đủ điều kiện hết → bật ──
  foreach v_bang in array v_ds
  loop
    execute format('alter table public.%I enable row level security', v_bang);
    v_so := v_so + 1;
  end loop;

  raise notice '00240 OK: đã bật lớp bảo vệ trên % bảng (đều đủ quy tắc 4 lệnh).', v_so;
  raise notice '00240: còn 30 bảng chờ đợt sau — xem câu đối chiếu cuối file.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- ĐỐI CHIẾU NGAY SAU KHI CHẠY — làm đủ 3 bước, đừng bỏ bước 2
-- ============================================================
-- 1) Đếm lại — 29 bảng phải chuyển sang true:
-- select count(*) filter (where relrowsecurity) as da_bat,
--        count(*) filter (where not relrowsecurity) as con_tat
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relkind = 'r';
--
-- 2) ⚠️ QUAN TRỌNG NHẤT — mở web, đăng nhập, xem 6 chỗ này phải hiện đủ:
--    · Hàng hoá (products, categories, suppliers)
--    · Tồn kho (branch_stock, product_lots)
--    · Công thức (bom, bom_items)
--    · Khách hàng (customers, customer_groups)
--    · Lệnh sản xuất (production_orders)
--    · Bảng giá (price_tiers)
--    Thiếu chỗ nào → chạy ngay đường lùi ở dưới rồi gọi em.
--
-- 3) Bán thử 1 đơn trên POS (đơn nhỏ, huỷ sau) — để chắc luồng trừ kho
--    qua công thức vẫn chạy.
--
-- ============================================================
-- ĐƯỜNG LÙI — chạy nếu web thiếu dữ liệu sau khi bật
-- ============================================================
-- do $$
-- declare b text;
-- begin
--   foreach b in array array['bom','bom_items','branch_stock','categories',
--     'coupons','customer_groups','customers','group_code_sequences',
--     'lot_allocations','loyalty_tiers','online_orders','pipeline_automations',
--     'pipeline_history','pipeline_items','pipeline_stages','pipeline_transitions',
--     'pipelines','price_books','price_tier_items','price_tiers','product_lots',
--     'product_prices','product_variants','production_order_materials',
--     'production_orders','products','promotions','suppliers','uom_conversions']
--   loop
--     execute format('alter table public.%I disable row level security', b);
--   end loop;
-- end $$;
--
-- ============================================================
-- ĐỢT SAU — 30 bảng còn lại, cần xem THIẾU LỆNH NÀO trước
-- ============================================================
-- select cl.relname as bang,
--        string_agg(distinct p.polcmd::text, ',' order by p.polcmd::text) as lenh_da_phu
--   from pg_class cl
--   join pg_namespace n on n.oid = cl.relnamespace
--   left join pg_policy p on p.polrelid = cl.oid
--  where n.nspname = 'public' and cl.relkind = 'r' and not cl.relrowsecurity
--  group by 1 order by 1;
--
-- Đọc kết quả: r=đọc a=thêm w=sửa d=xoá *=tất cả.
-- Bảng thiếu lệnh nào mà web CÓ dùng lệnh đó trực tiếp → phải viết quy tắc
-- trước. Lệnh nào web chỉ làm qua hàm RPC thì không cần (hàm chạy quyền
-- định nghĩa, không bị lớp bảo vệ chặn).
--
-- 5 bảng 0 quy tắc: invoice_items_cost_backup_00237, product_lots_backup_00226,
-- product_lots_backup_00231 (3 bảng sao lưu — có thể chỉ cần cấm hẳn client
-- đọc, không cần quy tắc), stock_transfers, stock_transfer_items (tính năng
-- chuyển kho — phải viết quy tắc trước khi bật).
