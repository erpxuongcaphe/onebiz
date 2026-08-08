-- ============================================================================
-- 00305 — HÀM TỔNG HỢP KPI MÀN HOÁ ĐƠN   (bản 2, sửa theo rà soát CEO 08/08)
--
-- ⚠️ CHƯA CHẠY. Chạy docs/PREFLIGHT-KPI-HOA-DON-2026-08-08.sql trước, gửi kết
--    quả A1/A4/A5, rồi mới chạy tệp này.
--
-- PHẠM VI (ranh giới CEO 08/08):
--   • CHỈ thêm 1 hàm mới + quyền gọi. Không sửa bảng, cột, ràng buộc, policy,
--     chỉ mục hay dữ liệu. Rollback: 00305_rollback_kpi_hoa_don_summary.sql
--   • SECURITY INVOKER (mặc định) · STABLE · thuần SELECT · không ghi audit,
--     không trigger nghiệp vụ, không tác dụng phụ.
--
-- SỬA SO VỚI BẢN NHÁP TRƯỚC (đều do CEO bắt được):
--   1. Hàm tenant đúng là public.get_user_tenant_id() (00002_rls_policies.sql:7).
--      Bản trước gọi user_tenant_id() — KHÔNG tồn tại. Em grep sai: mẫu
--      "user_tenant_id()" khớp nhầm phần đuôi của "get_user_tenant_id()".
--   2. Phạm vi chi nhánh chốt phía máy chủ theo đúng mẫu 00196: quyền hiệu lực
--      qua public.user_has_permission() (đã gồm quyền theo vai trò + cấp riêng
--      + thu hồi riêng), KHÔNG kiểm theo chức danh.
--   3. processing → draft + confirmed, y hệt invoices.ts.
--   4. Escape % và _ trong từ khoá, y hệt invoices.ts.
--   5. Mốc ngày kết thúc là ĐẦU NGÀY KẾ TIẾP với điều kiện `<`, không `<=`
--      (khớp applyDateRangeFilter: gte(from) + lt(toExclusive)).
--   6. Lọc giao hàng dùng EXISTS/NOT EXISTS kèm tenant của vận đơn.
--
-- ĐẶC TẢ (CEO chốt K0) — giữ nguyên:
--   Ba bộ đếm BỎ QUA riêng p_statuses (để làm nút lọc nhanh) nhưng tôn trọng
--   mọi bộ lọc khác: tenant · chi nhánh · thời gian · từ khoá · loại giao hàng.
--     1. tat_ca_hoa_don      mọi trạng thái còn sống
--     2. hoan_thanh          status = 'completed'
--     3. da_huy              status = 'cancelled'   (thay "Giao thất bại")
--   Hai chỉ số tiền CHỈ tính 'completed':
--     4. gia_tri_hoan_thanh  sum(total) — total ĐÃ trừ giảm giá, ĐÃ gồm thuế
--                            và phí giao. KHÔNG trừ giảm giá lần hai.
--     5. giam_gia_ap_dung    sum(discount_amount + promotion_discount),
--                            hiển thị riêng, KHÔNG trừ khỏi (4).
--   Cột đối chiếu (không hiển thị):
--     6. so_dong_theo_bo_loc ÁP p_statuses → phải khớp `total` của danh sách.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_invoice_list_summary(
  p_branch_id         uuid        DEFAULT NULL,
  p_date_from         timestamptz DEFAULT NULL,
  p_date_to_exclusive timestamptz DEFAULT NULL,  -- ĐẦU ngày kế tiếp, dùng với `<`
  p_statuses          text[]      DEFAULT NULL,
  p_search            text        DEFAULT NULL,
  p_search_field      text        DEFAULT 'all', -- danh sách trắng, xem CASE
  p_delivery          text        DEFAULT 'all'  -- 'all' | 'delivery' | 'no_delivery'
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
-- SECURITY INVOKER là mặc định — KHÔNG khai SECURITY DEFINER. RLS áp y hệt
-- truy vấn danh sách; không có leo thang quyền do thiết kế.
AS $$
DECLARE
  v_actor        uuid := auth.uid();
  v_tenant       uuid;
  v_xem_toan_bo  boolean;
  v_statuses     text[];
  v_search       text;
BEGIN
  -- ── Chốt danh tính phía máy chủ ────────────────────────────────────────
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_AUTH_REQUIRED';
  END IF;

  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_TENANT_UNKNOWN';
  END IF;

  -- ── Hồ sơ phải còn hoạt động và đúng tenant ───────────────────────────
  -- Không dựa vào giao diện, cũng không chỉ dựa vào get_user_tenant_id().
  -- Nhân viên bị tắt tài khoản mà phiên còn hiệu lực thì chặn ngay tại đây.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor
      AND p.tenant_id = v_tenant
      AND coalesce(p.is_active, true)
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_PROFILE_INACTIVE';
  END IF;

  -- ── Phạm vi chi nhánh — mẫu 00196, dùng QUYỀN HIỆU LỰC ────────────────
  -- user_has_permission() đã gộp quyền theo vai trò + cấp riêng + thu hồi
  -- riêng (00112/00114/00189). Không kiểm theo chức danh.
  v_xem_toan_bo :=
       public.user_has_permission(v_actor, 'reports.view_all_branches')
    OR public.user_has_permission(v_actor, 'system.manage_branches');

  IF p_branch_id IS NOT NULL THEN
    -- LUÔN kiểm chi nhánh có thật và thuộc đúng tenant — chặn dò UUID.
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = p_branch_id AND b.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'KPI_BRANCH_NOT_IN_TENANT';
    END IF;

    -- Người xem toàn công ty được chọn BẤT KỲ chi nhánh nào trong tenant —
    -- đó chính là thao tác xem tổng rồi bóc từng chi nhánh. Chỉ người KHÔNG
    -- có quyền toàn công ty mới phải nằm trong danh sách được gán.
    IF NOT v_xem_toan_bo
       AND NOT public.user_has_branch_access(v_actor, p_branch_id) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'KPI_BRANCH_DENIED';
    END IF;
  END IF;

  -- p_branch_id NULL KHÔNG đồng nghĩa xem toàn công ty: người không có quyền
  -- xem toàn bộ bị thu hẹp về đúng danh sách chi nhánh được gán (điều kiện
  -- trong truy vấn bên dưới). Không ném lỗi — màn Hoá đơn vẫn dùng được.

  -- ── Ánh xạ trạng thái: processing = draft + confirmed (giống invoices.ts) ──
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

  -- ── Escape % và _ trong từ khoá (giống invoices.ts) ───────────────────
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
      AND i.deleted_at IS NULL                      -- giống danh sách (00173)
      AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
      AND (
        v_xem_toan_bo
        OR p_branch_id IS NOT NULL
        OR i.branch_id IN (
             SELECT b.branch_id FROM public.get_user_accessible_branches(v_actor) b
           )
      )
      AND (p_date_from         IS NULL OR i.created_at >= p_date_from)
      AND (p_date_to_exclusive IS NULL OR i.created_at <  p_date_to_exclusive)
      AND (
        v_search IS NULL OR
        CASE p_search_field
          WHEN 'code'          THEN i.code          ILIKE '%' || v_search || '%'
          WHEN 'customer_name' THEN i.customer_name ILIKE '%' || v_search || '%'
          ELSE  i.code          ILIKE '%' || v_search || '%'
             OR i.customer_name ILIKE '%' || v_search || '%'
        END
      )
      -- EXISTS / NOT EXISTS: không bao giờ nhân đôi hoá đơn dù có nhiều vận đơn
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
  'KPI man Hoa don (00305). Chi doc, STABLE, SECURITY INVOKER. Ba bo dem trang '
  'thai bo qua rieng p_statuses de lam nut loc nhanh; hai chi so tien chi tinh '
  'completed. invoices.total DA tru giam gia — khong tru lan hai. Tenant va '
  'pham vi chi nhanh chot phia may chu theo mau 00196.';

REVOKE ALL ON FUNCTION public.get_invoice_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, text) TO authenticated;

DO $$ BEGIN RAISE NOTICE '00305: OK — da tao get_invoice_list_summary (chi doc)'; END $$;
