-- 00355 rollback — only restore the previous 20px lower bound when no thin
-- decoration has been created. Failing closed prevents a partial rollback
-- that would reject valid live layout data.

begin;

do $guard$
begin
  if exists (
    select 1
      from public.floor_plan_decorations
     where width < 20 or height < 20
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FLOOR_PLAN_00355_ROLLBACK_BLOCKED_BY_THIN_DECORATION';
  end if;
end;
$guard$;

alter table public.floor_plan_decorations
  drop constraint if exists floor_plan_decorations_width_check,
  drop constraint if exists floor_plan_decorations_height_check;

alter table public.floor_plan_decorations
  add constraint floor_plan_decorations_width_check check (width between 20 and 800),
  add constraint floor_plan_decorations_height_check check (height between 20 and 800);

commit;

notify pgrst, 'reload schema';
