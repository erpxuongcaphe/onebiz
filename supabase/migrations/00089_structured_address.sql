-- ============================================================
-- 00089: Tách địa chỉ structured cho customers + suppliers (CEO 17/05/2026)
--
-- YÊU CẦU: Tách trường `address` text đơn thành 5 component:
--   - house_number — Số nhà + tên đường
--   - quarter      — Khu phố
--   - ward         — Phường/Xã
--   - province     — Tỉnh/Thành phố (34 tỉnh sau sáp nhập 2025)
--   - country      — Quốc gia (default 'Việt Nam')
--
-- BACKWARD COMPAT (CEO yêu cầu "đừng ảnh hưởng data"):
--   - Giữ NGUYÊN cột `address` text — KHÔNG drop
--   - 5 cột mới default NULL
--   - Khi user save form mới → service auto-compose `address` từ 5 fields
--     để list view + báo cáo cũ vẫn xem được
--   - KHÔNG parse `address` cũ → user tự cập nhật khi mở edit
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. customers — thêm 5 cột
-- ────────────────────────────────────────────────────────────────
alter table public.customers
  add column if not exists house_number text,
  add column if not exists quarter text,
  add column if not exists ward text,
  add column if not exists province text,
  add column if not exists country text;

comment on column public.customers.house_number is
  'Số nhà + tên đường (vd "123 Lê Lợi"). Phần cụ thể nhất của địa chỉ. CEO 17/05/2026.';
comment on column public.customers.quarter is
  'Khu phố / Tổ dân phố (vd "Khu phố 5"). Optional.';
comment on column public.customers.ward is
  'Phường / Xã (vd "Phường Bến Nghé"). Dùng cho filter địa lý cấp xã.';
comment on column public.customers.province is
  'Tỉnh / Thành phố (vd "TP. Hồ Chí Minh"). Có 34 giá trị theo VN sau sáp nhập 2025. Hardcoded ở client.';
comment on column public.customers.country is
  'Quốc gia. Default "Việt Nam" khi tạo mới qua UI.';

-- Index province để filter nhanh
create index if not exists idx_customers_province
  on public.customers(tenant_id, province)
  where province is not null;

-- ────────────────────────────────────────────────────────────────
-- 2. suppliers — thêm 5 cột (cùng cấu trúc)
-- ────────────────────────────────────────────────────────────────
alter table public.suppliers
  add column if not exists house_number text,
  add column if not exists quarter text,
  add column if not exists ward text,
  add column if not exists province text,
  add column if not exists country text;

comment on column public.suppliers.house_number is
  'Số nhà + tên đường (vd "123 Lê Lợi"). CEO 17/05/2026.';
comment on column public.suppliers.quarter is
  'Khu phố / Tổ dân phố.';
comment on column public.suppliers.ward is
  'Phường / Xã.';
comment on column public.suppliers.province is
  'Tỉnh / Thành phố (34 giá trị VN sau sáp nhập 2025).';
comment on column public.suppliers.country is
  'Quốc gia. Default "Việt Nam".';

create index if not exists idx_suppliers_province
  on public.suppliers(tenant_id, province)
  where province is not null;

notify pgrst, 'reload schema';
