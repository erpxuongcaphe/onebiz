-- ============================================================
-- Migration 00131: Customer segmentation columns (Recency + Birthday + Tags)
--
-- CEO 06/06/2026 — research từ 8 hệ thống ngành (Sapo, Square POS, Toast,
-- HubSpot, Lightspeed, MISA, KiotViet, Odoo) xác nhận TOP 5 filter chuẩn.
-- Migration này thêm 3 cột để hỗ trợ Phase 2-3-4:
--   - last_purchase_at  → filter "Lần mua cuối" (Recency, có ở 4/8 hệ thống)
--   - birthday          → filter "Sinh nhật theo tháng" (loyalty FnB, Sapo)
--   - tags TEXT[]       → tagging mở (VIP, dị ứng sữa, KH Shopee...)
--
-- AN TOÀN:
--   - Tất cả ADD COLUMN IF NOT EXISTS + nullable
--   - Trigger update last_purchase_at chỉ recompute khi invoice.status = 'completed'
--   - Không động data invoices/customers gốc
--   - Backfill 1 lần ở cuối từ data hiện có
--   - Idempotent: rerun không sai
-- ROLLBACK: DROP COLUMN + DROP TRIGGER + DROP FUNCTION (không mất data invoices)
-- ============================================================

-- 1. ADD COLUMNS
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_purchase_at timestamptz,
  ADD COLUMN IF NOT EXISTS birthday date,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.customers.last_purchase_at IS
  'Ngày mua hàng cuối cùng — tự update qua trigger từ invoices.created_at WHERE status=completed';
COMMENT ON COLUMN public.customers.birthday IS
  'Ngày sinh (date) — dùng cho loyalty marketing chuỗi cà phê (gửi voucher sinh nhật)';
COMMENT ON COLUMN public.customers.tags IS
  'Tags tự do (VIP, dị ứng sữa, KH Shopee...) — array để filter contains pattern Sapo/HubSpot';

-- 2. INDEX
CREATE INDEX IF NOT EXISTS idx_customers_last_purchase
  ON public.customers(tenant_id, last_purchase_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_customers_birthday
  ON public.customers(tenant_id, birthday)
  WHERE birthday IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_tags
  ON public.customers USING GIN (tags);

-- 3. FUNCTION recompute last_purchase_at từ invoices
CREATE OR REPLACE FUNCTION public.recompute_customer_last_purchase(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last timestamptz;
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;

  SELECT MAX(created_at) INTO v_last
    FROM public.invoices
   WHERE customer_id = p_customer_id
     AND status = 'completed';

  UPDATE public.customers
     SET last_purchase_at = v_last,
         updated_at = now()
   WHERE id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_customer_last_purchase(uuid)
  TO authenticated, service_role;

-- 4. TRIGGER: invoices → recompute last_purchase
CREATE OR REPLACE FUNCTION public.trg_sync_customer_last_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Đổi customer (rare): recompute cả 2
  IF TG_OP = 'UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    PERFORM public.recompute_customer_last_purchase(OLD.customer_id);
    PERFORM public.recompute_customer_last_purchase(NEW.customer_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_customer_last_purchase(OLD.customer_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_customer_last_purchase(COALESCE(NEW.customer_id, OLD.customer_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_sync_last_purchase ON public.invoices;
CREATE TRIGGER trg_invoices_sync_last_purchase
AFTER INSERT OR UPDATE OF customer_id, status, created_at OR DELETE
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_customer_last_purchase();

-- 5. BACKFILL: sync last_purchase_at cho TẤT CẢ customers hiện tại
UPDATE public.customers c
   SET last_purchase_at = agg.max_date,
       updated_at = now()
  FROM (
    SELECT customer_id, MAX(created_at) AS max_date
      FROM public.invoices
     WHERE customer_id IS NOT NULL
       AND status = 'completed'
     GROUP BY customer_id
  ) agg
 WHERE c.id = agg.customer_id;

-- 6. VERIFY
DO $$
DECLARE
  v_synced int;
  v_with_birthday int;
BEGIN
  SELECT COUNT(*) INTO v_synced
    FROM public.customers WHERE last_purchase_at IS NOT NULL;
  SELECT COUNT(*) INTO v_with_birthday
    FROM public.customers WHERE birthday IS NOT NULL;
  RAISE NOTICE '[Migration 00131] Schema mở rộng xong:';
  RAISE NOTICE '  Customers có last_purchase: %', v_synced;
  RAISE NOTICE '  Customers có birthday: %', v_with_birthday;
  RAISE NOTICE '  Tags mặc định = empty array cho tất cả';
END $$;
