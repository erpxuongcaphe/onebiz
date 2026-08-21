-- ============================================================================
-- 00339 HOÀN TÁC — trả 5 RPC báo cáo hóa đơn về đọc invoices.created_at
--
-- ⚠️ Sau khi hoàn tác, các trang báo cáo sẽ LỆCH SỐ nhau đúng vào những hóa đơn
-- được chỉnh ngày. Chỉ chạy khi 00339 gây sự cố thật.
--
-- KHÔNG đụng dữ liệu — chỉ đổi thân hàm.
--
-- HAI PHẦN:
--   A. Ba hàm vá tại chỗ → file này vá ngược, có fingerprint, idempotent.
--   B. Hai hàm bị THAY TOÀN BỘ THÂN (get_invoice_list_summary,
--      get_sales_report_invoice_page) → chạy lại đúng migration gốc trong repo,
--      cả hai đều là `create or replace` nên chạy lặp an toàn:
--          supabase/migrations/00305_kpi_hoa_don_summary.sql
--          supabase/migrations/00198_reporting_v3_core_aggregates.sql
--      Không chép thân hai hàm đó vào đây để tránh có hai bản sự thật lệch nhau.
-- ============================================================================

begin;

create function pg_temp.dem_00339r(p_text text, p_chuoi text) returns int
language sql immutable as
$f$ select (length(p_text) - length(replace(p_text, p_chuoi, ''))) / length(p_chuoi) $f$;

do $go$
declare
  v_n   int;
  v_oid regprocedure;
  v_def text;
  v_da  int := 0;
begin
  -- ── get_sales_report_summary ──
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_sales_report_summary';
  if v_n = 1 then
    select p.oid::regprocedure into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_sales_report_summary';
    v_def := pg_get_functiondef(v_oid::oid);
    if v_def like '%ISSUED_AT_00335%' then
      if pg_temp.dem_00339r(v_def, 'i.issued_at as created_at,') <> 1
         or pg_temp.dem_00339r(v_def, 'case when i.issued_at >= p_date_from') <> 1
         or pg_temp.dem_00339r(v_def, 'and i.issued_at >= v_previous_from') <> 1
         or pg_temp.dem_00339r(v_def, 'and i.issued_at < p_date_to') <> 1 then
        raise exception 'HOANTAC_00339: get_sales_report_summary lệch fingerprint — DỪNG';
      end if;
      v_def := replace(v_def, 'i.issued_at as created_at,', 'i.created_at,');
      v_def := replace(v_def, 'case when i.issued_at >= p_date_from', 'case when i.created_at >= p_date_from');
      v_def := replace(v_def, 'and i.issued_at >= v_previous_from', 'and i.created_at >= v_previous_from');
      v_def := replace(v_def, 'and i.issued_at < p_date_to', 'and i.created_at < p_date_to');
      v_def := replace(v_def, 'declare -- ISSUED_AT_00335', 'declare');
      execute v_def;
      v_da := v_da + 1;
    end if;
  end if;

  -- ── get_profit_and_loss_report ──
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_profit_and_loss_report';
  if v_n = 1 then
    select p.oid::regprocedure into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_profit_and_loss_report';
    v_def := pg_get_functiondef(v_oid::oid);
    if v_def like '%ISSUED_AT_00335%' then
      if pg_temp.dem_00339r(v_def, 'on i.issued_at >= p.date_from and i.issued_at < p.date_to') <> 1 then
        raise exception 'HOANTAC_00339: get_profit_and_loss_report lệch fingerprint — DỪNG';
      end if;
      v_def := replace(v_def,
        'on i.issued_at >= p.date_from and i.issued_at < p.date_to',
        'on i.created_at >= p.date_from and i.created_at < p.date_to');
      v_def := replace(v_def, 'declare -- ISSUED_AT_00335', 'declare');
      execute v_def;
      v_da := v_da + 1;
    end if;
  end if;

  -- ── get_branch_profit_and_loss_report ──
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_branch_profit_and_loss_report';
  if v_n = 1 then
    select p.oid::regprocedure into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_branch_profit_and_loss_report';
    v_def := pg_get_functiondef(v_oid::oid);
    if v_def like '%ISSUED_AT_00335%' then
      if pg_temp.dem_00339r(v_def, 'and i.issued_at >= p_date_from') <> 1
         or pg_temp.dem_00339r(v_def, 'and i.issued_at < p_date_to') <> 1 then
        raise exception 'HOANTAC_00339: get_branch_profit_and_loss_report lệch fingerprint — DỪNG';
      end if;
      v_def := replace(v_def, 'and i.issued_at >= p_date_from', 'and i.created_at >= p_date_from');
      v_def := replace(v_def, 'and i.issued_at < p_date_to', 'and i.created_at < p_date_to');
      v_def := replace(v_def, 'declare -- ISSUED_AT_00335', 'declare');
      execute v_def;
      v_da := v_da + 1;
    end if;
  end if;

  raise notice '00339 hoàn tác: % / 3 hàm vá tại chỗ đã trả về created_at', v_da;
  raise notice '00339 hoàn tác: CÒN PHẢI chạy lại 00305 và 00198 cho 2 hàm thay thân';
end $go$;

drop function if exists pg_temp.dem_00339r(text, text);

commit;

notify pgrst, 'reload schema';
