-- ============================================================
-- 00125 — Sơ đồ bàn tuỳ chỉnh (Floor Plan) Phase A
-- CEO 04/06/2026 — Sprint 5
--
-- Mở rộng restaurant_tables: shape, width, height, rotation, color.
-- Tạo floor_plan_zones — entity khu vực với canvas riêng.
-- Seed permissions floor_plan.edit_global + floor_plan.edit_branch.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Mở rộng restaurant_tables
-- ────────────────────────────────────────────────────────────
alter table public.restaurant_tables
  add column if not exists shape text not null default 'round'
    check (shape in ('round','square','rect','sofa','booth','bar-seat')),
  add column if not exists width int not null default 80
    check (width between 40 and 400),
  add column if not exists height int not null default 80
    check (height between 40 and 400),
  add column if not exists rotation int not null default 0
    check (rotation between 0 and 359),
  add column if not exists color text,
  add column if not exists locked boolean not null default false,
  add column if not exists zone_id uuid;

comment on column public.restaurant_tables.shape is
  'Mẫu bàn: round/square/rect/sofa/booth/bar-seat';
comment on column public.restaurant_tables.locked is
  'true = khoá vị trí + kích thước, không cho drag/resize';

-- ────────────────────────────────────────────────────────────
-- 2. floor_plan_zones — khu vực với canvas riêng
-- ────────────────────────────────────────────────────────────
create table if not exists public.floor_plan_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  canvas_width int not null default 1024
    check (canvas_width between 320 and 4096),
  canvas_height int not null default 720
    check (canvas_height between 240 and 4096),
  background_url text,
  background_opacity int not null default 30
    check (background_opacity between 0 and 100),
  grid_size int not null default 16
    check (grid_size in (0, 8, 16, 32)),
  overlay_color text,
  floor_level int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, name)
);

create index if not exists idx_floor_plan_zones_branch
  on public.floor_plan_zones (tenant_id, branch_id, is_active, sort_order);

comment on table public.floor_plan_zones is
  'Khu vực sơ đồ bàn (Sảnh 1, Sân vườn...). 1 branch nhiều zone, mỗi zone 1 canvas riêng.';
comment on column public.floor_plan_zones.grid_size is
  'Snap pixel: 0=off, 8/16/32';
comment on column public.floor_plan_zones.floor_level is
  'Tầng (1=trệt, 2=lầu 1...). Phase C dùng để nhóm zones theo tầng.';

-- FK zone_id sau khi zones table có
alter table public.restaurant_tables
  add constraint restaurant_tables_zone_fkey
  foreign key (zone_id) references public.floor_plan_zones(id) on delete set null
  not valid;
alter table public.restaurant_tables validate constraint restaurant_tables_zone_fkey;

create index if not exists idx_restaurant_tables_zone
  on public.restaurant_tables (zone_id) where zone_id is not null;

-- ────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────
alter table public.floor_plan_zones enable row level security;

drop policy if exists "floor_plan_zones_tenant_isolation" on public.floor_plan_zones;
create policy "floor_plan_zones_tenant_isolation" on public.floor_plan_zones
  for all using (tenant_id = public.get_user_tenant_id());

-- Updated_at trigger
drop trigger if exists set_updated_at_floor_plan_zones on public.floor_plan_zones;
create trigger set_updated_at_floor_plan_zones
  before update on public.floor_plan_zones
  for each row execute function public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. Seed default zone cho data cũ
-- ────────────────────────────────────────────────────────────
-- Mỗi branch có restaurant_tables → tạo 1 zone "Sảnh chính" + gán cho mọi bàn.
do $$
declare
  v_branch record;
  v_zone_id uuid;
begin
  for v_branch in
    select distinct rt.tenant_id, rt.branch_id
    from public.restaurant_tables rt
    where rt.zone_id is null
  loop
    -- Tạo zone "Sảnh chính" nếu chưa có
    select id into v_zone_id
    from public.floor_plan_zones
    where tenant_id = v_branch.tenant_id
      and branch_id = v_branch.branch_id
      and name = 'Sảnh chính'
    limit 1;

    if v_zone_id is null then
      insert into public.floor_plan_zones (tenant_id, branch_id, name, sort_order)
      values (v_branch.tenant_id, v_branch.branch_id, 'Sảnh chính', 0)
      returning id into v_zone_id;
    end if;

    -- Gán mọi bàn của branch vào zone
    update public.restaurant_tables
       set zone_id = v_zone_id
     where tenant_id = v_branch.tenant_id
       and branch_id = v_branch.branch_id
       and zone_id is null;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────
-- 5. Seed permissions floor_plan.*
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_role record;
  v_codes text[] := array[
    'floor_plan.view',
    'floor_plan.edit_branch',
    'floor_plan.edit_global'
  ];
  v_code text;
  v_grant_view text[] := array['Chủ cửa hàng', 'Admin', 'Quản lý', 'Thu ngân', 'Nhân viên'];
  v_grant_edit_branch text[] := array['Chủ cửa hàng', 'Admin', 'Quản lý'];
  v_grant_edit_global text[] := array['Chủ cửa hàng', 'Admin'];
begin
  -- floor_plan.view cho mọi role được phục vụ
  for v_role in
    select r.id, r.name from public.roles r
    where r.name = any(v_grant_view)
  loop
    insert into public.role_permissions (role_id, permission_code)
    values (v_role.id, 'floor_plan.view')
    on conflict (role_id, permission_code) do nothing;
  end loop;

  -- floor_plan.edit_branch
  for v_role in
    select r.id, r.name from public.roles r
    where r.name = any(v_grant_edit_branch)
  loop
    insert into public.role_permissions (role_id, permission_code)
    values (v_role.id, 'floor_plan.edit_branch')
    on conflict (role_id, permission_code) do nothing;
  end loop;

  -- floor_plan.edit_global (chỉ admin/owner)
  for v_role in
    select r.id, r.name from public.roles r
    where r.name = any(v_grant_edit_global)
  loop
    insert into public.role_permissions (role_id, permission_code)
    values (v_role.id, 'floor_plan.edit_global')
    on conflict (role_id, permission_code) do nothing;
  end loop;

  raise notice 'Seeded floor_plan.* permissions';
end $$;

-- ────────────────────────────────────────────────────────────
-- 6. Realtime publication (để cashier sync status)
-- ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.restaurant_tables;
alter publication supabase_realtime add table public.floor_plan_zones;

notify pgrst, 'reload schema';
