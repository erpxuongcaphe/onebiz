-- Sales Module Permissions
-- Add sales permissions to default roles

-- =====================================================
-- UPDATE DEFAULT ROLES WITH SALES PERMISSIONS
-- =====================================================

-- Super Admin already has "*" (all permissions)

-- Admin: Add sales permissions
UPDATE public.roles
SET permissions = permissions || '["sales_orders.*", "delivery_orders.*"]'::jsonb
WHERE is_system = true 
  AND name = 'Admin'
  AND NOT (permissions ? 'sales_orders.*');

-- Manager: Add read-only sales permissions
UPDATE public.roles
SET permissions = permissions || '["sales_orders.view", "sales_orders.create", "delivery_orders.view", "delivery_orders.create"]'::jsonb
WHERE is_system = true 
  AND name = 'Manager'
  AND NOT (permissions ? 'sales_orders.view');

-- Note: Permissions are stored as JSON patterns in roles.permissions
-- Example patterns:
--   "sales_orders.*"         -> All sales order permissions
--   "sales_orders.view"      -> View sales orders
--   "sales_orders.create"    -> Create sales orders
--   "sales_orders.update"    -> Update sales orders
--   "sales_orders.delete"    -> Delete sales orders
--   "sales_orders.confirm"   -> Confirm sales orders
--   "sales_orders.cancel"    -> Cancel sales orders
--   "delivery_orders.*"      -> All delivery order permissions
--   "delivery_orders.view"   -> View delivery orders
--   "delivery_orders.create" -> Create delivery orders
--   "delivery_orders.complete" -> Complete delivery orders
--   "delivery_orders.cancel" -> Cancel delivery orders
