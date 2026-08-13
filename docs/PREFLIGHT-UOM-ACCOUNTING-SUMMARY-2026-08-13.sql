-- Compact read-only preflight for unit conversion accounting controls.
-- Returns one row and does not change business data or database schema.

select
  to_regclass('public.uom_conversions') is not null as uom_table_ok,
  to_regclass('public.purchase_order_items') is not null as po_items_ok,
  to_regclass('public.bom_items') is not null as bom_items_ok,

  (
    select count(*)
    from (
      select 1
      from public.uom_conversions
      where is_active
      group by tenant_id, product_id, lower(trim(from_unit)), lower(trim(to_unit))
      having count(*) > 1
    ) duplicates
  ) as duplicate_active_pairs,

  (
    select count(*)
    from public.uom_conversions a
    join public.uom_conversions b
      on b.tenant_id = a.tenant_id
     and b.product_id = a.product_id
     and b.id > a.id
     and lower(trim(b.from_unit)) = lower(trim(a.to_unit))
     and lower(trim(b.to_unit)) = lower(trim(a.from_unit))
    where a.is_active and b.is_active
  ) as reverse_pair_conflicts,

  (
    select count(*)
    from public.uom_conversions
    where is_active
      and (
        factor is null
        or factor < 0.0001
        or nullif(trim(from_unit), '') is null
        or nullif(trim(to_unit), '') is null
        or lower(trim(from_unit)) = lower(trim(to_unit))
      )
  ) as invalid_active_conversions,

  (
    select count(*)
    from public.uom_conversions c
    join public.products p
      on p.id = c.product_id
     and p.tenant_id = c.tenant_id
    where c.is_active
      and lower(trim(c.from_unit)) <> lower(trim(p.unit))
      and lower(trim(c.to_unit)) <> lower(trim(p.unit))
  ) as indirect_conversion_rows,

  (select count(*) from public.purchase_order_items) as purchase_item_count,
  (select count(*) from public.bom_items) as bom_item_count,
  (select count(*) from public.stock_movements) as stock_movement_count,
  pg_size_pretty(pg_total_relation_size('public.purchase_order_items')) as po_items_size,

  (
    select jsonb_object_agg(
      table_name || '.' || column_name,
      jsonb_build_object('precision', numeric_precision, 'scale', numeric_scale)
    )
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('purchase_order_items', 'bom_items')
      and column_name in ('quantity', 'received_quantity', 'unit_price')
  ) as numeric_precision,

  to_regprocedure(
    'public.save_purchase_order_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'
  ) is not null as purchase_rpc_ok,
  to_regprocedure(
    'public.receive_purchase_items_atomic(uuid,jsonb,uuid)'
  ) is not null as receive_rpc_ok,
  to_regprocedure(
    'public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)'
  ) is not null as bom_consume_rpc_ok;
