-- Preflight chi doc cho migration 00318. Khong INSERT/UPDATE/DELETE.

select
  to_regclass('public.modifier_groups') is not null as modifier_groups_ok,
  to_regclass('public.kitchen_orders') is not null as kitchen_orders_ok,
  to_regclass('public.kitchen_order_items') is not null as kitchen_order_items_ok,
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'kitchen_order_items'
       and column_name = 'modifier_selections' and data_type = 'jsonb'
  ) as modifier_snapshot_ok,
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'modifier_groups'
       and column_name = 'rule'
  ) as modifier_rule_ok;

-- Migration chi nen chay khi 5 cot tren cung la true.
-- Ket qua nay cung cho biet 00318 da cai hay chua.
select
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'modifier_groups'
       and column_name = 'min_select'
  ) as min_select_installed,
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'modifier_groups'
       and column_name = 'max_select'
  ) as max_select_installed,
  to_regprocedure('public.enforce_fnb_modifier_multi_limits_00318()') is not null
    as guard_installed;
