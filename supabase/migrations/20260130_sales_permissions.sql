-- Sales Module Permissions
-- RBAC permissions for sales orders and delivery orders

-- =====================================================
-- SALES ORDERS PERMISSIONS
-- =====================================================

-- View sales orders
INSERT INTO permissions (name, description, category)
VALUES ('sales_orders.view', 'Xem đơn bán hàng', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Create sales orders
INSERT INTO permissions (name, description, category)
VALUES ('sales_orders.create', 'Tạo đơn bán hàng mới', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Update sales orders
INSERT INTO permissions (name, description, category)
VALUES ('sales_orders.update', 'Sửa đơn bán hàng', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Delete sales orders
INSERT INTO permissions (name, description, category)
VALUES ('sales_orders.delete', 'Xóa đơn bán hàng nháp', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Confirm sales orders
INSERT INTO permissions (name, description, category)
VALUES ('sales_orders.confirm', 'Xác nhận đơn bán hàng', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Cancel sales orders
INSERT INTO permissions (name, description, category)
VALUES ('sales_orders.cancel', 'Hủy đơn bán hàng', 'sales')
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- DELIVERY ORDERS PERMISSIONS
-- =====================================================

-- View delivery orders
INSERT INTO permissions (name, description, category)
VALUES ('delivery_orders.view', 'Xem phiếu xuất kho', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Create delivery orders
INSERT INTO permissions (name, description, category)
VALUES ('delivery_orders.create', 'Tạo phiếu xuất kho', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Complete delivery orders
INSERT INTO permissions (name, description, category)
VALUES ('delivery_orders.complete', 'Hoàn tất giao hàng', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Cancel delivery orders
INSERT INTO permissions (name, description, category)
VALUES ('delivery_orders.cancel', 'Hủy phiếu xuất kho', 'sales')
ON CONFLICT (name) DO NOTHING;
