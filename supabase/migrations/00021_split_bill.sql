-- ============================================================
-- Split Bill Support
-- Parent/child kitchen orders for bill splitting
-- ============================================================

alter table public.kitchen_orders add column if not exists
  parent_order_id uuid references public.kitchen_orders(id) on delete set null;

create index idx_kitchen_orders_parent
  on public.kitchen_orders(parent_order_id)
  where parent_order_id is not null;
