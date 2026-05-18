-- ============================================================
-- 00104: Bulk gắn HSD cho tồn cũ (CEO 18/05/2026)
--
-- BỐI CẢNH: CEO setup data từ phần mềm cũ qua → 270 NVL có tồn nhưng
-- không có HSD. Mockup single-SP dialog (commit c813b5e) chỉ phù hợp
-- vài SP lẻ tẻ. Với 270 SP cần bulk table inline → 1 RPC xử lý nhiều
-- dòng atomic.
--
-- 2 RPC mới:
--   1. get_products_with_branch_stock — list SP có tồn > 0 ở chi nhánh,
--      kèm thông tin "đã có lot active với HSD nào sớm nhất" để UI cảnh
--      báo trước khi override.
--   2. bulk_create_adjustment_lots_atomic — tạo nhiều lots cùng lúc
--      trong 1 transaction. Validate qty + role owner/admin.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Helper: list SP có tồn > 0 ở chi nhánh, kèm earliest existing
--    active lot expiry (để UI cảnh báo).
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_products_with_branch_stock(
  p_branch_id uuid,
  p_category_id uuid default null,
  p_supplier_id uuid default null,
  p_only_without_lots boolean default false
) returns table (
  product_id uuid,
  product_code text,
  product_name text,
  product_type text,
  stock_unit text,
  category_id uuid,
  category_name text,
  branch_stock numeric,
  earliest_lot_expiry date,
  total_lots_active int
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := public._current_caller_tenant();

  return query
  with active_lots as (
    select
      pl.product_id,
      min(pl.expiry_date) filter (where pl.expiry_date is not null) as earliest_expiry,
      count(*)::int as total_active
    from public.product_lots pl
    where pl.tenant_id = v_tenant_id
      and pl.branch_id = p_branch_id
      and pl.status = 'active'
      and pl.current_qty > 0
    group by pl.product_id
  )
  select
    p.id as product_id,
    p.code as product_code,
    p.name as product_name,
    p.product_type,
    coalesce(p.stock_unit, p.unit, '') as stock_unit,
    p.category_id,
    c.name as category_name,
    coalesce(bs.quantity, 0) as branch_stock,
    al.earliest_expiry as earliest_lot_expiry,
    coalesce(al.total_active, 0) as total_lots_active
  from public.products p
    left join public.categories c on c.id = p.category_id
    inner join public.branch_stock bs on bs.product_id = p.id and bs.branch_id = p_branch_id
    left join active_lots al on al.product_id = p.id
  where p.tenant_id = v_tenant_id
    and p.is_active = true
    and bs.quantity > 0
    and (p_category_id is null or p.category_id = p_category_id)
    and (p_supplier_id is null or p.supplier_id = p_supplier_id)
    and (
      -- Filter "chỉ SP chưa có lot": chỉ trả SP có total_active = 0 (hoặc null)
      not p_only_without_lots
      or al.total_active is null
      or al.total_active = 0
    )
  order by c.name nulls last, p.code;
end;
$$;

grant execute on function public.get_products_with_branch_stock(uuid, uuid, uuid, boolean) to authenticated;

comment on function public.get_products_with_branch_stock is
  'List SP có tồn > 0 ở chi nhánh + thông tin lot active. Filter: nhóm, NCC, "chỉ chưa có lot". CEO 18/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- 2. RPC bulk: tạo nhiều adjustment lots cùng lúc
-- ────────────────────────────────────────────────────────────────
-- Input p_items jsonb:
-- [
--   {
--     "product_id": "uuid",
--     "branch_id": "uuid",
--     "qty": 60,
--     "expiry_date": "2026-12-15",
--     "lot_number": "LOT-CUOSAN-CPH-20260518",  // optional, auto-gen nếu trống
--     "note": "Khai báo tồn cũ chuyển từ KiotViet"
--   },
--   ...
-- ]
--
-- Return:
-- {
--   success: true,
--   created: 8,
--   failed: [{product_id, reason}, ...],
--   total: 10
-- }
create or replace function public.bulk_create_adjustment_lots_atomic(
  p_items jsonb,
  p_default_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_item jsonb;
  v_product_id uuid;
  v_branch_id uuid;
  v_qty numeric;
  v_expiry_date date;
  v_lot_number text;
  v_note text;
  v_branch_stock numeric;
  v_sum_active_lots numeric;
  v_product_record record;
  v_created int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_total int := 0;
  v_lot_stamp text := to_char(now(), 'YYYYMMDD');
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  if v_profile.role not in ('owner', 'admin') then
    raise exception 'PERMISSION_DENIED: chỉ owner/admin được gắn HSD cho tồn cũ';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_INPUT: p_items phải là JSON array';
  end if;

  v_total := jsonb_array_length(p_items);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_branch_id := nullif(v_item->>'branch_id', '')::uuid;
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    v_expiry_date := nullif(v_item->>'expiry_date', '')::date;
    v_lot_number := nullif(v_item->>'lot_number', '');
    v_note := coalesce(nullif(v_item->>'note', ''), p_default_note);

    -- Validate cơ bản
    if v_product_id is null or v_branch_id is null then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_product_id,
        'reason', 'Thiếu product_id hoặc branch_id'
      );
      continue;
    end if;

    if v_qty <= 0 then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_product_id,
        'reason', 'Số lượng phải > 0'
      );
      continue;
    end if;

    if v_expiry_date is null then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_product_id,
        'reason', 'Thiếu HSD'
      );
      continue;
    end if;

    -- Lock product + validate cross-tenant
    select p.id, p.code, p.name, p.product_type
    into v_product_record
    from public.products p
    where p.id = v_product_id and p.tenant_id = v_profile.tenant_id;

    if not found then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_product_id,
        'reason', 'SP không tồn tại hoặc không thuộc tenant'
      );
      continue;
    end if;

    -- Validate qty không vượt tồn (sau khi trừ SUM lots active)
    select coalesce(bs.quantity, 0) into v_branch_stock
    from public.branch_stock bs
    where bs.product_id = v_product_id
      and bs.branch_id = v_branch_id
      and bs.variant_id is null;

    if v_branch_stock is null or v_branch_stock <= 0 then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_product_id,
        'product_code', v_product_record.code,
        'reason', 'Chi nhánh không có tồn cho SP này'
      );
      continue;
    end if;

    select coalesce(sum(current_qty), 0) into v_sum_active_lots
    from public.product_lots
    where product_id = v_product_id
      and branch_id = v_branch_id
      and status = 'active';

    if v_sum_active_lots + v_qty > v_branch_stock then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_product_id,
        'product_code', v_product_record.code,
        'reason', format(
          'Vượt tồn: lots active đã có %s, cộng %s sẽ thành %s > tồn thực %s',
          v_sum_active_lots, v_qty, v_sum_active_lots + v_qty, v_branch_stock
        )
      );
      continue;
    end if;

    -- Auto-gen lot_number nếu trống
    if v_lot_number is null or v_lot_number = '' then
      v_lot_number := 'LOT-CUOSAN-' ||
        regexp_replace(v_product_record.code, '[^A-Z0-9]', '', 'g') ||
        '-' || v_lot_stamp || '-' ||
        lpad((v_created + 1)::text, 3, '0');
    end if;

    -- Insert adjustment lot
    insert into public.product_lots (
      tenant_id, product_id, variant_id, lot_number,
      source_type, purchase_order_id, supplier_id,
      received_date, expiry_date, initial_qty, current_qty,
      branch_id, status, note
    ) values (
      v_profile.tenant_id, v_product_id, null, v_lot_number,
      'adjustment', null, null,
      current_date, v_expiry_date, v_qty, v_qty,
      v_branch_id, 'active',
      coalesce(v_note, 'Khai báo HSD cho tồn cũ')
    );

    -- Audit log
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, new_data
    ) values (
      v_profile.tenant_id, v_actor, 'create_adjustment_lot', 'product_lot', v_product_id,
      jsonb_build_object(
        'product_code', v_product_record.code,
        'product_name', v_product_record.name,
        'branch_id', v_branch_id,
        'lot_number', v_lot_number,
        'qty', v_qty,
        'expiry_date', v_expiry_date,
        'note', v_note,
        'source_type', 'adjustment'
      )
    );

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'created', v_created,
    'failed', v_failed,
    'failed_count', jsonb_array_length(v_failed),
    'total', v_total
  );
end;
$$;

grant execute on function public.bulk_create_adjustment_lots_atomic(jsonb, text) to authenticated;

comment on function public.bulk_create_adjustment_lots_atomic is
  'Bulk tạo adjustment lots cho tồn cũ — chỉ owner/admin, validate qty + audit log. CEO 18/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- 3. ALTER product_lots check constraint cho source_type='adjustment'
-- ────────────────────────────────────────────────────────────────
-- Verify source_type constraint accept 'adjustment'. Nếu chưa thì thêm.
do $$
begin
  -- Check nếu có check constraint cũ và thêm 'adjustment' nếu thiếu
  if not exists (
    select 1 from pg_constraint
    where conname = 'product_lots_source_type_check'
      and pg_get_constraintdef(oid) like '%adjustment%'
  ) then
    -- Drop constraint cũ + tạo mới với 'adjustment'
    alter table public.product_lots
      drop constraint if exists product_lots_source_type_check;
    alter table public.product_lots
      add constraint product_lots_source_type_check
      check (source_type in ('purchase', 'production', 'adjustment', 'transfer'));
  end if;
end $$;

notify pgrst, 'reload schema';
