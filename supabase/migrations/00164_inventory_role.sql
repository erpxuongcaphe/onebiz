-- ============================================================
-- 00164 — products.inventory_role: vai trò tồn kho TƯỜNG MINH (nền móng Cách B)
-- ============================================================
-- CEO 07/07/2026 chốt mô hình mã hàng (2 mảng riêng):
--   • NVL          = đầu vào cho RETAIL (kho/xưởng): rang, sản xuất, đóng gói.
--   • SKU Retail   = bán ở POS Retail; ĐỒNG THỜI là hàng thành phần cấp sang
--                    quán F&B (sữa lon, cà phê rang xay, syrup, ly...) — GIỮ TỒN
--                    THẬT tại quán khi quán nhận hàng.
--   • SKU F&B menu = món pha chế bán ở POS F&B, KHÔNG giữ tồn — bán trừ
--                    thành phần theo BOM (thành phần = SKU Retail tại quán).
--   • SKU F&B stockable = hàng tồn F&B riêng (hiếm — chỉ khi tách hẳn khỏi Retail).
--
-- VẤN ĐỀ: hệ thống đang SUY LUẬN vai trò từ 3 cột (product_type + channel +
-- has_bom) rải rác khắp code — dễ suy sai và mỗi nơi suy một kiểu. Cột này nói
-- THẲNG vai trò, mọi query/báo cáo/guard sau này dùng 1 nguồn.
--
-- THIẾT KẾ: GENERATED ALWAYS ... STORED — tự tính từ product_type + channel
-- (KHÔNG dùng has_bom), KHÔNG BAO GIỜ lệch, không cần backfill/service set.
-- (Nếu mai này cần override thủ công → migration đổi thành cột thường.)
--   raw_material      : product_type='nvl'
--   fnb_menu_item     : sku + channel='fnb'  → MỌI mã F&B là MÓN MENU, KHÔNG giữ
--                       tồn. KHÔNG suy từ has_bom: món chưa gắn công thức vẫn là
--                       menu (sẽ bị chặn bán ở POS tới khi có công thức) — tránh
--                       bị coi nhầm là "hàng giữ tồn riêng".
--   retail_stock_item : sku + channel='retail' (kể cả has_bom 2-mã). Tồn = 0 tại
--                       Kho (nằm ở NVL), > 0 tại Quán outlet khi nhận thành phần.
--   fnb_stock_item    : [DEFER] chưa dùng. Khi cần "hàng tồn F&B riêng" → thêm
--                       bằng cột/flag riêng, KHÔNG suy từ has_bom.
-- ============================================================

alter table public.products
  add column if not exists inventory_role text
  generated always as (
    case
      when product_type = 'nvl' then 'raw_material'
      -- CEO 07/07 (Cách B): MỌI mã F&B là món menu, KHÔNG suy từ has_bom.
      when product_type = 'sku' and channel = 'fnb' then 'fnb_menu_item'
      when product_type = 'sku' then 'retail_stock_item'
      else 'raw_material'
    end
  ) stored;

create index if not exists idx_products_inventory_role
  on public.products (tenant_id, inventory_role);

comment on column public.products.inventory_role is
  'CEO 07/07/2026 — vai trò tồn kho (GENERATED từ product_type+channel, KHÔNG dùng has_bom): raw_material=NVL đầu vào Retail | retail_stock_item=SKU Retail (tồn=0 ở Kho vì nằm ở NVL, >0 ở Quán khi nhận thành phần) | fnb_menu_item=MỌI mã F&B (món menu, KHÔNG giữ tồn, bán trừ công thức). fnb_stock_item để dành tương lai qua cột/flag riêng.';

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY sau khi áp:
--   select inventory_role, count(*) from public.products
--   where tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'
--   group by inventory_role;
--   -- Kỳ vọng (data 07/07): raw_material=269, retail_stock_item=290,
--   --                        fnb_menu_item=1 (chỉ SKU-CPT-002 test). fnb_stock_item KHÔNG sinh (defer).
-- ============================================================
