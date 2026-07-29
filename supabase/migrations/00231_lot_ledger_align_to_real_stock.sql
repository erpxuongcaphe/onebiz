-- ============================================================
-- 00231 — Nắn sổ lô theo TỒN THẬT (CEO quyết 29/07)
-- ============================================================
-- BỐI CẢNH
-- Sau khi 00226 vá chỗ "mở lô khi nhập mà không đóng lô khi xuất", phần lô
-- GHI DƯ đã hết (0 ca). Còn lại chiều ngược lại: 71 ca hàng CÓ thật trong
-- kho nhưng KHÔNG có lô nào đứng tên — tổng 7.155,91 đơn vị, toàn bộ là
-- nguyên vật liệu ở Kho Tổng, không mã nào khai hạn sử dụng.
--
-- Đây là tồn nhập TRƯỚC khi hệ thống bắt đầu mở lô, nên không có gì để nắn
-- ngược — chỉ có thể ghi nhận nó thành một lô đầu kỳ.
--
-- CEO CHỌN: lấy tồn thật làm chuẩn.
--
-- LÀM GÌ
-- Với mỗi (mã hàng × chi nhánh) mà tồn thật > tổng lô: tạo MỘT lô bù đúng
-- phần chênh, đánh dấu rõ là tồn đầu kỳ chưa rõ nguồn:
--   lot_number  = 'DAUKY-<mã hàng>-<mã CN>'
--   source_type = 'opening'  (giá trị MỚI, nới ràng buộc ở bước 1)
--   expiry_date = NULL       (chưa rõ hạn — gắn sau bằng "Gắn HSD cho tồn cũ")
--
-- KHÔNG ĐỤNG TỒN THẬT: chỉ thêm dòng vào product_lots. products.stock và
-- branch_stock giữ nguyên tuyệt đối — sổ lô chạy theo tồn, không phải ngược lại.
--
-- CHẠY LẠI ĐƯỢC: lần hai thấy đã khớp nên không tạo thêm dòng nào.
--
-- BA ĐIỂM ĐÃ KIỂM VỚI ĐỊNH NGHĨA BẢNG THẬT (00006_foundation.sql:~250)
--  1. source_type bị khoá ở ('production','purchase') → phải NỚI trước khi
--     chèn 'opening', nếu không migration chết ngay dòng insert.
--  2. status KHÔNG có giá trị 'cancelled' — chỉ có active/expired/consumed/
--     disposed. Tổng lô phải lấy ('active','expired'): lô hết hạn vẫn nằm
--     trong kho cho tới khi tiêu huỷ, còn 'disposed' đã ra khỏi kho.
--  3. initial_qty/current_qty là numeric(15,2) → làm tròn 2 chữ số cho khớp,
--     tránh chênh lẻ sau khi Postgres tự cắt.
-- ============================================================

begin;

-- ── Bước 1: nới ràng buộc source_type để nhận 'opening' ──
alter table public.product_lots
  drop constraint if exists product_lots_source_type_check;

alter table public.product_lots
  add constraint product_lots_source_type_check
  check (source_type in ('production', 'purchase', 'opening'));

-- ── Bước 2: sao lưu trước khi đụng ──
drop table if exists public.product_lots_backup_00231;
create table public.product_lots_backup_00231 as
select * from public.product_lots;

-- ── Bước 3: tạo lô đầu kỳ cho phần hàng chưa có lô ──
with ton_that as (
  select bs.tenant_id, bs.product_id, bs.branch_id, bs.quantity::numeric as ton
  from public.branch_stock bs
  where bs.quantity > 0
),
theo_lo as (
  select pl.tenant_id, pl.product_id, pl.branch_id,
         sum(coalesce(pl.current_qty, 0))::numeric as lo
  from public.product_lots pl
  where pl.status in ('active', 'expired')
  group by pl.tenant_id, pl.product_id, pl.branch_id
),
can_bu as (
  select t.tenant_id, t.product_id, t.branch_id,
         round(t.ton - coalesce(l.lo, 0), 2) as thieu
  from ton_that t
  left join theo_lo l
    on l.tenant_id = t.tenant_id
   and l.product_id = t.product_id
   and l.branch_id = t.branch_id
  where round(t.ton - coalesce(l.lo, 0), 2) > 0
)
insert into public.product_lots (
  tenant_id, product_id, variant_id, lot_number, source_type,
  manufactured_date, expiry_date, received_date,
  initial_qty, current_qty, branch_id, status, note
)
select
  c.tenant_id,
  c.product_id,
  null,
  'DAUKY-' || coalesce(p.code, left(c.product_id::text, 8))
            || '-' || coalesce(b.code, left(c.branch_id::text, 6)),
  'opening',
  null,
  null,                        -- chưa rõ hạn dùng
  current_date,
  c.thieu,
  c.thieu,
  c.branch_id,
  'active',
  'Tồn đầu kỳ — hàng có trước khi hệ thống theo dõi lô. Chưa rõ hạn dùng, '
  || 'gắn sau bằng "Gắn HSD cho tồn cũ". Tạo bởi 00231.'
from can_bu c
left join public.products p on p.id = c.product_id
left join public.branches b on b.id = c.branch_id;

commit;

-- ============================================================
-- ĐỐI CHIẾU — chạy sau khi commit, cả 3 cột phải ra 0
-- ============================================================
-- with ton_that as (
--   select tenant_id, product_id, branch_id, quantity::numeric ton
--   from public.branch_stock where quantity > 0
-- ), theo_lo as (
--   select tenant_id, product_id, branch_id, sum(coalesce(current_qty,0))::numeric lo
--   from public.product_lots where status in ('active','expired')
--   group by tenant_id, product_id, branch_id
-- )
-- select
--   count(*) filter (where round(t.ton - coalesce(l.lo,0),2) > 0) as con_thieu_lo,
--   count(*) filter (where round(t.ton - coalesce(l.lo,0),2) < 0) as lo_ghi_du,
--   (select count(*) from public.branch_stock where quantity < 0) as ton_am
-- from ton_that t
-- left join theo_lo l on l.tenant_id=t.tenant_id
--                    and l.product_id=t.product_id
--                    and l.branch_id=t.branch_id;
--
-- Xem các lô vừa tạo:
-- select lot_number, current_qty, note from public.product_lots
--  where source_type = 'opening' order by current_qty desc;
--
-- HOÀN TÁC (nếu cần):
-- delete from public.product_lots where source_type = 'opening';
