-- Purchase Module Permissions
-- Add purchase permissions to default roles

-- =====================================================
-- UPDATE DEFAULT ROLES WITH PURCHASE PERMISSIONS
-- =====================================================

-- Super Admin already has "*" (all permissions)

-- Admin: Add purchase permissions
UPDATE public.roles
SET permissions = permissions || '["suppliers.*", "purchase_orders.*", "goods_receipts.*"]'::jsonb
WHERE is_system = true 
  AND name = 'Admin'
  AND NOT (permissions ? 'suppliers.*');

-- Manager: Add purchase permissions (full access to manage purchases)
UPDATE public.roles
SET permissions = permissions || '["suppliers.*", "purchase_orders.*", "goods_receipts.*"]'::jsonb
WHERE is_system = true 
  AND name = 'Manager'
  AND NOT (permissions ? 'suppliers.*');

-- Note: Permissions are stored as JSON patterns in roles.permissions
-- Example patterns:
--   "suppliers.*"              -> All supplier permissions
--   "suppliers.view"           -> View suppliers
--   "suppliers.create"         -> Create suppliers
--   "suppliers.update"         -> Update suppliers
--   "suppliers.delete"         -> Delete suppliers
--   "purchase_orders.*"        -> All purchase order permissions
--   "purchase_orders.view"     -> View purchase orders
--   "purchase_orders.create"   -> Create purchase orders
--   "purchase_orders.update"   -> Update purchase orders
--   "purchase_orders.delete"   -> Delete purchase orders
--   "purchase_orders.confirm"  -> Confirm purchase orders
--   "purchase_orders.cancel"   -> Cancel purchase orders
--   "goods_receipts.*"         -> All goods receipt permissions
--   "goods_receipts.view"      -> View goods receipts
--   "goods_receipts.create"    -> Create goods receipts
--   "goods_receipts.void"      -> Void goods receipts
