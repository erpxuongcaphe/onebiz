-- ============================================================
-- 00302: Fix POS shift cutoff timezone
--
-- The previous function assigned a Vietnam local timestamp to a
-- timestamptz variable before adding the timezone. On UTC database sessions
-- that shifted the cutoff by seven hours and could mark a same-day shift as
-- pending_reconcile. This migration only replaces the function; it does not
-- update shifts, invoices, stock, cash or any business data.
-- ============================================================

create or replace function public.mark_overdue_shifts_for_branch(
  p_branch_id uuid
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff_hour smallint;
  v_local_now timestamp without time zone;
  v_local_threshold timestamp without time zone;
  v_threshold timestamptz;
  v_count int;
  v_actor uuid := auth.uid();
  v_actor_tenant uuid;
  v_branch_tenant uuid;
begin
  if v_actor is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;

  select tenant_id, coalesce(shift_cutoff_hour, 3)
  into v_branch_tenant, v_cutoff_hour
  from public.branches
  where id = p_branch_id;

  if v_branch_tenant is null then
    return 0;
  end if;

  select tenant_id into v_actor_tenant
  from public.profiles
  where id = v_actor;

  if v_actor_tenant is null or v_branch_tenant <> v_actor_tenant then
    raise exception 'Không được phép thao tác trên chi nhánh khác tenant'
      using errcode = '42501';
  end if;

  v_local_now := now() at time zone 'Asia/Ho_Chi_Minh';
  v_local_threshold := date_trunc('day', v_local_now)
    + make_interval(hours => v_cutoff_hour);

  if v_local_now < v_local_threshold then
    v_local_threshold := v_local_threshold - interval '1 day';
  end if;

  -- Convert exactly once, after all local-calendar calculations are done.
  v_threshold := v_local_threshold at time zone 'Asia/Ho_Chi_Minh';

  update public.shifts
  set status = 'pending_reconcile',
      auto_marked_pending_at = now()
  where tenant_id = v_actor_tenant
    and branch_id = p_branch_id
    and status = 'open'
    and opened_at < v_threshold;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_overdue_shifts_for_branch is
  'Mark ca open trước cutoff gần nhất theo Asia/Ho_Chi_Minh; không làm lệch mốc do timezone session.';

revoke all on function public.mark_overdue_shifts_for_branch(uuid) from public;
grant execute on function public.mark_overdue_shifts_for_branch(uuid) to authenticated;

-- Read-only verification result for the SQL Editor.
select
  to_regprocedure('public.mark_overdue_shifts_for_branch(uuid)') is not null
    as shift_cutoff_rpc_ok,
  pg_get_functiondef(to_regprocedure('public.mark_overdue_shifts_for_branch(uuid)'))
    like '%v_local_threshold at time zone ''Asia/Ho_Chi_Minh''%'
    as timezone_conversion_ok;