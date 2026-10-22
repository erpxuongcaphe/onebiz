-- Add future F&B reconciliation snapshots. No backfill or historical close.
alter table public.shifts
  add column if not exists close_kind text,
  add column if not exists expected_transfer numeric,
  add column if not exists actual_transfer numeric,
  add column if not exists transfer_difference numeric;

create or replace function public.fnb_reconcile_shift_totals_20261022(
  p_shift_id uuid, p_actual_cash numeric, p_actual_transfer numeric,
  p_expected_cash numeric, p_expected_transfer numeric, p_close_kind text,
  p_note text default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shift record;
  v_result jsonb;
  v_transfer numeric;
  v_cash numeric;
  v_actor uuid := auth.uid();
  v_tenant uuid := public.get_user_tenant_id();
begin
  if v_actor is null or v_tenant is null then
    raise exception using errcode='42501', message='SHIFT_AUTH_REQUIRED';
  end if;
  if p_actual_cash is null or not (p_actual_cash between 0 and 1000000000000000)
     or p_actual_transfer is null or not (p_actual_transfer between -1000000000000000 and 1000000000000000)
     or p_expected_cash is null or not (p_expected_cash between -1000000000000000 and 1000000000000000)
     or p_expected_transfer is null or not (p_expected_transfer between -1000000000000000 and 1000000000000000) then
    raise exception using errcode='22023', message='SHIFT_RECONCILIATION_AMOUNT_INVALID';
  end if;
  if p_close_kind is null or p_close_kind not in ('end_of_day','shift_change') then
    raise exception using errcode='22023', message='SHIFT_CLOSE_KIND_INVALID';
  end if;
  select s.* into v_shift from public.shifts s
    where s.id=p_shift_id and s.tenant_id=v_tenant for update;
  if not found then
    raise exception using errcode='22023', message='SHIFT_NOT_FOUND';
  end if;
  if not exists (select 1 from public.branches b where b.id=v_shift.branch_id
    and b.tenant_id=v_tenant and b.cascade_mode='outlet') then
    raise exception using errcode='42501', message='SHIFT_FNB_BRANCH_REQUIRED';
  end if;

  -- Reuse the existing actor/branch/manager checks and the current refund-aware finalizer.
  -- Any validation error below rolls back its close and all updates in this transaction.
  if v_shift.status='open' then
    v_result := public.close_shift_atomic(p_shift_id,p_actual_cash,p_note);
  elsif v_shift.status='pending_reconcile' then
    v_result := public.reconcile_pending_shift(p_shift_id,p_actual_cash,p_reason,p_note);
  else
    raise exception using errcode='PT409', message='SHIFT_STATE_CHANGED';
  end if;
  v_cash := (v_result->>'expected_cash')::numeric;
  v_transfer := coalesce((v_result->'sales_by_method'->>'transfer')::numeric,0);
  if v_cash is distinct from p_expected_cash or v_transfer is distinct from p_expected_transfer then
    raise exception using errcode='PT409', message='SHIFT_TOTALS_CHANGED';
  end if;
  if (p_actual_cash<>v_cash or p_actual_transfer<>v_transfer)
    and length(coalesce(nullif(trim(p_note),''),case when v_shift.status='pending_reconcile' then nullif(trim(p_reason),'') end,''))<3 then
    raise exception using errcode='22023', message='SHIFT_DIFFERENCE_REASON_REQUIRED';
  end if;
  update public.shifts set close_kind=p_close_kind,
    expected_transfer=v_transfer, actual_transfer=p_actual_transfer,
    transfer_difference=p_actual_transfer-v_transfer,
    reconciled_by=v_actor, reconciled_at=now()
    where id=p_shift_id and tenant_id=v_tenant and status='closed';
  return v_result || jsonb_build_object('close_kind',p_close_kind,
    'expected_transfer',v_transfer,'actual_transfer',p_actual_transfer,
    'transfer_difference',p_actual_transfer-v_transfer,
    'shift',(select to_jsonb(s) from public.shifts s where s.id=p_shift_id and s.tenant_id=v_tenant));
end; $$;
revoke all on function public.fnb_reconcile_shift_totals_20261022(uuid,numeric,numeric,numeric,numeric,text,text,text) from public,anon;
grant execute on function public.fnb_reconcile_shift_totals_20261022(uuid,numeric,numeric,numeric,numeric,text,text,text) to authenticated;
-- Serialize monetary postings with shift close. Preserve legacy closed shifts.
-- An in-flight checkout that validated the shift before close must not append
-- a receipt after the new reconciliation snapshot has been committed.
create or replace function public._guard_fnb_shift_cash_20261022()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_shift record; v_old_shift uuid;
begin
  if TG_OP='UPDATE' then
    if row(new.shift_id,new.amount,new.payment_method,new.type,new.reference_type,new.reference_id)
       is not distinct from row(old.shift_id,old.amount,old.payment_method,old.type,old.reference_type,old.reference_id) then return new; end if;
    v_old_shift:=old.shift_id;
  end if;
  for v_shift in select s.id,s.status,s.close_kind from public.shifts s
    join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
    where s.id in (new.shift_id,v_old_shift) and s.tenant_id=new.tenant_id and b.cascade_mode='outlet'
    order by s.id for update of s
  loop
    if v_shift.status='closed' and v_shift.close_kind is not null then
      raise exception using errcode='PT409',message='SHIFT_RECONCILED_CASH_LOCKED';
    end if;
  end loop;
  return new;
end; $$;
revoke all on function public._guard_fnb_shift_cash_20261022() from public,anon,authenticated;
drop trigger if exists guard_fnb_shift_cash_20261022 on public.cash_transactions;
create trigger guard_fnb_shift_cash_20261022 before insert or update of
  shift_id,amount,payment_method,type,reference_type,reference_id on public.cash_transactions
  for each row execute function public._guard_fnb_shift_cash_20261022();
notify pgrst, 'reload schema';
