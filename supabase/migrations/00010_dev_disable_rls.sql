-- ============================================================
-- 00010_dev_disable_rls.sql
--
-- ⚠️  DEV-ONLY — KHÔNG ĐƯỢC CHẠY TRÊN PRODUCTION ⚠️
--
-- Mục đích:
--   Trong giai đoạn build/dev, chúng ta CHƯA tạo tài khoản auth
--   nên không có session → RLS chặn 100% query → giao diện trống.
--
--   File này TẠM THỜI tắt Row Level Security trên TẤT CẢ các table
--   data để dev có thể test CRUD trực tiếp với anon key (khi
--   `NEXT_PUBLIC_BYPASS_AUTH=true`).
--
-- Khi nào chạy:
--   1. Bây giờ — để Claude có thể test bulk actions trên /hang-hoa.
--   2. Mỗi lần reset DB / làm lại schema.
--
-- Khi nào ROLLBACK (BẮT BUỘC trước khi production):
--   Chạy block cuối file (hiện đang comment) để re-enable RLS.
--   Hoặc tạo migration mới `00011_enable_rls.sql` đảo lại.
-- ============================================================

-- Idempotent: ALTER ... DISABLE chạy lặp không lỗi.

-- ---- Tables từ 00001_initial_schema ----
alter table public.tenants                  disable row level security;
alter table public.branches                 disable row level security;
alter table public.profiles                 disable row level security;
alter table public.categories               disable row level security;
alter table public.suppliers                disable row level security;
alter table public.customer_groups          disable row level security;
alter table public.customers                disable row level security;
alter table public.products                 disable row level security;
alter table public.price_books              disable row level security;
alter table public.product_prices           disable row level security;
alter table public.invoices                 disable row level security;
alter table public.invoice_items            disable row level security;
alter table public.purchase_orders          disable row level security;
alter table public.purchase_order_items     disable row level security;
alter table public.stock_movements          disable row level security;
alter table public.inventory_checks         disable row level security;
alter table public.inventory_check_items    disable row level security;
alter table public.sales_returns            disable row level security;
alter table public.return_items             disable row level security;
alter table public.delivery_partners        disable row level security;
alter table public.shipping_orders          disable row level security;
alter table public.cash_transactions        disable row level security;
alter table public.sales_channels           disable row level security;
alter table public.notifications            disable row level security;
alter table public.code_sequences           disable row level security;
alter table public.audit_log                disable row level security;

-- ---- Tables từ 00004_new_features ----
alter table public.favorites                disable row level security;
alter table public.coupons                  disable row level security;
alter table public.coupon_usages            disable row level security;
alter table public.promotions               disable row level security;
alter table public.loyalty_settings         disable row level security;
alter table public.loyalty_tiers            disable row level security;
alter table public.loyalty_transactions     disable row level security;
alter table public.online_orders            disable row level security;
alter table public.conversations            disable row level security;
alter table public.conversation_messages    disable row level security;

-- ---- Tables từ 00006_foundation ----
alter table public.product_variants            disable row level security;
alter table public.bom                          disable row level security;
alter table public.bom_items                    disable row level security;
alter table public.uom_conversions              disable row level security;
alter table public.branch_stock                 disable row level security;
alter table public.group_code_sequences         disable row level security;
alter table public.production_orders            disable row level security;
alter table public.production_order_materials   disable row level security;
alter table public.product_lots                 disable row level security;
alter table public.lot_allocations              disable row level security;
alter table public.price_tiers                  disable row level security;
alter table public.price_tier_items             disable row level security;
alter table public.pipelines                    disable row level security;
alter table public.pipeline_stages              disable row level security;
alter table public.pipeline_transitions         disable row level security;
alter table public.pipeline_items               disable row level security;
alter table public.pipeline_history             disable row level security;
alter table public.pipeline_automations         disable row level security;

-- ---- Verify ----
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_tables
  where schemaname = 'public' and rowsecurity = true;

  raise notice '✅ Disabled RLS. Còn % table public vẫn bật RLS.', v_count;
end $$;

-- ============================================================
-- 🔒 ROLLBACK — chạy block dưới đây trước khi go production
-- ============================================================
-- Uncomment toàn bộ block dưới và chạy lại để re-enable RLS:
--
-- alter table public.tenants                  enable row level security;
-- alter table public.branches                 enable row level security;
-- alter table public.profiles                 enable row level security;
-- alter table public.categories               enable row level security;
-- alter table public.suppliers                enable row level security;
-- alter table public.customer_groups          enable row level security;
-- alter table public.customers                enable row level security;
-- alter table public.products                 enable row level security;
-- alter table public.price_books              enable row level security;
-- alter table public.product_prices           enable row level security;
-- alter table public.invoices                 enable row level security;
-- alter table public.invoice_items            enable row level security;
-- alter table public.purchase_orders          enable row level security;
-- alter table public.purchase_order_items     enable row level security;
-- alter table public.stock_movements          enable row level security;
-- alter table public.inventory_checks         enable row level security;
-- alter table public.inventory_check_items    enable row level security;
-- alter table public.sales_returns            enable row level security;
-- alter table public.return_items             enable row level security;
-- alter table public.delivery_partners        enable row level security;
-- alter table public.shipping_orders          enable row level security;
-- alter table public.cash_transactions        enable row level security;
-- alter table public.sales_channels           enable row level security;
-- alter table public.notifications            enable row level security;
-- alter table public.code_sequences           enable row level security;
-- alter table public.audit_log                enable row level security;
-- alter table public.favorites                enable row level security;
-- alter table public.coupons                  enable row level security;
-- alter table public.coupon_usages            enable row level security;
-- alter table public.promotions               enable row level security;
-- alter table public.loyalty_settings         enable row level security;
-- alter table public.loyalty_tiers            enable row level security;
-- alter table public.loyalty_transactions     enable row level security;
-- alter table public.online_orders            enable row level security;
-- alter table public.conversations            enable row level security;
-- alter table public.conversation_messages    enable row level security;
-- alter table public.product_variants            enable row level security;
-- alter table public.bom                          enable row level security;
-- alter table public.bom_items                    enable row level security;
-- alter table public.uom_conversions              enable row level security;
-- alter table public.branch_stock                 enable row level security;
-- alter table public.group_code_sequences         enable row level security;
-- alter table public.production_orders            enable row level security;
-- alter table public.production_order_materials   enable row level security;
-- alter table public.product_lots                 enable row level security;
-- alter table public.lot_allocations              enable row level security;
-- alter table public.price_tiers                  enable row level security;
-- alter table public.price_tier_items             enable row level security;
-- alter table public.pipelines                    enable row level security;
-- alter table public.pipeline_stages              enable row level security;
-- alter table public.pipeline_transitions         enable row level security;
-- alter table public.pipeline_items               enable row level security;
-- alter table public.pipeline_history             enable row level security;
-- alter table public.pipeline_automations         enable row level security;
