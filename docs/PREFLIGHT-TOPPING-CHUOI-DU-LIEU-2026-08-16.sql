-- ============================================================================
-- PREFLIGHT — chuỗi dữ liệu topping trên PRODUCTION. CHỈ ĐỌC.
--
-- Mục đích: chứng minh (hoặc bác bỏ) từng mắt xích, KHÔNG suy từ một đầu.
--   client productId
--     → fnb_send_to_kitchen_atomic_v2 xác minh sản phẩm
--     → snapshot kitchen_order_items.toppings ghi CẢ productId + product_id
--     → hàm thanh toán đọc product_id
--     → 00304 lấy giá từ máy chủ
--
-- Chỉ được kết luận "còn lỗi" khi một mắt xích THẬT SỰ thiếu.
-- Không tạo đơn thử, không ghi gì.
-- ============================================================================

select * from (

  -- A. Bản RPC gửi bếp đang cài trên production có ghi HAI khoá không?
  select 1 as stt, 'A. GỬI BẾP ghi 2 khoá?' as muc,
         'productId=' || (pg_get_functiondef(p.oid) like '%''productId''%')::text
      || ' | product_id=' || (pg_get_functiondef(p.oid) like '%''product_id''%')::text
      || ' | linkedProductId=' || (pg_get_functiondef(p.oid) like '%linkedProductId%')::text
      || ' | dài ' || length(pg_get_functiondef(p.oid))::text || ' ký tự'
         as ket_qua
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fnb_send_to_kitchen_atomic_v2'

  union all
  -- B. Hàm thanh toán đang cài đọc topping bằng khoá nào?
  select 2, 'B. THANH TOÁN đọc khoá nào',
         p.proname
      || ' | đọc product_id=' || (pg_get_functiondef(p.oid) like '%t->>''product_id''%')::text
      || ' | đọc productId=' || (pg_get_functiondef(p.oid) like '%t->>''productId''%')::text
      || ' | có nhánh trừ kho topping=' || (pg_get_functiondef(p.oid) like '%v_topping_product_id%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_complete_payment_atomic','fnb_complete_payment_atomic_v2',
                      '_fnb_complete_payment_impl_00230')

  union all
  -- C. 00304 — giá topping lấy từ máy chủ hay tin client?
  select 3, 'C. GIÁ TOPPING lấy ở đâu',
         p.proname
      || ' | tra bảng modifier_options=' || (pg_get_functiondef(p.oid) like '%modifier_options%')::text
      || ' | dùng price_delta=' || (pg_get_functiondef(p.oid) like '%price_delta%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_send_to_kitchen_atomic_v2','fnb_complete_payment_atomic',
                      '_fnb_complete_payment_impl_00230')

  union all
  -- D. Hàm thanh toán nào đang được gọi thật (bản mới nhất theo oid)
  select 4, 'D. CÁC BẢN HÀM THANH TOÁN',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'fnb_complete_payment%'

  union all
  -- E. Dữ liệu topping đã có: lựa chọn nào nối tới sản phẩm kho
  select 5, 'E. LỰA CHỌN NỐI SẢN PHẨM',
         'tổng lựa chọn=' || count(*)::text
      || ' | có linked_product_id=' || count(mo.linked_product_id)::text
      || ' | có phụ thu (price_delta<>0)=' || count(*) filter (where coalesce(mo.price_delta,0) <> 0)::text
  from public.modifier_options mo

  union all
  -- F. Snapshot topping đã ghi trong thực tế (nếu có đơn nào)
  select 6, 'F. SNAPSHOT ĐÃ GHI',
         'số dòng đơn bếp có topping=' || count(*)::text
  from public.kitchen_order_items koi
  where koi.toppings is not null and jsonb_array_length(koi.toppings) > 0

) t order by stt, ket_qua;
