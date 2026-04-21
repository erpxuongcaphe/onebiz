-- ============================================================
-- 00031 — Inventory check variance: GENERATED column cho `difference`
-- ============================================================
--
-- Lý do:
--   Trước đây `inventory_check_items.difference` là cột numeric thường — client
--   gửi giá trị này khi tạo/sửa row. User độc ác có thể sửa devtools:
--     actual=5, system=5, difference=1000 → apply gây nhập kho ảo 995 đơn vị.
--
--   applyInventoryCheck() trong inventory.ts đã recompute client-side (commit
--   trước), nhưng đó vẫn là client code. Defense-in-depth: DB cũng recompute.
--
-- Giải pháp:
--   Chuyển `difference` thành GENERATED ALWAYS AS (actual_stock - system_stock)
--   STORED — DB tự tính, client KHÔNG thể ghi đè. Chèn sai bị Postgres reject.
--
-- Compat:
--   - Cột hiện tại có default 0. DROP trước, ADD lại generated.
--   - Dữ liệu cũ có thể có difference ≠ actual-system (do bug cũ). Sau migration
--     tự động chính xác hoá (STORED recompute tất cả row).
-- ============================================================

-- Bỏ cột difference cũ (dữ liệu sẽ được tính lại từ actual-system)
alter table public.inventory_check_items
  drop column if exists difference;

-- Thêm lại như generated column
alter table public.inventory_check_items
  add column difference numeric(15,2)
    generated always as (actual_stock - system_stock) stored;

comment on column public.inventory_check_items.difference is
  'Chênh lệch = actual_stock - system_stock. GENERATED — DB tự tính, client không thể ghi.';
