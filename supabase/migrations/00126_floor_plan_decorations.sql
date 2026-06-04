-- ============================================================
-- 00126 — Floor Plan Phase B: ảnh nền + đồ trang trí
-- CEO 04/06/2026 — Sprint 5
--
-- Tạo bảng floor_plan_decorations + storage bucket cho ảnh nền quán.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Bảng decorations
-- ────────────────────────────────────────────────────────────
create table if not exists public.floor_plan_decorations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  zone_id uuid references public.floor_plan_zones(id) on delete cascade,
  kind text not null
    check (kind in ('door','plant','bar','restroom','window','tv','stairs','wall','custom')),
  label text,
  position_x int not null default 0,
  position_y int not null default 0,
  width int not null default 60
    check (width between 20 and 800),
  height int not null default 60
    check (height between 20 and 800),
  rotation int not null default 0
    check (rotation between 0 and 359),
  color text,
  icon text,
  locked boolean not null default false,
  z_index int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_floor_plan_decor_zone
  on public.floor_plan_decorations (zone_id, z_index);

comment on table public.floor_plan_decorations is
  'Đồ trang trí + vật cản (cửa, cây, quầy bar, toilet) trên canvas sơ đồ bàn.';

-- ────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────
alter table public.floor_plan_decorations enable row level security;

drop policy if exists "floor_plan_decor_tenant_isolation" on public.floor_plan_decorations;
create policy "floor_plan_decor_tenant_isolation" on public.floor_plan_decorations
  for all using (tenant_id = public.get_user_tenant_id());

-- ────────────────────────────────────────────────────────────
-- 3. Realtime
-- ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.floor_plan_decorations;

-- ────────────────────────────────────────────────────────────
-- 4. Storage bucket floor-plans (ảnh nền quán)
-- ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('floor-plans', 'floor-plans', true)
on conflict (id) do nothing;

-- Policy: chỉ user trong tenant được upload + delete + view
drop policy if exists "floor_plans_select" on storage.objects;
create policy "floor_plans_select" on storage.objects
  for select using (
    bucket_id = 'floor-plans'
    and auth.role() = 'authenticated'
  );

drop policy if exists "floor_plans_insert" on storage.objects;
create policy "floor_plans_insert" on storage.objects
  for insert with check (
    bucket_id = 'floor-plans'
    and auth.role() = 'authenticated'
  );

drop policy if exists "floor_plans_delete" on storage.objects;
create policy "floor_plans_delete" on storage.objects
  for delete using (
    bucket_id = 'floor-plans'
    and auth.role() = 'authenticated'
  );

notify pgrst, 'reload schema';
