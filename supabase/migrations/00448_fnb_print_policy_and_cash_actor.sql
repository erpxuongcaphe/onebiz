begin;
set local lock_timeout = '2s';

alter table public.fnb_print_points add column if not exists policy jsonb not null default '{}';

-- Reuse the established branch/permission/route validation. Policy and routes
-- commit together; callers cannot update another branch or provision a token.
create or replace function public.fnb_print_manage_v2(p_branch uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_result jsonb; v_policy jsonb; v_key text;
begin
  if p_action <> 'save' then raise exception 'INVALID_PRINT_ACTION'; end if;
  v_policy := coalesce(p_data->'policy','{}'::jsonb);
  if jsonb_typeof(v_policy) is distinct from 'object' then raise exception 'INVALID_PRINT_POLICY'; end if;
  for v_key in select jsonb_object_keys(v_policy) loop
    if v_key not in ('autoPrintKitchen','autoPrintReceipt','receiptStyle','kitchenTicketStyle') then raise exception 'INVALID_PRINT_POLICY'; end if;
  end loop;
  if (v_policy ? 'autoPrintKitchen' and jsonb_typeof(v_policy->'autoPrintKitchen') <> 'boolean')
    or (v_policy ? 'autoPrintReceipt' and jsonb_typeof(v_policy->'autoPrintReceipt') <> 'boolean')
    or (v_policy ? 'receiptStyle' and coalesce(v_policy->>'receiptStyle','') not in ('minimal','standard','full'))
    or (v_policy ? 'kitchenTicketStyle' and coalesce(v_policy->>'kitchenTicketStyle','') not in ('compact','standard','detailed')) then
    raise exception 'INVALID_PRINT_POLICY';
  end if;
  v_result := public.fnb_print_manage_v1(p_branch,p_action,p_data);
  update public.fnb_print_points set policy=v_policy where id=(v_result->>'id')::uuid;
  return v_result || jsonb_build_object('policy',v_policy);
end $$;
revoke all on function public.fnb_print_manage_v2(uuid,text,jsonb) from public,anon;
grant execute on function public.fnb_print_manage_v2(uuid,text,jsonb) to authenticated;

-- Stamp only new F&B invoice receipts in their existing atomic transaction.
-- Do not infer performers on historical rows or mutate cash/stock amounts.
create or replace function public.stamp_fnb_cash_actor_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid := auth.uid(); v_profile public.profiles;
begin
  if new.type <> 'receipt' or new.reference_type <> 'invoice'
    or new.performed_by is not null or new.performed_by_name is not null
    or v_actor is null or new.created_by is distinct from v_actor then return new; end if;
  if not exists(select 1 from public.kitchen_orders k where k.invoice_id=new.reference_id and k.branch_id=new.branch_id and k.tenant_id=new.tenant_id) then return new; end if;
  select * into v_profile from public.profiles where id=v_actor and tenant_id=new.tenant_id and coalesce(is_active,true);
  if not found or not coalesce(public.user_has_permission(v_actor,'pos_fnb.checkout'),false)
    or not coalesce(public.user_has_branch_access(v_actor,new.branch_id),false) then return new; end if;
  new.performed_by := v_actor;
  new.performed_by_name := v_profile.full_name;
  return new;
end $$;
revoke all on function public.stamp_fnb_cash_actor_v1() from public,anon,authenticated;
-- Guard runs first while INSERT metadata is empty; the internal trigger stamps
-- the authenticated cashier only after that guard has accepted the row.
drop trigger if exists z_fnb_cash_actor_stamp on public.cash_transactions;
create trigger z_fnb_cash_actor_stamp before insert on public.cash_transactions
for each row execute function public.stamp_fnb_cash_actor_v1();

-- Older atomic checkout inserts cash before linking the kitchen order. Cover
-- that ordering as well, without ever backfilling receipts from earlier calls.
create or replace function public.stamp_linked_fnb_cash_actor_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid := auth.uid(); v_name text; v_cash record; v_previous text;
begin
  if new.invoice_id is null or new.invoice_id is not distinct from old.invoice_id or v_actor is null then return new; end if;
  select full_name into v_name from public.profiles where id=v_actor and tenant_id=new.tenant_id and coalesce(is_active,true);
  if not found or not coalesce(public.user_has_permission(v_actor,'pos_fnb.checkout'),false)
    or not coalesce(public.user_has_branch_access(v_actor,new.branch_id),false) then return new; end if;
  v_previous := current_setting('onebiz.cash_context_id',true);
  for v_cash in select id from public.cash_transactions where tenant_id=new.tenant_id and branch_id=new.branch_id
    and reference_type='invoice' and reference_id=new.invoice_id and type='receipt' and created_by=v_actor
    and created_at=transaction_timestamp() and performed_by is null and performed_by_name is null
  loop
    perform set_config('onebiz.cash_context_id',v_cash.id::text,true);
    update public.cash_transactions set performed_by=v_actor,performed_by_name=v_name where id=v_cash.id;
  end loop;
  perform set_config('onebiz.cash_context_id',coalesce(v_previous,''),true);
  return new;
end $$;
revoke all on function public.stamp_linked_fnb_cash_actor_v1() from public,anon,authenticated;
drop trigger if exists fnb_linked_cash_actor_stamp on public.kitchen_orders;
create trigger fnb_linked_cash_actor_stamp after update of invoice_id on public.kitchen_orders
for each row execute function public.stamp_linked_fnb_cash_actor_v1();
notify pgrst,'reload schema';
commit;
