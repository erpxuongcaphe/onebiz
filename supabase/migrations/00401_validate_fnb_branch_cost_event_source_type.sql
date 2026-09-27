-- Validate the widened F&B cost-event allowlist after 00397-00400.
-- The NOT VALID checks in those migrations already reject invalid new writes;
-- validation scans old rows under a lock that permits concurrent DML.
begin;
set local lock_timeout = '1s';

do $preflight$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = to_regclass('public.fnb_branch_product_cost_events')
      and c.conname = 'fnb_branch_product_cost_events_source_type_check'
      and c.contype = 'c'
  ) then
    raise exception using errcode = 'P0001',
      message = 'FNB_00401_SOURCE_TYPE_CONSTRAINT_MISSING';
  end if;
end;
$preflight$;

alter table public.fnb_branch_product_cost_events
  validate constraint fnb_branch_product_cost_events_source_type_check;

do $verify$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = to_regclass('public.fnb_branch_product_cost_events')
      and c.conname = 'fnb_branch_product_cost_events_source_type_check'
      and c.contype = 'c'
      and c.convalidated
  ) then
    raise exception using errcode = 'P0001',
      message = 'FNB_00401_SOURCE_TYPE_CONSTRAINT_NOT_VALIDATED';
  end if;
end;
$verify$;

commit;
