-- ============================================================
-- 00041_price_tier_multichannel.sql
--
-- Price tier multi-channel support — CEO chốt kiến trúc:
--   - Retail (B2B): tier gắn vào KH (đại lý / quán / lẻ)
--   - FnB (POS quán): tier gắn vào CHI NHÁNH (quán Q1 vs quán Thủ Đức)
--   - Both: tier có thể dùng cho cả 2 channel
--
-- Logic resolve giá tại check out:
--   - POS FnB:    branch.price_tier → item.price ?? product.sell_price
--   - POS Retail: customer.price_tier → item.price ?? product.sell_price
--
-- Tier KHÔNG cần chứa hết SP — chỉ chứa SP override. SP không match
-- → fallback giá niêm yết. Đơn giản hoá việc setup (không phải insert
-- 500 items khi 80% SP cùng giá toàn chuỗi).
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. price_tiers.scope — phân loại tier theo channel
-- ──────────────────────────────────────────────────────────
ALTER TABLE public.price_tiers
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'both';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'price_tiers_scope_check'
  ) THEN
    ALTER TABLE public.price_tiers
      ADD CONSTRAINT price_tiers_scope_check
      CHECK (scope IN ('retail', 'fnb', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN public.price_tiers.scope IS
  'Channel áp dụng tier: retail (gắn KH B2B), fnb (gắn chi nhánh quán), both (dùng cả hai). Default both vì các tier seed cũ chưa phân biệt.';

-- ──────────────────────────────────────────────────────────
-- 2. customers.price_tier_id — default tier cho KH (retail)
-- ──────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS price_tier_id UUID
  REFERENCES public.price_tiers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_price_tier
  ON public.customers (tenant_id, price_tier_id)
  WHERE price_tier_id IS NOT NULL;

COMMENT ON COLUMN public.customers.price_tier_id IS
  'Bảng giá mặc định áp dụng khi KH này check out POS Retail. NULL → dùng giá niêm yết. ON DELETE SET NULL để xoá tier không phá KH.';

-- ──────────────────────────────────────────────────────────
-- 3. branches.price_tier_id — default tier cho chi nhánh (fnb)
-- ──────────────────────────────────────────────────────────
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS price_tier_id UUID
  REFERENCES public.price_tiers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_branches_price_tier
  ON public.branches (tenant_id, price_tier_id)
  WHERE price_tier_id IS NOT NULL;

COMMENT ON COLUMN public.branches.price_tier_id IS
  'Bảng giá mặc định áp dụng khi POS FnB của chi nhánh này check out. NULL → dùng giá niêm yết. Cho phép quán Q1 latte 55k vs quán Thủ Đức latte 45k.';
