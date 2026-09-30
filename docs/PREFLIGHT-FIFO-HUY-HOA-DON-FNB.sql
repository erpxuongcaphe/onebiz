-- ============================================================================
-- PREFLIGHT — đối xứng FIFO khi HUỶ HOÁ ĐƠN F&B. CHỈ ĐỌC, KHÔNG GHI GÌ.
-- Bôi đen toàn bộ → Run. Mã tenant OneBiz đã dán sẵn.
--
-- Nghi vấn cần chứng minh (chưa kết luận trước khi có số liệu):
--   1. fnb_void_invoice_atomic đang là bản 00165.
--   2. consume_bom_for_sale cấp phát lô với source_type = 'invoice'.
--   3. Hàm huỷ hoàn branch_stock/products theo movement bom_consume +
--      modifier_topping, NHƯNG không hoàn / không đối soát lại product_lots +
--      lot_allocations cho các sản phẩm đó.
--   4. _reconcile_product_lots_to_branch_00284 có tồn tại để dùng lại.
--   5. Phạm vi ảnh hưởng thực tế: bao nhiêu hoá đơn F&B, bao nhiêu movement.
-- ============================================================================

with t as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as id
),
ham as (
  select p.oid, p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_void_invoice_atomic','consume_bom_for_sale',
                      'allocate_lots_fifo','_reconcile_product_lots_to_branch_00284',
                      'create_sales_return_atomic','_create_sales_return_auth_impl_00244')
)

-- 1. Dấu vân tay bản hàm huỷ đang cài
select 1 as stt, '1. BẢN HÀM HUỶ ĐANG CÀI' as muc,
       'md5=' || md5(h.def)
    || ' | dài=' || length(h.def)::text
    || ' | có nhắc 00165=' || (h.def ~ '00165')::text as ket_qua
from ham h where h.proname = 'fnb_void_invoice_atomic'

union all
-- 2. Hàm huỷ lọc movement nào để hoàn kho
select 2, '2. HUỶ — lọc movement nào để hoàn',
       coalesce(substring(h.def from '(reference_type[^;]{0,250})'), 'không trích được')
from ham h where h.proname = 'fnb_void_invoice_atomic'

union all
-- 3. Hàm huỷ có đụng tới lô hay không (kỳ vọng: KHÔNG → đó là lỗ hổng)
select 3, '3. HUỶ — có xử lý lô không?',
       'product_lots=' || (h.def ~ 'product_lots')::text
    || ' | lot_allocations=' || (h.def ~ 'lot_allocations')::text
    || ' | reconcile_product_lots=' || (h.def ~ '_reconcile_product_lots_to_branch')::text
    || ' | allocate_lots_fifo=' || (h.def ~ 'allocate_lots_fifo')::text
from ham h where h.proname = 'fnb_void_invoice_atomic'

union all
-- 4. Trừ kho khi bán: cấp phát lô với source_type nào
select 4, '4. TRỪ KHO — đoạn gọi cấp phát lô',
       coalesce(substring(h.def from '(allocate_lots_fifo[^;]{0,250})'), 'KHÔNG GỌI allocate_lots_fifo')
from ham h where h.proname = 'consume_bom_for_sale'

union all
-- 5. Hàm đối soát lô có sẵn để dùng lại
select 5, '5. HÀM ĐỐI SOÁT LÔ',
       h.proname || ' — tồn tại, dài ' || length(h.def)::text || ' ký tự'
from ham h where h.proname = '_reconcile_product_lots_to_branch_00284'

union all
-- 6. Luồng TRẢ HÀNG đã bọc đúng chưa (không được sửa nhầm phần này)
select 6, '6. TRẢ HÀNG — đã gọi đối soát lô?',
       h.proname || ' → gọi _reconcile_product_lots_to_branch_00284: '
    || (h.def ~ '_reconcile_product_lots_to_branch_00284')::text
from ham h
where h.proname in ('create_sales_return_atomic','_create_sales_return_auth_impl_00244')

union all
-- 7. Phạm vi ảnh hưởng: hoá đơn F&B của tenant này
select 7, '7. PHẠM VI — hoá đơn F&B',
       'tổng hoá đơn nguồn fnb=' || count(*)::text
    || ' | đã huỷ=' || count(*) filter (where i.status = 'cancelled')::text
from public.invoices i cross join t
where i.tenant_id = t.id and i.source = 'fnb'

union all
-- 8. Phạm vi ảnh hưởng: movement theo loại tham chiếu
select 8, '8. PHẠM VI — movement theo loại',
       coalesce(string_agg(x.reference_type || '=' || x.so::text, ' | ' order by x.reference_type), 'KHÔNG CÓ')
from (
  select sm.reference_type, count(*) as so
  from public.stock_movements sm cross join t
  where sm.tenant_id = t.id
    and sm.reference_type in ('invoice','bom_consume','modifier_topping','invoice_void')
  group by sm.reference_type
) x

union all
-- 9. Phạm vi ảnh hưởng: cấp phát lô theo nguồn
select 9, '9. PHẠM VI — cấp phát lô theo nguồn',
       coalesce(string_agg(y.source_type || '=' || y.so::text, ' | ' order by y.source_type), 'KHÔNG CÓ')
from (
  select la.source_type, count(*) as so
  from public.lot_allocations la cross join t
  where la.tenant_id = t.id
  group by la.source_type
) y

order by 1;
