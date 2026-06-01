-- ============================================================
-- 00121 — Phase 2.1: Variant + Modifier schema cho POS FnB
-- ============================================================
-- CEO 01/06/2026 (Phương án C — học từ Fabi/KiotViet/Toast/Square):
--   1 SKU FnB = 1 dòng menu/POS, KHÔNG bùng nổ tổ hợp size × đường.
--   - SIZE = variant: mỗi variant có BOM riêng (M=18g cà phê, L=25g).
--     Khi anh đổi size, swap luôn BOM (vì ly M ≠ ly L).
--   - ĐƯỜNG/ĐÁ/TOPPING = modifier group: gắn theo SP hoặc nhóm.
--     Modifier "Mức đường" scale 1 NVL (đường) trong BOM của variant
--     đang chọn — vd 70% đường → NVL đường × 0.7. Không tạo BOM riêng
--     cho mỗi % đường.
--
-- Bảng/cột mới:
--   1. product_variants.bom_code        — text, mỗi variant 1 BOM riêng
--   2. modifier_groups                  — Đường, Đá, Topping...
--   3. modifier_options                 — 0%, 30%, 50%, 70%, 100%...
--   4. product_modifier_groups          — gắn group vào 1 SP cụ thể
--   5. category_modifier_groups         — mặc định cho cả nhóm SP
--   6. bom_items.modifier_scale_target  — link NVL đến modifier_group
--
-- Backward compat:
--   - Tất cả là ADD, không DROP/ALTER cột cũ.
--   - POS hiện tại không đọc bảng mới → vẫn chạy như cũ.
--   - Sprint 2.2 + 2.3 sẽ wire UI + POS dùng tables này.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. product_variants.bom_code — mỗi size có BOM riêng
-- ────────────────────────────────────────────────────────────
alter table public.product_variants
  add column if not exists bom_code text;

comment on column public.product_variants.bom_code is
  'Mã BOM riêng cho variant này. Vd: SKU-CFS-002 Size M dùng BOM "CFS-002-M" (18g cà phê + ly M), Size L dùng "CFS-002-L" (25g cà phê + ly L). Null = fallback BOM của product cha.';

create index if not exists idx_product_variants_bom_code
  on public.product_variants(tenant_id, bom_code)
  where bom_code is not null;

-- ────────────────────────────────────────────────────────────
-- 2. modifier_groups — Mức đường, Mức đá, Topping, Ghi chú...
-- ────────────────────────────────────────────────────────────
create table if not exists public.modifier_groups (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  -- Rule chọn lựa: kiểu Fabi.
  --   'single_required' = bắt buộc chọn 1 (vd Size).
  --   'single'          = chọn 1 hoặc không (vd Mức đường default 100%).
  --   'multi'           = chọn nhiều (vd Topping nhiều món).
  rule text not null check (rule in ('single_required', 'single', 'multi')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  -- Áp dụng cho channel nào (fnb mặc định)
  channel text not null default 'fnb' check (channel in ('fnb', 'retail', 'all')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modifier_groups_name_per_tenant unique (tenant_id, name)
);

create index if not exists idx_modifier_groups_tenant
  on public.modifier_groups(tenant_id);

comment on table public.modifier_groups is
  'CEO 01/06/2026: Nhóm tuỳ chọn món FnB (Mức đường, Mức đá, Topping...). Mỗi group có rule chọn 1 bắt buộc / 1 tuỳ chọn / nhiều.';

-- ────────────────────────────────────────────────────────────
-- 3. modifier_options — các giá trị trong 1 group
-- ────────────────────────────────────────────────────────────
create table if not exists public.modifier_options (
  id uuid primary key default extensions.uuid_generate_v4(),
  group_id uuid not null references public.modifier_groups(id) on delete cascade,
  label text not null,
  -- Phí cộng thêm (cho topping, vd "Trân châu đen +7,000").
  -- Đường/đá thường = 0 vì không phụ thu.
  price_delta numeric(15,2) not null default 0,
  -- Tỷ lệ scale BOM ingredient (cho Mức đường: 0/0.3/0.5/0.7/1.0).
  -- Null cho options không scale (topping, size).
  scale_factor numeric(5,3),
  -- Link tới NVL/SKU nếu option = topping (vd "Trân châu đen" → NVL-TPV-001).
  -- Khi cashier chọn topping, POS sẽ trừ tồn NVL này theo BOM.
  linked_product_id uuid references public.products(id) on delete set null,
  is_default boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_modifier_options_group
  on public.modifier_options(group_id);

comment on column public.modifier_options.scale_factor is
  'Tỷ lệ scale BOM ingredient cho Mức đường (0/0.3/0.5/0.7/1.0). Khi anh chọn 70% đường + món có BOM 10g đường → tồn trừ 7g.';

comment on column public.modifier_options.linked_product_id is
  'Nếu option = topping → link tới NVL/SKU topping. POS trừ tồn topping khi chọn.';

-- ────────────────────────────────────────────────────────────
-- 4. product_modifier_groups — gắn 1 group vào 1 SP cụ thể
-- ────────────────────────────────────────────────────────────
create table if not exists public.product_modifier_groups (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  modifier_group_id uuid not null references public.modifier_groups(id) on delete cascade,
  -- Override rule của group nếu cần (vd group default "single" nhưng SP
  -- này yêu cầu "single_required").
  rule_override text check (rule_override in ('single_required', 'single', 'multi')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint product_modifier_groups_unique unique (product_id, modifier_group_id)
);

create index if not exists idx_product_modifier_groups_product
  on public.product_modifier_groups(product_id);

-- ────────────────────────────────────────────────────────────
-- 5. category_modifier_groups — default cho cả nhóm SP
-- ────────────────────────────────────────────────────────────
-- Anh có thể gán Mức đường + Mức đá cho cả nhóm "Cà phê pha sẵn" (CFS)
-- 1 lần thay vì gán cho từng SKU. SP nào không override sẽ inherit.
create table if not exists public.category_modifier_groups (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  modifier_group_id uuid not null references public.modifier_groups(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint category_modifier_groups_unique unique (category_id, modifier_group_id)
);

create index if not exists idx_category_modifier_groups_category
  on public.category_modifier_groups(category_id);

-- ────────────────────────────────────────────────────────────
-- 6. bom_items.modifier_scale_target — link NVL trong BOM với modifier
-- ────────────────────────────────────────────────────────────
-- Vd BOM "Cà phê sữa đá size M" có item NVL "Đường" qty=10g.
-- modifier_scale_target = id của group "Mức đường".
-- Khi cashier chọn 70% đường → POS scale 10g × 0.7 = 7g.
alter table public.bom_items
  add column if not exists modifier_scale_target uuid
    references public.modifier_groups(id) on delete set null;

comment on column public.bom_items.modifier_scale_target is
  'CEO 01/06/2026: Nếu set → BOM item này được scale theo option đã chọn của modifier group đó. Vd ingredient "Đường" scale theo Mức đường (0/30/50/70/100%).';

-- ────────────────────────────────────────────────────────────
-- 7. RLS + multi-tenant safety
-- ────────────────────────────────────────────────────────────
alter table public.modifier_groups        enable row level security;
alter table public.modifier_options       enable row level security;
alter table public.product_modifier_groups enable row level security;
alter table public.category_modifier_groups enable row level security;

-- Modifier groups: tenant scoped
create policy modifier_groups_tenant_select on public.modifier_groups
  for select using (tenant_id = (select public.current_tenant_id()));
create policy modifier_groups_tenant_insert on public.modifier_groups
  for insert with check (tenant_id = (select public.current_tenant_id()));
create policy modifier_groups_tenant_update on public.modifier_groups
  for update using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy modifier_groups_tenant_delete on public.modifier_groups
  for delete using (tenant_id = (select public.current_tenant_id()));

-- Modifier options: scoped via group → group.tenant_id
create policy modifier_options_tenant_select on public.modifier_options
  for select using (
    exists (
      select 1 from public.modifier_groups g
      where g.id = group_id and g.tenant_id = (select public.current_tenant_id())
    )
  );
create policy modifier_options_tenant_insert on public.modifier_options
  for insert with check (
    exists (
      select 1 from public.modifier_groups g
      where g.id = group_id and g.tenant_id = (select public.current_tenant_id())
    )
  );
create policy modifier_options_tenant_update on public.modifier_options
  for update using (
    exists (
      select 1 from public.modifier_groups g
      where g.id = group_id and g.tenant_id = (select public.current_tenant_id())
    )
  ) with check (
    exists (
      select 1 from public.modifier_groups g
      where g.id = group_id and g.tenant_id = (select public.current_tenant_id())
    )
  );
create policy modifier_options_tenant_delete on public.modifier_options
  for delete using (
    exists (
      select 1 from public.modifier_groups g
      where g.id = group_id and g.tenant_id = (select public.current_tenant_id())
    )
  );

-- Product modifier groups (junction)
create policy product_modifier_groups_tenant_all on public.product_modifier_groups
  for all using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- Category modifier groups (junction)
create policy category_modifier_groups_tenant_all on public.category_modifier_groups
  for all using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

notify pgrst, 'reload schema';
