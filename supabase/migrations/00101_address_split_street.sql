-- ============================================================
-- 00101: Tách "tên đường" khỏi "số nhà" trong địa chỉ KH + NCC
-- (CEO 18/05/2026)
--
-- Migration 00089 đã tách 5 cột (house_number / quarter / ward / province /
-- country). Tuy nhiên `house_number` đang gộp "số nhà + tên đường"
-- (vd "123 Lê Lợi") → khó filter / sort theo đường.
--
-- Sprint này thêm cột mới:
--   - `street` (tên đường — vd "Lê Lợi", "Nguyễn Văn Cừ")
--
-- Cột `house_number` giữ nguyên nhưng nay chỉ chứa SỐ NHÀ (vd "123", "45/2A").
-- ============================================================

-- 1. customers — thêm cột street
alter table public.customers
  add column if not exists street text;

comment on column public.customers.street is
  'Tên đường (vd "Lê Lợi", "Nguyễn Văn Cừ"). Tách khỏi house_number. CEO 18/05/2026.';

comment on column public.customers.house_number is
  'CHỈ số nhà (vd "123", "45/2A"). Tên đường lưu ở cột `street`. CEO 18/05/2026.';

-- 2. suppliers — thêm cột street
alter table public.suppliers
  add column if not exists street text;

comment on column public.suppliers.street is
  'Tên đường (vd "Lê Lợi", "Nguyễn Văn Cừ"). Tách khỏi house_number. CEO 18/05/2026.';

comment on column public.suppliers.house_number is
  'CHỈ số nhà (vd "123", "45/2A"). Tên đường lưu ở cột `street`. CEO 18/05/2026.';

notify pgrst, 'reload schema';
