-- ============================================================================
-- PREFLIGHT — chuỗi Size theo QUY CÁCH (variant). CHỈ ĐỌC, KHÔNG GHI GÌ.
--
-- CÁCH CHẠY (Supabase SQL Editor):
--   Mã tenant OneBiz ĐÃ DÁN SẴN ở CTE đầu tiên — chỉ cần bôi đen toàn bộ tệp
--   rồi bấm Run. (Muốn chạy cho tenant khác thì thay mã ở dòng đó.)
--
--   Toàn bộ tệp là MỘT câu SELECT duy nhất nên SQL Editor hiện đủ kết quả.
--   Không dùng lệnh psql (\set), không transaction, không set_config.
--   Nếu ai đó xoá mã tenant, Postgres báo lỗi ép kiểu uuid và dừng — đó là
--   chủ đích, tránh chạy nhầm trên toàn database.
--
-- Chuỗi cần chứng minh:
--   POS gửi variantId
--     → kitchen_order_items.variant_id
--     → consume_bom_for_sale(..., p_variant_id)
--     → get_active_bom_for_branch(product, branch, variant)
--     → khi HUỶ HOÁ ĐƠN ĐÃ HOÀN THÀNH: fnb_void_invoice_atomic → restore_bom_for_return(..., p_variant_id)
--     → khi TRẢ HÀNG: create_sales_return_atomic (lớp bọc)
--                      → _create_sales_return_auth_impl_00244 → restore_bom_for_return(..., p_variant_id)
--   Huỷ đơn CHƯA thanh toán: chưa trừ kho nên KHÔNG cần hoàn kho — kiểm riêng, kỳ vọng false.
-- ============================================================================

with t as (
  -- Mã tenant OneBiz (đổi chỗ này nếu cần chạy cho tenant khác)
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as id
),
ham as (
  -- Liệt kê MỌI bản (kể cả trùng tên khác tham số) — không dùng limit 1
  select p.oid, p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_send_to_kitchen_atomic_v2','_fnb_complete_payment_impl_00230',
                      'consume_bom_for_sale','get_active_bom_for_branch',
                      'restore_bom_for_return','fnb_void_invoice_atomic',
                      'fnb_cancel_unpaid_order_atomic',
                      'create_sales_return_atomic','_create_sales_return_auth_impl_00244')
)

-- ── 0. Tenant có hợp lệ không ────────────────────────────────────────────────
select 0 as stt, '0. TENANT' as muc,
       case when exists (select 1 from public.tenants x, t where x.id = t.id)
            then 'Hợp lệ: ' || (select id::text from t)
            else '❌ MÃ TENANT KHÔNG TỒN TẠI — dừng lại, dán đúng mã rồi chạy lại'
       end as ket_qua
from t

-- ── A. Chữ ký thật của MỌI bản hàm trong chuỗi ──────────────────────────────
union all
select 1, 'A. CHỮ KÝ THẬT (mọi bản)',
       h.proname || '(' || h.args || ')'
    || case when h.args ~ 'p_variant_id' then '  ✔ có p_variant_id' else '' end
from ham h

-- ── B. Chữ ký kỳ vọng có tồn tại đúng như vậy không (to_regprocedure) ───────
union all
select 2, 'B. KHỚP CHỮ KÝ KỲ VỌNG', x.ket_qua
from (
  select 'get_active_bom_for_branch(uuid,uuid,uuid) → '
      || coalesce(to_regprocedure('public.get_active_bom_for_branch(uuid,uuid,uuid)')::text,
                  '❌ KHÔNG CÓ') as ket_qua
  union all
  select 'consume_bom_for_sale — số bản có p_variant_id: '
      || (select count(*)::text from ham where proname='consume_bom_for_sale' and args ~ 'p_variant_id')
      || ' / tổng ' || (select count(*)::text from ham where proname='consume_bom_for_sale')
  union all
  select 'restore_bom_for_return — số bản có p_variant_id: '
      || (select count(*)::text from ham where proname='restore_bom_for_return' and args ~ 'p_variant_id')
      || ' / tổng ' || (select count(*)::text from ham where proname='restore_bom_for_return')
  union all
  select 'create_sales_return_atomic tồn tại: '
      || (select count(*)::text from ham where proname='create_sales_return_atomic') || ' bản'
  union all
  select '_create_sales_return_auth_impl_00244 tồn tại: '
      || (select count(*)::text from ham where proname='_create_sales_return_auth_impl_00244') || ' bản'
) x

-- ── C. Thanh toán gọi trừ kho: trích ĐÚNG đoạn gọi ─────────────────────────
union all
select 3, 'C. THANH TOÁN → consume_bom_for_sale',
       coalesce(substring(h.def from 'consume_bom_for_sale\s*\(([^;]{0,250})'),
                '❌ KHÔNG THẤY LỜI GỌI')
from ham h where h.proname = '_fnb_complete_payment_impl_00230'

-- ── D. Gửi bếp ghi variant_id vào dòng đơn ─────────────────────────────────
union all
select 4, 'D. GỬI BẾP ghi variant_id',
       coalesce(substring(h.def from '(variant_id[^;]{0,200})'), '❌ KHÔNG THẤY')
from ham h where h.proname = 'fnb_send_to_kitchen_atomic_v2'

-- ── E1. Huỷ HOÁ ĐƠN ĐÃ HOÀN THÀNH → phải hoàn kho theo variant ─────────────
union all
select 5, 'E1. HUỶ HĐ ĐÃ HOÀN THÀNH → restore',
       h.proname || ' → ' ||
       coalesce(substring(h.def from 'restore_bom_for_return\s*\(([^;]{0,250})'),
                '❌ KHÔNG GỌI restore_bom_for_return')
from ham h where h.proname = 'fnb_void_invoice_atomic'

-- ── E2. TRẢ HÀNG: lớp bọc phải gọi impl 00244 ─────────────────────────────
union all
select 6, 'E2. TRẢ HÀNG — lớp bọc gọi impl',
       h.proname || ' → gọi _create_sales_return_auth_impl_00244: '
    || (h.def ~ '_create_sales_return_auth_impl_00244')::text
from ham h where h.proname = 'create_sales_return_atomic'

-- ── E3. TRẢ HÀNG: trong impl, restore có truyền variant_id không ──────────
union all
select 7, 'E3. TRẢ HÀNG — impl truyền variant',
       h.proname || ' → ' ||
       coalesce(substring(h.def from 'restore_bom_for_return\s*\(([^;]{0,250})'),
                '❌ KHÔNG GỌI restore_bom_for_return')
from ham h where h.proname = '_create_sales_return_auth_impl_00244'

-- ── E4. Huỷ đơn CHƯA thanh toán: kỳ vọng KHÔNG hoàn kho ───────────────────
union all
select 8, 'E4. HUỶ ĐƠN CHƯA THANH TOÁN (kỳ vọng false)',
       h.proname || ' → có gọi restore_bom_for_return: '
    || (h.def ~ 'restore_bom_for_return')::text
    || '  (chưa trừ kho nên không cần hoàn)'
from ham h where h.proname = 'fnb_cancel_unpaid_order_atomic'

-- ── F. Chọn BOM: nhánh theo variant VÀ đoạn rơi về BOM món cha ────────────
union all
select 9, 'F1. CHỌN BOM — nhánh theo variant',
       coalesce(substring(h.def from '(p_variant_id is not null[^;]{0,250})'),
                '❌ không thấy nhánh p_variant_id is not null')
from ham h where h.proname = 'get_active_bom_for_branch'

union all
select 10, 'F2. CHỌN BOM — đoạn rơi về BOM món cha (23 món Size KHÔNG được phép)',
       coalesce(substring(h.def from '(variant_id is null[^;]{0,250})'),
                coalesce(substring(h.def from '(b\.product_id = p_product_id[^;]{0,250})'),
                         '❌ không trích được — xem chữ ký ở mục A rồi đọc tay'))
from ham h where h.proname = 'get_active_bom_for_branch'

-- ── G. Dữ liệu quy cách — khoá đúng tenant ────────────────────────────────
union all
select 11, 'G. QUY CÁCH CỦA TENANT NÀY',
       'tổng=' || count(*)::text
    || ' | đang bật=' || count(*) filter (where pv.is_active)::text
    || ' | giá > 0=' || count(*) filter (where coalesce(pv.sell_price,0) > 0)::text
    || ' | có mã công thức=' || count(pv.bom_code)::text
    || ' | đánh dấu mặc định=' || count(*) filter (where pv.is_default)::text
from public.product_variants pv
cross join t
where pv.tenant_id = t.id

-- ── H. Món có nhiều hơn một mặc định (phải rỗng) ─────────────────────────
union all
select 12, 'H. TRÙNG MẶC ĐỊNH (phải rỗng)',
       coalesce(
         (select string_agg(p2.code, ', ')
          from (select pv.product_id
                from public.product_variants pv
                cross join t
                where pv.tenant_id = t.id and pv.is_default and pv.is_active
                group by pv.product_id
                having count(*) > 1) x
          join public.products p2 on p2.id = x.product_id),
         'KHÔNG CÓ — an toàn')

-- ── I. Quy cách thiếu điều kiện (JOIN đúng theo yêu cầu) ─────────────────
union all
select 13, 'I. QUY CÁCH THIẾU GIÁ HOẶC THIẾU CÔNG THỨC',
       coalesce(string_agg(p.code || '/' || pv.name, ', '), 'KHÔNG CÓ')
from public.product_variants pv
join public.products p
  on p.id = pv.product_id
 and p.tenant_id = pv.tenant_id
cross join t
where pv.tenant_id = t.id
  and pv.is_active
  and (coalesce(pv.sell_price, 0) <= 0 or pv.bom_code is null)

order by 1, 3;
