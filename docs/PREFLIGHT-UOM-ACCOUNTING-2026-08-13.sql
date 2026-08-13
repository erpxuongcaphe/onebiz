-- Read-only preflight for unit conversion accounting controls.
-- This file does not change data or schema.

-- A1. Required tables and columns.
select
  to_regclass('public.uom_conversions') is not null as uom_table_ok,
  to_regclass('public.purchase_order_items') is not null as po_items_ok,
  to_regclass('public.bom_items') is not null as bom_items_ok;

-- A2. Detect duplicate active conversion pairs. Must return zero rows.
select
  tenant_id,
  product_id,
  lower(trim(from_unit)) as from_unit,
  lower(trim(to_unit)) as to_unit,
  count(*) as duplicate_count
from public.uom_conversions
where is_active
group by tenant_id, product_id, lower(trim(from_unit)), lower(trim(to_unit))
having count(*) > 1;

-- A3. Detect conflicting reverse pairs. Review before enabling automatic conversion.
-- Example conflict: Thung -> Tui x12 and Tui -> Thung x12.
select
  a.product_id,
  a.from_unit as first_from,
  a.to_unit as first_to,
  a.factor as first_factor,
  b.from_unit as reverse_from,
  b.to_unit as reverse_to,
  b.factor as reverse_factor
from public.uom_conversions a
join public.uom_conversions b
  on b.tenant_id = a.tenant_id
 and b.product_id = a.product_id
 and b.id > a.id
 and lower(trim(b.from_unit)) = lower(trim(a.to_unit))
 and lower(trim(b.to_unit)) = lower(trim(a.from_unit))
where a.is_active and b.is_active;

-- A4. Invalid factors. Must return zero rows.
select id, product_id, from_unit, to_unit, factor
from public.uom_conversions
where is_active
  and (
    factor is null
    or factor < 0.0001
    or nullif(trim(from_unit), '') is null
    or nullif(trim(to_unit), '') is null
    or lower(trim(from_unit)) = lower(trim(to_unit))
  );

-- A4b. Conversion endpoints not connected directly to the product stock unit.
-- Informational: these rows are retained but not offered in purchase/BOM selectors.
select c.id, c.product_id, p.unit as stock_unit, c.from_unit, c.to_unit, c.factor
from public.uom_conversions c
join public.products p on p.id = c.product_id and p.tenant_id = c.tenant_id
where c.is_active
  and lower(trim(c.from_unit)) <> lower(trim(p.unit))
  and lower(trim(c.to_unit)) <> lower(trim(p.unit));

-- A5. Existing documents remain untouched. Counts are for reconciliation only.
select
  (select count(*) from public.purchase_order_items) as purchase_item_count,
  (select count(*) from public.bom_items) as bom_item_count,
  (select count(*) from public.stock_movements) as stock_movement_count,
  pg_size_pretty(pg_total_relation_size('public.purchase_order_items')) as po_items_size;

-- A5b. Current numeric precision. 00320 widens these without changing values.
select table_name, column_name, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public'
  and table_name in ('purchase_order_items', 'bom_items')
  and column_name in ('quantity', 'received_quantity', 'unit_price')
order by table_name, column_name;

-- A6. Verify latest purchase RPC currently installed.
select
  to_regprocedure(
    'public.save_purchase_order_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'
  ) is not null as purchase_rpc_ok,
  to_regprocedure(
    'public.receive_purchase_items_atomic(uuid,jsonb,uuid)'
  ) is not null as receive_rpc_ok,
  to_regprocedure(
    'public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)'
  ) is not null as bom_consume_rpc_ok;

-- A7. Products whose stock unit would be locked by accounting history.
-- Informational only: 00320 does not change any of these products.
select
  count(*) filter (where has_stock_movement) as products_with_stock_history,
  count(*) filter (where has_purchase) as products_with_purchase_history,
  count(*) filter (where has_sale) as products_with_sales_history,
  count(*) filter (where has_bom_usage) as products_used_in_bom
from (
  select p.id,
    exists (select 1 from public.stock_movements sm where sm.product_id = p.id) as has_stock_movement,
    exists (select 1 from public.purchase_order_items poi where poi.product_id = p.id) as has_purchase,
    exists (select 1 from public.invoice_items ii where ii.product_id = p.id) as has_sale,
    exists (select 1 from public.bom_items bi where bi.material_id = p.id) as has_bom_usage
  from public.products p
) q;
