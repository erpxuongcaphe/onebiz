-- ============================================================================
-- PREFLIGHT 00331 — CHỈ ĐỌC, chạy TRƯỚC khi chạy migration 00331
-- Một câu SELECT duy nhất (SQL Editor chỉ hiện kết quả câu cuối).
-- Không cần dán tenant — toàn bộ là kiểm tra cấp schema + đếm tổng.
--
-- ĐẠT khi:  cot_source_order_id = 'CHUA CO — dung, se them'
--           rpc_tao_don_con     = 'CHUA CO — dung, se tao'
--           ham_next_code       = 'CO'
--           bo_dem_NH           = 'CO' (>= 1 dong)
-- ============================================================================
with
kiem_cot as (
  select case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
      and column_name = 'source_order_id'
  ) then 'DA CO SAN — dung lai, bao em' else 'CHUA CO — dung, se them' end as kq
),
kiem_rpc as (
  select case when to_regprocedure('public.create_child_sale_from_order(uuid)') is not null
    then 'DA CO SAN — dung lai, bao em' else 'CHUA CO — dung, se tao' end as kq
),
kiem_next_code as (
  select case when to_regprocedure('public.next_code(uuid,text)') is not null
    then 'CO' else 'THIEU — DUNG LAI, bao em' end as kq
),
kiem_bo_dem as (
  select case when exists (
    select 1 from public.code_sequences where entity_type = 'pos_draft' and prefix = 'NH'
  ) then 'CO' else 'THIEU bo dem NH — DUNG LAI, bao em' end as kq
),
dem as (
  select
    (select count(*) from public.invoices where source = 'order' and deleted_at is null)  as tong_don_dat_hang,
    (select count(*) from public.invoices where fulfilled_by_id is not null)              as don_da_gan_fulfilled,
    (select count(*) from public.invoices where source = 'order' and status = 'cancelled') as don_dat_da_huy
)
select
  (select kq from kiem_cot)        as cot_source_order_id,
  (select kq from kiem_rpc)        as rpc_tao_don_con,
  (select kq from kiem_next_code)  as ham_next_code,
  (select kq from kiem_bo_dem)     as bo_dem_NH,
  d.tong_don_dat_hang,
  d.don_da_gan_fulfilled,
  d.don_dat_da_huy
from dem d;
