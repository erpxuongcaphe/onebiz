-- ============================================================
-- 00288: Enforce one atomic write path for stock data
-- ============================================================
-- Privilege and trigger definitions only. No existing business row changes.

begin;

-- Catalog editing remains available, but a browser must never rewrite the
-- company stock snapshot without a stock movement and branch snapshot.
create or replace function public.guard_direct_product_stock_update_00288()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.stock is distinct from old.stock
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using
      errcode = '42501',
      message = 'PRODUCT_STOCK_DIRECT_UPDATE_BLOCKED',
      detail = 'Use an approved atomic stock workflow.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_direct_product_stock_update_00288()
  from public, anon, authenticated;

drop trigger if exists trg_guard_direct_product_stock_update_00288
  on public.products;
create trigger trg_guard_direct_product_stock_update_00288
before update of stock on public.products
for each row
when (old.stock is distinct from new.stock)
execute function public.guard_direct_product_stock_update_00288();

-- These tables are ledgers/snapshots owned by SECURITY DEFINER workflows.
-- Authenticated users keep their existing SELECT access through RLS, but may
-- not create partial stock state from the browser.
revoke insert, update, delete on table public.branch_stock
  from anon, authenticated;
revoke insert, update, delete on table public.stock_movements
  from anon, authenticated;
revoke insert, update, delete on table public.product_lots
  from anon, authenticated;
revoke insert, update, delete on table public.lot_allocations
  from anon, authenticated;

-- Low-level FIFO allocation is an implementation detail. Public workflows
-- call it from trusted database functions in the same transaction.
revoke all on function public.allocate_lots_fifo(
  uuid,uuid,uuid,numeric,text,uuid,uuid
) from public, anon, authenticated;
grant execute on function public.allocate_lots_fifo(
  uuid,uuid,uuid,numeric,text,uuid,uuid
) to service_role;

commit;

select
  to_regprocedure('public.guard_direct_product_stock_update_00288()') is not null
    as product_stock_guard_ok,
  not has_table_privilege('authenticated', 'public.branch_stock', 'INSERT')
    as branch_stock_client_insert_blocked,
  not has_table_privilege('authenticated', 'public.stock_movements', 'INSERT')
    as stock_movement_client_insert_blocked,
  not has_table_privilege('authenticated', 'public.product_lots', 'INSERT')
    as product_lot_client_insert_blocked,
  not has_function_privilege(
    'authenticated',
    'public.allocate_lots_fifo(uuid,uuid,uuid,numeric,text,uuid,uuid)',
    'EXECUTE'
  ) as direct_fifo_allocation_blocked;

notify pgrst, 'reload schema';
