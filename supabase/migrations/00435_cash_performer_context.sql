begin;

alter table public.cash_transactions
  add column if not exists performed_by uuid references public.profiles(id),
  add column if not exists performed_by_name text;

create or replace function public.guard_cash_performer_context()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if new.performed_by is null and new.performed_by_name is null then return new; end if;
  elsif new.performed_by is not distinct from old.performed_by and new.performed_by_name is not distinct from old.performed_by_name then
    return new;
  end if;
  if current_setting('onebiz.cash_context_id',true) is distinct from new.id::text then
    raise exception 'CASH_PERFORMER_REQUIRES_CONTEXT_RPC' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.guard_cash_performer_context() from public,anon,authenticated;
drop trigger if exists cash_performer_context_guard on public.cash_transactions;
create trigger cash_performer_context_guard before insert or update of performed_by,performed_by_name on public.cash_transactions
  for each row execute function public.guard_cash_performer_context();

-- Metadata for new vouchers only; historical creator is not presumed to be payer.
create or replace function public.get_cash_performers(p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid; v_result jsonb;
begin
  select tenant_id into v_tenant from public.profiles
    where id=auth.uid() and coalesce(is_active,true);
  if v_tenant is null or not public.user_has_permission(auth.uid(),'finance.create_transaction')
     or not public.user_has_branch_access(auth.uid(),p_branch_id)
     or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=v_tenant and coalesce(is_active,true)) then
    raise exception 'CASH_BRANCH_DENIED' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name,p.id),'[]'::jsonb)
    into v_result from public.profiles p
    where p.tenant_id=v_tenant and coalesce(p.is_active,true)
      and public.user_has_branch_access(p.id,p_branch_id);
  return v_result;
end; $$;

create or replace function public.record_cash_transaction_context(
  p_operation text, p_payload jsonb, p_performed_by uuid,
  p_occurred_at timestamptz default null, p_transaction_date date default null,
  p_time_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_result jsonb; v_id uuid; v_row public.cash_transactions%rowtype;
  v_performer public.profiles%rowtype;
begin
  select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
  if v_tenant is null or not public.user_has_permission(auth.uid(),'finance.create_transaction') then
    raise exception 'CASH_CREATE_DENIED' using errcode='42501';
  end if;
  select * into v_performer from public.profiles where id=p_performed_by
    and tenant_id=v_tenant and coalesce(is_active,true);
  if not found then raise exception 'CASH_PERFORMER_REQUIRED' using errcode='22023'; end if;
  -- Delegate money/debt/timing rules unchanged. Any metadata failure rolls back the whole call.
  v_result := public.record_cash_transaction_timed(p_operation,p_payload,p_occurred_at,p_transaction_date,p_time_reason);
  v_id := coalesce(v_result->>'cash_transaction_id',v_result->>'id')::uuid;
  select * into v_row from public.cash_transactions where id=v_id and tenant_id=v_tenant and created_by=auth.uid() for update;
  if not found or not public.user_has_branch_access(auth.uid(),v_row.branch_id)
    or (p_payload ? 'branchId' and (p_payload->>'branchId')::uuid is distinct from v_row.branch_id)
    or not public.user_has_branch_access(v_performer.id,v_row.branch_id) then
    raise exception 'CASH_PERFORMER_BRANCH_DENIED' using errcode='42501';
  end if;
  perform set_config('onebiz.cash_context_id',v_id::text,true);
  update public.cash_transactions set performed_by=v_performer.id,performed_by_name=v_performer.full_name where id=v_id;
  perform set_config('onebiz.cash_context_id','',true);
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
    values(v_tenant,auth.uid(),'cash_performer_recorded','cash_transaction',v_id,
      jsonb_build_object('performed_by',v_performer.id,'performed_by_name',v_performer.full_name,'branch_id',v_row.branch_id,'created_by',auth.uid(),'atomic',true));
  if p_operation='manual' then select to_jsonb(c) into v_result from public.cash_transactions c where id=v_id;
  else v_result := v_result || jsonb_build_object('performed_by',v_performer.id,'performed_by_name',v_performer.full_name); end if;
  return v_result;
end; $$;

revoke all on function public.get_cash_performers(uuid) from public,anon;
revoke all on function public.record_cash_transaction_context(text,jsonb,uuid,timestamptz,date,text) from public,anon;
grant execute on function public.get_cash_performers(uuid) to authenticated;
grant execute on function public.record_cash_transaction_context(text,jsonb,uuid,timestamptz,date,text) to authenticated;
notify pgrst,'reload schema';
commit;
