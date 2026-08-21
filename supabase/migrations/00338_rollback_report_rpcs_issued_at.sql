-- ============================================================================
-- 00338 HOÀN TÁC — trả 3 RPC báo cáo Khách × Sản phẩm về đọc invoices.created_at
--
-- ⚠️ Sau khi hoàn tác, trang Khách × Sản phẩm sẽ LỆCH SỐ so với các trang báo
-- cáo khác đúng vào những hóa đơn được chỉnh ngày (các trang kia đọc ngày
-- chứng từ). Chỉ chạy khi 00338 gây sự cố thật.
--
-- KHÔNG đụng dữ liệu — chỉ đổi thân hàm. Vá ngược đúng 4 phép thay của 00338,
-- có fingerprint để không vá mù. Idempotent: hàm chưa có marker thì bỏ qua.
-- ============================================================================

begin;

create function pg_temp.dem_00338r(p_text text, p_chuoi text) returns int
language sql immutable as
$f$ select (length(p_text) - length(replace(p_text, p_chuoi, ''))) / length(p_chuoi) $f$;

do $go$
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
begin
  for v_i in 1 .. array_length(c_hams, 1) loop
    select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname = c_hams[v_i];
    if v_n <> 1 then
      raise exception 'HOANTAC_00338: % có % overload (phải 1) — DỪNG', c_hams[v_i], v_n;
    end if;

    select p.oid::regprocedure into v_oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname = c_hams[v_i];
    v_def := pg_get_functiondef(v_oid::oid);

    if v_def not like '%ISSUED_AT_00335%' then
      continue;  -- chưa vá, không có gì để hoàn tác
    end if;

    if pg_temp.dem_00338r(v_def, 'and i.issued_at >= p_date_from') <> 1
       or pg_temp.dem_00338r(v_def, 'and i.issued_at < p_date_to') <> 1 then
      raise exception 'HOANTAC_00338: % lệch fingerprint — DỪNG', c_hams[v_i];
    end if;

    if pg_temp.dem_00338r(v_def, 'i.issued_at as created_at,') = 1 then
      v_def := replace(v_def, 'i.issued_at as created_at,', 'i.created_at,');
    elsif pg_temp.dem_00338r(v_def, 'max(i.issued_at) as last_purchase_at') = 1 then
      v_def := replace(v_def, 'max(i.issued_at) as last_purchase_at',
                              'max(i.created_at) as last_purchase_at');
    else
      raise exception 'HOANTAC_00338: % không khớp dạng đọc ngày nào — DỪNG', c_hams[v_i];
    end if;

    v_def := replace(v_def, 'and i.issued_at >= p_date_from', 'and i.created_at >= p_date_from');
    v_def := replace(v_def, 'and i.issued_at < p_date_to', 'and i.created_at < p_date_to');
    v_def := replace(v_def, 'declare -- ISSUED_AT_00335', 'declare');
    execute v_def;
    v_da := v_da + 1;
    raise notice '00338 hoàn tác: % trả về created_at', c_hams[v_i];
  end loop;
  raise notice '00338 hoàn tác: % hàm', v_da;
end $go$;

drop function if exists pg_temp.dem_00338r(text, text);

commit;

notify pgrst, 'reload schema';
