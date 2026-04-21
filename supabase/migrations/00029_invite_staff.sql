-- ============================================================
-- Migration 00029 — Invite Staff Flow
-- ============================================================
-- Cho phép admin mời nhân viên join vào tenant hiện có (thay vì mỗi
-- signup tạo tenant mới). Logic:
--   - Nếu raw_user_meta_data có `invited_tenant_id` → link vào tenant đó
--     + dùng `invited_branch_id`, `invited_role_id`, `phone`, `full_name`.
--   - Nếu không → giữ nguyên flow owner-signup cũ (tạo tenant mới).
--
-- Flow nghiệp vụ:
--   1. Admin vào trang he-thong/users → click "Mời nhân viên"
--   2. Form: email + họ tên + số ĐT + chi nhánh + vai trò
--   3. App gọi supabase.auth.signInWithOtp({ email, options: { data: {...} } })
--      → Supabase gửi magic link về email của nhân viên
--   4. Nhân viên click link → auth.users.insert → trigger này fire
--      → đọc metadata → tạo profile link đúng tenant/branch/role
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
  store_name text;
  user_name text;
  invited_tenant uuid;
  invited_branch uuid;
  invited_role uuid;
  invited_phone text;
begin
  -- ── Invited staff path ──
  -- Admin pre-populated metadata khi gọi signInWithOtp / inviteUserByEmail.
  invited_tenant := nullif(new.raw_user_meta_data ->> 'invited_tenant_id', '')::uuid;

  if invited_tenant is not null then
    -- Validate tenant tồn tại trước khi dùng
    if not exists (select 1 from public.tenants where id = invited_tenant) then
      raise exception 'Invited tenant_id % không tồn tại', invited_tenant;
    end if;

    invited_branch := nullif(new.raw_user_meta_data ->> 'invited_branch_id', '')::uuid;
    invited_role   := nullif(new.raw_user_meta_data ->> 'invited_role_id', '')::uuid;
    invited_phone  := new.raw_user_meta_data ->> 'phone';
    user_name      := coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    );

    -- Nếu branch được chỉ định, verify thuộc tenant
    if invited_branch is not null then
      if not exists (
        select 1 from public.branches
        where id = invited_branch and tenant_id = invited_tenant
      ) then
        raise exception 'Invited branch_id % không thuộc tenant %',
          invited_branch, invited_tenant;
      end if;
    end if;

    -- Nếu role được chỉ định, verify thuộc tenant
    if invited_role is not null then
      if not exists (
        select 1 from public.roles
        where id = invited_role and tenant_id = invited_tenant
      ) then
        raise exception 'Invited role_id % không thuộc tenant %',
          invited_role, invited_tenant;
      end if;
    end if;

    -- Tạo profile link vào tenant admin
    insert into public.profiles (
      id, tenant_id, branch_id, role_id, full_name, email, phone, role
    ) values (
      new.id,
      invited_tenant,
      invited_branch,
      invited_role,
      user_name,
      new.email,
      invited_phone,
      'staff'  -- legacy role field; actual permissions từ role_id
    );

    return new;
  end if;

  -- ── Owner signup path (flow cũ, giữ nguyên cho backward compat) ──
  store_name := coalesce(
    new.raw_user_meta_data ->> 'store_name',
    'Cửa hàng của ' || coalesce(new.raw_user_meta_data ->> 'full_name', 'tôi')
  );
  user_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1)
  );

  -- Tạo tenant mới
  insert into public.tenants (name, slug)
  values (
    store_name,
    'tenant-' || substr(new.id::text, 1, 8)
  )
  returning id into new_tenant_id;

  -- Tạo chi nhánh mặc định
  insert into public.branches (tenant_id, name, is_default)
  values (new_tenant_id, 'Chi nhánh chính', true);

  -- Tạo profile với role owner
  insert into public.profiles (id, tenant_id, full_name, email, role)
  values (new.id, new_tenant_id, user_name, new.email, 'owner');

  -- Tạo code sequences mặc định
  insert into public.code_sequences (tenant_id, entity_type, prefix, padding) values
    (new_tenant_id, 'product',         'SP',  6),
    (new_tenant_id, 'customer',        'KH',  6),
    (new_tenant_id, 'supplier',        'NCC', 5),
    (new_tenant_id, 'invoice',         'HD',  6),
    (new_tenant_id, 'purchase_order',  'PN',  6),
    (new_tenant_id, 'sales_order',     'DH',  6),
    (new_tenant_id, 'return',          'TH',  6),
    (new_tenant_id, 'shipping',        'VD',  6),
    (new_tenant_id, 'cash_receipt',    'PT',  5),
    (new_tenant_id, 'cash_payment',    'PC',  5),
    (new_tenant_id, 'inventory',       'KK',  5),
    (new_tenant_id, 'internal_export', 'XNB', 5),
    (new_tenant_id, 'disposal',        'XH',  5),
    (new_tenant_id, 'purchase_return', 'THN', 5),
    (new_tenant_id, 'manufacturing',   'SX',  5);

  return new;
end;
$$;

-- Trigger đã tồn tại từ migration 00003, không cần tạo lại.
