-- ============================================================
-- 00043_promotion_gift_items.sql
--
-- Sprint KM-3 — Gift items cho promotion type='gift'
--
-- KM-2 ước lượng BOGO discount = sets × cheapest_unit_price.
-- KM-3 refine: output FREE ITEMS LIST cụ thể để invoice + receipt
-- hiển thị "+1 món tặng kèm" rõ ràng cho cashier + khách.
--
-- BOGO (buy_x_get_y): pick các unit rẻ nhất từ eligible items làm free
--                     → KM-3 không cần schema mới, refine engine logic.
-- Gift:               cần schema mới `gift_product_ids` để admin chỉ định
--                     SP X tặng khi mua đủ điều kiện (vd "tặng combo
--                     bánh khi đơn từ 200k").
-- ============================================================

-- gift_product_ids — chỉ dùng cho promotions.type = 'gift'
-- Mỗi ID trong mảng = 1 SP tặng (qty mặc định 1 cho mỗi gift).
-- Empty array = chưa cấu hình → engine sẽ skip apply gift này.
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS gift_product_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.promotions.gift_product_ids IS
  'Mảng product_id sẽ tặng kèm khi promotion type=''gift'' và đơn match điều kiện. Mỗi ID = 1 quà (qty 1). Rỗng = chưa cấu hình → engine skip. Dùng riêng cho gift, không apply cho BOGO (BOGO tự pick từ eligible items rẻ nhất).';
