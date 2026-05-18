-- ============================================================
-- 00103: Thêm `tax_code` cho customers (CEO 18/05/2026)
--
-- YÊU CẦU: KH doanh nghiệp mua hàng cần xuất hoá đơn VAT → cần lưu MST.
-- Hiện chỉ suppliers có tax_code. Khách hàng chưa có.
--
-- Bonus: bỏ regex chặn 10 chữ số ở Excel import (suppliers) — cho phép
-- nhập MST tự do (NCC nước ngoài, MST chi nhánh có dấu '-', v.v.)
-- ============================================================

alter table public.customers
  add column if not exists tax_code text;

comment on column public.customers.tax_code is
  'Mã số thuế (cho KH doanh nghiệp cần xuất hoá đơn VAT). Format tự do, không validate. CEO 18/05/2026.';

create index if not exists idx_customers_tax_code
  on public.customers(tenant_id, tax_code)
  where tax_code is not null;

notify pgrst, 'reload schema';
