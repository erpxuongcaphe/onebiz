-- ============================================================
-- 00115: Seed FULL permissions cho mọi role (CEO 26/05/2026)
-- ============================================================
--
-- BỐI CẢNH: Em phát hiện sau khi fix RPC ambiguity (migration 00114),
-- user HT (Admin role) chỉ thấy ~33 items sidebar — THIẾU:
--   - Khách hàng (/khach-hang)
--   - Nhà cung cấp (/hang-hoa/nha-cung-cap)
--   - Nhóm hàng (/hang-hoa/nhom)
--   - Sản phẩm (/hang-hoa)
--   - Báo cáo (/phan-tich/* — 30 pages)
--
-- ROOT CAUSE: Migration 00019 (RBAC schema) chỉ tạo table, không seed
-- defaults. Migration 00113 chỉ seed 5 production.* codes. Các
-- permissions khác (products.*, customers.*, suppliers.*, reports.*,
-- finance.*, inventory.*, pos_*, orders.*, invoices.*, system.*)
-- chưa được seed → sidebar filter các menu items này ra hết.
--
-- FIX: Seed full permission set theo DEFAULT_ROLE_TEMPLATES trong
-- src/lib/permissions/constants.ts cho mọi role hiện có.
--
-- Idempotent: ON CONFLICT DO NOTHING — chạy nhiều lần không lỗi.
-- ============================================================

DO $$
DECLARE
  v_role record;
  v_perm text;
  -- ALL permission codes (76 codes total)
  v_all_perms text[] := ARRAY[
    -- POS FnB (11)
    'pos_fnb.send_kitchen','pos_fnb.void','pos_fnb.cancel_unpaid_order',
    'pos_fnb.void_paid_bill','pos_fnb.edit_sent_order','pos_fnb.discount',
    'pos_fnb.view_orders','pos_fnb.manage_tables','pos_fnb.split_bill',
    'pos_fnb.transfer_table','pos_fnb.edit_price',
    -- POS Retail (5)
    'pos_retail.checkout','pos_retail.void','pos_retail.discount',
    'pos_retail.save_draft','pos_retail.edit_price',
    -- Inventory (7)
    'inventory.view','inventory.adjust','inventory.create_po',
    'inventory.dispose','inventory.internal_export','inventory.transfer',
    'inventory.check',
    -- Production (5)
    'production.view','production.create_order','production.complete_order',
    'production.cancel_order','production.manage_bom',
    -- Finance (4)
    'finance.view_cash_book','finance.create_transaction',
    'finance.view_reports','finance.void_transaction',
    -- Products (11)
    'products.view','products.create','products.edit','products.delete',
    'products.manage_prices','products.view_cost','products.view_profit',
    'products.import','products.export','products.print_barcode',
    'products.duplicate',
    -- Customers (7)
    'customers.view','customers.create','customers.edit','customers.delete',
    'customers.view_debt','customers.import','customers.export',
    -- Suppliers (7)
    'suppliers.view','suppliers.create','suppliers.edit','suppliers.delete',
    'suppliers.view_debt','suppliers.import','suppliers.export',
    -- Orders (6)
    'orders.view','orders.create','orders.cancel','orders.print',
    'orders.export','orders.view_own_only',
    -- Invoices (3)
    'invoices.view','invoices.print','invoices.export',
    -- System (5)
    'system.manage_users','system.manage_branches','system.manage_roles',
    'system.view_audit','system.issue_otp',
    -- Reports (5)
    'reports.dashboard','reports.analytics','reports.fnb','reports.export',
    'reports.view_profit'
  ];

  -- Manager subset (no system.manage_users/branches/roles, no orders.view_own_only)
  v_manager_perms text[] := ARRAY[
    -- POS full
    'pos_fnb.send_kitchen','pos_fnb.void','pos_fnb.cancel_unpaid_order',
    'pos_fnb.void_paid_bill','pos_fnb.edit_sent_order','pos_fnb.discount',
    'pos_fnb.view_orders','pos_fnb.manage_tables','pos_fnb.split_bill',
    'pos_fnb.transfer_table','pos_fnb.edit_price',
    'pos_retail.checkout','pos_retail.void','pos_retail.discount',
    'pos_retail.save_draft','pos_retail.edit_price',
    -- Inventory full
    'inventory.view','inventory.adjust','inventory.create_po',
    'inventory.dispose','inventory.internal_export','inventory.transfer',
    'inventory.check',
    -- Production full
    'production.view','production.create_order','production.complete_order',
    'production.cancel_order','production.manage_bom',
    -- Finance view+create
    'finance.view_cash_book','finance.create_transaction','finance.view_reports',
    -- Products full
    'products.view','products.create','products.edit','products.delete',
    'products.manage_prices','products.view_cost','products.view_profit',
    'products.import','products.export','products.print_barcode',
    'products.duplicate',
    -- Customers full
    'customers.view','customers.create','customers.edit','customers.delete',
    'customers.view_debt','customers.import','customers.export',
    -- Suppliers full
    'suppliers.view','suppliers.create','suppliers.edit','suppliers.delete',
    'suppliers.view_debt','suppliers.import','suppliers.export',
    -- Orders (no view_own_only constraint)
    'orders.view','orders.create','orders.cancel','orders.print','orders.export',
    -- Invoices full
    'invoices.view','invoices.print','invoices.export',
    -- Reports full
    'reports.dashboard','reports.analytics','reports.fnb','reports.export',
    'reports.view_profit',
    -- System partial
    'system.view_audit','system.issue_otp'
  ];
BEGIN
  FOR v_role IN SELECT id, name FROM public.roles LOOP
    IF v_role.name = 'Chủ cửa hàng' THEN
      -- Owner: ALL permissions (76)
      FOREACH v_perm IN ARRAY v_all_perms LOOP
        INSERT INTO public.role_permissions (role_id, permission_code)
        VALUES (v_role.id, v_perm)
        ON CONFLICT (role_id, permission_code) DO NOTHING;
      END LOOP;
      RAISE NOTICE 'Seeded % permissions for role: % (%)',
        array_length(v_all_perms, 1), v_role.name, v_role.id;

    ELSIF v_role.name = 'Admin' THEN
      -- Admin: ALL except system.manage_roles
      FOREACH v_perm IN ARRAY v_all_perms LOOP
        IF v_perm != 'system.manage_roles' THEN
          INSERT INTO public.role_permissions (role_id, permission_code)
          VALUES (v_role.id, v_perm)
          ON CONFLICT (role_id, permission_code) DO NOTHING;
        END IF;
      END LOOP;
      RAISE NOTICE 'Seeded % permissions for role: % (%)',
        array_length(v_all_perms, 1) - 1, v_role.name, v_role.id;

    ELSIF v_role.name = 'Quản lý' THEN
      -- Manager: subset
      FOREACH v_perm IN ARRAY v_manager_perms LOOP
        INSERT INTO public.role_permissions (role_id, permission_code)
        VALUES (v_role.id, v_perm)
        ON CONFLICT (role_id, permission_code) DO NOTHING;
      END LOOP;
      RAISE NOTICE 'Seeded % permissions for role: % (%)',
        array_length(v_manager_perms, 1), v_role.name, v_role.id;
    END IF;
    -- Cashier / Phục vụ / Kho vận / Kế toán: giữ permissions hiện có,
    -- không seed thêm. Owner/admin có quyền cấp thủ công qua UI.
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
