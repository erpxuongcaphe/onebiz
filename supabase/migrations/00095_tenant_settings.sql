-- ============================================================
-- 00095: tenant_settings — key-value settings per tenant (CEO 18/05/2026)
--
-- Mục đích: lưu các flag config của tenant — đầu tiên là
-- `allow_negative_stock` cho việc bán SKU có BOM mà NVL không đủ.
--
-- Pattern key-value flexible để dễ thêm setting tương lai:
--   - allow_negative_stock           boolean (default true)
--   - require_bom_for_sku            boolean (default false — warning thôi)
--   - <future>                       …
--
-- Cấu trúc:
--   - 1 row per (tenant_id, key)
--   - value lưu jsonb để hỗ trợ boolean / string / number / object
--
-- Helper `get_tenant_setting(tenant_id, key, default)` để các RPC khác query
-- nhanh + có fallback default.
-- ============================================================

create table if not exists public.tenant_settings (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create index if not exists idx_tenant_settings_tenant on public.tenant_settings(tenant_id);

-- ────────────────────────────────────────────────────────────────
-- Helper: get_tenant_setting(tenant_id, key, default_value)
-- Trả về setting value (jsonb). Nếu không có row → trả default.
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_tenant_setting(
  p_tenant_id uuid,
  p_key text,
  p_default jsonb default 'null'::jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_value jsonb;
begin
  select value into v_value
  from public.tenant_settings
  where tenant_id = p_tenant_id and key = p_key;

  if v_value is null then
    return p_default;
  end if;

  return v_value;
end;
$$;

grant execute on function public.get_tenant_setting(uuid, text, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- Helper: set_tenant_setting(key, value) — upsert + audit log
-- ────────────────────────────────────────────────────────────────
create or replace function public.set_tenant_setting(
  p_key text,
  p_value jsonb,
  p_description text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_old_value jsonb;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND';
  end if;

  -- Chỉ owner + admin mới được đổi setting
  if v_profile.role not in ('owner', 'admin') then
    raise exception 'PERMISSION_DENIED: chỉ owner/admin mới được đổi cài đặt hệ thống';
  end if;

  select value into v_old_value
  from public.tenant_settings
  where tenant_id = v_profile.tenant_id and key = p_key;

  insert into public.tenant_settings (tenant_id, key, value, description, updated_by)
  values (v_profile.tenant_id, p_key, p_value, p_description, v_actor)
  on conflict (tenant_id, key)
  do update set
    value = excluded.value,
    description = coalesce(excluded.description, public.tenant_settings.description),
    updated_by = excluded.updated_by,
    updated_at = now();

  -- Audit log
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'update', 'tenant_setting', null,
    jsonb_build_object('key', p_key, 'old_value', v_old_value),
    jsonb_build_object('key', p_key, 'new_value', p_value)
  );

  return jsonb_build_object(
    'success', true,
    'key', p_key,
    'value', p_value
  );
end;
$$;

grant execute on function public.set_tenant_setting(text, jsonb, text) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- Seed default settings cho tất cả tenants hiện có
-- ────────────────────────────────────────────────────────────────
insert into public.tenant_settings (tenant_id, key, value, description)
select
  t.id,
  'allow_negative_stock',
  'true'::jsonb,
  'Cho phép bán SKU có BOM kể cả khi NVL không đủ tồn (admin tự cân đối kế toán)'
from public.tenants t
on conflict (tenant_id, key) do nothing;

insert into public.tenant_settings (tenant_id, key, value, description)
select
  t.id,
  'require_bom_for_sku',
  'false'::jsonb,
  'Bắt buộc SKU phải có BOM trước khi bán (false = chỉ cảnh báo, true = reject)'
from public.tenants t
on conflict (tenant_id, key) do nothing;

comment on table public.tenant_settings is
  'Key-value settings per tenant. CEO 18/05/2026.';

notify pgrst, 'reload schema';
