-- Read-only preflight for 00319. This file does not change data or schema.

select
  to_regclass('public.shipping_orders') is not null as shipping_orders_ok,
  to_regclass('public.customers') is not null as customers_ok,
  to_regprocedure('public.attach_invoice_shipment_atomic(uuid,numeric,text,text,text,uuid,text)') is not null as legacy_attach_rpc_ok,
  to_regprocedure('public.save_sales_order_atomic(uuid,text,uuid,uuid,jsonb,numeric,text,uuid,text,text,text)') is not null as legacy_order_rpc_ok,
  to_regprocedure('public.get_user_tenant_id()') is not null as tenant_rpc_ok;

select
  count(*) as current_shipments,
  count(*) filter (where cod_amount > 0) as current_cod_shipments,
  coalesce(sum(cod_amount) filter (where cod_amount > 0), 0) as current_cod_total
from public.shipping_orders;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shipping_orders'
  and column_name in (
    'id', 'tenant_id', 'invoice_id', 'cod_amount',
    'receiver_name', 'receiver_phone', 'receiver_address'
  )
order by column_name;
