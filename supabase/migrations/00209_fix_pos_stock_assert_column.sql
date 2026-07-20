-- 00209 — FIX P0: POS không thanh toán được (42703 "column p.status does not exist")
-- Gốc rễ: assert_pos_stock_available (00203) tham chiếu products.status — cột
-- KHÔNG tồn tại (cột đúng: is_active boolean). Hàm này chạy trước MỌI thanh
-- toán (cả F10 lẫn hoàn tất nháp) → chặn bán toàn bộ.
-- Vá: chép nguyên hàm 00203, sửa 3 chỗ p.status → p.is_active (đánh dấu [00209]).

create or replace function public.assert_pos_stock_available(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_items jsonb,
  p_allow_bom_shortage boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_shortage record;
  v_bom_id uuid;
begin
  if p_tenant_id is null or p_branch_id is null then
    raise exception using errcode = '22023', message = 'POS_STOCK_SCOPE_REQUIRED';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'POS_ITEMS_REQUIRED';
  end if;

  -- One checkout at a time per branch. The lock is transaction-scoped and
  -- covers missing branch_stock rows as well as existing rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_branch_id::text, 203)
  );

  for v_item in
    with parsed as (
      select
        (item->>'productId')::uuid as product_id,
        (item->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_items) item
    )
    select
      p.id as product_id,
      p.name as product_name,
      p.is_active, -- [00209] was: p.status (không tồn tại)
      coalesce(p.has_bom, false) as has_bom,
      sum(parsed.quantity) as required
    from parsed
    left join public.products p
      on p.id = parsed.product_id
     and p.tenant_id = p_tenant_id
    group by p.id, p.name, p.is_active, p.has_bom -- [00209]
  loop
    if v_item.product_id is null then
      raise exception using errcode = '22023', message = 'POS_PRODUCT_INVALID';
    end if;
    if v_item.required is null or v_item.required <= 0 then
      raise exception using errcode = '22023', message = 'POS_QUANTITY_INVALID';
    end if;
    -- [00209] chỉ chặn khi CHẮC CHẮN ngừng kinh doanh (is_active = false).
    if v_item.is_active is false then
      raise exception using errcode = 'P0001',
        message = 'POS_PRODUCT_INACTIVE|' || v_item.product_id::text;
    end if;

    if v_item.has_bom
       and public.should_cascade_bom_at_branch(
         v_item.product_id,
         p_branch_id
       ) then
      v_bom_id := public.get_active_bom_for_branch(
        v_item.product_id,
        p_branch_id,
        null
      );
      if v_bom_id is null then
        raise exception using errcode = 'P0001',
          message = 'POS_BOM_UNAVAILABLE|' || v_item.product_id::text;
      end if;
    end if;
  end loop;

  -- Products that are decremented directly must never go below zero.
  for v_shortage in
    with parsed as (
      select
        (item->>'productId')::uuid as product_id,
        (item->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_items) item
    ),
    requested as (
      select product_id, sum(quantity) as required
      from parsed
      group by product_id
    )
    select
      r.product_id,
      p.name as product_name,
      r.required,
      coalesce((
        select sum(bs.quantity)
        from public.branch_stock bs
        where bs.tenant_id = p_tenant_id
          and bs.branch_id = p_branch_id
          and bs.product_id = r.product_id
          and bs.variant_id is null
      ), 0) as available
    from requested r
    join public.products p
      on p.id = r.product_id
     and p.tenant_id = p_tenant_id
    where not (
      coalesce(p.has_bom, false)
      and public.should_cascade_bom_at_branch(p.id, p_branch_id)
    )
      and coalesce((
        select sum(bs.quantity)
        from public.branch_stock bs
        where bs.tenant_id = p_tenant_id
          and bs.branch_id = p_branch_id
          and bs.product_id = r.product_id
          and bs.variant_id is null
      ), 0) < r.required
  loop
    raise exception using errcode = 'P0001',
      message = format(
        'POS_STOCK_SHORTAGE|%s|%s|%s|%s',
        v_shortage.product_id,
        coalesce(v_shortage.product_name, 'Sản phẩm'),
        v_shortage.required,
        v_shortage.available
      );
  end loop;

  if not p_allow_bom_shortage then
    -- Aggregate shared materials across the whole cart before comparing stock.
    for v_shortage in
      with parsed as (
        select
          (item->>'productId')::uuid as product_id,
          (item->>'quantity')::numeric as quantity
        from jsonb_array_elements(p_items) item
      ),
      requested as (
        select product_id, sum(quantity) as sale_qty
        from parsed
        group by product_id
      ),
      material_need as (
        select
          bi.material_id,
          sum(
            bi.quantity
            * (1 + coalesce(bi.waste_percent, 0) / 100)
            * r.sale_qty
          ) as required
        from requested r
        join public.products p
          on p.id = r.product_id
         and p.tenant_id = p_tenant_id
        cross join lateral (
          select public.get_active_bom_for_branch(
            r.product_id,
            p_branch_id,
            null
          ) as bom_id
        ) active_bom
        join public.bom_items bi on bi.bom_id = active_bom.bom_id
        where coalesce(p.has_bom, false)
          and public.should_cascade_bom_at_branch(p.id, p_branch_id)
          and bi.material_id <> r.product_id
        group by bi.material_id
      )
      select
        need.material_id as product_id,
        p.name as product_name,
        need.required,
        coalesce((
          select sum(bs.quantity)
          from public.branch_stock bs
          where bs.tenant_id = p_tenant_id
            and bs.branch_id = p_branch_id
            and bs.product_id = need.material_id
            and bs.variant_id is null
        ), 0) as available
      from material_need need
      left join public.products p on p.id = need.material_id
      where coalesce((
        select sum(bs.quantity)
        from public.branch_stock bs
        where bs.tenant_id = p_tenant_id
          and bs.branch_id = p_branch_id
          and bs.product_id = need.material_id
          and bs.variant_id is null
      ), 0) < need.required
    loop
      raise exception using errcode = 'P0001',
        message = format(
          'NVL_INSUFFICIENT|%s|%s|%s|%s',
          v_shortage.product_id,
          coalesce(v_shortage.product_name, 'NVL'),
          v_shortage.required,
          v_shortage.available
        );
    end loop;
  end if;
end;
$$;

revoke all on function public.assert_pos_stock_available(
  uuid, uuid, jsonb, boolean
) from public, anon, authenticated;

notify pgrst, 'reload schema';

do $$
begin
  raise notice '00209 OK: assert_pos_stock_available dùng is_active — POS bán lại được.';
end $$;
