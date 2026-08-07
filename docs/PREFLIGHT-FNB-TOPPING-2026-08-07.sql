-- ============================================================
-- PREFLIGHT F&B TOPPING — CHỈ ĐỌC. KHÔNG sửa dữ liệu, KHÔNG tạo đơn.
-- Bản 3 (07/08/2026) — sửa lỗi 42809 khi CEO chạy bản 2.
--
-- LỖI BẢN 2: `pg_get_functiondef()` NÉM LỖI khi gặp hàm tổng hợp
--   (ERROR 42809: "array_agg" is an aggregate function).
--   Phần 6 và 10 quét toàn bộ schema public nên đụng phải → cả lô dừng.
--   → SỬA: thêm `p.prokind = 'f'` (chỉ hàm thường) vào MỌI truy vấn.
--
-- SỬA THÊM: bỏ `regexp_count` (chỉ có từ PostgreSQL 15) → dùng
--   `(select count(*) from regexp_matches(d, '...', 'g'))` chạy mọi phiên bản.
--
-- Cách chạy: Supabase Dashboard → SQL Editor → dán toàn bộ → Run.
-- Nếu vẫn lỗi ở một phần nào đó, chạy từng PHẦN riêng — các phần độc lập.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- PHẦN 0 — PHIÊN BẢN POSTGRESQL (để biết còn bẫy tương thích nào)
-- ══════════════════════════════════════════════════════════════
select version() as phien_ban_postgres, current_database() as csdl;


-- ══════════════════════════════════════════════════════════════
-- PHẦN 1 — 5 HÀM: CÓ TỒN TẠI KHÔNG, BAO NHIÊU BẢN QUÁ TẢI?
-- ══════════════════════════════════════════════════════════════
select
  p.proname                                 as ten_ham,
  pg_get_function_identity_arguments(p.oid) as tham_so,
  p.prosecdef                               as security_definer,
  md5(pg_get_functiondef(p.oid))            as van_tay,
  length(pg_get_functiondef(p.oid))         as do_dai
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'                       -- ★ chỉ hàm thường
  and p.proname in (
    'fnb_send_to_kitchen_atomic',
    'fnb_send_to_kitchen_atomic_v2',
    'fnb_complete_payment_atomic',
    '_fnb_complete_payment_impl_00230',
    'consume_bom_for_sale'
  )
order by p.proname, tham_so;
-- ĐỌC: một tên có >1 dòng ⇒ còn bản quá tải cũ, PostgREST có thể gọi nhầm.


-- ══════════════════════════════════════════════════════════════
-- PHẦN 2 — HỢP ĐỒNG KHOÁ JSON TOPPING  ★ ĐIỂM NGHI NGỜ CHÍNH ★
-- ══════════════════════════════════════════════════════════════
select
  p.proname as ten_ham,
  (select count(*) from regexp_matches(d, '''productId''',        'g')) as ghi_productId,
  (select count(*) from regexp_matches(d, '''product_id''',       'g')) as ghi_product_id,
  (select count(*) from regexp_matches(d, '->>\s*''productId''',  'g')) as doc_productId,
  (select count(*) from regexp_matches(d, '->>\s*''product_id''', 'g')) as doc_product_id,
  (select count(*) from regexp_matches(d, 'topping',              'g')) as so_lan_nhac_topping
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select pg_get_functiondef(p.oid) as d) x
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.proname in (
    'fnb_send_to_kitchen_atomic','fnb_send_to_kitchen_atomic_v2',
    'fnb_complete_payment_atomic','_fnb_complete_payment_impl_00230',
    'consume_bom_for_sale'
  )
order by p.proname;
-- HỆ THỐNG ĐÚNG khi: hàm gửi bếp GHI khoá nào thì hàm thanh toán ĐỌC khoá đó.
-- NGHI NGỜ TỪ REPO: gửi bếp ghi 'productId', thanh toán đọc ->>'product_id'.
-- Nếu lệch ⇒ thanh toán KHÔNG trừ kho topping (mà tiền vẫn cộng).


-- ══════════════════════════════════════════════════════════════
-- PHẦN 3 — TRÍCH ĐOẠN XỬ LÝ TOPPING TRONG HÀM THANH TOÁN
-- ══════════════════════════════════════════════════════════════
select
  p.proname,
  substring(d from greatest(position('toppings' in d) - 200, 1) for 2000)
    as doan_xu_ly_topping
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select pg_get_functiondef(p.oid) as d) x
where n.nspname = 'public' and p.prokind = 'f'
  and p.proname in ('fnb_complete_payment_atomic','_fnb_complete_payment_impl_00230');


-- ══════════════════════════════════════════════════════════════
-- PHẦN 4 — TRÍCH ĐOẠN GHI SNAPSHOT TOPPING TRONG HÀM GỬI BẾP
-- ══════════════════════════════════════════════════════════════
select
  p.proname,
  substring(d from greatest(position('topping' in d) - 150, 1) for 2000)
    as doan_ghi_snapshot
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select pg_get_functiondef(p.oid) as d) x
where n.nspname = 'public' and p.prokind = 'f'
  and p.proname like 'fnb_send_to_kitchen_atomic%';


-- ══════════════════════════════════════════════════════════════
-- PHẦN 5 — consume_bom_for_sale: NHẬN GÌ, XỬ LÝ GÌ
-- ══════════════════════════════════════════════════════════════
select
  pg_get_function_identity_arguments(p.oid) as tham_so_day_du,
  (d like '%linkedProductId%')              as co_xu_ly_linkedProductId,
  (d like '%p_modifier_selections%')        as co_nhan_modifier_selections,
  (d like '%scale_factor%' or d like '%scaleFactor%') as co_xu_ly_he_so_scale,
  (select count(*) from regexp_matches(d, 'upsert_branch_stock',     'g')) as so_lan_tru_ton_chi_nhanh,
  (select count(*) from regexp_matches(d, 'increment_product_stock', 'g')) as so_lan_tru_ton_tong,
  (select count(*) from regexp_matches(d, 'allocate_lots_fifo',      'g')) as so_lan_tru_lo_fifo
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select pg_get_functiondef(p.oid) as d) x
where n.nspname = 'public' and p.prokind = 'f'
  and p.proname = 'consume_bom_for_sale';


-- ══════════════════════════════════════════════════════════════
-- PHẦN 6 — HÀM NÀO ĐANG KHOÁ CỨNG 'NVL-TOP%'
--          (quét toàn schema — CHÍNH LÀ CHỖ BẢN 2 CHẾT)
-- ══════════════════════════════════════════════════════════════
select
  p.proname,
  (select count(*) from regexp_matches(d, 'NVL-TOP', 'g')) as so_lan_khoa_cung
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select pg_get_functiondef(p.oid) as d) x
where n.nspname = 'public'
  and p.prokind = 'f'                       -- ★ bắt buộc, nếu không sẽ lỗi 42809
  and d like '%NVL-TOP%'
order by p.proname;


-- ══════════════════════════════════════════════════════════════
-- PHẦN 7 — DỮ LIỆU ĐÃ PHÁT SINH THẬT SỰ (mức thiệt hại)
-- ══════════════════════════════════════════════════════════════
select
  (select count(*) from public.kitchen_orders)                                   as tong_don_bep,
  (select count(*) from public.kitchen_order_items)                              as tong_dong_don_bep,
  (select count(*) from public.kitchen_order_items
     where jsonb_array_length(coalesce(toppings, '[]'::jsonb)) > 0)              as dong_co_topping_that,
  (select count(*) from public.kitchen_order_items
     where jsonb_array_length(coalesce(modifier_selections, '[]'::jsonb)) > 0)   as dong_co_modifier_that,
  (select count(*) from public.stock_movements
     where reference_type = 'modifier_topping')                                  as so_kho_tu_modifier,
  (select count(*) from public.stock_movements
     where note ilike 'Topping %')                                               as so_kho_tu_topping_cu,
  (select count(*) from public.invoices where channel = 'fnb')                   as hoa_don_fnb;


-- ══════════════════════════════════════════════════════════════
-- PHẦN 8 — KHẢO SÁT ĐỦ 3 NHÓM MÃ  (NVL-TOP / SKU-TOP / SKU-TPP)
-- ══════════════════════════════════════════════════════════════
-- 8a. Cột vai trò tồn kho có tồn tại không?
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'products'
  and column_name in ('inventory_role','product_type','channel','has_bom','bom_code');

-- 8b. Bảng chính — 3 nhóm mã, kèm số dòng lịch sử từng mã
select
  case
    when p.code like 'NVL-TOP%' then '1-NGUYEN LIEU'
    when p.code like 'SKU-TOP%' then '2-BAN NGUYEN TUI'
    when p.code like 'SKU-TPP%' then '3-TOPPING THEO PHAN'
  end                                       as nhom,
  p.code, p.name,
  p.product_type as loai, p.channel as kenh,
  p.unit as dvt_chinh, p.purchase_unit as dvt_mua,
  p.stock_unit as dvt_kho, p.sell_unit as dvt_ban,
  p.sell_price as gia_ban, p.cost_price as gia_von, p.stock as ton_tong,
  p.has_bom as co_bom, p.bom_code as ma_bom, p.is_active as dang_bat,
  (select count(*) from public.purchase_order_items poi where poi.product_id = p.id) as so_dong_phieu_nhap,
  (select count(*) from public.invoice_items ii      where ii.product_id  = p.id)    as so_dong_hoa_don,
  (select count(*) from public.stock_movements sm    where sm.product_id  = p.id)    as so_dong_so_kho,
  (select count(*) from public.bom_items bi          where bi.material_id = p.id)    as so_lan_lam_nguyen_lieu,
  (select count(*) from public.branch_stock bs       where bs.product_id  = p.id)    as so_dong_ton_chi_nhanh,
  (select count(*) from public.modifier_options mo   where mo.linked_product_id = p.id) as so_lua_chon_noi_toi
from public.products p
where p.code like 'NVL-TOP%' or p.code like 'SKU-TOP%' or p.code like 'SKU-TPP%'
order by nhom, p.code;

-- 8c. Công thức của 3 nhóm này ghi định lượng theo đơn vị nào
select
  po.code as ma_san_pham_dau_ra, po.name as ten_san_pham, po.unit as dvt_dau_ra,
  b.code  as ma_cong_thuc, b.output_quantity as san_luong,
  pm.code as ma_nguyen_lieu, pm.name as ten_nguyen_lieu,
  pm.unit as dvt_nguyen_lieu, bi.quantity as dinh_luong, bi.unit as dvt_ghi_trong_ct
from public.bom_items bi
join public.bom b        on b.id = bi.bom_id
join public.products pm  on pm.id = bi.material_id
left join public.products po on po.id = b.product_id
where pm.code like 'NVL-TOP%' or pm.code like 'SKU-TOP%' or pm.code like 'SKU-TPP%'
   or po.code like 'NVL-TOP%' or po.code like 'SKU-TOP%' or po.code like 'SKU-TPP%'
order by po.code nulls last, pm.code;


-- ══════════════════════════════════════════════════════════════
-- PHẦN 9 — NHÓM TUỲ CHỌN: THỨ TỰ, LUẬT, MẶC ĐỊNH, LIÊN KẾT
-- ══════════════════════════════════════════════════════════════
select
  g.sort_order as thu_tu, g.name as ten_nhom, g.rule as luat, g.is_active as dang_bat,
  (select count(*) from public.modifier_options o where o.group_id = g.id)                  as so_lua_chon,
  (select count(*) from public.modifier_options o where o.group_id = g.id and o.is_default) as so_mac_dinh,
  (select count(*) from public.modifier_options o where o.group_id = g.id and o.linked_product_id is not null) as so_lua_chon_co_noi_sku,
  (select count(*) from public.category_modifier_groups l where l.modifier_group_id = g.id) as so_nhom_hang_gan,
  (select count(*) from public.product_modifier_groups l where l.modifier_group_id = g.id)  as so_mon_gan_rieng
from public.modifier_groups g
order by g.sort_order, g.name;
-- ĐỌC: nhóm single/single_required mà so_mac_dinh > 1 ⇒ CẤU HÌNH SAI.
-- Nếu MỌI nhóm đều sort_order = 0 ⇒ thứ tự trên popup là ngẫu nhiên.

-- 9b. Chi tiết lựa chọn của các nhóm "chọn một"
select g.name as ten_nhom, g.rule as luat,
       o.sort_order, o.label, o.price_delta, o.scale_factor, o.is_default,
       lp.code as sku_duoc_noi, lp.unit as dvt_sku, lp.sell_price as gia_sku
from public.modifier_groups g
join public.modifier_options o on o.group_id = g.id
left join public.products lp on lp.id = o.linked_product_id
where g.rule in ('single','single_required')
order by g.name, o.sort_order;


-- ══════════════════════════════════════════════════════════════
-- PHẦN 10 — CƠ CHẾ ĐƠN VỊ TÍNH
-- ══════════════════════════════════════════════════════════════
select from_unit, to_unit, factor, is_active, count(*) as so_san_pham
from public.uom_conversions
group by from_unit, to_unit, factor, is_active
order by so_san_pham desc;

-- Có hàm nào của DB đọc uom_conversions khi trừ kho không?
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select pg_get_functiondef(p.oid) as d) x
where n.nspname = 'public'
  and p.prokind = 'f'                       -- ★ bắt buộc
  and d like '%uom_conversions%'
order by p.proname;
-- Kết quả RỖNG ⇒ bảng quy đổi chỉ dùng để HIỂN THỊ, kho vẫn chạy theo products.unit.

-- ============================================================
-- HẾT — toàn bộ chỉ SELECT, không ghi bất kỳ dòng nào.
-- ============================================================
