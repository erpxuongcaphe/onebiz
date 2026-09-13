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

create temporary table _stock_precision_00378_before on commit drop as
select 'products'::text as source,
       count(*)::bigint as row_count,
       coalesce(sum(stock), 0)::numeric as value_1,
       coalesce(sum(min_stock), 0)::numeric as value_2,
       coalesce(sum(max_stock), 0)::numeric as value_3
  from public.products
union all
select 'branch_stock', count(*), coalesce(sum(quantity), 0),
       coalesce(sum(reserved), 0), 0
  from public.branch_stock
union all
select 'stock_movements', count(*), coalesce(sum(quantity), 0), 0, 0
  from public.stock_movements
union all
select 'inventory_check_items', count(*), coalesce(sum(system_stock), 0),
       coalesce(sum(actual_stock), 0), coalesce(sum(difference), 0)
  from public.inventory_check_items;

alter table public.products
  alter column stock type numeric(18,4),
  alter column min_stock type numeric(18,4),
  alter column max_stock type numeric(18,4);

alter table public.branch_stock
  alter column quantity type numeric(18,4),
  alter column reserved type numeric(18,4);

alter table public.stock_movements
  alter column quantity type numeric(18,4);

alter table public.inventory_check_items
  alter column system_stock type numeric(18,4),
  alter column actual_stock type numeric(18,4),
  alter column difference type numeric(18,4);

do $integrity$
declare
  v_failed text;
begin
  with after_state as (
    select 'products'::text as source,
           count(*)::bigint as row_count,
           coalesce(sum(stock), 0)::numeric as value_1,
           coalesce(sum(min_stock), 0)::numeric as value_2,
           coalesce(sum(max_stock), 0)::numeric as value_3
      from public.products
    union all
    select 'branch_stock', count(*), coalesce(sum(quantity), 0),
           coalesce(sum(reserved), 0), 0
      from public.branch_stock
    union all
    select 'stock_movements', count(*), coalesce(sum(quantity), 0), 0, 0
      from public.stock_movements
    union all
    select 'inventory_check_items', count(*), coalesce(sum(system_stock), 0),
           coalesce(sum(actual_stock), 0), coalesce(sum(difference), 0)
      from public.inventory_check_items
  )
  select string_agg(b.source, ', ' order by b.source)
    into v_failed
    from _stock_precision_00378_before b
    join after_state a using (source)
   where (b.row_count, b.value_1, b.value_2, b.value_3)
         is distinct from
         (a.row_count, a.value_1, a.value_2, a.value_3);

  if v_failed is not null then
    raise exception using errcode = 'P0001',
      message = '00378_EXISTING_STOCK_CHANGED', detail = v_failed;
  end if;
end;
$integrity$;

comment on column public.stock_movements.quantity is
  'Stock-ledger quantity in inventory UOM. 00378: four decimals preserve FnB gram-to-Kg consumption.';
comment on column public.branch_stock.quantity is
  'Branch stock snapshot. 00378: numeric(18,4), aligned with BOM and FIFO precision.';
comment on column public.products.stock is
  'Company stock snapshot. 00378: numeric(18,4), aligned with branch stock and ledger.';

commit;
