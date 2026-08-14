-- 00322 rollback: fail closed by disabling order merge.
-- Existing orders, items, discounts and tables are not changed.

revoke all on function public.merge_kitchen_orders_atomic(uuid, uuid[])
  from public, anon, authenticated;
drop function if exists public.merge_kitchen_orders_atomic(uuid, uuid[]);

select
  to_regprocedure('public.merge_kitchen_orders_atomic(uuid,uuid[])') is null
    as fnb_merge_orders_disabled_ok;
