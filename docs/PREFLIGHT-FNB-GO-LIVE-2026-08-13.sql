-- Hậu kiểm chỉ đọc trước khi vận hành POS FnB.
-- Không INSERT / UPDATE / DELETE, không đổi cấu trúc hay dữ liệu.

with fn as (
  select
    coalesce(string_agg(pg_get_functiondef(p.oid), E'\n') filter (
      where p.proname = 'fnb_send_to_kitchen_atomic_v2'
    ), '') as send_to_kitchen,
    coalesce(string_agg(pg_get_functiondef(p.oid), E'\n') filter (
      where p.proname = '_fnb_complete_payment_impl_00230'
    ), '') as complete_payment
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'fnb_send_to_kitchen_atomic_v2',
      '_fnb_complete_payment_impl_00230'
    )
), modifier_columns as (
  select
    count(*) filter (where column_name = 'min_select') = 1 as has_min_select,
    count(*) filter (where column_name = 'max_select') = 1 as has_max_select
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'modifier_groups'
    and column_name in ('min_select', 'max_select')
), modifier_guard as (
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'enforce_fnb_modifier_multi_limits_00318'
  ) as installed
)
select
  position('00303' in fn.send_to_kitchen) > 0 as topping_compat_00303_ok,
  position('GIA_TOPPING_SERVER_00304' in fn.complete_payment) > 0 as topping_server_price_00304_ok,
  modifier_columns.has_min_select
    and modifier_columns.has_max_select
    and modifier_guard.installed as modifier_limits_00318_ok
from fn, modifier_columns, modifier_guard;

-- Thống kê cấu hình, không trả UUID hoặc dữ liệu giao dịch.
with topping as (
  select
    p.tenant_id,
    count(*) as total,
    count(*) filter (
      where p.sell_price > 0
        and exists (
          select 1
          from public.bom b
          where b.is_active = true
            and (b.product_id = p.id or (p.bom_code is not null and b.code = p.bom_code))
        )
    ) as ready
  from public.products p
  where p.deleted_at is null
    and p.is_active = true
    and p.product_type = 'sku'
    and p.channel = 'fnb'
    and p.code ilike 'SKU-TPP%'
  group by p.tenant_id
), modifier_risk as (
  select
    mg.tenant_id,
    count(*) filter (
      where mo.is_active = true
        and mo.scale_factor is not null
        and mo.linked_product_id is not null
    ) as double_stock_mode,
    count(*) filter (where mo.is_active = true and mo.is_default = true) as defaults
  from public.modifier_groups mg
  left join public.modifier_options mo on mo.group_id = mg.id
  where mg.is_active = true
    and mg.name = 'Mức đường'
  group by mg.tenant_id
)
select
  coalesce(sum(topping.total), 0) as topping_sku_total,
  coalesce(sum(topping.ready), 0) as topping_sku_ready,
  coalesce(sum(modifier_risk.double_stock_mode), 0) as sugar_options_with_double_stock_mode,
  coalesce(max(modifier_risk.defaults), 0) as max_sugar_defaults_per_tenant
from topping
full join modifier_risk using (tenant_id);
