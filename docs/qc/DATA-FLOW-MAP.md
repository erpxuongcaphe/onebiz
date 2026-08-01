# Bản đồ điểm truy cập dữ liệu OneBiz

> Kiểm kê tĩnh toàn bộ mã nguồn `src`. Chưa xác nhận policy hoặc dữ liệu sống trên Supabase.

## Tổng quan

- File mã nguồn đã quét: 686
- Điểm truy cập dữ liệu: 732
- Truy vấn bảng: 686
- Gọi RPC: 30
- Gọi API từ frontend: 16
- Điểm có khả năng ghi dữ liệu: 217
- Điểm ghi từ page/component/service: 189
- Điểm ghi vào dữ liệu nhạy cảm: 15

## Ghi dữ liệu nhạy cảm

| Nơi chạy | Loại | Đích | Lệnh | File:dòng |
|---|---|---|---|---|
| server-route | table | `audit_log` | insert | `src/app/api/cron/stock-reconciliation/route.ts:166` |
| server-route | table | `tenants` | insert | `src/app/api/mkt/v1/audit-runner/setup/route.ts:118` |
| server-route | table | `branches` | insert | `src/app/api/mkt/v1/audit-runner/setup/route.ts:137` |
| server-route | table | `profiles` | upsert | `src/app/api/mkt/v1/audit-runner/setup/route.ts:169` |
| server-route | table | `tenants` | delete | `src/app/api/mkt/v1/audit-runner/setup/route.ts:213` |
| component | table | `invoices` | insert | `src/components/shared/dialogs/create-invoice-dialog.tsx:256` |
| component | table | `invoice_items` | insert | `src/components/shared/dialogs/create-invoice-dialog.tsx:281` |
| service | table | `audit_log` | insert | `src/lib/services/supabase/audit.ts:251` |
| service | table | `inventory_checks` | insert | `src/lib/services/supabase/duplicate-services.ts:50` |
| service | table | `stock_transfers` | insert | `src/lib/services/supabase/duplicate-services.ts:96` |
| service | table | `audit_log` | insert | `src/lib/services/supabase/excel-import.ts:432` |
| service | table | `audit_log` | insert | `src/lib/services/supabase/excel-import.ts:455` |
| service | rpc | `record_invoice_payment` | execute | `src/lib/services/supabase/payments.ts:46` |
| service | rpc | `record_purchase_payment` | execute | `src/lib/services/supabase/payments.ts:82` |
| service | rpc | `create_supplier_return_atomic` | execute | `src/lib/services/supabase/purchase-entries.ts:579` |

## Ghi trực tiếp từ page, component hoặc service

| Nơi chạy | Loại | Đích | Lệnh | File:dòng |
|---|---|---|---|---|
| page | rpc | `get_email_by_phone` | execute | `src/app/(auth)/quen-mat-khau/page.tsx:42` |
| page | rpc | `cleanup_expired_auto_drafts` | execute | `src/app/pos/page.tsx:715` |
| component | table | `delivery_partners` | insert | `src/components/shared/dialogs/create-delivery-partner-dialog.tsx:92` |
| component | table | `invoices` | insert | `src/components/shared/dialogs/create-invoice-dialog.tsx:256` |
| component | table | `invoice_items` | insert | `src/components/shared/dialogs/create-invoice-dialog.tsx:281` |
| component | table | `products` | update | `src/components/shared/dialogs/create-price-book-dialog.tsx:127` |
| component | table | `shipping_orders` | insert | `src/components/shared/dialogs/create-shipping-order-dialog.tsx:138` |
| component | table | `products` | insert | `src/components/shared/import-export-buttons.tsx:15` |
| service | table | `agents` | insert | `src/lib/services/supabase/ai-agents.ts:152` |
| service | table | `agents` | update | `src/lib/services/supabase/ai-agents.ts:189` |
| service | table | `agents` | delete | `src/lib/services/supabase/ai-agents.ts:210` |
| service | rpc | `seed_default_agents` | execute | `src/lib/services/supabase/ai-agents.ts:231` |
| service | table | `kpi_breakdowns` | insert | `src/lib/services/supabase/ai-agents.ts:292` |
| service | table | `kpi_breakdowns` | update | `src/lib/services/supabase/ai-agents.ts:322` |
| service | table | `kpi_breakdowns` | delete | `src/lib/services/supabase/ai-agents.ts:334` |
| service | table | `agent_tasks` | insert | `src/lib/services/supabase/ai-agents.ts:380` |
| service | table | `agent_tasks` | update | `src/lib/services/supabase/ai-agents.ts:424` |
| service | table | `agent_tasks` | delete | `src/lib/services/supabase/ai-agents.ts:444` |
| service | table | `agent_tasks` | update | `src/lib/services/supabase/ai-agents.ts:493` |
| service | table | `agent_executions` | insert | `src/lib/services/supabase/ai-agents.ts:544` |
| service | table | `agents` | update | `src/lib/services/supabase/ai-agents.ts:563` |
| service | table | `agent_executions` | update | `src/lib/services/supabase/ai-agents.ts:608` |
| service | table | `agent_executions` | update | `src/lib/services/supabase/ai-agents.ts:623` |
| service | table | `audit_log` | insert | `src/lib/services/supabase/audit.ts:251` |
| service | rpc | `next_group_code` | execute | `src/lib/services/supabase/base.ts:394` |
| service | rpc | `peek_next_group_code` | execute | `src/lib/services/supabase/base.ts:517` |
| service | rpc | `get_bom_availability_batch` | execute | `src/lib/services/supabase/bom.ts:32` |
| service | table | `bom` | insert | `src/lib/services/supabase/bom.ts:269` |
| service | table | `bom_items` | insert | `src/lib/services/supabase/bom.ts:291` |
| service | table | `bom` | update | `src/lib/services/supabase/bom.ts:443` |
| service | table | `bom_items` | delete | `src/lib/services/supabase/bom.ts:464` |
| service | table | `bom` | update | `src/lib/services/supabase/bom.ts:488` |
| service | rpc | `calculate_bom_cost` | execute | `src/lib/services/supabase/bom.ts:495` |
| service | rpc | `seed_internal_entities` | execute | `src/lib/services/supabase/branches.ts:344` |
| service | table | `categories` | update | `src/lib/services/supabase/categories.ts:192` |
| service | table | `categories` | update | `src/lib/services/supabase/categories.ts:198` |
| service | table | `categories` | delete | `src/lib/services/supabase/categories.ts:305` |
| service | table | `conversation_messages` | insert | `src/lib/services/supabase/conversations.ts:116` |
| service | table | `conversations` | update | `src/lib/services/supabase/conversations.ts:132` |
| service | table | `conversations` | update | `src/lib/services/supabase/conversations.ts:160` |
| service | table | `coupons` | insert | `src/lib/services/supabase/coupons.ts:110` |
| service | table | `coupons` | update | `src/lib/services/supabase/coupons.ts:188` |
| service | table | `coupons` | delete | `src/lib/services/supabase/coupons.ts:235` |
| service | rpc | `validate_coupon` | execute | `src/lib/services/supabase/coupons.ts:260` |
| service | table | `customer_saved_views` | insert | `src/lib/services/supabase/customer-saved-views.ts:79` |
| service | table | `customer_saved_views` | update | `src/lib/services/supabase/customer-saved-views.ts:132` |
| service | table | `customer_saved_views` | delete | `src/lib/services/supabase/customer-saved-views.ts:146` |
| service | table | `customer_groups` | insert | `src/lib/services/supabase/customers.ts:280` |
| service | table | `customer_groups` | update | `src/lib/services/supabase/customers.ts:300` |
| service | table | `customer_groups` | delete | `src/lib/services/supabase/customers.ts:311` |
| service | table | `customers` | insert | `src/lib/services/supabase/customers.ts:359` |
| service | table | `customers` | update | `src/lib/services/supabase/customers.ts:450` |
| service | table | `customers` | insert | `src/lib/services/supabase/customers.ts:461` |
| service | table | `customers` | update | `src/lib/services/supabase/customers.ts:583` |
| service | table | `inventory_checks` | insert | `src/lib/services/supabase/duplicate-services.ts:50` |
| service | table | `stock_transfers` | insert | `src/lib/services/supabase/duplicate-services.ts:96` |
| service | table | `disposal_exports` | insert | `src/lib/services/supabase/duplicate-services.ts:143` |
| service | table | `internal_sales` | insert | `src/lib/services/supabase/duplicate-services.ts:190` |
| service | table | `production_orders` | insert | `src/lib/services/supabase/duplicate-services.ts:237` |
| service | table | `uom_conversions` | insert | `src/lib/services/supabase/excel-import.ts:193` |
| service | table | `customers` | insert | `src/lib/services/supabase/excel-import.ts:259` |
| service | table | `suppliers` | insert | `src/lib/services/supabase/excel-import.ts:316` |
| service | table | `customers` | update | `src/lib/services/supabase/excel-import.ts:426` |
| service | table | `audit_log` | insert | `src/lib/services/supabase/excel-import.ts:432` |
| service | table | `suppliers` | update | `src/lib/services/supabase/excel-import.ts:449` |
| service | table | `audit_log` | insert | `src/lib/services/supabase/excel-import.ts:455` |
| service | table | `products` | update | `src/lib/services/supabase/excel-import.ts:601` |
| service | table | `bom_items` | delete | `src/lib/services/supabase/excel-import.ts:994` |
| service | rpc | `toggle_favorite` | execute | `src/lib/services/supabase/favorites.ts:62` |
| service | table | `floor_plan_decorations` | insert | `src/lib/services/supabase/floor-plan-decorations.ts:69` |
| service | table | `floor_plan_decorations` | update | `src/lib/services/supabase/floor-plan-decorations.ts:110` |
| service | table | `floor_plan_decorations` | delete | `src/lib/services/supabase/floor-plan-decorations.ts:122` |
| service | table | `floor_plan_zones` | insert | `src/lib/services/supabase/floor-plan.ts:81` |
| service | table | `floor_plan_zones` | update | `src/lib/services/supabase/floor-plan.ts:119` |
| service | table | `floor_plan_zones` | update | `src/lib/services/supabase/floor-plan.ts:132` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/floor-plan.ts:195` |
| service | table | `fnb_delivery_fee_tiers` | delete | `src/lib/services/supabase/fnb-delivery-tiers.ts:169` |
| service | table | `restaurant_tables` | insert | `src/lib/services/supabase/fnb-tables.ts:75` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/fnb-tables.ts:102` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/fnb-tables.ts:125` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/fnb-tables.ts:148` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/fnb-tables.ts:197` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/fnb-tables.ts:217` |
| service | table | `restaurant_tables` | insert | `src/lib/services/supabase/fnb-tables.ts:277` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/fnb-tables.ts:297` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/fnb-tables.ts:319` |
| service | table | `internal_sales` | update | `src/lib/services/supabase/internal-sales.ts:366` |
| service | table | `kitchen_orders` | insert | `src/lib/services/supabase/kitchen-orders.ts:254` |
| service | table | `kitchen_order_items` | insert | `src/lib/services/supabase/kitchen-orders.ts:307` |
| service | table | `kitchen_orders` | update | `src/lib/services/supabase/kitchen-orders.ts:423` |
| service | table | `kitchen_order_items` | update | `src/lib/services/supabase/kitchen-orders.ts:451` |
| service | table | `kitchen_order_items` | delete | `src/lib/services/supabase/kitchen-orders.ts:465` |
| service | table | `kitchen_orders` | update | `src/lib/services/supabase/kitchen-orders.ts:515` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/kitchen-orders.ts:533` |
| service | table | `kitchen_order_items` | update | `src/lib/services/supabase/kitchen-orders.ts:660` |
| service | table | `kitchen_orders` | update | `src/lib/services/supabase/kitchen-orders.ts:668` |
| service | table | `restaurant_tables` | update | `src/lib/services/supabase/kitchen-orders.ts:688` |
| service | table | `kitchen_orders` | update | `src/lib/services/supabase/kitchen-orders.ts:731` |
| service | table | `kitchen_stations` | insert | `src/lib/services/supabase/kitchen-stations.ts:156` |
| service | table | `kitchen_stations` | update | `src/lib/services/supabase/kitchen-stations.ts:202` |
| service | table | `kitchen_stations` | update | `src/lib/services/supabase/kitchen-stations.ts:229` |
| service | table | `categories` | update | `src/lib/services/supabase/kitchen-stations.ts:255` |
| service | table | `kpi_breakdowns` | insert | `src/lib/services/supabase/kpi-engine.ts:359` |
| service | table | `kpi_breakdowns` | insert | `src/lib/services/supabase/kpi-engine.ts:442` |
| service | table | `kpi_breakdowns` | update | `src/lib/services/supabase/kpi-engine.ts:547` |
| service | table | `loyalty_settings` | upsert | `src/lib/services/supabase/loyalty.ts:71` |
| service | table | `loyalty_tiers` | insert | `src/lib/services/supabase/loyalty.ts:128` |
| service | table | `loyalty_tiers` | update | `src/lib/services/supabase/loyalty.ts:192` |
| service | table | `loyalty_tiers` | delete | `src/lib/services/supabase/loyalty.ts:241` |
| service | rpc | `earn_loyalty_points` | execute | `src/lib/services/supabase/loyalty.ts:308` |
| service | table | `modifier_groups` | update | `src/lib/services/supabase/modifier-groups.ts:104` |
| service | table | `modifier_groups` | insert | `src/lib/services/supabase/modifier-groups.ts:120` |
| service | table | `modifier_groups` | update | `src/lib/services/supabase/modifier-groups.ts:146` |
| service | table | `modifier_groups` | update | `src/lib/services/supabase/modifier-groups.ts:160` |
| service | table | `modifier_options` | insert | `src/lib/services/supabase/modifier-groups.ts:191` |
| service | table | `modifier_options` | update | `src/lib/services/supabase/modifier-groups.ts:221` |
| service | table | `modifier_options` | update | `src/lib/services/supabase/modifier-groups.ts:234` |
| service | table | `modifier_groups` | update | `src/lib/services/supabase/modifier-groups.ts:341` |
| service | table | `modifier_groups` | insert | `src/lib/services/supabase/modifier-groups.ts:355` |
| service | table | `modifier_options` | insert | `src/lib/services/supabase/modifier-groups.ts:389` |
| service | table | `category_modifier_groups` | delete | `src/lib/services/supabase/modifier-groups.ts:458` |
| service | table | `category_modifier_groups` | insert | `src/lib/services/supabase/modifier-groups.ts:478` |
| service | table | `product_modifier_groups` | delete | `src/lib/services/supabase/modifier-groups.ts:539` |
| service | table | `product_modifier_groups` | insert | `src/lib/services/supabase/modifier-groups.ts:558` |
| service | table | `notifications` | update | `src/lib/services/supabase/notifications.ts:136` |
| service | table | `notifications` | update | `src/lib/services/supabase/notifications.ts:154` |
| service | table | `notifications` | delete | `src/lib/services/supabase/notifications.ts:175` |
| service | table | `notifications` | insert | `src/lib/services/supabase/notifications.ts:200` |
| service | table | `online_orders` | update | `src/lib/services/supabase/online-orders.ts:112` |
| service | table | `online_orders` | update | `src/lib/services/supabase/online-orders.ts:131` |
| service | rpc | `record_invoice_payment` | execute | `src/lib/services/supabase/payments.ts:46` |
| service | rpc | `record_purchase_payment` | execute | `src/lib/services/supabase/payments.ts:82` |
| service | table | `user_permission_overrides` | upsert | `src/lib/services/supabase/permission-overrides.ts:76` |
| service | table | `user_permission_overrides` | delete | `src/lib/services/supabase/permission-overrides.ts:102` |
| service | table | `pipeline_items` | insert | `src/lib/services/supabase/pipeline.ts:79` |
| service | rpc | `pipeline_transition` | execute | `src/lib/services/supabase/pipeline.ts:123` |
| service | rpc | `pipeline_get_allowed_transitions` | execute | `src/lib/services/supabase/pipeline.ts:137` |
| service | rpc | `pipeline_get_board` | execute | `src/lib/services/supabase/pipeline.ts:162` |
| service | rpc | `pipeline_get_timeline` | execute | `src/lib/services/supabase/pipeline.ts:191` |
| service | table | `agents` | update | `src/lib/services/supabase/playbook-engine.ts:359` |
| service | table | `price_tiers` | insert | `src/lib/services/supabase/pricing.ts:132` |
| service | table | `price_tiers` | update | `src/lib/services/supabase/pricing.ts:178` |
| service | table | `price_tiers` | update | `src/lib/services/supabase/pricing.ts:190` |
| service | table | `price_tiers` | insert | `src/lib/services/supabase/pricing.ts:233` |
| service | table | `price_tier_items` | insert | `src/lib/services/supabase/pricing.ts:263` |
| service | table | `price_tiers` | delete | `src/lib/services/supabase/pricing.ts:267` |
| service | table | `price_tier_items` | insert | `src/lib/services/supabase/pricing.ts:436` |
| service | table | `price_tier_items` | delete | `src/lib/services/supabase/pricing.ts:477` |
| service | table | `price_tier_items` | insert | `src/lib/services/supabase/pricing.ts:493` |
| service | table | `price_tier_items` | update | `src/lib/services/supabase/pricing.ts:528` |
| service | table | `price_tier_items` | delete | `src/lib/services/supabase/pricing.ts:554` |
| service | table | `print_templates` | update | `src/lib/services/supabase/print-templates-engine.ts:162` |
| service | table | `print_templates` | insert | `src/lib/services/supabase/print-templates-engine.ts:192` |
| service | table | `print_templates` | update | `src/lib/services/supabase/print-templates-engine.ts:233` |
| service | table | `print_templates` | update | `src/lib/services/supabase/print-templates-engine.ts:250` |
| service | rpc | `complete_production_order` | execute | `src/lib/services/supabase/production.ts:201` |
| service | rpc | `consume_production_materials` | execute | `src/lib/services/supabase/production.ts:214` |
| service | rpc | `get_lots_for_product` | execute | `src/lib/services/supabase/production.ts:399` |
| service | rpc | `allocate_lots_fifo` | execute | `src/lib/services/supabase/production.ts:438` |
| service | rpc | `check_expiring_lots` | execute | `src/lib/services/supabase/production.ts:459` |
| service | table | `product_lots` | insert | `src/lib/services/supabase/production.ts:504` |
| service | table | `products` | insert | `src/lib/services/supabase/products.ts:1297` |
| service | table | `products` | update | `src/lib/services/supabase/products.ts:1387` |
| service | table | `products` | update | `src/lib/services/supabase/products.ts:1523` |
| service | table | `products` | update | `src/lib/services/supabase/products.ts:1530` |
| service | table | `products` | update | `src/lib/services/supabase/products.ts:1552` |
| service | table | `products` | update | `src/lib/services/supabase/products.ts:1580` |
| service | table | `products` | insert | `src/lib/services/supabase/products.ts:1981` |
| service | table | `promotions` | insert | `src/lib/services/supabase/promotions.ts:165` |
| service | table | `promotions` | update | `src/lib/services/supabase/promotions.ts:236` |
| service | table | `promotions` | delete | `src/lib/services/supabase/promotions.ts:282` |
| service | table | `promotion_settings` | upsert | `src/lib/services/supabase/promotions.ts:354` |
| service | table | `input_invoices` | delete | `src/lib/services/supabase/purchase-entries.ts:418` |
| service | table | `input_invoices` | update | `src/lib/services/supabase/purchase-entries.ts:471` |
| service | table | `input_invoices` | update | `src/lib/services/supabase/purchase-entries.ts:479` |
| service | table | `input_invoices` | update | `src/lib/services/supabase/purchase-entries.ts:524` |
| service | rpc | `create_supplier_return_atomic` | execute | `src/lib/services/supabase/purchase-entries.ts:579` |
| service | rpc | `get_user_permissions` | execute | `src/lib/services/supabase/roles.ts:198` |
| service | table | `shifts` | insert | `src/lib/services/supabase/shifts.ts:76` |
| service | table | `delivery_partners` | update | `src/lib/services/supabase/shipping.ts:403` |
| service | table | `delivery_partners` | update | `src/lib/services/supabase/shipping.ts:422` |
| service | rpc | `next_code` | execute | `src/lib/services/supabase/stock-adjustments.ts:150` |
| service | table | `suppliers` | insert | `src/lib/services/supabase/suppliers.ts:191` |
| service | table | `suppliers` | update | `src/lib/services/supabase/suppliers.ts:320` |
| service | table | `uom_conversions` | insert | `src/lib/services/supabase/uom.ts:66` |
| service | table | `uom_conversions` | update | `src/lib/services/supabase/uom.ts:98` |
| service | table | `uom_conversions` | update | `src/lib/services/supabase/uom.ts:109` |
| service | table | `products` | update | `src/lib/services/supabase/uom.ts:239` |
| service | table | `product_variants` | update | `src/lib/services/supabase/variants.ts:141` |

## File có truy cập dữ liệu nhưng chưa thấy catch

| Nơi chạy | Số điểm gọi | File |
|---|---:|---|
| page | 1 | `src/app/(auth)/quen-mat-khau/page.tsx` |
| server-route | 1 | `src/app/api/mkt/v1/audit-runner/ai-links/route.ts` |
| server-route | 1 | `src/app/api/mkt/v1/notifications/read/route.ts` |
| server-route | 1 | `src/app/api/mkt/v1/telegram/link-token/route.ts` |
| component | 1 | `src/components/shared/import-export-buttons.tsx` |
| library | 2 | `src/lib/admin/managed-user-scope.ts` |
| library | 1 | `src/lib/permissions/server.ts` |
| service | 2 | `src/lib/services/supabase/abc-analysis.ts` |
| service | 19 | `src/lib/services/supabase/bom.ts` |
| service | 6 | `src/lib/services/supabase/branch-stock.ts` |
| service | 3 | `src/lib/services/supabase/branches.ts` |
| service | 3 | `src/lib/services/supabase/cash-book.ts` |
| service | 13 | `src/lib/services/supabase/categories.ts` |
| service | 5 | `src/lib/services/supabase/conversations.ts` |
| service | 4 | `src/lib/services/supabase/customer-saved-views.ts` |
| service | 13 | `src/lib/services/supabase/dashboard.ts` |
| service | 2 | `src/lib/services/supabase/debt.ts` |
| service | 10 | `src/lib/services/supabase/duplicate-services.ts` |
| service | 4 | `src/lib/services/supabase/favorites.ts` |
| service | 6 | `src/lib/services/supabase/floor-plan.ts` |
| service | 19 | `src/lib/services/supabase/fnb-analytics.ts` |
| service | 3 | `src/lib/services/supabase/fnb-delivery-tiers.ts` |
| service | 2 | `src/lib/services/supabase/fnb-platform-settings.ts` |
| service | 11 | `src/lib/services/supabase/fnb-tables.ts` |
| service | 9 | `src/lib/services/supabase/internal-sales.ts` |
| service | 2 | `src/lib/services/supabase/inventory-check-report.ts` |
| service | 4 | `src/lib/services/supabase/inventory.ts` |
| service | 12 | `src/lib/services/supabase/invoices.ts` |
| service | 8 | `src/lib/services/supabase/kitchen-stations.ts` |
| service | 22 | `src/lib/services/supabase/modifier-groups.ts` |
| service | 6 | `src/lib/services/supabase/notifications.ts` |
| service | 6 | `src/lib/services/supabase/online-orders.ts` |
| service | 5 | `src/lib/services/supabase/payments.ts` |
| service | 3 | `src/lib/services/supabase/permission-overrides.ts` |
| service | 10 | `src/lib/services/supabase/pipeline.ts` |
| service | 3 | `src/lib/services/supabase/platform-prices.ts` |
| service | 1 | `src/lib/services/supabase/pos-pin.ts` |
| service | 2 | `src/lib/services/supabase/pos-stock.ts` |
| service | 24 | `src/lib/services/supabase/pricing.ts` |
| service | 8 | `src/lib/services/supabase/print-templates-engine.ts` |
| service | 8 | `src/lib/services/supabase/production-dashboard.ts` |
| service | 11 | `src/lib/services/supabase/production.ts` |
| service | 5 | `src/lib/services/supabase/promotion-analytics.ts` |
| service | 9 | `src/lib/services/supabase/purchase-forecast.ts` |
| service | 5 | `src/lib/services/supabase/purchase-orders.ts` |
| service | 3 | `src/lib/services/supabase/returns.ts` |
| service | 9 | `src/lib/services/supabase/roles.ts` |
| service | 12 | `src/lib/services/supabase/shifts.ts` |
| service | 7 | `src/lib/services/supabase/shipping.ts` |
| service | 1 | `src/lib/services/supabase/split-bill.ts` |
| service | 1 | `src/lib/services/supabase/stock-adjustments.ts` |
| service | 3 | `src/lib/services/supabase/stock-documents.ts` |
| service | 1 | `src/lib/services/supabase/stock-forecast.ts` |
| service | 3 | `src/lib/services/supabase/tenant-settings.ts` |
| service | 3 | `src/lib/services/supabase/transfers.ts` |
| service | 7 | `src/lib/services/supabase/uom.ts` |
| service | 3 | `src/lib/services/supabase/variants.ts` |

## Cách sử dụng kết quả

- Mỗi điểm ghi nhạy cảm phải được đối chiếu quyền, tenant, chi nhánh và trạng thái chứng từ.
- RPC phải được kiểm tra owner, `SECURITY DEFINER`, `search_path`, quyền EXECUTE và audit log.
- Danh sách `chưa thấy catch` là tín hiệu rà soát, không mặc nhiên là lỗi.
