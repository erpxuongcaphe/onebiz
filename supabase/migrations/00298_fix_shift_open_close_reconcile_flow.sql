-- 00298 - Make shift open/close/reconcile transitions atomic and conflict-free.
--
-- Function-only migration. Running this file does not open, close, reconcile,
-- insert, update, or delete any existing business record.

create or replace function public._finalize_shift_atomic_00298(
  p_shift_id uuid,
  p_actual_cash numeric,
  p_note text,
  p_required_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift record;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected numeric;
  v_variance numeric;
  v_total_sales numeric := 0;
  v_total_orders integer := 0;
  v_sales_by_method jsonb := '{}'::jsonb;
  r record;
begin
  if p_required_status not in ('open', 'pending_reconcile') then
    raise exception using errcode = '22023', message = 'SHIFT_STATUS_INVALID';
  end if;
  if p_actual_cash is null or p_actual_cash < 0 then
    raise exception using errcode = '22023', message = 'SHIFT_ACTUAL_CASH_INVALID';
  end if;

  select *
    into v_shift
    from public.shifts s
   where s.id = p_shift_id
     and s.status = p_required_status
   for update;

  if not found then
    raise exception using errcode = '40001', message = 'SHIFT_STATE_CHANGED';
  end if;

  select
    coalesce(sum(case when ct.type = 'receipt' then ct.amount else 0 end), 0),
    coalesce(sum(case when ct.type = 'payment' then ct.amount else 0 end), 0)
    into v_cash_in, v_cash_out
    from public.cash_transactions ct
   where ct.shift_id = p_shift_id
     and coalesce(ct.status, 'completed') <> 'cancelled'
     and coalesce(ct.payment_method, 'cash') = 'cash';

  v_expected := coalesce(v_shift.starting_cash, 0) + v_cash_in - v_cash_out;
  v_variance := p_actual_cash - v_expected;

  select count(*)::integer
    into v_total_orders
    from public.invoices i
   where i.shift_id = p_shift_id
     and i.status = 'completed';

  for r in
    select method, sum(net_amount) as amount
      from (
        select
          coalesce(ct.payment_method, 'cash') as method,
          case
            when ct.type = 'receipt' and ct.reference_type = 'invoice'
              then coalesce(ct.amount, 0)
            when ct.type = 'payment'
                 and ct.reference_type in ('invoice', 'sales_return')
              then -coalesce(ct.amount, 0)
            else 0
          end as net_amount
        from public.cash_transactions ct
       where ct.shift_id = p_shift_id
         and coalesce(ct.status, 'completed') <> 'cancelled'
         and ct.reference_type in ('invoice', 'sales_return')
      ) movements
     group by method
    having sum(net_amount) <> 0
  loop
    v_sales_by_method := jsonb_set(
      v_sales_by_method,
      array[r.method],
      to_jsonb(r.amount),
      true
    );
    v_total_sales := v_total_sales + r.amount;
  end loop;

  update public.shifts
     set status = 'closed',
         closed_at = now(),
         expected_cash = v_expected,
         actual_cash = p_actual_cash,
         cash_difference = v_variance,
         total_sales = v_total_sales,
         total_orders = v_total_orders,
         sales_by_method = v_sales_by_method,
         note = p_note
   where id = p_shift_id
     and status = p_required_status;

  if not found then
    raise exception using errcode = '40001', message = 'SHIFT_STATE_CHANGED';
  end if;

  return jsonb_build_object(
    'shift_id', p_shift_id,
    'starting_cash', v_shift.starting_cash,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'expected_cash', v_expected,
    'actual_cash', p_actual_cash,
    'cash_difference', v_variance,
    'total_sales', v_total_sales,
    'total_orders', v_total_orders,
    'sales_by_method', v_sales_by_method,
    'opened_at', v_shift.opened_at,
    'closed_at', now()
  );
end;
$$;

revoke all on function public._finalize_shift_atomic_00298(
  uuid, numeric, text, text
) from public, anon, authenticated;

create or replace function public.open_shift_atomic(
  p_branch_id uuid,
  p_starting_cash numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_shift public.shifts%rowtype;
  v_already_open boolean := false;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'SHIFT_AUTH_REQUIRED';
  end if;
  if p_starting_cash is null or p_starting_cash < 0 then
    raise exception using errcode = '22023', message = 'SHIFT_STARTING_CASH_INVALID';
  end if;
  if not exists (
    select 1
      from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = v_tenant_id
       and b.is_active = true
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'SHIFT_BRANCH_DENIED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_branch_id::text || ':' || v_actor::text, 0)
  );

  select *
    into v_shift
    from public.shifts s
   where s.tenant_id = v_tenant_id
     and s.branch_id = p_branch_id
     and s.cashier_id = v_actor
     and s.status = 'open'
   for update;

  if found then
    v_already_open := true;
  else
    insert into public.shifts (
      tenant_id, branch_id, cashier_id, starting_cash, status
    ) values (
      v_tenant_id, p_branch_id, v_actor, p_starting_cash, 'open'
    )
    returning * into v_shift;
  end if;

  return to_jsonb(v_shift) || jsonb_build_object(
    'already_open', v_already_open
  );
end;
$$;

revoke all on function public.open_shift_atomic(uuid, numeric)
  from public, anon;
grant execute on function public.open_shift_atomic(uuid, numeric)
  to authenticated;

create or replace function public.close_shift_atomic(
  p_shift_id uuid,
  p_actual_cash numeric,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_shift record;
  v_can_manage boolean := false;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'SHIFT_AUTH_REQUIRED';
  end if;

  select s.id, s.tenant_id, s.branch_id, s.cashier_id, s.status
    into v_shift
    from public.shifts s
   where s.id = p_shift_id
     and s.tenant_id = v_tenant_id
   for update;

  if not found then
    raise exception using errcode = '22023', message = 'SHIFT_NOT_FOUND';
  end if;
  if v_shift.status <> 'open' then
    raise exception using errcode = '40001', message = 'SHIFT_NOT_OPEN';
  end if;
  if not public.user_has_branch_access(v_actor, v_shift.branch_id) then
    raise exception using errcode = '42501', message = 'SHIFT_BRANCH_DENIED';
  end if;

  if v_shift.cashier_id <> v_actor then
    v_can_manage := public.user_has_permission(v_actor, 'shifts.reconcile_any')
      or (
        public.user_has_permission(v_actor, 'shifts.reconcile_own_branch')
        and public.user_has_branch_access(v_actor, v_shift.branch_id)
      );
    if not v_can_manage then
      raise exception using errcode = '42501', message = 'SHIFT_CLOSE_DENIED';
    end if;
  end if;

  return public._finalize_shift_atomic_00298(
    p_shift_id, p_actual_cash, p_note, 'open'
  );
end;
$$;

revoke all on function public.close_shift_atomic(uuid, numeric, text)
  from public, anon;
grant execute on function public.close_shift_atomic(uuid, numeric, text)
  to authenticated;

create or replace function public.reconcile_pending_shift(
  p_shift_id uuid,
  p_actual_cash numeric,
  p_reason text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_tenant uuid := public.get_user_tenant_id();
  v_shift record;
  v_can_any boolean;
  v_can_own boolean;
  v_result jsonb;
  v_final_note text;
begin
  if v_actor is null or v_actor_tenant is null then
    raise exception using errcode = '42501', message = 'SHIFT_AUTH_REQUIRED';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'SHIFT_REASON_REQUIRED';
  end if;

  select s.id, s.tenant_id, s.branch_id, s.cashier_id, s.status
    into v_shift
    from public.shifts s
   where s.id = p_shift_id
     and s.tenant_id = v_actor_tenant
   for update;

  if not found then
    raise exception using errcode = '22023', message = 'SHIFT_NOT_FOUND';
  end if;
  if v_shift.status <> 'pending_reconcile' then
    raise exception using errcode = '40001', message = 'SHIFT_NOT_PENDING_RECONCILE';
  end if;

  v_can_any := public.user_has_permission(v_actor, 'shifts.reconcile_any');
  v_can_own := public.user_has_permission(v_actor, 'shifts.reconcile_own_branch')
    and public.user_has_branch_access(v_actor, v_shift.branch_id);
  if not (v_can_any or v_can_own) then
    raise exception using errcode = '42501', message = 'SHIFT_RECONCILE_DENIED';
  end if;

  v_final_note := concat_ws(
    ' ',
    nullif(trim(coalesce(p_note, '')), ''),
    '[Doi chieu: ' || trim(p_reason) || ']'
  );

  v_result := public._finalize_shift_atomic_00298(
    p_shift_id, p_actual_cash, v_final_note, 'pending_reconcile'
  );

  update public.shifts
     set reconciled_by = v_actor,
         reconciled_at = now(),
         reconcile_reason = trim(p_reason)
   where id = p_shift_id
     and status = 'closed';

  return v_result || jsonb_build_object(
    'reconciled_by', v_actor,
    'reconciled_at', now(),
    'reconcile_reason', trim(p_reason)
  );
end;
$$;

revoke all on function public.reconcile_pending_shift(uuid, numeric, text, text)
  from public, anon;
grant execute on function public.reconcile_pending_shift(uuid, numeric, text, text)
  to authenticated;

notify pgrst, 'reload schema';

-- Read-only verification. Every returned value must be true.
with definitions as (
  select
    pg_get_functiondef(
      to_regprocedure('public.open_shift_atomic(uuid,numeric)')
    ) as open_def,
    pg_get_functiondef(
      to_regprocedure('public.close_shift_atomic(uuid,numeric,text)')
    ) as close_def,
    pg_get_functiondef(
      to_regprocedure('public.reconcile_pending_shift(uuid,numeric,text,text)')
    ) as reconcile_def,
    pg_get_functiondef(
      to_regprocedure('public._finalize_shift_atomic_00298(uuid,numeric,text,text)')
    ) as finalize_def
)
select
  open_def is not null as open_rpc_ok,
  position('already_open' in open_def) > 0 as open_recovers_existing_ok,
  close_def is not null as close_rpc_ok,
  position('_finalize_shift_atomic_00298' in close_def) > 0 as close_uses_finalizer_ok,
  reconcile_def is not null as reconcile_rpc_ok,
  position('set status = ''open''' in lower(reconcile_def)) = 0 as no_pending_to_open_flip_ok,
  position('''pending_reconcile''' in reconcile_def) > 0 as pending_closed_directly_ok,
  finalize_def is not null as finalizer_ok,
  to_regclass('public.idx_shifts_open') is not null as open_shift_index_ok
from definitions;
