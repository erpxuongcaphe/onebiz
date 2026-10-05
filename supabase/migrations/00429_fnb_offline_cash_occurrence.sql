-- Tested against the actual checkout chain in disposable PostgreSQL CI:
-- run 37309814711 / job 111762181182. Replay never rewrites historical cash.
begin;
create or replace function public.fnb_complete_payment_timed_v1(p_payload jsonb,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid; v_result jsonb; v_invoice uuid; v_branch uuid; v_cash record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not public.user_has_permission(v_actor,'pos_fnb.checkout') then raise exception 'FNB_CHECKOUT_DENIED' using errcode='42501'; end if;
  if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '5 minutes' then raise exception 'CASH_TIME_INVALID' using errcode='22023'; end if;
  v_result:=public.fnb_complete_payment_atomic_v3(
    (p_payload->>'p_kitchen_order_id')::uuid,(p_payload->>'p_customer_id')::uuid,p_payload->>'p_customer_name',p_payload->>'p_payment_method',
    nullif(p_payload->'p_payment_breakdown','null'::jsonb),(p_payload->>'p_paid')::numeric,coalesce((p_payload->>'p_allow_debt')::boolean,false),
    coalesce((p_payload->>'p_manual_discount_amount')::numeric,0),(p_payload->>'p_manual_discount_otp_id')::uuid,p_payload->>'p_manual_discount_reason',
    p_payload->>'p_note',(p_payload->>'p_shift_id')::uuid,coalesce((p_payload->>'p_tip_amount')::numeric,0),(p_payload->>'p_promotion_id')::uuid,p_payload->>'p_coupon_code');
  if coalesce((v_result->>'idempotent')::boolean,false) then return v_result; end if;
  select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
  v_invoice:=(v_result->>'invoice_id')::uuid;
  select branch_id into v_branch from public.invoices where id=v_invoice and tenant_id=v_tenant;
  if v_branch is null or not public.user_has_branch_access(v_actor,v_branch) then raise exception 'CASH_TIME_ROW_DENIED' using errcode='42501'; end if;
  for v_cash in update public.cash_transactions set occurred_at=p_occurred_at,
      transaction_date=(p_occurred_at at time zone 'Asia/Ho_Chi_Minh')::date,time_source='offline',time_reason='Thu tiền offline; thời điểm lưu trên máy quầy'
    where reference_type='invoice' and reference_id=v_invoice and tenant_id=v_tenant and branch_id=v_branch
      and created_by=v_actor and created_at=transaction_timestamp()
    returning id
  loop
    insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
    values(v_tenant,v_actor,'cash_time_recorded','cash_transaction',v_cash.id,
      jsonb_build_object('occurred_at',p_occurred_at,'time_source','offline','created_at',transaction_timestamp(),'atomic',true));
  end loop;
  return v_result;
end $$;
revoke all on function public.fnb_complete_payment_timed_v1(jsonb,timestamptz) from public,anon;
grant execute on function public.fnb_complete_payment_timed_v1(jsonb,timestamptz) to authenticated;
comment on column public.cash_transactions.time_source is 'system, entered, offline or date_only; historical null is preserved.';
notify pgrst,'reload schema';
commit;
