-- ============================================================
-- 00224 — Vá 3 CỘT bị sót khi áp migration lên prod
-- ============================================================
-- PHÁT HIỆN 25/07/2026 bằng test đạn thật trên POS F&B:
--   gọi fnb_complete_payment_atomic → lỗi
--   'column "tip_amount" of relation "invoices" does not exist'
--   ⇒ MỌI lần thanh toán F&B đều chết ngay. Quán không bán được ly nào.
--
-- Quét đối chiếu 193 cột khai báo trong 225 file migration với schema prod
-- → đúng 3 cột vắng mặt, thuộc 2 file mà phần ALTER TABLE chưa từng chạy:
--   • 00035_fnb_tip_support.sql  → invoices.tip_amount
--   • 00015_vat_support.sql      → supplier_return_items.vat_rate / vat_amount
--
-- Vì sao lọt lưới trước đây: cách kiểm cũ chỉ liệt kê RPC qua OpenAPI spec.
-- Hai file này chủ yếu ALTER TABLE — hàm bên trong được các migration sau
-- (00100/00148/00166) tạo lại nên vẫn "có mặt", còn CỘT thì không ai kiểm.
-- Bài học: kiểm migration phải soi cả CỘT, không chỉ HÀM.
--
-- AN TOÀN: chỉ thêm cột có DEFAULT, không sửa/xoá dữ liệu.
--   invoices                = 210 dòng → tip_amount = 0
--   supplier_return_items   = 0 dòng   → không ảnh hưởng ai
-- Chạy lại nhiều lần vô hại (if not exists).
-- ============================================================

-- 1) Tiền tip F&B — bản gốc 00035
alter table public.invoices
  add column if not exists tip_amount numeric default 0 not null;

comment on column public.invoices.tip_amount is
  'Tiền tip khách cho nhân viên F&B. Tách khỏi subtotal/discount để báo cáo chia tip cuối ca.';

-- 2) Thuế khi trả hàng nhà cung cấp — bản gốc 00015
alter table public.supplier_return_items
  add column if not exists vat_rate numeric(5,2) not null default 0,
  add column if not exists vat_amount numeric(15,2) not null default 0;

-- ============================================================
-- VERIFY — chạy sau khi áp, cả 3 dòng phải ra 'CÓ'
-- ============================================================
-- select
--   case when exists (select 1 from information_schema.columns
--     where table_schema='public' and table_name='invoices' and column_name='tip_amount')
--   then 'CÓ' else 'THIẾU' end as invoices_tip_amount,
--   case when exists (select 1 from information_schema.columns
--     where table_schema='public' and table_name='supplier_return_items' and column_name='vat_rate')
--   then 'CÓ' else 'THIẾU' end as sri_vat_rate,
--   case when exists (select 1 from information_schema.columns
--     where table_schema='public' and table_name='supplier_return_items' and column_name='vat_amount')
--   then 'CÓ' else 'THIẾU' end as sri_vat_amount;
