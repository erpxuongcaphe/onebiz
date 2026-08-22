-- ============================================================================
-- 00339 — 5 RPC BÁO CÁO HÓA ĐƠN ĐỌC THEO NGÀY HÓA ĐƠN — 21/08/2026
--
-- VÌ SAO CÓ FILE NÀY (đồng bộ repo ↔ production):
-- Năm hàm dưới đây ĐÃ ĐỔI TRÊN PRODUCTION ngày 20/08/2026 (Pha A của 00335)
-- nhưng bản đổi chỉ nằm ở tệp vận hành chưa track. Dựng database TRẮNG từ repo
-- sẽ ra 5 hàm VẪN lọc theo invoices.created_at ⇒ khác production, và các trang
-- báo cáo sẽ lệch số nhau đúng vào những hóa đơn được chỉnh ngày.
--
--   Thay TOÀN BỘ thân (bản 00305 / 00198 + ngày hóa đơn):
--     · get_invoice_list_summary        (00305)
--     · get_sales_report_invoice_page   (00198)
--   Vá TẠI CHỖ trên bản đang cài (mẫu 00304, fingerprint đếm chuỗi):
--     · get_sales_report_summary
--     · get_profit_and_loss_report
--     · get_branch_profit_and_loss_report
--
-- Ba hàm Khách × Sản phẩm nằm ở migration 00338 (chạy trước hay sau đều được).
--
-- KHÔNG ĐỔI HÀNH VI khi chạy: sau backfill của 00335, issued_at = created_at
-- với mọi hóa đơn đã phát hành nên số liệu Y HỆT. Khác biệt chỉ xuất hiện từ
-- lúc có hóa đơn được chỉnh ngày.
--
-- Idempotent: phần vá tại chỗ bỏ qua hàm đã có marker ISSUED_AT_00335; phần
-- thay thân là create or replace nên chạy lặp an toàn.
-- KHÔNG mang md5 guard của bản vận hành: guard đó khoá đúng trạng thái
-- production hôm 19/08, chạy trên database trắng sẽ nổ oan.
--
-- Rollback: 00339_rollback_invoice_report_rpcs_issued_at.sql
-- ============================================================================

begin;

do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invoices' and column_name='issued_at'
  ) then
    raise exception 'GUARD_00339: chưa có cột issued_at — chạy 00335 trước';
  end if;
end $guard$;

-- Cả 5 hàm PHẢI tồn tại trước khi vá. Hai hàm bị thay toàn bộ thân
-- (get_invoice_list_summary, get_sales_report_invoice_page) do 00305/00198 tạo
-- ra; nếu chúng chưa có thì ảnh chụp sẽ thiếu và hoàn tác về sau KHÔNG khôi
-- phục được bản gốc. Thà dừng ở đây còn hơn để mất đường lùi.
do $guard_du_5$
declare v_thieu text;
begin
  select string_agg(t.ten, ', ') into v_thieu
  from (values ('get_invoice_list_summary'), ('get_sales_report_invoice_page'),
               ('get_sales_report_summary'), ('get_profit_and_loss_report'),
               ('get_branch_profit_and_loss_report')) as t(ten)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = t.ten
  );
  if v_thieu is not null then
    raise exception
      'GUARD_00339: thiếu hàm % — chạy 00198 và 00305 trước. '
      'Vá khi chưa đủ 5 hàm sẽ làm ảnh chụp thiếu và mất đường hoàn tác.', v_thieu;
  end if;
end $guard_du_5$;

-- ── Ảnh chụp BẤT BIẾN thân hàm TRƯỚC KHI VÁ ───────────────────────────────
-- Hoàn tác đọc thẳng từ đây nên TỰ ĐỦ: không bắt người vận hành nhớ chạy thêm
-- migration nào khác, và khôi phục đúng bản đang chạy chứ không phải bản trong
-- repo (hai thứ có thể lệch nhau).
-- Chỉ chụp MỘT LẦN cho mỗi hàm: chạy lần hai KHÔNG chụp đè bản đã vá.
create table if not exists public.rpc_backup_ngay_hoa_don (
  migration  text not null,
  ham_oid    oid  not null,
  chu_ky     text not null,
  def_truoc  text not null,
  chup_luc   timestamptz not null default now(),
  primary key (migration, ham_oid)
);
comment on table public.rpc_backup_ngay_hoa_don is
  'Ảnh chụp BẤT BIẾN thân RPC báo cáo trước khi đổi sang ngày hóa đơn (00338/00339). Dùng cho rollback tự đủ.';
revoke all on table public.rpc_backup_ngay_hoa_don from public, anon, authenticated;

insert into public.rpc_backup_ngay_hoa_don (migration, ham_oid, chu_ky, def_truoc)
select '00339', p.oid, p.oid::regprocedure::text, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('get_invoice_list_summary','get_sales_report_invoice_page','get_sales_report_summary','get_profit_and_loss_report','get_branch_profit_and_loss_report')
on conflict (migration, ham_oid) do nothing;

-- ── Khối 5a. get_invoice_list_summary — bản 00305 + lọc theo NGÀY HOÁ ĐƠN ──
-- Danh sách gồm cả nháp (issued_at NULL) → coalesce. Sau Pha A giá trị bằng
-- created_at nên KẾT QUẢ Y HỆT hôm nay. Marker: ISSUED_AT_00335.
CREATE OR REPLACE FUNCTION public.get_invoice_list_summary(
  p_branch_id         uuid        DEFAULT NULL,
  p_date_from         timestamptz DEFAULT NULL,
  p_date_to_exclusive timestamptz DEFAULT NULL,
  p_statuses          text[]      DEFAULT NULL,
  p_search            text        DEFAULT NULL,
  p_search_field      text        DEFAULT 'all',
  p_delivery          text        DEFAULT 'all'
)
RETURNS TABLE (
  tat_ca_hoa_don      bigint,
  hoan_thanh          bigint,
  da_huy              bigint,
  gia_tri_hoan_thanh  numeric,
  giam_gia_ap_dung    numeric,
  so_dong_theo_bo_loc bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  -- ISSUED_AT_00335
  v_actor        uuid := auth.uid();
  v_tenant       uuid;
  v_xem_toan_bo  boolean;
  v_statuses     text[];
  v_search       text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_AUTH_REQUIRED';
  END IF;

  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_TENANT_UNKNOWN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor
      AND p.tenant_id = v_tenant
      AND coalesce(p.is_active, true)
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_PROFILE_INACTIVE';
  END IF;

  v_xem_toan_bo :=
       public.user_has_permission(v_actor, 'reports.view_all_branches')
    OR public.user_has_permission(v_actor, 'system.manage_branches');

  IF p_branch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = p_branch_id AND b.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'KPI_BRANCH_NOT_IN_TENANT';
    END IF;

    IF NOT v_xem_toan_bo
       AND NOT public.user_has_branch_access(v_actor, p_branch_id) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'KPI_BRANCH_DENIED';
    END IF;
  END IF;

  v_statuses := CASE
    WHEN p_statuses IS NULL OR cardinality(p_statuses) = 0 THEN NULL
    ELSE (
      SELECT array_agg(DISTINCT x)
      FROM (
        SELECT unnest(
          CASE WHEN s = 'processing' THEN ARRAY['draft','confirmed'] ELSE ARRAY[s] END
        ) AS x
        FROM unnest(p_statuses) AS s
      ) t
    )
  END;

  v_search := CASE
    WHEN p_search IS NULL OR p_search = '' THEN NULL
    ELSE replace(replace(p_search, '%', '\%'), '_', '\_')
  END;

  RETURN QUERY
  WITH loc AS (
    SELECT
      i.status,
      i.total,
      coalesce(i.discount_amount, 0) + coalesce(i.promotion_discount, 0) AS giam
    FROM public.invoices i
    WHERE
      i.tenant_id = v_tenant
      AND i.deleted_at IS NULL
      AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
      AND (
        v_xem_toan_bo
        OR p_branch_id IS NOT NULL
        OR i.branch_id IN (
             SELECT b.branch_id FROM public.get_user_accessible_branches(v_actor) b
           )
      )
      AND (p_date_from         IS NULL OR coalesce(i.issued_at, i.created_at) >= p_date_from)
      AND (p_date_to_exclusive IS NULL OR coalesce(i.issued_at, i.created_at) <  p_date_to_exclusive)
      AND (
        v_search IS NULL OR
        CASE p_search_field
          WHEN 'code'          THEN i.code          ILIKE '%' || v_search || '%'
          WHEN 'customer_name' THEN i.customer_name ILIKE '%' || v_search || '%'
          ELSE  i.code          ILIKE '%' || v_search || '%'
             OR i.customer_name ILIKE '%' || v_search || '%'
        END
      )
      AND (
        p_delivery IS NULL OR p_delivery = 'all'
        OR (p_delivery = 'delivery' AND EXISTS (
              SELECT 1 FROM public.shipping_orders so
              WHERE so.invoice_id = i.id AND so.tenant_id = v_tenant))
        OR (p_delivery = 'no_delivery' AND NOT EXISTS (
              SELECT 1 FROM public.shipping_orders so
              WHERE so.invoice_id = i.id AND so.tenant_id = v_tenant))
      )
  )
  SELECT
    count(*)                                                    AS tat_ca_hoa_don,
    count(*) FILTER (WHERE l.status = 'completed')               AS hoan_thanh,
    count(*) FILTER (WHERE l.status = 'cancelled')               AS da_huy,
    coalesce(sum(l.total) FILTER (WHERE l.status = 'completed'), 0)
                                                                 AS gia_tri_hoan_thanh,
    coalesce(sum(l.giam)  FILTER (WHERE l.status = 'completed'), 0)
                                                                 AS giam_gia_ap_dung,
    count(*) FILTER (
      WHERE v_statuses IS NULL OR l.status = ANY (v_statuses)
    )                                                            AS so_dong_theo_bo_loc
  FROM loc l;
END;
$$;

-- ── Khối 5b. get_sales_report_invoice_page — bản 00198 + issued_at ────────
-- Chỉ lấy completed → sau backfill mọi dòng đều có issued_at → dùng THẲNG
-- (ăn index, không coalesce). Trả THÊM issued_at, GIỮ created_at để client cũ
-- không vỡ. ISSUED_AT_00335.
create or replace function public.get_sales_report_invoice_page(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 1000
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- ISSUED_AT_00335
  v_tenant_id uuid;
  v_limit integer;
  v_rows jsonb;
  v_count integer;
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);
  perform public.assert_report_access('reports.export_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  v_limit := greatest(1, least(coalesce(p_limit, 1000), 1000));

  select coalesce(jsonb_agg(to_jsonb(t) order by t.issued_at desc, t.code), '[]'::jsonb), count(*)
  into v_rows, v_count
  from (
    select
      i.code,
      i.branch_id,
      i.customer_name,
      i.subtotal,
      i.discount_amount,
      coalesce(i.delivery_fee, 0) as delivery_fee,
      i.total,
      i.paid,
      i.debt,
      i.payment_method,
      i.created_at,
      i.issued_at
    from public.invoices i
    where i.tenant_id = v_tenant_id
      and i.status = 'completed'
      and i.issued_at >= p_date_from
      and i.issued_at < p_date_to
      and (p_branch_id is null or i.branch_id = p_branch_id)
    order by i.issued_at desc, i.code
    offset greatest(coalesce(p_offset, 0), 0)
    limit v_limit
  ) t;

  return jsonb_build_object(
    'rows', v_rows,
    'has_more', v_count = v_limit
  );
end;
$$;

-- ── Khối 5c. 3 hàm analytics 00198 — PATCH TẠI CHỖ kiểu 00304 ─────────────
-- get_sales_report_summary + get_profit_and_loss_report +
-- get_branch_profit_and_loss_report cũng lọc doanh thu theo created_at.
-- Sửa trên pg_get_functiondef BẢN ĐANG CÀI; fingerprint ĐẾM số lần xuất hiện
-- từng chuỗi, lệch là DỪNG. Phiếu trả hàng (sales_returns.created_at) GIỮ
-- NGUYÊN — đó là thời gian giao dịch thật.
create function pg_temp.dem_00335(p_text text, p_chuoi text) returns int
language sql immutable as
$f$ select (length(p_text) - length(replace(p_text, p_chuoi, ''))) / length(p_chuoi) $f$;

do $patch$
declare
  v_oid regprocedure;
  v_def text;
  v_n   int;
begin
  -- 5c.1 get_sales_report_summary — 4 chỗ trong CTE nguồn scoped_invoices;
  -- alias GIỮ TÊN created_at nên breakdown ngày/thứ/giờ/top hạ nguồn ăn theo.
  select count(*) into v_n from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_sales_report_summary';
  if v_n <> 1 then
    raise exception 'PATCH_00335A: get_sales_report_summary có % overload (phải 1) — DỪNG', v_n;
  end if;
  select p.oid::regprocedure into v_oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_sales_report_summary';
  v_def := pg_get_functiondef(v_oid::oid);
  if v_def not like '%ISSUED_AT_00335%' then
    if pg_temp.dem_00335(v_def, 'i.created_at,') <> 1
       or pg_temp.dem_00335(v_def, 'case when i.created_at >= p_date_from') <> 1
       or pg_temp.dem_00335(v_def, 'and i.created_at >= v_previous_from') <> 1
       or pg_temp.dem_00335(v_def, 'and i.created_at < p_date_to') <> 1
       or pg_temp.dem_00335(v_def, 'declare') <> 1 then
      raise exception 'PATCH_00335A: get_sales_report_summary lệch fingerprint — DỪNG';
    end if;
    v_def := replace(v_def, 'i.created_at,', 'i.issued_at as created_at,');
    v_def := replace(v_def, 'case when i.created_at >= p_date_from', 'case when i.issued_at >= p_date_from');
    v_def := replace(v_def, 'and i.created_at >= v_previous_from', 'and i.issued_at >= v_previous_from');
    v_def := replace(v_def, 'and i.created_at < p_date_to', 'and i.issued_at < p_date_to');
    v_def := replace(v_def, 'declare', 'declare -- ISSUED_AT_00335');
    execute v_def;
    raise notice '00335A: patch get_sales_report_summary sang issued_at';
  end if;

  -- 5c.2 get_profit_and_loss_report — 1 dòng join theo kỳ
  select count(*) into v_n from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_profit_and_loss_report';
  if v_n <> 1 then
    raise exception 'PATCH_00335A: get_profit_and_loss_report có % overload (phải 1) — DỪNG', v_n;
  end if;
  select p.oid::regprocedure into v_oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_profit_and_loss_report';
  v_def := pg_get_functiondef(v_oid::oid);
  if v_def not like '%ISSUED_AT_00335%' then
    if pg_temp.dem_00335(v_def, 'on i.created_at >= p.date_from and i.created_at < p.date_to') <> 1
       or pg_temp.dem_00335(v_def, 'declare') <> 1 then
      raise exception 'PATCH_00335A: get_profit_and_loss_report lệch fingerprint — DỪNG';
    end if;
    v_def := replace(v_def,
      'on i.created_at >= p.date_from and i.created_at < p.date_to',
      'on i.issued_at >= p.date_from and i.issued_at < p.date_to');
    v_def := replace(v_def, 'declare', 'declare -- ISSUED_AT_00335');
    execute v_def;
    raise notice '00335A: patch get_profit_and_loss_report sang issued_at';
  end if;

  -- 5c.3 get_branch_profit_and_loss_report — 2 dòng lọc kỳ
  select count(*) into v_n from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_branch_profit_and_loss_report';
  if v_n <> 1 then
    raise exception 'PATCH_00335A: get_branch_profit_and_loss_report có % overload (phải 1) — DỪNG', v_n;
  end if;
  select p.oid::regprocedure into v_oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_branch_profit_and_loss_report';
  v_def := pg_get_functiondef(v_oid::oid);
  if v_def not like '%ISSUED_AT_00335%' then
    if pg_temp.dem_00335(v_def, 'and i.created_at >= p_date_from') <> 1
       or pg_temp.dem_00335(v_def, 'and i.created_at < p_date_to') <> 1
       or pg_temp.dem_00335(v_def, 'declare') <> 1 then
      raise exception 'PATCH_00335A: get_branch_profit_and_loss_report lệch fingerprint — DỪNG';
    end if;
    v_def := replace(v_def, 'and i.created_at >= p_date_from', 'and i.issued_at >= p_date_from');
    v_def := replace(v_def, 'and i.created_at < p_date_to', 'and i.issued_at < p_date_to');
    v_def := replace(v_def, 'declare', 'declare -- ISSUED_AT_00335');
    execute v_def;
    raise notice '00335A: patch get_branch_profit_and_loss_report sang issued_at';
  end if;
end $patch$;

drop function if exists pg_temp.dem_00335(text, text);

-- ── Hậu kiểm TRONG transaction: sai là rollback, không để nửa vời ──────────
do $hau_kiem$
declare v_n int;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname in ('get_invoice_list_summary',
                      'get_sales_report_invoice_page',
                      'get_sales_report_summary',
                      'get_profit_and_loss_report',
                      'get_branch_profit_and_loss_report')
    and pg_get_functiondef(p.oid) ~ 'issued_at';
  if v_n <> 5 then
    raise exception '00339 thất bại: chỉ % / 5 hàm đọc theo ngày hóa đơn', v_n;
  end if;
  raise notice '00339: OK - cả 5 RPC báo cáo hóa đơn đọc theo ngày hóa đơn';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';
