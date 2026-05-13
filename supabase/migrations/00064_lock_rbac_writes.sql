-- ============================================================
-- 00064: Lock RLS writes cho roles + role_permissions
--
-- CEO 12/05/2026 audit phát hiện PRIVILEGE ESCALATION:
--   Policy hiện tại (00019:60-73) cho phép BẤT KỲ user nào trong tenant
--   INSERT/UPDATE/DELETE row vào role_permissions vì chỉ check tenant_id,
--   KHÔNG check permission system.manage_roles.
--
--   Cashier có Supabase JS client có thể tự cấp permission cho mình:
--     await supabase.from("role_permissions").insert({
--       role_id: "<cashier's role>",
--       permission_code: "products.delete"
--     });
--   → Bypass toàn bộ UI gate, defense-in-depth bị thủng.
--
-- Fix: thay 6 policy bằng 2 policy mới — yêu cầu owner HOẶC có quyền
-- system.manage_roles mới được write. SELECT vẫn cho phép trong tenant
-- (cần để UI hiện list role).
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Drop các policy WRITE cũ
-- ────────────────────────────────────────────────────────────────
drop policy if exists "roles_insert" on public.roles;
drop policy if exists "roles_update" on public.roles;
drop policy if exists "roles_delete" on public.roles;
drop policy if exists "role_permissions_insert" on public.role_permissions;
drop policy if exists "role_permissions_update" on public.role_permissions;
drop policy if exists "role_permissions_delete" on public.role_permissions;

-- ────────────────────────────────────────────────────────────────
-- 2. Policy WRITE mới: chỉ owner hoặc system.manage_roles
-- ────────────────────────────────────────────────────────────────
-- Helper check: actor có quyền sửa role không?
-- Inline thay vì tạo function riêng để policy planner inline được.

create policy "roles_insert_admin_only" on public.roles
  for insert
  with check (
    tenant_id = public.get_user_tenant_id()
    and (
      public.user_has_permission(auth.uid(), 'system.manage_roles')
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'owner'
      )
    )
  );

create policy "roles_update_admin_only" on public.roles
  for update
  using (
    tenant_id = public.get_user_tenant_id()
    and (
      public.user_has_permission(auth.uid(), 'system.manage_roles')
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'owner'
      )
    )
  );

create policy "roles_delete_admin_only" on public.roles
  for delete
  using (
    tenant_id = public.get_user_tenant_id()
    and (
      public.user_has_permission(auth.uid(), 'system.manage_roles')
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'owner'
      )
    )
  );

create policy "role_permissions_insert_admin_only" on public.role_permissions
  for insert
  with check (
    exists (
      select 1 from public.roles
      where roles.id = role_permissions.role_id
        and roles.tenant_id = public.get_user_tenant_id()
    )
    and (
      public.user_has_permission(auth.uid(), 'system.manage_roles')
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'owner'
      )
    )
  );

create policy "role_permissions_update_admin_only" on public.role_permissions
  for update
  using (
    exists (
      select 1 from public.roles
      where roles.id = role_permissions.role_id
        and roles.tenant_id = public.get_user_tenant_id()
    )
    and (
      public.user_has_permission(auth.uid(), 'system.manage_roles')
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'owner'
      )
    )
  );

create policy "role_permissions_delete_admin_only" on public.role_permissions
  for delete
  using (
    exists (
      select 1 from public.roles
      where roles.id = role_permissions.role_id
        and roles.tenant_id = public.get_user_tenant_id()
    )
    and (
      public.user_has_permission(auth.uid(), 'system.manage_roles')
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'owner'
      )
    )
  );

-- Lưu ý: SELECT policy "roles_select" và "role_permissions_select" của
-- 00019 vẫn giữ nguyên — UI cần đọc list role để hiển thị cho user.
-- Cashier vẫn xem được role nào tồn tại nhưng không sửa được.

-- ────────────────────────────────────────────────────────────────
-- 3. Rollback (nếu cần revert): chạy block sau
-- ────────────────────────────────────────────────────────────────
-- drop policy if exists "roles_insert_admin_only" on public.roles;
-- drop policy if exists "roles_update_admin_only" on public.roles;
-- drop policy if exists "roles_delete_admin_only" on public.roles;
-- drop policy if exists "role_permissions_insert_admin_only" on public.role_permissions;
-- drop policy if exists "role_permissions_update_admin_only" on public.role_permissions;
-- drop policy if exists "role_permissions_delete_admin_only" on public.role_permissions;
--
-- create policy "roles_insert" on public.roles
--   for insert with check (tenant_id = get_user_tenant_id());
-- create policy "roles_update" on public.roles
--   for update using (tenant_id = get_user_tenant_id());
-- create policy "roles_delete" on public.roles
--   for delete using (tenant_id = get_user_tenant_id());
-- create policy "role_permissions_insert" on public.role_permissions
--   for insert with check (
--     exists (select 1 from public.roles where roles.id = role_permissions.role_id and roles.tenant_id = get_user_tenant_id())
--   );
-- create policy "role_permissions_update" on public.role_permissions
--   for update using (
--     exists (select 1 from public.roles where roles.id = role_permissions.role_id and roles.tenant_id = get_user_tenant_id())
--   );
-- create policy "role_permissions_delete" on public.role_permissions
--   for delete using (
--     exists (select 1 from public.roles where roles.id = role_permissions.role_id and roles.tenant_id = get_user_tenant_id())
--   );

notify pgrst, 'reload schema';
