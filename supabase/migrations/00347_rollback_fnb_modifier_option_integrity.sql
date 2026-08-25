-- Rollback 00347. This only removes validation triggers and does not change
-- modifier data, invoices, kitchen orders, or inventory movements.

begin;

drop trigger if exists trg_enforce_modifier_option_integrity_00347
  on public.modifier_options;
drop trigger if exists trg_enforce_modifier_group_integrity_00347
  on public.modifier_groups;

drop function if exists public.enforce_modifier_option_integrity_00347();
drop function if exists public.enforce_modifier_group_integrity_00347();

commit;

notify pgrst, 'reload schema';
