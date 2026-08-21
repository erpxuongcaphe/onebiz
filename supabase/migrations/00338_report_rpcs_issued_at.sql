-- ============================================================================
-- 00338 — 3 RPC BÁO CÁO KHÁCH × SẢN PHẨM ĐỌC THEO NGÀY HÓA ĐƠN — 21/08/2026
--
-- VÌ SAO CÓ FILE NÀY (đồng bộ repo ↔ production):
-- Bản vá này ĐÃ CHẠY TRÊN PRODUCTION ngày 20/08/2026 nhưng chỉ tồn tại ở tệp
-- vận hành chưa track (SQL-CAN-CHAY/00335-PHA-A3-...). Hậu quả: dựng một
-- database TRẮNG từ repo sẽ ra 3 hàm báo cáo VẪN lọc theo invoices.created_at,
-- khác production — trang Khách × Sản phẩm sẽ lệch số so với các trang khác
-- đúng vào những hóa đơn được chỉnh ngày. Đưa vào đây để repo là nguồn sự thật.
--
-- BA HÀM (bản gốc 00199) — mỗi hàm 3 chỗ đọc ngày:
--   · get_customer_product_report
--   · get_customer_product_detail_page
--   · get_customer_product_export_page
--
-- ĐÃ KIỂM VÀ KHÔNG CẦN VÁ: get_finance_dashboard_report (00258) chỉ đọc
-- cash_transactions.created_at — SỔ QUỸ GIỮ THỜI GIAN GIAO DỊCH THẬT, không
-- được kéo theo ngày hóa đơn chỉnh tay.
--
-- KỸ THUẬT: vá tại chỗ trên pg_get_functiondef BẢN ĐANG CÀI (mẫu 00304).
-- Fingerprint ĐẾM số lần xuất hiện từng chuỗi — lệch là DỪNG, không vá mù.
-- Idempotent: đã có marker ISSUED_AT_00335 thì bỏ qua ⇒ chạy trên production
-- (đã vá 20/08) là no-op, chạy trên database trắng thì vá.
--
-- Rollback: 00338_rollback_report_rpcs_issued_at.sql
-- ============================================================================

begin;

do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invoices' and column_name='issued_at'
  ) then
    raise exception 'GUARD_00338: chưa có cột issued_at — chạy 00335 trước';
  end if;
end $guard$;

create function pg_temp.dem_00338(p_text text, p_chuoi text) returns int
language sql immutable as
$f$ select (length(p_text) - length(replace(p_text, p_chuoi, ''))) / length(p_chuoi) $f$;

do $patch$
declare
  c_hams constant text[] := array[
    'get_customer_product_report',
    'get_customer_product_detail_page',
    'get_customer_product_export_page'
  ];
  v_i   int;
  v_n   int;
  v_oid regprocedure;
  v_def text;
  v_da  int := 0;
  v_bo  int := 0;
begin
  for v_i in 1 .. array_length(c_hams, 1) loop
    -- Đúng 1 overload rồi mới lấy oid — nhiều overload là dấu hiệu đã lệch.
    select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname = c_hams[v_i];
    if v_n <> 1 then
      raise exception 'PATCH_00338: % có % overload (phải 1) — DỪNG', c_hams[v_i], v_n;
    end if;

    select p.oid::regprocedure into v_oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname = c_hams[v_i];
    v_def := pg_get_functiondef(v_oid::oid);

    if v_def like '%ISSUED_AT_00335%' then
      v_bo := v_bo + 1;
      continue;  -- đã vá rồi (production)
    end if;

    -- Fingerprint 2 mốc lọc kỳ — CHUNG cho cả 3 hàm.
    if pg_temp.dem_00338(v_def, 'and i.created_at >= p_date_from') <> 1
       or pg_temp.dem_00338(v_def, 'and i.created_at < p_date_to') <> 1
       or pg_temp.dem_00338(v_def, 'declare') <> 1 then
      raise exception 'PATCH_00338: % lệch fingerprint (mốc lọc kỳ) — DỪNG', c_hams[v_i];
    end if;

    -- Fingerprint chỗ ĐỌC ngày — KHÁC nhau giữa các hàm:
    --   · get_customer_product_report   : cột `i.created_at,` trong select
    --   · *_detail_page / *_export_page : `max(i.created_at) as last_purchase_at`
    -- Phải khớp ĐÚNG MỘT trong hai dạng, không thì DỪNG (không vá mù).
    if pg_temp.dem_00338(v_def, 'i.created_at,') = 1 then
      -- Giữ NGUYÊN tên cột trả ra để client cũ không vỡ.
      v_def := replace(v_def, 'i.created_at,', 'i.issued_at as created_at,');
    elsif pg_temp.dem_00338(v_def, 'max(i.created_at) as last_purchase_at') = 1 then
      -- "Lần mua gần nhất" của khách = theo NGÀY CHỨNG TỪ.
      v_def := replace(v_def, 'max(i.created_at) as last_purchase_at',
                              'max(i.issued_at) as last_purchase_at');
    else
      raise exception 'PATCH_00338: % không khớp dạng đọc ngày nào — DỪNG', c_hams[v_i];
    end if;

    v_def := replace(v_def, 'and i.created_at >= p_date_from', 'and i.issued_at >= p_date_from');
    v_def := replace(v_def, 'and i.created_at < p_date_to', 'and i.issued_at < p_date_to');
    v_def := replace(v_def, 'declare', 'declare -- ISSUED_AT_00335');
    execute v_def;
    v_da := v_da + 1;
    raise notice '00338: đã vá % sang issued_at', c_hams[v_i];
  end loop;

  raise notice '00338: vá % hàm, bỏ qua % hàm (đã có marker)', v_da, v_bo;
end $patch$;

drop function if exists pg_temp.dem_00338(text, text);

-- ── Hậu kiểm TRONG transaction: sai là rollback, không để nửa vời ──
do $hau_kiem$
declare v_n int;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname in ('get_customer_product_report',
                      'get_customer_product_detail_page',
                      'get_customer_product_export_page')
    and pg_get_functiondef(p.oid) like '%ISSUED_AT_00335%'
    and pg_get_functiondef(p.oid) not like '%and i.created_at%';
  if v_n <> 3 then
    raise exception '00338 thất bại: chỉ % / 3 hàm đọc theo ngày hóa đơn', v_n;
  end if;
  raise notice '00338: OK - cả 3 hàm báo cáo đọc theo ngày hóa đơn';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';
