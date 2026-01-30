-- ============================================
-- PERMISSIONS FOR PURCHASE MODULE
-- ============================================

-- Check if permissions table exists (from RBAC system)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'permissions') then
    
    -- Suppliers permissions
    insert into public.permissions (code, name, description, category) values
      ('suppliers.view', 'Xem nhà cung cấp', 'View suppliers', 'purchase'),
      ('suppliers.create', 'Tạo nhà cung cấp', 'Create suppliers', 'purchase'),
      ('suppliers.update', 'Sửa nhà cung cấp', 'Update suppliers', 'purchase'),
      ('suppliers.delete', 'Xóa nhà cung cấp', 'Delete suppliers', 'purchase')
    on conflict (code) do nothing;
    
    -- Purchase Orders permissions
    insert into public.permissions (code, name, description, category) values
      ('purchase_orders.view', 'Xem đơn đặt hàng', 'View purchase orders', 'purchase'),
      ('purchase_orders.create', 'Tạo đơn đặt hàng', 'Create purchase orders', 'purchase'),
      ('purchase_orders.update', 'Sửa đơn đặt hàng', 'Update purchase orders', 'purchase'),
      ('purchase_orders.approve', 'Duyệt đơn đặt hàng', 'Approve purchase orders', 'purchase'),
      ('purchase_orders.cancel', 'Hủy đơn đặt hàng', 'Cancel purchase orders', 'purchase'),
      ('purchase_orders.delete', 'Xóa đơn đặt hàng', 'Delete purchase orders', 'purchase')
    on conflict (code) do nothing;
    
    -- Goods Receipts permissions
    insert into public.permissions (code, name, description, category) values
      ('goods_receipts.view', 'Xem phiếu nhập', 'View goods receipts', 'purchase'),
      ('goods_receipts.create', 'Tạo phiếu nhập', 'Create goods receipts', 'purchase'),
      ('goods_receipts.update', 'Sửa phiếu nhập', 'Update goods receipts', 'purchase'),
      ('goods_receipts.complete', 'Hoàn tất nhập kho', 'Complete receipts and update stock', 'purchase'),
      ('goods_receipts.void', 'Hủy phiếu nhập', 'Void goods receipts', 'purchase'),
      ('goods_receipts.delete', 'Xóa phiếu nhập', 'Delete goods receipts', 'purchase')
    on conflict (code) do nothing;
    
    raise notice 'Purchase module permissions inserted successfully';
  else
    raise notice 'Permissions table does not exist, skipping permission insertion';
  end if;
end $$;

-- Grant default permissions to admin role (if role_permissions table exists)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'role_permissions') then
    -- Grant all purchase permissions to admin role
    insert into public.role_permissions (role_id, permission_id)
    select 
      r.id as role_id,
      p.id as permission_id
    from public.roles r
    cross join public.permissions p
    where r.name = 'Admin'
      and p.category = 'purchase'
    on conflict do nothing;
    
    raise notice 'Purchase permissions granted to Admin role';
  end if;
end $$;
