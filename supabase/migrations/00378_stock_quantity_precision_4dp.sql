-- ============================================================================
-- 00378 - Preserve sub-10g FnB consumption in the stock ledger
--
-- BOM quantities and FIFO lots already use four decimal places, but the three
-- stock sources of truth still used numeric(15,2). A 2.8g recipe expressed in
-- Kg (0.0028) was therefore rounded when it reached stock_movements,
-- branch_stock and products.stock. Widening the scale is backward-compatible:
-- existing Retail quantities retain exactly the same numeric value.
-- ============================================================================

begin;

-- Production should fail quickly instead of waiting behind a long transaction.
set local lock_timeout = '5s';

do $migration$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select jsonb_build_object(
    'products', (select jsonb_build_array(count(*), coalesce(sum(stock), 0),
      coalesce(sum(min_stock), 0), coalesce(sum(max_stock), 0)) from public.products),
    'branch_stock', (select jsonb_build_array(count(*), coalesce(sum(quantity), 0),
      coalesce(sum(reserved), 0)) from public.branch_stock),
    'stock_movements', (select jsonb_build_array(count(*), coalesce(sum(quantity), 0))
      from public.stock_movements),
    'inventory_check_items', (select jsonb_build_array(count(*),
      coalesce(sum(system_stock), 0), coalesce(sum(actual_stock), 0),
      coalesce(sum(difference), 0)) from public.inventory_check_items)
  ) into v_before;

  execute 'alter table public.products
    alter column stock type numeric(18,4),
    alter column min_stock type numeric(18,4),
    alter column max_stock type numeric(18,4)';
  execute 'alter table public.branch_stock
    alter column quantity type numeric(18,4),
    alter column reserved type numeric(18,4)';
  execute 'alter table public.stock_movements
    alter column quantity type numeric(18,4)';
  execute 'alter table public.inventory_check_items
    alter column system_stock type numeric(18,4),
    alter column actual_stock type numeric(18,4),
    alter column difference type numeric(18,4)';

  select jsonb_build_object(
    'products', (select jsonb_build_array(count(*), coalesce(sum(stock), 0),
      coalesce(sum(min_stock), 0), coalesce(sum(max_stock), 0)) from public.products),
    'branch_stock', (select jsonb_build_array(count(*), coalesce(sum(quantity), 0),
      coalesce(sum(reserved), 0)) from public.branch_stock),
    'stock_movements', (select jsonb_build_array(count(*), coalesce(sum(quantity), 0))
      from public.stock_movements),
    'inventory_check_items', (select jsonb_build_array(count(*),
      coalesce(sum(system_stock), 0), coalesce(sum(actual_stock), 0),
      coalesce(sum(difference), 0)) from public.inventory_check_items)
  ) into v_after;

  if v_before is distinct from v_after then
    raise exception using errcode = 'P0001',
      message = '00378_EXISTING_STOCK_CHANGED',
      detail = jsonb_build_object('before', v_before, 'after', v_after)::text;
  end if;
end;
$migration$;

comment on column public.stock_movements.quantity is
  'Stock-ledger quantity in inventory UOM. 00378: four decimals preserve FnB gram-to-Kg consumption.';
comment on column public.branch_stock.quantity is
  'Branch stock snapshot. 00378: numeric(18,4), aligned with BOM and FIFO precision.';
comment on column public.products.stock is
  'Company stock snapshot. 00378: numeric(18,4), aligned with branch stock and ledger.';

commit;
