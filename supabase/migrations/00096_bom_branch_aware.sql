-- ============================================================
-- 00096: BOM theo chi nhánh (CEO 18/05/2026)
--
-- Mục đích: Quán FnB Q1 và Q2 có thể có công thức khác nhau cho cùng 1 SKU
-- (vd: 1 ly Bạc xỉu ở Q1 = 18g cà phê + 80ml sữa; Q2 = 20g cà phê + 60ml
-- sữa tươi + đường nâu).
--
-- Pattern: thêm cột `branch_id` nullable.
--   - branch_id = NULL    → BOM global default (áp dụng mọi chi nhánh)
--   - branch_id = <Q_id>  → BOM override chỉ cho quán đó
--
-- Lookup priority: branch-specific > global default
-- ============================================================

-- 1. Thêm cột branch_id (nullable, FK → branches)
alter table public.bom
  add column if not exists branch_id uuid references public.branches(id) on delete cascade;

create index if not exists idx_bom_branch on public.bom(branch_id);
create index if not exists idx_bom_product_branch_active
  on public.bom(product_id, branch_id) where is_active = true;

-- 2. Drop UNIQUE cũ (tenant_id, code) — code có thể trùng giữa global vs per-branch
-- Note: vẫn giữ unique nhưng thêm branch_id để tách
alter table public.bom drop constraint if exists bom_tenant_id_code_key;

-- 3. UNIQUE mới: 1 SP × 1 chi nhánh = tối đa 1 BOM active
-- Dùng COALESCE để treat NULL như 1 giá trị (UUID zero)
-- (Nếu có 2 BOM cùng product + cùng branch → đảm bảo chỉ 1 is_active=true tại 1 thời điểm)
create unique index if not exists idx_bom_product_branch_unique
  on public.bom (
    tenant_id,
    product_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where is_active = true;

-- 4. Helper: get_active_bom_for_branch(product_id, branch_id)
-- Trả về bom_id active, ưu tiên branch-specific > global.
-- Nếu cả 2 đều không có → trả NULL (SKU chưa có BOM).
create or replace function public.get_active_bom_for_branch(
  p_product_id uuid,
  p_branch_id uuid
) returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
begin
  -- Bước 1: tìm BOM riêng cho branch này
  select id into v_bom_id
  from public.bom
  where product_id = p_product_id
    and branch_id = p_branch_id
    and is_active = true
  order by version desc nulls last
  limit 1;

  if v_bom_id is not null then
    return v_bom_id;
  end if;

  -- Bước 2: fallback BOM global (branch_id IS NULL)
  select id into v_bom_id
  from public.bom
  where product_id = p_product_id
    and branch_id is null
    and is_active = true
  order by version desc nulls last
  limit 1;

  return v_bom_id; -- có thể null nếu SP chưa setup BOM
end;
$$;

grant execute on function public.get_active_bom_for_branch(uuid, uuid) to authenticated;

comment on function public.get_active_bom_for_branch is
  'Trả bom_id cho (product, branch) — ưu tiên branch-specific > global. CEO 18/05/2026.';

-- 5. Helper: get_bom_items_for_branch — convenient wrapper
-- Trả về list bom_items với material info để consumer dùng.
create or replace function public.get_bom_items_for_branch(
  p_product_id uuid,
  p_branch_id uuid
) returns table (
  bom_id uuid,
  bom_name text,
  bom_branch_id uuid,
  material_id uuid,
  material_code text,
  material_name text,
  quantity numeric,
  unit text,
  waste_percent numeric,
  effective_qty numeric
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
begin
  v_bom_id := public.get_active_bom_for_branch(p_product_id, p_branch_id);

  if v_bom_id is null then
    return; -- không có BOM
  end if;

  return query
  select
    b.id as bom_id,
    b.name as bom_name,
    b.branch_id as bom_branch_id,
    bi.material_id,
    p.code as material_code,
    p.name as material_name,
    bi.quantity,
    bi.unit,
    coalesce(bi.waste_percent, 0) as waste_percent,
    -- effective_qty = quantity × (1 + waste_percent/100)
    round(
      (bi.quantity * (1 + coalesce(bi.waste_percent, 0) / 100))::numeric,
      4
    ) as effective_qty
  from public.bom b
    join public.bom_items bi on bi.bom_id = b.id
    left join public.products p on p.id = bi.material_id
  where b.id = v_bom_id
  order by bi.sort_order, bi.id;
end;
$$;

grant execute on function public.get_bom_items_for_branch(uuid, uuid) to authenticated;

comment on function public.get_bom_items_for_branch is
  'Trả list bom_items + material info cho (product, branch). CEO 18/05/2026.';

notify pgrst, 'reload schema';
