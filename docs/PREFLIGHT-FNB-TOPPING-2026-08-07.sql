-- ============================================================
-- PREFLIGHT — CHỈ ĐỌC. KHÔNG sửa dữ liệu, KHÔNG tạo đơn.
-- Mục đích: xác nhận ĐỊNH NGHĨA ĐANG CÀI TRÊN PROD của 5 hàm F&B,
--           và hợp đồng khoá JSON topping (productId vs product_id).
--
-- Cách chạy: Supabase Dashboard → SQL Editor → dán toàn bộ → Run.
-- Gửi lại kết quả từng phần cho Claude.
-- ============================================================

-- ── 1) 5 HÀM CÓ TỒN TẠI KHÔNG, BAO NHIÊU BẢN QUÁ TẢI? ──────────
select
  p.proname                                   as ten_ham,
  pg_get_function_identity_arguments(p.oid)   as tham_so,
  p.prosecdef                                 as security_definer,
  md5(pg_get_functiondef(p.oid))              as van_tay_dinh_nghia,
  length(pg_get_functiondef(p.oid))           as do_dai
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'fnb_send_to_kitchen_atomic',
    'fnb_send_to_kitchen_atomic_v2',
    'fnb_complete_payment_atomic',
    '_fnb_complete_payment_impl_00230',
    'consume_bom_for_sale'
  )
order by p.proname, tham_so;
-- ĐỌC KẾT QUẢ: nếu một tên có >1 dòng ⇒ có bản quá tải cũ còn sót,
-- PostgREST có thể gọi nhầm bản cũ.


-- ── 2) HỢP ĐỒNG KHOÁ JSON TOPPING — ĐIỂM NGHI NGỜ CHÍNH ────────
-- Đếm số lần mỗi hàm GHI 'productId' / 'product_id' và ĐỌC ->>'productId' / ->>'product_id'
select
  p.proname as ten_ham,
  (length(d) - length(replace(d, '''productId''',  ''))) / 12 as ghi_productId,
  (length(d) - length(replace(d, '''product_id''', ''))) / 13 as ghi_product_id,
  (length(d) - length(replace(d, '>>''productId''',  ''))) / 14 as doc_productId,
  (length(d) - length(replace(d, '>>''product_id''', ''))) / 15 as doc_product_id
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select pg_get_functiondef(p.oid) as d) x
where n.nspname = 'public'
  and p.proname in (
    'fnb_send_to_kitchen_atomic','fnb_send_to_kitchen_atomic_v2',
    'fnb_complete_payment_atomic','_fnb_complete_payment_impl_00230','consume_bom_for_sale'
  )
order by p.proname;
-- KỲ VỌNG NẾU HỆ THỐNG ĐÚNG: hàm gửi bếp GHI khoá nào thì hàm thanh toán ĐỌC khoá đó.
-- NGHI NGỜ TỪ REPO: gửi bếp ghi 'productId', thanh toán đọc ->>'product_id' ⇒ LỆCH.


-- ── 3) TRÍCH ĐÚNG ĐOẠN XỬ LÝ TOPPING TRONG HÀM THANH TOÁN ──────
select
  p.proname,
  substring(pg_get_functiondef(p.oid)
            from position('toppings' in pg_get_functiondef(p.oid)) - 200
            for 1800) as doan_xu_ly_topping
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fnb_complete_payment_atomic','_fnb_complete_payment_impl_00230');


-- ── 4) TRÍCH ĐOẠN GHI SNAPSHOT TOPPING TRONG HÀM GỬI BẾP ───────
select
  p.proname,
  substring(pg_get_functiondef(p.oid)
            from position('toppings_snapshot' in pg_get_functiondef(p.oid)) - 100
            for 1500) as doan_ghi_snapshot
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'fnb_send_to_kitchen_atomic%';


-- ── 5) consume_bom_for_sale — CÓ NHẬN modifier_selections KHÔNG? ──
select
  pg_get_function_identity_arguments(p.oid) as tham_so_day_du,
  position('linkedProductId' in pg_get_functiondef(p.oid)) > 0 as co_xu_ly_linkedProductId,
  position('p_modifier_selections' in pg_get_functiondef(p.oid)) > 0 as co_nhan_modifier
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'consume_bom_for_sale';


-- ── 6) HÀM NÀO ĐANG KHOÁ CỨNG 'NVL-TOP%'? ─────────────────────
select p.proname,
       position('NVL-TOP' in pg_get_functiondef(p.oid)) > 0 as khoa_cung_NVL_TOP
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and pg_get_functiondef(p.oid) like '%NVL-TOP%'
order by p.proname;


-- ── 7) DỮ LIỆU ĐÃ PHÁT SINH CHƯA (để biết mức thiệt hại) ──────
select
  (select count(*) from public.kitchen_orders)                                as tong_don_bep,
  (select count(*) from public.kitchen_order_items where toppings is not null) as dong_co_topping,
  (select count(*) from public.stock_movements where reference_type = 'modifier_topping') as so_kho_modifier_topping,
  (select count(*) from public.stock_movements where note ilike 'Topping %')   as so_kho_topping_cu;


-- ── 8) ĐƠN VỊ TÍNH — CƠ CHẾ SẴN CÓ CỦA ONEBIZ ─────────────────
select table_name
from information_schema.tables
where table_schema = 'public'
  and (table_name ilike '%uom%' or table_name ilike '%unit%' or table_name ilike '%conversion%');

select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'products'
  and (column_name ilike '%unit%' or column_name ilike '%uom%' or column_name ilike '%conversion%' or column_name ilike '%pack%')
order by column_name;

-- Giá trị thật đang dùng ở 5 mã nguyên liệu topping
select code, name, unit, purchase_unit, stock_unit, sell_unit, stock, cost_price, sell_price
from public.products
where code like 'NVL-TOP%'
order by code;

-- BOM đang ghi định lượng theo đơn vị nào (mẫu 20 dòng)
select b.code as ma_cong_thuc, p.code as ma_nvl, p.name as ten_nvl,
       p.unit as dvt_nvl, bi.quantity as dinh_luong
from public.bom_items bi
join public.bom b on b.id = bi.bom_id
join public.products p on p.id = bi.material_id
order by b.code
limit 20;

-- ============================================================
-- HẾT — toàn bộ câu lệnh trên chỉ SELECT.
-- ============================================================
