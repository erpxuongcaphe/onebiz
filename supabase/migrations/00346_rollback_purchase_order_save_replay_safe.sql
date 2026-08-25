begin;

drop function if exists public.save_purchase_order_with_uom_atomic_v2(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric, text,
  boolean, boolean, jsonb
);

drop table if exists public.purchase_order_save_keys;

commit;
notify pgrst, 'reload schema';
