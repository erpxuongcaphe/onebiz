-- ============================================================
-- OneBiz ERP — Foundation v4
-- NVL/SKU product architecture + Pipeline Engine + Production + Pricing + Lot tracking
-- ============================================================

-- ============================================================
-- 1. ALTER EXISTING TABLES
-- ============================================================

-- Categories: thêm code + scope
alter table public.categories
  add column if not exists code text,
  add column if not exists scope text;

-- Thêm constraint scope sau khi thêm column
do $$ begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'categories_scope_check'
  ) then
    alter table public.categories
      add constraint categories_scope_check
      check (scope in ('nvl', 'sku', 'customer', 'supplier'));
  end if;
end $$;

-- Products: thêm product_type, has_bom, UOM 3 đơn vị, HSD, group tracking
alter table public.products
  add column if not exists product_type text not null default 'nvl',
  add column if not exists has_bom boolean not null default false,
  add column if not exists old_code text,
  add column if not exists group_code text,
  add column if not exists purchase_unit text,
  add column if not exists stock_unit text,
  add column if not exists sell_unit text,
  add column if not exists shelf_life_days int,
  add column if not exists shelf_life_unit text not null default 'day',
  add column if not exists supplier_id uuid;

do $$ begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'products_product_type_check'
  ) then
    alter table public.products
      add constraint products_product_type_check
      check (product_type in ('nvl', 'sku'));
  end if;

  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'products_shelf_life_unit_check'
  ) then
    alter table public.products
      add constraint products_shelf_life_unit_check
      check (shelf_life_unit in ('day', 'month', 'year'));
  end if;

  -- FK supplier_id
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'products_supplier_id_fkey'
  ) then
    alter table public.products
      add constraint products_supplier_id_fkey
      foreign key (supplier_id) references public.suppliers(id) on delete set null;
  end if;
end $$;

create index if not exists idx_products_type on public.products(tenant_id, product_type);

-- Branches: thêm code + branch_type
alter table public.branches
  add column if not exists code text,
  add column if not exists branch_type text not null default 'store';

do $$ begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'branches_branch_type_check'
  ) then
    alter table public.branches
      add constraint branches_branch_type_check
      check (branch_type in ('store', 'warehouse', 'factory', 'office'));
  end if;
end $$;

-- Suppliers: thêm code_v2 (vì code đã tồn tại) + group_id
alter table public.suppliers
  add column if not exists group_code text,
  add column if not exists group_id uuid;

do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'suppliers_group_id_fkey'
  ) then
    alter table public.suppliers
      add constraint suppliers_group_id_fkey
      foreign key (group_id) references public.categories(id) on delete set null;
  end if;
end $$;

-- Customers: customers đã có code, thêm thêm fields
-- (customer_groups đã tồn tại, sẽ dùng lại)

-- ============================================================
-- 2. NEW TABLES
-- ============================================================

-- 2.1 Packaging Variants (Quy cách đóng gói)
create table if not exists public.product_variants (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text,
  name text not null,
  packaging_type text,
  packaging_size text,
  unit_count int not null default 1,
  barcode text,
  sell_price numeric(15,2) not null default 0,
  cost_price numeric(15,2) not null default 0,
  weight numeric(10,2),
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_variants_product on public.product_variants(product_id);
create index if not exists idx_product_variants_tenant on public.product_variants(tenant_id);
create unique index if not exists idx_product_variants_sku on public.product_variants(tenant_id, sku) where sku is not null;

-- 2.2 BOM (Công thức sản xuất)
create table if not exists public.bom (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  code text,
  name text not null,
  version int not null default 1,
  is_active boolean not null default true,
  batch_size numeric(15,2) not null default 1,
  yield_qty numeric(15,2) not null default 1,
  yield_unit text not null default 'cái',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index if not exists idx_bom_product on public.bom(product_id);
create index if not exists idx_bom_tenant on public.bom(tenant_id);

create table if not exists public.bom_items (
  id uuid primary key default uuid_generate_v4(),
  bom_id uuid not null references public.bom(id) on delete cascade,
  material_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(15,4) not null,
  unit text not null default 'kg',
  waste_percent numeric(5,2) not null default 0,
  sort_order int not null default 0,
  note text
);

create index if not exists idx_bom_items_bom on public.bom_items(bom_id);

-- 2.3 UOM Conversions (Quy đổi đơn vị)
create table if not exists public.uom_conversions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  from_unit text not null,
  to_unit text not null,
  factor numeric(15,4) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_uom_conversions_product on public.uom_conversions(product_id);

-- 2.4 Branch Stock (Tồn kho per chi nhánh)
create table if not exists public.branch_stock (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  quantity numeric(15,2) not null default 0,
  reserved numeric(15,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique(branch_id, product_id, variant_id)
);

create index if not exists idx_branch_stock_tenant on public.branch_stock(tenant_id);
create index if not exists idx_branch_stock_product on public.branch_stock(product_id);

-- 2.5 Group Code Sequences (Sinh mã NVL-BAO-001, SKU-CPC-001, NCC-SUA-001, KHA-KSI-001)
create table if not exists public.group_code_sequences (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  prefix text not null,
  group_code text not null,
  current_number int not null default 0,
  padding int not null default 3,
  unique(tenant_id, prefix, group_code)
);

create index if not exists idx_group_code_seq_tenant on public.group_code_sequences(tenant_id);

-- 2.6 Production Orders (Lệnh sản xuất)
create table if not exists public.production_orders (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  branch_id uuid not null references public.branches(id) on delete restrict,
  bom_id uuid not null references public.bom(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid references public.product_variants(id) on delete set null,
  planned_qty numeric(15,2) not null,
  completed_qty numeric(15,2) not null default 0,
  status text not null default 'planned'
    check (status in ('planned', 'material_check', 'in_production', 'quality_check', 'completed', 'cancelled')),
  lot_number text,
  planned_start date,
  planned_end date,
  actual_start timestamptz,
  actual_end timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index if not exists idx_production_orders_tenant on public.production_orders(tenant_id);
create index if not exists idx_production_orders_status on public.production_orders(tenant_id, status);

-- 2.7 Production Order Materials (NVL cho lệnh SX)
create table if not exists public.production_order_materials (
  id uuid primary key default uuid_generate_v4(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  planned_qty numeric(15,4) not null,
  actual_qty numeric(15,4),
  unit text not null,
  note text
);

create index if not exists idx_po_materials_order on public.production_order_materials(production_order_id);

-- 2.8 Product Lots (Lot/batch tracking — CẢ NVL + SKU)
create table if not exists public.product_lots (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid references public.product_variants(id) on delete set null,
  lot_number text not null,
  source_type text not null default 'purchase'
    check (source_type in ('production', 'purchase')),
  production_order_id uuid references public.production_orders(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  manufactured_date date,
  expiry_date date,
  received_date date not null default current_date,
  initial_qty numeric(15,2) not null,
  current_qty numeric(15,2) not null,
  branch_id uuid not null references public.branches(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'expired', 'consumed', 'disposed')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_lots_tenant on public.product_lots(tenant_id);
create index if not exists idx_product_lots_product on public.product_lots(product_id);
create index if not exists idx_product_lots_branch on public.product_lots(branch_id);
create index if not exists idx_product_lots_expiry on public.product_lots(tenant_id, expiry_date) where status = 'active';
create index if not exists idx_product_lots_status on public.product_lots(tenant_id, status);

-- 2.9 Lot Allocations (Ghi nhận lot xuất cho hóa đơn/SX/chuyển kho)
create table if not exists public.lot_allocations (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lot_id uuid not null references public.product_lots(id) on delete restrict,
  source_type text not null
    check (source_type in ('invoice', 'production', 'transfer', 'disposal')),
  source_id uuid not null,
  quantity numeric(15,2) not null,
  allocated_at timestamptz not null default now(),
  allocated_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_lot_allocations_lot on public.lot_allocations(lot_id);
create index if not exists idx_lot_allocations_source on public.lot_allocations(source_type, source_id);

-- 2.10 Price Tiers (Giá sỉ theo nhóm KH)
create table if not exists public.price_tiers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  priority int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index if not exists idx_price_tiers_tenant on public.price_tiers(tenant_id);

create table if not exists public.price_tier_items (
  id uuid primary key default uuid_generate_v4(),
  price_tier_id uuid not null references public.price_tiers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  price numeric(15,2) not null,
  min_qty numeric(15,2) not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_price_tier_items_tier on public.price_tier_items(price_tier_id);
create index if not exists idx_price_tier_items_product on public.price_tier_items(product_id);

-- ============================================================
-- 3. PIPELINE ENGINE (6 bảng)
-- ============================================================

-- 3.1 Pipelines — Định nghĩa pipeline per entity_type
create table if not exists public.pipelines (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(tenant_id, entity_type)
);

create index if not exists idx_pipelines_tenant on public.pipelines(tenant_id);

-- 3.2 Pipeline Stages — Các bước trong pipeline
create table if not exists public.pipeline_stages (
  id uuid primary key default uuid_generate_v4(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  code text not null,
  name text not null,
  color text,
  icon text,
  sort_order int not null default 0,
  is_initial boolean not null default false,
  is_final boolean not null default false,
  validation_rules jsonb,
  metadata jsonb
);

create index if not exists idx_pipeline_stages_pipeline on public.pipeline_stages(pipeline_id);

-- 3.3 Pipeline Transitions — Quy tắc chuyển stage
create table if not exists public.pipeline_transitions (
  id uuid primary key default uuid_generate_v4(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  from_stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  to_stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  name text,
  required_role text,
  conditions jsonb,
  auto_trigger boolean not null default false,
  unique(from_stage_id, to_stage_id)
);

create index if not exists idx_pipeline_transitions_pipeline on public.pipeline_transitions(pipeline_id);

-- 3.4 Pipeline Items — Entity → current stage + dimensions
create table if not exists public.pipeline_items (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  entity_id uuid not null,
  current_stage_id uuid not null references public.pipeline_stages(id),
  dimensions jsonb not null default '{}',
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(pipeline_id, entity_id)
);

create index if not exists idx_pipeline_items_tenant on public.pipeline_items(tenant_id);
create index if not exists idx_pipeline_items_stage on public.pipeline_items(current_stage_id);
create index if not exists idx_pipeline_items_entity on public.pipeline_items(entity_id);

-- 3.5 Pipeline History — Audit log
create table if not exists public.pipeline_history (
  id uuid primary key default uuid_generate_v4(),
  pipeline_item_id uuid not null references public.pipeline_items(id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages(id),
  to_stage_id uuid not null references public.pipeline_stages(id),
  transition_id uuid references public.pipeline_transitions(id),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  note text,
  metadata jsonb
);

create index if not exists idx_pipeline_history_item on public.pipeline_history(pipeline_item_id);

-- 3.6 Pipeline Automations — Cross-pipeline triggers
create table if not exists public.pipeline_automations (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  trigger_pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  trigger_stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  action_type text not null
    check (action_type in ('create_pipeline_item', 'transition', 'notify', 'webhook')),
  action_config jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_pipeline_automations_trigger on public.pipeline_automations(trigger_pipeline_id);

-- ============================================================
-- 4. RLS POLICIES cho các bảng mới
-- ============================================================

-- Enable RLS on all new tables
alter table public.product_variants enable row level security;
alter table public.bom enable row level security;
alter table public.bom_items enable row level security;
alter table public.uom_conversions enable row level security;
alter table public.branch_stock enable row level security;
alter table public.group_code_sequences enable row level security;
alter table public.production_orders enable row level security;
alter table public.production_order_materials enable row level security;
alter table public.product_lots enable row level security;
alter table public.lot_allocations enable row level security;
alter table public.price_tiers enable row level security;
alter table public.price_tier_items enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.pipeline_transitions enable row level security;
alter table public.pipeline_items enable row level security;
alter table public.pipeline_history enable row level security;
alter table public.pipeline_automations enable row level security;

-- Helper: get_user_tenant_id() đã tồn tại từ migration 00002

-- RLS policies: SELECT / INSERT / UPDATE / DELETE cho tenant_id tables
do $$
declare
  t record;
begin
  for t in
    select unnest(array[
      'product_variants', 'bom', 'uom_conversions', 'branch_stock',
      'group_code_sequences', 'production_orders', 'product_lots',
      'lot_allocations', 'price_tiers',
      'pipelines', 'pipeline_items', 'pipeline_automations'
    ]) as tbl
  loop
    execute format('
      drop policy if exists %I on public.%I;
      drop policy if exists %I on public.%I;
      drop policy if exists %I on public.%I;
      drop policy if exists %I on public.%I;
      create policy %I on public.%I for select using (tenant_id = get_user_tenant_id());
      create policy %I on public.%I for insert with check (tenant_id = get_user_tenant_id());
      create policy %I on public.%I for update using (tenant_id = get_user_tenant_id());
      create policy %I on public.%I for delete using (tenant_id = get_user_tenant_id());
    ',
      t.tbl || '_select', t.tbl,
      t.tbl || '_insert', t.tbl,
      t.tbl || '_update', t.tbl,
      t.tbl || '_delete', t.tbl,
      t.tbl || '_select', t.tbl,
      t.tbl || '_insert', t.tbl,
      t.tbl || '_update', t.tbl,
      t.tbl || '_delete', t.tbl
    );
  end loop;
end $$;

-- RLS for child tables (no tenant_id, inherit via parent)
-- Drop existing child policies first (idempotent re-run)
do $$
declare
  p record;
begin
  for p in
    select polname, polrelid::regclass::text as tbl
    from pg_policy
    where polrelid::regclass::text in (
      'public.bom_items', 'public.production_order_materials',
      'public.pipeline_stages', 'public.pipeline_transitions',
      'public.pipeline_history', 'public.price_tier_items'
    )
  loop
    execute format('drop policy if exists %I on %s', p.polname, p.tbl);
  end loop;
end $$;

-- bom_items → bom → tenant_id
create policy bom_items_select on public.bom_items for select
  using (exists (select 1 from public.bom where bom.id = bom_items.bom_id and bom.tenant_id = get_user_tenant_id()));
create policy bom_items_insert on public.bom_items for insert
  with check (exists (select 1 from public.bom where bom.id = bom_items.bom_id and bom.tenant_id = get_user_tenant_id()));
create policy bom_items_update on public.bom_items for update
  using (exists (select 1 from public.bom where bom.id = bom_items.bom_id and bom.tenant_id = get_user_tenant_id()));
create policy bom_items_delete on public.bom_items for delete
  using (exists (select 1 from public.bom where bom.id = bom_items.bom_id and bom.tenant_id = get_user_tenant_id()));

-- production_order_materials → production_orders → tenant_id
create policy po_materials_select on public.production_order_materials for select
  using (exists (select 1 from public.production_orders where production_orders.id = production_order_materials.production_order_id and production_orders.tenant_id = get_user_tenant_id()));
create policy po_materials_insert on public.production_order_materials for insert
  with check (exists (select 1 from public.production_orders where production_orders.id = production_order_materials.production_order_id and production_orders.tenant_id = get_user_tenant_id()));
create policy po_materials_update on public.production_order_materials for update
  using (exists (select 1 from public.production_orders where production_orders.id = production_order_materials.production_order_id and production_orders.tenant_id = get_user_tenant_id()));
create policy po_materials_delete on public.production_order_materials for delete
  using (exists (select 1 from public.production_orders where production_orders.id = production_order_materials.production_order_id and production_orders.tenant_id = get_user_tenant_id()));

-- pipeline_stages → pipelines → tenant_id
create policy pipeline_stages_select on public.pipeline_stages for select
  using (exists (select 1 from public.pipelines where pipelines.id = pipeline_stages.pipeline_id and pipelines.tenant_id = get_user_tenant_id()));
create policy pipeline_stages_insert on public.pipeline_stages for insert
  with check (exists (select 1 from public.pipelines where pipelines.id = pipeline_stages.pipeline_id and pipelines.tenant_id = get_user_tenant_id()));
create policy pipeline_stages_update on public.pipeline_stages for update
  using (exists (select 1 from public.pipelines where pipelines.id = pipeline_stages.pipeline_id and pipelines.tenant_id = get_user_tenant_id()));
create policy pipeline_stages_delete on public.pipeline_stages for delete
  using (exists (select 1 from public.pipelines where pipelines.id = pipeline_stages.pipeline_id and pipelines.tenant_id = get_user_tenant_id()));

-- pipeline_transitions → pipelines → tenant_id
create policy pipeline_transitions_select on public.pipeline_transitions for select
  using (exists (select 1 from public.pipelines where pipelines.id = pipeline_transitions.pipeline_id and pipelines.tenant_id = get_user_tenant_id()));
create policy pipeline_transitions_insert on public.pipeline_transitions for insert
  with check (exists (select 1 from public.pipelines where pipelines.id = pipeline_transitions.pipeline_id and pipelines.tenant_id = get_user_tenant_id()));
create policy pipeline_transitions_update on public.pipeline_transitions for update
  using (exists (select 1 from public.pipelines where pipelines.id = pipeline_transitions.pipeline_id and pipelines.tenant_id = get_user_tenant_id()));
create policy pipeline_transitions_delete on public.pipeline_transitions for delete
  using (exists (select 1 from public.pipelines where pipelines.id = pipeline_transitions.pipeline_id and pipelines.tenant_id = get_user_tenant_id()));

-- pipeline_history → pipeline_items → tenant_id
create policy pipeline_history_select on public.pipeline_history for select
  using (exists (select 1 from public.pipeline_items where pipeline_items.id = pipeline_history.pipeline_item_id and pipeline_items.tenant_id = get_user_tenant_id()));
create policy pipeline_history_insert on public.pipeline_history for insert
  with check (exists (select 1 from public.pipeline_items where pipeline_items.id = pipeline_history.pipeline_item_id and pipeline_items.tenant_id = get_user_tenant_id()));
create policy pipeline_history_update on public.pipeline_history for update
  using (exists (select 1 from public.pipeline_items where pipeline_items.id = pipeline_history.pipeline_item_id and pipeline_items.tenant_id = get_user_tenant_id()));
create policy pipeline_history_delete on public.pipeline_history for delete
  using (exists (select 1 from public.pipeline_items where pipeline_items.id = pipeline_history.pipeline_item_id and pipeline_items.tenant_id = get_user_tenant_id()));

-- price_tier_items → price_tiers → tenant_id
create policy price_tier_items_select on public.price_tier_items for select
  using (exists (select 1 from public.price_tiers where price_tiers.id = price_tier_items.price_tier_id and price_tiers.tenant_id = get_user_tenant_id()));
create policy price_tier_items_insert on public.price_tier_items for insert
  with check (exists (select 1 from public.price_tiers where price_tiers.id = price_tier_items.price_tier_id and price_tiers.tenant_id = get_user_tenant_id()));
create policy price_tier_items_update on public.price_tier_items for update
  using (exists (select 1 from public.price_tiers where price_tiers.id = price_tier_items.price_tier_id and price_tiers.tenant_id = get_user_tenant_id()));
create policy price_tier_items_delete on public.price_tier_items for delete
  using (exists (select 1 from public.price_tiers where price_tiers.id = price_tier_items.price_tier_id and price_tiers.tenant_id = get_user_tenant_id()));

-- ============================================================
-- 5. TRIGGERS updated_at cho bảng mới
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'product_variants', 'bom', 'production_orders',
    'product_lots', 'pipeline_items', 'price_tiers'
  ] loop
    execute format('
      create trigger set_updated_at before update on public.%I
        for each row execute function handle_updated_at();
    ', t);
  end loop;
end $$;
