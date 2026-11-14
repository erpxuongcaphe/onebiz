-- ============================================================================
-- PREFLIGHT BỔ SUNG — 3 mục chưa kết luận được ở lần chạy trước. CHỈ ĐỌC.
-- Bôi đen toàn bộ → Run. Không ghi gì.
--
-- Vì sao cần: lần trước regex trích quá hẹp nên
--   D  chỉ ra "variant_id uuid" (khai báo biến), chưa chứng minh GHI vào bảng;
--   E1 báo void không gọi restore_bom_for_return → PHẢI xem nó hoàn kho bằng
--      cách nào khác, không được kết luận là lỗi;
--   F2 không trích được đoạn rơi về công thức món cha.
-- ============================================================================

with ham as (
  select p.oid, p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_send_to_kitchen_atomic_v2','fnb_void_invoice_atomic',
                      'get_active_bom_for_branch')
)

-- D2. Gửi bếp: trích đoạn INSERT vào kitchen_order_items để thấy variant_id được GHI
select 1 as stt, 'D2. GỬI BẾP — đoạn insert dòng đơn' as muc,
       coalesce(substring(h.def from 'insert into public\.kitchen_order_items[\s\S]{0,250}'),
                '❌ không trích được') as ket_qua
from ham h where h.proname = 'fnb_send_to_kitchen_atomic_v2'

union all
-- D3. Gửi bếp: các chỗ nhắc variant_id (đếm) để biết có dùng thật không
select 2, 'D3. GỬI BẾP — số lần nhắc variant_id',
       (select count(*)::text from regexp_matches(h.def, 'variant_id', 'g'))
from ham h where h.proname = 'fnb_send_to_kitchen_atomic_v2'

union all
-- E1b. Huỷ hoá đơn: nó hoàn kho bằng CÁCH NÀO (liệt kê mọi hàm nó gọi)
select 3, 'E1b. HUỶ HĐ — các hàm nó gọi',
       coalesce((select string_agg(distinct m[1], ', ')
                 from regexp_matches(h.def, 'public\.([a-z_0-9]+)\s*\(', 'g') as m),
                '❌ không trích được')
from ham h where h.proname = 'fnb_void_invoice_atomic'

union all
-- E1c. Huỷ hoá đơn: có đụng tồn kho trực tiếp không
select 4, 'E1c. HUỶ HĐ — có ghi thẳng tồn kho?',
       'branch_stock=' || (h.def ~ 'branch_stock')::text
    || ' | stock_movements=' || (h.def ~ 'stock_movements')::text
    || ' | products.stock=' || (h.def ~ 'products[\s\S]{0,40}stock')::text
from ham h where h.proname = 'fnb_void_invoice_atomic'

union all
-- F2b. Chọn công thức: TOÀN BỘ thân hàm (hàm ngắn) để đọc tay nhánh fallback
select 5, 'F2b. CHỌN BOM — toàn bộ thân hàm',
       substring(h.def from 1 for 2000)
from ham h where h.proname = 'get_active_bom_for_branch'

order by 1;
