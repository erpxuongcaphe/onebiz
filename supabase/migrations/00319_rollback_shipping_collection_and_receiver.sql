-- Roll back only the new write paths. Business rows and the two new columns
-- are deliberately preserved so a rollback can never erase shipment data.

drop function if exists public.attach_invoice_shipment_atomic_v2(
  uuid, numeric, text, text, text, uuid, text, text, uuid
);
drop function if exists public.save_sales_order_atomic_v2(
  uuid, text, uuid, uuid, jsonb, numeric, text, uuid, text, text, text, text, uuid
);

drop trigger if exists trg_guard_shipping_collection_00319 on public.shipping_orders;
drop function if exists public.guard_shipping_collection_00319();

notify pgrst, 'reload schema';

-- Intentionally NOT dropped:
--   shipping_orders.collection_mode
--   shipping_orders.receiver_customer_id
