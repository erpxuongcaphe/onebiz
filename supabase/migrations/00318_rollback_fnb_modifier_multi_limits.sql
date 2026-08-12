-- Rollback 00318. Khong cham vao don hang, hoa don, ton kho hay so kho.

drop trigger if exists trg_enforce_fnb_modifier_multi_limits_00318
  on public.kitchen_order_items;
drop function if exists public.enforce_fnb_modifier_multi_limits_00318();

alter table public.modifier_groups
  drop constraint if exists modifier_groups_multi_limits_check;
alter table public.modifier_groups
  drop column if exists max_select,
  drop column if exists min_select;

notify pgrst, 'reload schema';
