-- ============================================================================
-- PREFLIGHT — chuỗi Size theo QUY CÁCH (variant). CHỈ ĐỌC.
--
-- Khác bản trước: KHÔNG dò từ khoá bằng LIKE. Kiểm chữ ký hàm bằng
-- to_regprocedure + pg_get_function_identity_arguments, và trích ĐÚNG đoạn gọi
-- bằng regexp để chứng minh tham số variant thật sự được truyền suốt chuỗi:
--
--   POS gửi variantId
--     → kitchen_order_items.variant_id
--     → consume_bom_for_sale(..., p_variant_id)
--     → get_active_bom_for_branch(product, branch, variant)
--     → restore_bom_for_return(..., p_variant_id) khi HUỶ HOÁ ĐƠN ĐÃ HOÀN THÀNH / TRẢ HÀNG
--
-- Huỷ đơn CHƯA thanh toán không trừ kho nên KHÔNG yêu cầu hoàn kho — kiểm riêng.
--
-- ⚠️ DÁN MÃ TENANT VÀO DÒNG DƯỚI TRƯỚC KHI CHẠY. Chưa dán thì script tự dừng.
-- ============================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_tenant uuid;
begin
  -- ↓↓↓ DÁN MÃ TENANT ONEBIZ VÀO ĐÂY ↓↓↓
  v_tenant := nullif('PASTE_TENANT_ID_HERE', 'PASTE_TENANT_ID_HERE')::uuid;
  -- ↑↑↑ ------------------------------ ↑↑↑

  if v_tenant is null then
    raise exception 'CHUA DAN MA TENANT: mo tep, thay PASTE_TENANT_ID_HERE bang ma tenant OneBiz roi chay lai';
  end if;
  if not exists (select 1 from public.tenants t where t.id = v_tenant) then
    raise exception 'MA TENANT KHONG TON TAI: %', v_tenant;
  end if;
  raise notice 'Tenant hop le, tiep tuc doc du lieu.';
end $$;

-- ── PHẦN 1: CHỮ KÝ HÀM (không phụ thuộc tenant) ─────────────────────────────
select * from (

  -- A. Chữ ký THẬT của từng hàm trong chuỗi
  select 1 as stt, 'A. CHỮ KÝ THẬT' as muc,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as ket_qua
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_send_to_kitchen_atomic_v2','_fnb_complete_payment_impl_00230',
                      'consume_bom_for_sale','get_active_bom_for_branch',
                      'restore_bom_for_return','fnb_void_invoice_atomic',
                      'fnb_cancel_unpaid_order_atomic')

  union all
  -- B. Chữ ký KỲ VỌNG có tồn tại đúng như vậy không (to_regprocedure = null là KHÔNG có)
  select 2, 'B. KHỚP CHỮ KÝ KỲ VỌNG',
         'get_active_bom_for_branch(uuid,uuid,uuid) = '
         || coalesce(to_regprocedure('public.get_active_bom_for_branch(uuid,uuid,uuid)')::text, 'KHÔNG CÓ')

  union all
  select 2, 'B. KHỚP CHỮ KÝ KỲ VỌNG',
         'consume_bom_for_sale có tham số p_variant_id = '
         || (pg_get_function_identity_arguments(
               (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='consume_bom_for_sale' limit 1)
             ) ~ 'p_variant_id')::text

  union all
  select 2, 'B. KHỚP CHỮ KÝ KỲ VỌNG',
         'restore_bom_for_return có tham số p_variant_id = '
         || (pg_get_function_identity_arguments(
               (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='restore_bom_for_return' limit 1)
             ) ~ 'p_variant_id')::text

  union all
  -- C. Trích ĐÚNG đoạn gọi consume_bom_for_sale trong hàm thanh toán (không dò từ khoá)
  select 3, 'C. THANH TOÁN GỌI TRỪ KHO',
         coalesce(
           (select substring(pg_get_functiondef(p.oid)
                   from 'consume_bom_for_sale\s*\(([^;]{0,400})')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname='public' and p.proname='_fnb_complete_payment_impl_00230'),
           'KHÔNG THẤY LỜI GỌI')

  union all
  -- D. Đoạn ghi variant_id vào dòng đơn bếp, trong hàm gửi bếp
  select 4, 'D. GỬI BẾP GHI variant_id',
         coalesce(
           (select substring(pg_get_functiondef(p.oid)
                   from '(variant_id[^;]{0,200})')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname='public' and p.proname='fnb_send_to_kitchen_atomic_v2'),
           'KHÔNG THẤY')

  union all
  -- E1. HUỶ HOÁ ĐƠN ĐÃ HOÀN THÀNH / TRẢ HÀNG → phải truyền variant_id vào restore
  select 5, 'E1. HUỶ HĐ ĐÃ HOÀN THÀNH → hoàn kho',
         p.proname || ' | đoạn gọi restore: ' ||
         coalesce(substring(pg_get_functiondef(p.oid) from 'restore_bom_for_return\s*\(([^;]{0,300})'),
                  'KHÔNG GỌI restore_bom_for_return')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname = 'fnb_void_invoice_atomic'

  union all
  -- E2. HUỶ ĐƠN CHƯA THANH TOÁN → chưa trừ kho nên KHÔNG cần hoàn kho (chỉ ghi nhận)
  select 6, 'E2. HUỶ ĐƠN CHƯA THANH TOÁN (không cần hoàn kho)',
         p.proname || ' | có gọi restore_bom_for_return = '
         || (pg_get_functiondef(p.oid) ~ 'restore_bom_for_return')::text
         || ' — kỳ vọng false vì chưa trừ kho'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname = 'fnb_cancel_unpaid_order_atomic'

  union all
  -- F. Hàm chọn BOM có cho variant thiếu bom_code kế thừa BOM món cha không?
  select 7, 'F. KẾ THỪA BOM CHA (23 món Size KHÔNG được phép)',
         coalesce(
           (select substring(pg_get_functiondef(p.oid) from '(variant_id is null[^;]{0,300})')
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='get_active_bom_for_branch'),
           'không thấy nhánh variant_id is null — đọc thêm mục A')

) t order by stt, ket_qua;

-- ── PHẦN 2: DỮ LIỆU — KHOÁ ĐÚNG TENANT ─────────────────────────────────────
-- Dán lại mã tenant vào cả 3 chỗ :tenant bên dưới (thay chuỗi trong ngoặc nháy).
with t as (select 'PASTE_TENANT_ID_HERE'::uuid as id)
select * from (

  select 8 as stt, 'G. QUY CÁCH CỦA TENANT NÀY' as muc,
         'tổng=' || count(*)::text
      || ' | đang bật=' || count(*) filter (where pv.is_active)::text
      || ' | giá > 0=' || count(*) filter (where coalesce(pv.sell_price,0) > 0)::text
      || ' | có mã công thức=' || count(pv.bom_code)::text
      || ' | đánh dấu mặc định=' || count(*) filter (where pv.is_default)::text as ket_qua
  from public.product_variants pv, t
  where pv.tenant_id = t.id

  union all
  select 9, 'H. MÓN CÓ NHIỀU HƠN MỘT MẶC ĐỊNH (phải rỗng)',
         coalesce((select string_agg(p.code, ', ')
                   from (select pv.product_id from public.product_variants pv, t
                         where pv.tenant_id = t.id and pv.is_default and pv.is_active
                         group by pv.product_id having count(*) > 1) x
                   join public.products p on p.id = x.product_id),
                  'KHÔNG CÓ — an toàn')

  union all
  select 10, 'I. QUY CÁCH THIẾU ĐIỀU KIỆN (giá 0 hoặc chưa có công thức)',
         coalesce((select string_agg(p.code || '/' || pv.name, ', ')
                   from public.product_variants pv, t
                   join public.products p on p.id = pv.product_id
                   where pv.tenant_id = t.id and pv.is_active
                     and (coalesce(pv.sell_price,0) <= 0 or pv.bom_code is null)),
                  'KHÔNG CÓ')

) u order by stt, ket_qua;
