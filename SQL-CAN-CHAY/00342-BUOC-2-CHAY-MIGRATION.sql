-- ============================================================================
-- 00342 — Trang HOÁ ĐƠN chỉ hiện CHỨNG TỪ BÁN
--
-- VẤN ĐỀ: màn /don-hang/hoa-don hiện cả đơn đặt hàng (DH000055–58 trong ảnh
-- production 22/08/2026). Đơn đặt hàng thuộc trang Đơn đặt hàng, kể cả khi đã
-- xử lý xong. KPI đầu trang đọc get_invoice_list_summary nên cũng đang đếm dư
-- 10 đơn (5 draft + 5 cancelled) — bảng và KPI phải sửa CÙNG một điều kiện,
-- nếu không hai con số sẽ lệch nhau.
--
-- MỐC PHÂN LOẠI (đã kiểm chứng trên dữ liệu production, không đoán):
--   source='order' + order_code IS NULL      → CÒN là đơn đặt hàng  → LOẠI
--   source='order' + order_code IS NOT NULL  → đã chuyển tại chỗ    → GIỮ
--   source <> 'order' (kể cả NULL)           → chứng từ POS/FnB/... → GIỮ
--
-- ⚠️ TUYỆT ĐỐI KHÔNG lọc bằng `source <> 'order'` đơn thuần: pos_checkout_v3/v5
-- (00169 dòng 118-130, 00203 dòng 508) hoàn tất đơn TẠI CHỖ — cấp mã HD mới,
-- ghi order_code = mã cũ, nhưng GIỮ source='order'. Preflight đếm được 33 bản
-- ghi như vậy (31 completed) là hoá đơn bán THẬT. Lọc ngây thơ sẽ xoá sạch 33
-- hoá đơn khỏi màn Hoá đơn và khỏi KPI.
--
-- CŨNG KHÔNG lọc bằng tiền tố mã 'DH': tiền tố là dữ liệu hiển thị, quy ước
-- cấp mã đã đổi một lần ở 00169; lọc theo chuỗi là hỏng âm thầm lần sau.
--
-- KHÔNG ĐỤNG DỮ LIỆU: migration này chỉ CREATE OR REPLACE một hàm CHỈ ĐỌC.
-- Không UPDATE/INSERT/DELETE dòng nào, không đổi status, không đụng kho/quỹ.
--
-- Nền: giữ NGUYÊN thân hàm bản 00339 (marker ISSUED_AT_00335 còn nguyên để
-- test 00338-00339 tiếp tục nhận diện), chỉ THÊM đúng một mệnh đề WHERE.
--
-- ⚠️ NGUYÊN TỬ: toàn bộ phần ghi nằm trong MỘT transaction. Thiếu BEGIN/COMMIT
-- thì psql chạy autocommit từng lệnh — hậu kiểm ở cuối có nổ cũng KHÔNG cuộn
-- lại được CREATE OR REPLACE và bảng chụp đã ghi trước đó. Đã đo thật trên
-- PostgreSQL 16.4: bản thiếu BEGIN/COMMIT để lại hàm ĐÃ VÁ + bảng chụp 1 dòng
-- sau khi hậu kiểm hỏng. Xem test src/__tests__/migrations/00342-*.test.ts.
-- ============================================================================

begin;

-- ── Khối 0. Guard: hàm nền phải tồn tại và phải là bản 00339 ────────────────
do $guard$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_invoice_list_summary'
    and p.pronargs = 7;

  if v_def is null then
    raise exception
      '00342 DUNG: khong thay get_invoice_list_summary(7 tham so). '
      'Phai chay 00305 va 00339 truoc.';
  end if;

  if position('ISSUED_AT_00335' in v_def) = 0 then
    raise exception
      '00342 DUNG: get_invoice_list_summary tren CSDL nay CHUA phai ban 00339 '
      '(khong thay marker ISSUED_AT_00335). Chay 00339 truoc roi chay lai.';
  end if;

  if position('CHUNG_TU_BAN_00342' in v_def) > 0 then
    raise notice '00342: da vá tu truoc — CREATE OR REPLACE lai la vo hai.';
  end if;
end $guard$;

-- ── Khối 1. Chụp bản định nghĩa TRƯỚC khi vá (để hoàn tác chính xác) ───────
-- Bảng BẤT BIẾN: chụp đúng MỘT lần. Chạy lại migration không được ghi đè bản
-- chụp, nếu không hoàn tác sẽ trỏ về trạng thái đã vá thay vì trạng thái gốc.
create table if not exists public.rpc_backup_chung_tu_ban (
  migration  text        not null,
  ham_oid    oid         not null,
  chu_ky     text        not null,
  def_truoc  text        not null,
  chup_luc   timestamptz not null default now(),
  primary key (migration, ham_oid)
);

insert into public.rpc_backup_chung_tu_ban (migration, ham_oid, chu_ky, def_truoc)
select '00342', p.oid, p.oid::regprocedure::text, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_invoice_list_summary'
  and p.pronargs = 7
on conflict (migration, ham_oid) do nothing;

-- ── Khối 2. Bản vá ─────────────────────────────────────────────────────────
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
  -- CHUNG_TU_BAN_00342
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
      -- 00342: CHỈ CHỨNG TỪ BÁN. Đơn đặt hàng còn là đơn (source='order'
      -- và chưa chuyển mã) thuộc trang Đơn đặt hàng, không phải trang Hoá
      -- đơn. Đơn ĐÃ chuyển tại chỗ giữ source='order' nhưng có order_code
      -- → là hoá đơn bán thật, PHẢI đếm. IS DISTINCT FROM để an toàn NULL.
      AND (i.source IS DISTINCT FROM 'order' OR i.order_code IS NOT NULL)
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

COMMENT ON FUNCTION public.get_invoice_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, text
) IS
  'KPI danh sach hoa don (00305) + ngay hoa don (00339) + CHI CHUNG TU BAN '
  '(00342: loai don dat hang con la don — source=order va order_code IS NULL). '
  'Chi doc. Phai khop tung con so voi danh sach o client.';

-- ── Khối 3. Hậu kiểm — chạy TRONG cùng transaction, sai là cuộn lại ────────
do $hau_kiem$
declare
  v_def text;
  v_n   int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_invoice_list_summary'
    and p.pronargs = 7;

  if position('CHUNG_TU_BAN_00342' in v_def) = 0 then
    raise exception '00342 THAT BAI: khong thay marker CHUNG_TU_BAN_00342. CUON LAI.';
  end if;
  if position('ISSUED_AT_00335' in v_def) = 0 then
    raise exception '00342 THAT BAI: mat marker ISSUED_AT_00335 cua ban 00339. CUON LAI.';
  end if;
  if position('i.source IS DISTINCT FROM ''order''' in v_def) = 0 then
    raise exception '00342 THAT BAI: khong thay menh de loc chung tu ban. CUON LAI.';
  end if;

  -- Bản chụp phải có đúng 1 dòng và KHÔNG được là bản đã vá.
  select count(*) into v_n from public.rpc_backup_chung_tu_ban where migration = '00342';
  if v_n <> 1 then
    raise exception '00342 THAT BAI: ban chup co % dong (ky vong 1). CUON LAI.', v_n;
  end if;
  select count(*) into v_n from public.rpc_backup_chung_tu_ban
  where migration = '00342' and position('CHUNG_TU_BAN_00342' in def_truoc) > 0;
  if v_n <> 0 then
    raise exception
      '00342 THAT BAI: ban chup lai la ban DA VA — hoan tac se khong ve duoc '
      'trang thai goc. CUON LAI.';
  end if;

  raise notice '00342: DAT — KPI hoa don da loai don dat hang, giu nguyen hoa don chuyen tai cho.';
end $hau_kiem$;

-- Nạp lại lược đồ cho PostgREST — ĐẶT TRONG TRANSACTION, ngay trước COMMIT.
-- PostgreSQL chỉ GIAO notification khi COMMIT, nên:
--   · hậu kiểm nổ → cuộn lại → KHÔNG có reload nào được phát;
--   · commit xong → phát đúng một lần.
-- Đặt SAU commit thì client nào bỏ qua lỗi và chạy tiếp (psql không bật
-- ON_ERROR_STOP) vẫn phát reload dù bản vá đã cuộn lại.
notify pgrst, 'reload schema';

commit;
