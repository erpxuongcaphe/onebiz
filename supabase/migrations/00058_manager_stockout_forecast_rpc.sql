-- Manager PWA stockout forecast
-- Read-only helper for fast branch-aware replenishment signals.

create index if not exists idx_branch_stock_tenant_branch_product
  on public.branch_stock (tenant_id, branch_id, product_id);

create index if not exists idx_stock_movements_tenant_branch_created_product
  on public.stock_movements (tenant_id, branch_id, created_at desc, product_id);

create or replace function public.get_stockout_forecast(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_days integer default 30,
  p_limit integer default 8,
  p_product_type text default 'sku'
)
returns table (
  product_id uuid,
  product_code text,
  product_name text,
  unit text,
  stock numeric,
  min_stock numeric,
  avg_daily_out numeric,
  avg_daily_in numeric,
  total_out numeric,
  total_in numeric,
  days_until_stockout integer,
  forecast_date date
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_days integer := greatest(7, coalesce(p_days, 30));
begin
  return query
  with stock as (
    select
      bs.product_id,
      max(p.code)::text as product_code,
      max(p.name)::text as product_name,
      max(p.unit)::text as unit,
      sum(coalesce(bs.quantity, 0))::numeric as stock,
      max(coalesce(p.min_stock, 0))::numeric as min_stock
    from public.branch_stock bs
    join public.products p
      on p.id = bs.product_id
     and p.tenant_id = bs.tenant_id
    where bs.tenant_id = p_tenant_id
      and (p_branch_id is null or bs.branch_id = p_branch_id)
      and p.is_active is true
      and (p_product_type is null or p.product_type = p_product_type)
    group by bs.product_id
  ),
  movement as (
    select
      sm.product_id,
      sum(
        case
          when sm.type = 'out'
           and (
             p_branch_id is not null
             or lower(coalesce(sm.reference_type, '')) not like '%transfer%'
           )
          then abs(coalesce(sm.quantity, 0))
          else 0
        end
      )::numeric as total_out,
      sum(
        case
          when sm.type = 'in'
           and (
             p_branch_id is not null
             or sm.reference_type is null
             or lower(sm.reference_type) like '%purchase%'
             or lower(sm.reference_type) like '%goods_receipt%'
             or lower(sm.reference_type) like '%nhap_hang%'
           )
          then abs(coalesce(sm.quantity, 0))
          else 0
        end
      )::numeric as total_in
    from public.stock_movements sm
    where sm.tenant_id = p_tenant_id
      and sm.created_at >= now() - ((v_days::text || ' days')::interval)
      and (p_branch_id is null or sm.branch_id = p_branch_id)
    group by sm.product_id
  ),
  forecast as (
    select
      s.product_id,
      s.product_code,
      s.product_name,
      s.unit,
      s.stock,
      s.min_stock,
      coalesce(m.total_out, 0)::numeric as total_out,
      coalesce(m.total_in, 0)::numeric as total_in,
      (coalesce(m.total_out, 0) / v_days)::numeric as avg_daily_out,
      (coalesce(m.total_in, 0) / v_days)::numeric as avg_daily_in
    from stock s
    left join movement m on m.product_id = s.product_id
    where coalesce(m.total_out, 0) > 0
       or s.stock <= s.min_stock
  )
  select
    f.product_id,
    f.product_code,
    f.product_name,
    f.unit,
    f.stock,
    f.min_stock,
    f.avg_daily_out,
    f.avg_daily_in,
    f.total_out,
    f.total_in,
    case
      when f.avg_daily_out <= 0 then null
      else greatest(0, floor(f.stock / nullif(f.avg_daily_out, 0))::integer)
    end as days_until_stockout,
    case
      when f.avg_daily_out <= 0 then null
      else current_date + greatest(0, floor(f.stock / nullif(f.avg_daily_out, 0))::integer)
    end as forecast_date
  from forecast f
  order by
    case
      when f.stock <= 0 then 0
      when f.avg_daily_out > 0 and floor(f.stock / nullif(f.avg_daily_out, 0)) <= 3 then 0
      when f.avg_daily_out > 0 and floor(f.stock / nullif(f.avg_daily_out, 0)) <= 7 then 1
      when f.stock <= f.min_stock then 2
      when f.avg_daily_out > 0 and floor(f.stock / nullif(f.avg_daily_out, 0)) <= 14 then 2
      else 3
    end,
    case
      when f.avg_daily_out <= 0 then 2147483647
      else greatest(0, floor(f.stock / nullif(f.avg_daily_out, 0))::integer)
    end,
    f.total_out desc
  limit greatest(1, coalesce(p_limit, 8));
end;
$$;

grant execute on function public.get_stockout_forecast(uuid, uuid, integer, integer, text)
  to authenticated;
