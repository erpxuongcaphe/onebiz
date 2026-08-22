-- ============================================================================
-- 00341 — KPI ĐƠN ĐẶT HÀNG NHẬN ĐỦ BA TRẠNG THÁI — 21/08/2026
--
-- LỖI ĐANG VÁ: `get_sales_order_list_summary` (00306) chỉ nhận
-- ('pending','fulfilled'). Từ khi màn danh sách tách ba mức, client gửi
-- 'processing' ⇒ RPC rơi vào nhánh `else null` ⇒ BỎ LỌC ⇒ **KPI tính toàn bộ
-- đơn trong khi bảng chỉ hiện đơn Đang xử lý**. Đo thật trên PostgreSQL local
-- với 6 đơn: KPI 'processing' đếm 6 đơn còn bảng chỉ có 2.
--
-- Sửa cho bảng và KPI dùng CHUNG một điều kiện:
--   fulfilled   → fulfilled_by_id IS NOT NULL
--   processing  → fulfilled_by_id IS NULL  VÀ  CÓ  hóa đơn con còn hiệu lực
--   pending     → fulfilled_by_id IS NULL  VÀ  KHÔNG có hóa đơn con nào
--
-- "Hóa đơn con còn hiệu lực" = status='completed', chưa xoá mềm, chưa void,
-- chưa huỷ. Dùng EXISTS tương quan nên một đơn có bao nhiêu hóa đơn con cũng
-- chỉ tính MỘT lần — không tải danh sách, không có trần.
--
-- ⚠️ BÀI HỌC KỸ THUẬT: thân hàm trên máy chủ có thể chứa CRLF (migration gốc
-- lưu kiểu Windows). Vì thế fingerprint ở đây chỉ khớp TỪNG DÒNG ĐƠN, không
-- khớp khối nhiều dòng — khối nhiều dòng sẽ trượt vì ký tự xuống dòng khác nhau.
--
-- Kỹ thuật: vá tại chỗ trên pg_get_functiondef BẢN ĐANG CÀI (mẫu 00304).
-- Idempotent qua marker BA_MUC_00341. Chạy lặp an toàn.
-- Rollback: 00341_rollback_order_summary_three_states.sql
-- ============================================================================

begin;

create function pg_temp.dem_00341(p_text text, p_chuoi text) returns int
language sql immutable as
$f$ select (length(p_text) - length(replace(p_text, p_chuoi, ''))) / length(p_chuoi) $f$;

do $patch$
declare
  v_n   int;
  v_oid regprocedure;
  v_def text;
  -- Cả hai mốc đều nằm GỌN TRONG MỘT DÒNG.
  c_wl_cu  constant text := 'p_fulfillment_state in (''pending'', ''fulfilled'')';
  c_wl_moi constant text := 'p_fulfillment_state in (''pending'', ''processing'', ''fulfilled'')';
  c_loc_cu constant text := 'or (v_fulfillment = ''pending'' and i.fulfilled_by_id is null)';
  c_loc_moi constant text :=
    'or (v_fulfillment in (''pending'', ''processing'') and i.fulfilled_by_id is null'
    || ' and (v_fulfillment = ''processing'') = exists (select 1 from public.invoices c'
    || ' where c.tenant_id = v_tenant and c.source_order_id = i.id'
    || ' and c.status = ''completed'' and c.deleted_at is null'
    || ' and c.voided_at is null and c.cancelled_at is null)) /* BA_MUC_00341 */';
begin
  select count(*) into v_n from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_sales_order_list_summary';
  if v_n <> 1 then
    raise exception 'PATCH_00341: get_sales_order_list_summary có % overload (phải 1) — DỪNG', v_n;
  end if;

  select p.oid::regprocedure into v_oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_sales_order_list_summary';
  v_def := pg_get_functiondef(v_oid::oid);

  if v_def like '%BA_MUC_00341%' then
    raise notice '00341: đã vá từ trước — bỏ qua';
    return;
  end if;

  if pg_temp.dem_00341(v_def, c_wl_cu) <> 1 then
    raise exception
      'PATCH_00341: lệch fingerprint (danh sách trạng thái hợp lệ, tìm thấy % lần) — DỪNG',
      pg_temp.dem_00341(v_def, c_wl_cu);
  end if;
  if pg_temp.dem_00341(v_def, c_loc_cu) <> 1 then
    raise exception
      'PATCH_00341: lệch fingerprint (dòng lọc pending, tìm thấy % lần) — DỪNG',
      pg_temp.dem_00341(v_def, c_loc_cu);
  end if;

  v_def := replace(v_def, c_wl_cu, c_wl_moi);
  v_def := replace(v_def, c_loc_cu, c_loc_moi);
  execute v_def;
  raise notice '00341: đã vá get_sales_order_list_summary nhận đủ ba trạng thái';
end $patch$;

drop function if exists pg_temp.dem_00341(text, text);

-- ── Hậu kiểm TRONG transaction: sai là cuộn lại ───────────────────────────
do $hau_kiem$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_sales_order_list_summary';
  if v_def !~ 'BA_MUC_00341' then
    raise exception '00341 thất bại: thiếu marker';
  end if;
  if v_def !~ '''processing''' then
    raise exception '00341 thất bại: chưa nhận trạng thái processing';
  end if;
  if v_def !~ 'c\.source_order_id = i\.id' then
    raise exception '00341 thất bại: thiếu điều kiện hóa đơn con';
  end if;
  if v_def !~ 'c\.voided_at is null' or v_def !~ 'c\.cancelled_at is null' then
    raise exception '00341 thất bại: chưa loại hóa đơn con đã void/huỷ';
  end if;
  raise notice '00341: OK - KPI và bảng dùng chung điều kiện ba mức';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';
