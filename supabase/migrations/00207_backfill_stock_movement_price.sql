-- 00207 — Thẻ kho Đợt 6d: điền giá cho dòng sổ CŨ (trước trigger 00206).
-- Chỉ đụng dòng unit_cost/unit_price ĐANG NULL (không đè dòng mới đã có giá).
-- Dòng không truy được giá → giữ NULL (UI hiện "—", trung thực).

-- 1) Giá NHẬP (unit_price) cho dòng nhập mua: lấy từ chính phiếu nhập.
UPDATE public.stock_movements sm
SET unit_price = poi.unit_price
FROM public.purchase_order_items poi
WHERE sm.unit_price IS NULL
  AND sm.reference_type IN ('purchase_order','po_receive','goods_receipt','purchase_entry')
  AND poi.purchase_order_id = sm.reference_id
  AND poi.product_id = sm.product_id;

-- 2) Giá VỐN (unit_cost) tại thời điểm mỗi dòng: lấy WAC gần nhất TRƯỚC dòng đó
--    từ lịch sử audit_log (action='cost_price_update', new_data.cost_price).
UPDATE public.stock_movements sm
SET unit_cost = c.cost_at_time
FROM (
  SELECT s.id,
    (SELECT (al.new_data->>'cost_price')::numeric
     FROM public.audit_log al
     WHERE al.entity_id = s.product_id
       AND al.action = 'cost_price_update'
       AND al.created_at <= s.created_at
     ORDER BY al.created_at DESC
     LIMIT 1) AS cost_at_time
  FROM public.stock_movements s
  WHERE s.unit_cost IS NULL AND s.product_id IS NOT NULL
) c
WHERE sm.id = c.id AND c.cost_at_time IS NOT NULL;

-- VERIFY (đọc — không đổi dữ liệu)
DO $$
DECLARE n_cost int; n_price int; n_null int;
BEGIN
  SELECT count(*) FILTER (WHERE unit_cost IS NOT NULL),
         count(*) FILTER (WHERE unit_price IS NOT NULL),
         count(*) FILTER (WHERE unit_cost IS NULL)
  INTO n_cost, n_price, n_null FROM public.stock_movements;
  RAISE NOTICE '00207 OK: unit_cost có %, unit_price có %, còn NULL % (dòng không truy được giá — đúng chủ đích).',
    n_cost, n_price, n_null;
END $$;
