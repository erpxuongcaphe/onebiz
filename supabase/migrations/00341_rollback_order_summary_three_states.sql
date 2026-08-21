-- ============================================================================
-- 00341 HOÀN TÁC — trả get_sales_order_list_summary về chỉ nhận
-- ('pending','fulfilled').
--
-- ⚠️ Sau khi hoàn tác, chọn bộ lọc "Đang xử lý" ở màn Đơn đặt hàng sẽ làm KPI
-- đầu trang KHÔNG khớp danh sách bên dưới (RPC bỏ lọc, tính toàn bộ đơn).
-- Chỉ chạy khi 00341 gây sự cố thật.
--
-- KHÔNG đụng dữ liệu — chỉ đổi thân hàm. Vá ngược đúng 2 phép thay của 00341.
-- Khớp TỪNG DÒNG ĐƠN (thân hàm trên máy chủ có thể chứa CRLF).
-- Idempotent: chưa có marker thì bỏ qua.
-- ============================================================================

begin;

create function pg_temp.dem_00341r(p_text text, p_chuoi text) returns int
language sql immutable as
$f$ select (length(p_text) - length(replace(p_text, p_chuoi, ''))) / length(p_chuoi) $f$;

do $go$
declare
  v_oid regprocedure;
  v_def text;
  c_wl_moi constant text := 'p_fulfillment_state in (''pending'', ''processing'', ''fulfilled'')';
  c_wl_cu  constant text := 'p_fulfillment_state in (''pending'', ''fulfilled'')';
  c_loc_moi constant text :=
    'or (v_fulfillment in (''pending'', ''processing'') and i.fulfilled_by_id is null'
    || ' and (v_fulfillment = ''processing'') = exists (select 1 from public.invoices c'
    || ' where c.tenant_id = v_tenant and c.source_order_id = i.id'
    || ' and c.status = ''completed'' and c.deleted_at is null'
    || ' and c.voided_at is null and c.cancelled_at is null)) /* BA_MUC_00341 */';
  c_loc_cu constant text := 'or (v_fulfillment = ''pending'' and i.fulfilled_by_id is null)';
begin
  select p.oid::regprocedure into v_oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_sales_order_list_summary';
  if v_oid is null then
    raise exception 'HOANTAC_00341: không tìm thấy get_sales_order_list_summary';
  end if;
  v_def := pg_get_functiondef(v_oid::oid);

  if v_def not like '%BA_MUC_00341%' then
    raise notice '00341 hoàn tác: chưa vá, không có gì để làm';
    return;
  end if;
  if pg_temp.dem_00341r(v_def, c_wl_moi) <> 1
     or pg_temp.dem_00341r(v_def, c_loc_moi) <> 1 then
    raise exception 'HOANTAC_00341: lệch fingerprint — DỪNG';
  end if;

  v_def := replace(v_def, c_wl_moi, c_wl_cu);
  v_def := replace(v_def, c_loc_moi, c_loc_cu);
  execute v_def;
  raise notice '00341 hoàn tác: đã trả về hai trạng thái';
end $go$;

drop function if exists pg_temp.dem_00341r(text, text);

do $hau_kiem$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_sales_order_list_summary';
  if v_def ~ 'BA_MUC_00341' then
    raise exception '00341 hoàn tác thất bại: marker vẫn còn';
  end if;
  raise notice '00341 hoàn tác: OK';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';
