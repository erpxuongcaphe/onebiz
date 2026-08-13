-- Rollback code paths from 00320. Existing snapshot columns are retained so
-- audit evidence is never destroyed.

begin;

drop trigger if exists trg_normalize_bom_item_uom_00320 on public.bom_items;
drop function if exists public.normalize_bom_item_uom_00320();
drop function if exists public.update_purchase_order_prices_with_uom(
  uuid, jsonb, uuid, text, text, numeric, numeric, numeric
);
drop function if exists public.receive_purchase_items_with_uom_atomic(
  uuid, jsonb, uuid
);
drop function if exists public.save_purchase_order_with_uom_atomic(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric,
  text, boolean, boolean, jsonb
);
drop function if exists public.resolve_product_uom_factor(uuid, uuid, text);
drop function if exists public.replace_product_uom_conversions_atomic(uuid, text, jsonb);

-- Restore the legacy grants only if rollback is explicitly requested.
grant insert, update, delete on table public.uom_conversions to authenticated;
drop index if exists public.idx_uom_conversions_active_pair_unique;

commit;

select
  to_regprocedure('public.resolve_product_uom_factor(uuid,uuid,text)') is null as factor_removed,
  not exists (
    select 1 from pg_trigger
    where tgname = 'trg_normalize_bom_item_uom_00320' and not tgisinternal
  ) as bom_guard_removed;
