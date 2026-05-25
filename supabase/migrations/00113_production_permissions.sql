-- ============================================================
-- 00113: Production permissions — seed cho tenants hiện có
--
-- BỐI CẢNH (CEO 25/05/2026):
-- Admin "Cao Thị Huy" báo: vào /he-thong/users → Quyền tuỳ chỉnh
-- KHÔNG thấy group "Sản xuất". Hậu quả: không cấp được quyền SX riêng,
-- phải tick "Xem tồn kho" (inventory.view) để unlock cả menu SX → confusing.
--
-- Root cause: Nav-config 4 items group "Sản xuất" (Dashboard SX, Lệnh SX,
-- BOM, Lô SX) đều require permission `inventory.view`. UI permission grid
-- không có group "Sản xuất" riêng.
--
-- FIX:
-- 1. Frontend: thêm 5 permission codes mới production.* + UI group
--    "Sản xuất" (đã commit cùng migration này).
-- 2. Nav-config: đổi 4 items từ inventory.view → production.view (+
--    production.manage_bom cho BOM).
-- 3. Migration này: seed production.* vào role_permissions cho mọi role
--    hiện có theo template:
--    - owner   → tất cả 5 codes
--    - admin   → tất cả 5 codes
--    - manager → tất cả 5 codes (vì SX là task quản lý)
--    - cashier / staff → KHÔNG
--
-- KHÔNG break existing flow: inventory.view vẫn tồn tại + vẫn được dùng
-- cho menu kho. Chỉ là menu SX bây giờ KHÔNG còn dùng inventory.view nữa.
-- ============================================================

do $$
declare
  v_tenant record;
  v_role record;
  v_codes text[] := array[
    'production.view',
    'production.create_order',
    'production.complete_order',
    'production.cancel_order',
    'production.manage_bom'
  ];
  v_code text;
  v_grant_roles text[] := array['Chủ cửa hàng', 'Admin', 'Quản lý'];
begin
  -- Loop qua mọi tenant + mọi role có name thuộc v_grant_roles
  for v_role in
    select r.id, r.name, r.tenant_id, t.name as tenant_name
    from public.roles r
    join public.tenants t on t.id = r.tenant_id
    where r.name = any(v_grant_roles)
  loop
    foreach v_code in array v_codes loop
      -- Upsert: skip nếu đã tồn tại (unique constraint)
      insert into public.role_permissions (role_id, permission_code)
      values (v_role.id, v_code)
      on conflict (role_id, permission_code) do nothing;
    end loop;
    raise notice 'Seeded 5 production perms cho role % (tenant %)',
      v_role.name, v_role.tenant_name;
  end loop;
end $$;

-- Reload PostgREST schema cache để API lập tức nhìn thấy permissions mới
notify pgrst, 'reload schema';
