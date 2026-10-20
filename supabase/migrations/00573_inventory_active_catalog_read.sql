-- Inventory management read model only. No stock rows or business data are created.
begin;
set local lock_timeout = '3s';

create or replace function public.get_inventory_catalog_00573(
  p_branch_id uuid default null,
  p_product_type text default null,
  p_search text default null,
  p_stock_filter text default 'all',
  p_low_stock_only boolean default false,
  p_offset integer default 0,
  p_limit integer default 20
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  tenant uuid := public.get_user_tenant_id();
  actor uuid := auth.uid();
  search_text text := nullif(replace(lower(trim(p_search)), '×', 'x'), '');
  result jsonb;
begin
  if tenant is null or actor is null or not coalesce(public.user_has_permission(actor, 'inventory.view'), false) then
    raise exception 'INVENTORY_CATALOG_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = tenant
      and public._can_read_branch_inventory_00476(actor, tenant, b.id)
  ) then
    raise exception 'INVENTORY_CATALOG_BRANCH_DENIED' using errcode = '42501';
  end if;
  if p_stock_filter is null or p_stock_filter not in ('all', 'positive', 'zero', 'negative')
    or (p_product_type is not null and p_product_type not in ('sku', 'nvl'))
    or p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'INVENTORY_CATALOG_FILTER_INVALID' using errcode = '22023';
  end if;

  with catalog as materialized (
    select p.id, p.tenant_id, p.code, p.name, p.product_type, p.unit,
      p.min_stock, p.max_stock, p.is_active
    from public.products_scoped p
    where p.tenant_id = tenant and p.inventory_role is distinct from 'fnb_menu_item'
      and (p_product_type is null or p.product_type = p_product_type)
      and (search_text is null
        or position(search_text in replace(lower(p.code), '×', 'x')) > 0
        or position(search_text in replace(lower(p.name), '×', 'x')) > 0)
  ), readable_branches as materialized (
    select b.id, b.code, b.name, b.is_active from public.branches b
    where b.tenant_id = tenant and (p_branch_id is null or b.id = p_branch_id)
      and public._can_read_branch_inventory_00476(actor, tenant, b.id)
  ), balances as materialized (
    select min(s.id::text) id, s.branch_id, s.product_id, s.variant_id,
      sum(s.quantity) quantity, sum(s.reserved) reserved, max(s.updated_at) updated_at
    from public.branch_stock s
    join catalog p on p.id = s.product_id and p.tenant_id = s.tenant_id
    join readable_branches b on b.id = s.branch_id
    where s.tenant_id = tenant
    group by s.branch_id, s.product_id, s.variant_id
  ), visible as materialized (
    select coalesce(s.id, 'catalog:' || b.id::text || ':' || p.id::text) id,
      b.id branch_id, b.name branch_name, b.code branch_code,
      p.id product_id, p.code product_code, p.name product_name, p.product_type,
      p.unit, p.min_stock, p.max_stock, s.variant_id, v.name variant_name,
      coalesce(s.quantity, 0) quantity, coalesce(s.reserved, 0) reserved,
      coalesce(s.quantity, 0) - coalesce(s.reserved, 0) available,
      s.updated_at, s.id is not null has_stock_record
    from catalog p cross join readable_branches b
    left join balances s on s.product_id = p.id and s.branch_id = b.id
    left join public.product_variants_scoped v on v.id = s.variant_id and v.tenant_id = tenant
    -- Keep historical nonzero/reserved balances even for inactive products.
    -- An active catalog item with no balance appears as a zero display row.
    where (p.is_active and (b.is_active or s.id is not null))
      or coalesce(s.quantity, 0) <> 0 or coalesce(s.reserved, 0) <> 0
  ), filtered as materialized (
    select * from visible r
    where (p_stock_filter = 'all'
      or (p_stock_filter = 'positive' and r.quantity > 0)
      or (p_stock_filter = 'zero' and r.quantity = 0)
      or (p_stock_filter = 'negative' and r.quantity < 0))
      and (not coalesce(p_low_stock_only, false) or (r.min_stock > 0 and r.quantity <= r.min_stock))
  ), valuations as materialized (
    -- Existing valuation authority keeps its cost permission and branch checks.
    select * from public.get_branch_stock_values_00540(
      coalesce((select array_agg(distinct product_id) from filtered), '{}'::uuid[]),
      coalesce((select array_agg(distinct branch_id) from filtered), '{}'::uuid[])
    )
  ), valued as materialized (
    select r.*, v.unit_cost,
      case when r.quantity = 0 then 0
        when v.valuation_complete and v.quantity <> 0 then v.stock_value * r.quantity / v.quantity
        else null end stock_value
    from filtered r left join valuations v on v.branch_id = r.branch_id and v.product_id = r.product_id
  ), page_rows as (
    select * from valued order by updated_at desc nulls last, product_code, branch_id,
      variant_id nulls first, id offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,
      r.product_code, r.branch_id, r.variant_id nulls first, r.id) from page_rows r), '[]'::jsonb),
    'total', (select count(*) from valued),
    'total_products', (select count(distinct product_id) from valued),
    'total_value', (select coalesce(sum(stock_value), 0) from valued),
    'valuation_complete', (select coalesce(bool_and(stock_value is not null), true) from valued),
    'low_stock_count', (select count(*) from valued where min_stock > 0 and quantity <= min_stock)
  ) into result;
  return result;
end $$;
revoke all on function public.get_inventory_catalog_00573(uuid,text,text,text,boolean,integer,integer) from public,anon;
grant execute on function public.get_inventory_catalog_00573(uuid,text,text,text,boolean,integer,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
