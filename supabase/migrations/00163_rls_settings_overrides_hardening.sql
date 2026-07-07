-- ============================================================
-- 00163 — Bịt 3 lỗ RLS: tenant_settings, fnb_delivery_fee_tiers, override self-grant
-- ============================================================
-- CEO 06/07/2026 (audit toàn web): 2 bảng tạo SAU đợt siết RLS 00014 nên KHÔNG
-- bật RLS → user tenant khác đọc/ghi trực tiếp qua REST (anon key) được:
--   - tenant_settings (00095): allow_negative_stock, cấu hình loyalty... — tamper.
--   - fnb_delivery_fee_tiers (00108): phí giao hàng — sửa chéo tenant.
-- Và user_permission_overrides (00112) CÓ RLS nhưng policy `FOR ALL USING
-- (tenant_id...)` THIẾU kiểm owner/admin + thiếu WITH CHECK → nhân viên thường
-- tự INSERT dòng cấp quyền cho chính mình (vd pos_fnb.void_paid_bill, giảm giá).
--
-- FIX: bật RLS + policy tenant-isolation cho 2 bảng; siết policy override để CHỈ
-- owner/admin được GHI (đọc vẫn cho tenant để UI quản trị liệt kê). Các RPC
-- SECURITY DEFINER (set_tenant_setting, get_user_permissions...) bypass RLS nên
-- không ảnh hưởng luồng hợp lệ.
-- ============================================================

-- ── 1. tenant_settings ──
alter table public.tenant_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies
    where tablename = 'tenant_settings' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on public.tenant_settings
      for all
      using (tenant_id = public.get_user_tenant_id())
      with check (tenant_id = public.get_user_tenant_id());
  end if;
end $$;

-- ── 2. fnb_delivery_fee_tiers ──
alter table public.fnb_delivery_fee_tiers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies
    where tablename = 'fnb_delivery_fee_tiers' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on public.fnb_delivery_fee_tiers
      for all
      using (tenant_id = public.get_user_tenant_id())
      with check (tenant_id = public.get_user_tenant_id());
  end if;
end $$;

-- ── 3. user_permission_overrides — chống tự cấp quyền ──
-- Bỏ policy cũ (FOR ALL chỉ check tenant → ai trong tenant cũng ghi được).
drop policy if exists tenant_isolation on public.user_permission_overrides;

-- Đọc: mọi thành viên tenant (để trang quản trị liệt kê override của tenant).
do $$ begin
  if not exists (select 1 from pg_policies
    where tablename = 'user_permission_overrides' and policyname = 'overrides_read') then
    create policy overrides_read on public.user_permission_overrides
      for select
      using (tenant_id = public.get_user_tenant_id());
  end if;
end $$;

-- Ghi (insert/update/delete): CHỈ owner/admin của đúng tenant.
do $$ begin
  if not exists (select 1 from pg_policies
    where tablename = 'user_permission_overrides' and policyname = 'overrides_admin_write') then
    create policy overrides_admin_write on public.user_permission_overrides
      for all
      using (
        tenant_id = public.get_user_tenant_id()
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.tenant_id = user_permission_overrides.tenant_id
            and p.role in ('owner', 'admin')
        )
      )
      with check (
        tenant_id = public.get_user_tenant_id()
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.tenant_id = user_permission_overrides.tenant_id
            and p.role in ('owner', 'admin')
        )
      );
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY sau khi áp:
--   select tablename, rowsecurity from pg_tables
--   where tablename in ('tenant_settings','fnb_delivery_fee_tiers','user_permission_overrides');
--   -- rowsecurity = true cả 3
--   select tablename, policyname, cmd from pg_policies
--   where tablename in ('tenant_settings','fnb_delivery_fee_tiers','user_permission_overrides')
--   order by tablename, policyname;
-- Nghiệm thu chức năng: đăng nhập owner → vào Cài đặt sửa được (RPC definer);
--   vào trang phân quyền cấp/thu quyền cho nhân viên vẫn OK.
-- ============================================================
