-- ============================================================================
-- POSTFLIGHT 00331 — CHỈ ĐỌC, chạy SAU khi migration 00331 báo
-- "00331: OK - cot source_order_id + RPC tao don con da san sang"
-- Một câu SELECT duy nhất. Gửi em nguyên bảng kết quả.
--
-- ĐẠT khi: 4 cột đầu đều 'OK' và anon_goi_duoc = 'KHONG (dung)'.
-- ============================================================================
with
c1 as (
  select case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
      and column_name = 'source_order_id' and is_nullable = 'YES'
  ) then 'OK' else 'THIEU COT' end as kq
),
c2 as (
  select case when exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'invoices'
      and indexname = 'idx_invoices_source_order_id'
  ) then 'OK' else 'THIEU CHI MUC' end as kq
),
c3 as (
  select case when to_regprocedure('public.create_child_sale_from_order(uuid)') is not null
    then 'OK' else 'THIEU RPC' end as kq
),
c4 as (
  -- Thân hàm không được sửa/xóa invoices (đơn gốc bất khả xâm phạm)
  select case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_child_sale_from_order'
      and pg_get_functiondef(p.oid) !~* 'update\s+public\.invoices'
      and pg_get_functiondef(p.oid) !~* 'delete\s+from\s+public\.invoices'
      and pg_get_functiondef(p.oid) ~* 'source_order_id'
  ) then 'OK' else 'THAN HAM SAI — bao em' end as kq
),
c5 as (
  select case when exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name = 'create_child_sale_from_order'
      and grantee = 'anon'
  ) then 'CO — SAI, bao em' else 'KHONG (dung)' end as kq
),
van_tay as (
  select md5(pg_get_functiondef(p.oid)) as dau
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_child_sale_from_order'
  limit 1
)
select
  (select kq from c1) as cot_nullable,
  (select kq from c2) as chi_muc,
  (select kq from c3) as rpc_ton_tai,
  (select kq from c4) as than_ham_an_toan,
  (select kq from c5) as anon_goi_duoc,
  (select dau from van_tay) as dau_van_tay_md5,
  (select count(*) from public.invoices where source_order_id is not null) as so_don_con_hien_co;
