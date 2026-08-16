-- ============================================================================
-- PREFLIGHT — chuỗi Size theo QUY CÁCH (variant) trên PRODUCTION. CHỈ ĐỌC.
--
-- Đọc định nghĩa hàm ĐANG CÀI (pg_get_functiondef), không đọc file trong repo,
-- không tin test mã nguồn. Mục tiêu: chứng minh từng mắt xích trước khi cho
-- nhân viên nhập quy cách hàng loạt.
--
--   POS gửi variantId
--     → gửi bếp chốt variant_id + giá của variant
--     → thanh toán chọn ĐÚNG công thức của variant theo chi nhánh
--     → huỷ/trả hoàn ĐÚNG nguyên liệu của variant
-- ============================================================================

select * from (

  -- A. Gửi bếp: có nhận và chốt variant_id + lấy giá của variant không?
  select 1 as stt, 'A. GỬI BẾP chốt variant' as muc,
         'nhận variantId=' || (pg_get_functiondef(p.oid) like '%variantId%')::text
      || ' | ghi variant_id=' || (pg_get_functiondef(p.oid) like '%variant_id%')::text
      || ' | tra bảng product_variants=' || (pg_get_functiondef(p.oid) like '%product_variants%')::text
      || ' | lấy sell_price của variant=' || (pg_get_functiondef(p.oid) like '%pv.sell_price%')::text
         as ket_qua
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fnb_send_to_kitchen_atomic_v2'

  union all
  -- B. GUARD: máy chủ có BẮT BUỘC variantId khi món đang có quy cách bật không?
  select 2, 'B. GUARD bắt buộc variant',
         'có chặn thiếu variant=' || (pg_get_functiondef(p.oid) ilike '%quy cách%'
                                   or pg_get_functiondef(p.oid) ilike '%variant%required%'
                                   or pg_get_functiondef(p.oid) ilike '%chưa chọn%')::text
      || ' | có chặn giá 0=' || (pg_get_functiondef(p.oid) ilike '%sell_price <= 0%'
                              or pg_get_functiondef(p.oid) ilike '%sell_price = 0%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fnb_send_to_kitchen_atomic_v2'

  union all
  -- C. Thanh toán: chọn công thức theo variant + theo chi nhánh
  select 3, 'C. THANH TOÁN chọn BOM theo variant',
         p.proname
      || ' | truyền variant_id vào consume_bom=' || (pg_get_functiondef(p.oid) like '%consume_bom_for_sale%'
                                                  and pg_get_functiondef(p.oid) like '%variant_id%')::text
      || ' | có gọi get_active_bom_for_branch=' || (pg_get_functiondef(p.oid) like '%get_active_bom_for_branch%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_fnb_complete_payment_impl_00230'

  union all
  -- D. Hàm chọn công thức: ưu tiên variant, lọc theo chi nhánh
  select 4, 'D. CHỌN BOM',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || ' | lọc branch_id=' || (pg_get_functiondef(p.oid) like '%branch_id%')::text
      || ' | ưu tiên variant_id=' || (pg_get_functiondef(p.oid) like '%variant_id%')::text
      || ' | chỉ lấy BOM đang bật=' || (pg_get_functiondef(p.oid) like '%is_active%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('get_active_bom_for_branch','consume_bom_for_sale')

  union all
  -- E. Huỷ / trả: hoàn đúng nguyên liệu của variant
  select 5, 'E. HOÀN KHO theo variant',
         p.proname
      || ' | nhận variant_id=' || (pg_get_functiondef(p.oid) like '%variant_id%')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('restore_bom_for_return','fnb_void_invoice_atomic',
                                               'fnb_cancel_unpaid_order_atomic')

  union all
  -- F. Dữ liệu quy cách hiện có (để biết đang ở đâu)
  select 6, 'F. QUY CÁCH HIỆN CÓ',
         'tổng=' || count(*)::text
      || ' | đang bật=' || count(*) filter (where pv.is_active)::text
      || ' | có giá > 0=' || count(*) filter (where coalesce(pv.sell_price,0) > 0)::text
      || ' | có mã BOM=' || count(pv.bom_code)::text
      || ' | đánh dấu mặc định=' || count(*) filter (where pv.is_default)::text
  from public.product_variants pv

  union all
  -- G. Món nào có NHIỀU HƠN MỘT quy cách mặc định (phải là duy nhất)
  select 7, 'G. TRÙNG MẶC ĐỊNH',
         coalesce((select string_agg(x.product_id::text, ', ')
                   from (select pv.product_id from public.product_variants pv
                         where pv.is_default and pv.is_active
                         group by pv.product_id having count(*) > 1) x),
                  'KHÔNG CÓ — an toàn')

) t order by stt, ket_qua;
