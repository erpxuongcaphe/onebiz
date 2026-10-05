\set ON_ERROR_STOP on
-- Test-only candidate, on the existing disposable first-payment fixture.
-- Production RPC/client changes are intentionally not applied before evidence.
do $$ begin
  if current_database()<>'fnb_payment_concurrency_test' then raise exception 'Disposable concurrency database required'; end if;
end $$;
alter table cash_transactions add column created_at timestamptz;
alter table cash_transactions alter column created_at set default now();
alter table cash_transactions add column occurred_at timestamptz;
alter table cash_transactions add column transaction_date date;
alter table cash_transactions add column time_source text;
alter table cash_transactions add column time_reason text;
create or replace function public.user_has_permission(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.denied_permission',true),'')<>$2$$;
create or replace function public.user_has_branch_access(uuid,uuid) returns boolean language sql as $$select coalesce(current_setting('test.deny_branch',true),'')<>'yes'$$;

create function public.test_fnb_cash_time_candidate(p_payload jsonb,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid; v_result jsonb; v_invoice uuid; v_branch uuid; v_cash record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not public.user_has_permission(v_actor,'pos_fnb.checkout') then raise exception 'FNB_CHECKOUT_DENIED' using errcode='42501'; end if;
  if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '5 minutes' then raise exception 'CASH_TIME_INVALID' using errcode='22023'; end if;
  -- Existing payment owns every authorization, shift, tender, stock and replay guard.
  v_result:=public.fnb_complete_payment_atomic_v3(
    (p_payload->>'p_kitchen_order_id')::uuid,(p_payload->>'p_customer_id')::uuid,p_payload->>'p_customer_name',p_payload->>'p_payment_method',
    nullif(p_payload->'p_payment_breakdown','null'::jsonb),(p_payload->>'p_paid')::numeric,coalesce((p_payload->>'p_allow_debt')::boolean,false),
    coalesce((p_payload->>'p_manual_discount_amount')::numeric,0),(p_payload->>'p_manual_discount_otp_id')::uuid,p_payload->>'p_manual_discount_reason',
    p_payload->>'p_note',(p_payload->>'p_shift_id')::uuid,coalesce((p_payload->>'p_tip_amount')::numeric,0),(p_payload->>'p_promotion_id')::uuid,p_payload->>'p_coupon_code');
  -- A replay must never change any receipt metadata, even in the same transaction.
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
revoke all on function public.test_fnb_cash_time_candidate(jsonb,timestamptz) from public,anon;
grant execute on function public.test_fnb_cash_time_candidate(jsonb,timestamptz) to authenticated;

insert into kitchen_orders(id,tenant_id,branch_id,status,order_number)
select '00000000-0000-0000-0000-000000000008',tenant_id,branch_id,'pending','UAT-TIMED' from kitchen_orders limit 1;
insert into kitchen_order_items(kitchen_order_id,product_id,product_name,quantity,unit_price)
values('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000010','Timed drink',1,30000);
create function public.test_timed_pay(p_order uuid default '00000000-0000-0000-0000-000000000008',p_at timestamptz default now()-interval '2 days') returns jsonb language sql as $$
select test_fnb_cash_time_candidate(jsonb_build_object('p_kitchen_order_id',$1,'p_customer_name','UAT','p_payment_method','cash','p_paid',50000,'p_shift_id','00000000-0000-0000-0000-000000000007'),$2)
$$;
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
create table test_cash_before as select * from cash_transactions;
do $$ declare r jsonb; at_time timestamptz:=now()-interval '2 days'; n bigint; a bigint; s numeric; begin
  r:=test_timed_pay(p_at=>at_time);
  perform test_assert((select count(*)=1 and min(occurred_at)=at_time and min(transaction_date)=(at_time at time zone 'Asia/Ho_Chi_Minh')::date and min(time_source)='offline' and min(created_at)>at_time from cash_transactions where reference_id=(r->>'invoice_id')::uuid),'first payment records original offline cash time');
  select count(*) into n from cash_transactions; select count(*) into a from audit_log; select sum(quantity) into s from stock_movements;
  r:=test_timed_pay(p_at=>now()-interval '4 days');
  perform test_assert(r->>'idempotent'='true','actual payment replay result preserved');
  perform test_assert((select min(occurred_at)=at_time from cash_transactions where reference_id=(r->>'invoice_id')::uuid),'replay does not rewrite receipt time');
  perform test_assert((select count(*)=n from cash_transactions) and (select count(*)=a from audit_log) and (select sum(quantity)=s from stock_movements),'replay has no cash, audit or stock writes');
end $$;
select test_assert(not exists(select 1 from test_cash_before b join cash_transactions c using(id) where to_jsonb(b) is distinct from to_jsonb(c)),'all historic receipts unchanged');
create function test_timed_error(p_expected text) returns void language plpgsql as $$declare msg text; begin
  begin perform test_timed_pay(); exception when others then msg:=sqlerrm; end;
  perform test_assert(msg=p_expected,'guard: '||p_expected);
end $$;
select set_config('test.denied_permission','pos_fnb.checkout',false);
select test_timed_error('FNB_CHECKOUT_DENIED');
select set_config('test.denied_permission','',false);
select set_config('test.deny_branch','yes',false);
select test_timed_error('BRANCH_ACCESS_DENIED');
select set_config('test.deny_branch','',false);
insert into profiles values('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000099',true);
select set_config('test.actor','00000000-0000-0000-0000-000000000090',false);
select test_timed_error('KITCHEN_ORDER_NOT_FOUND');
select set_config('test.actor','',false);
select test_timed_error('AUTH_REQUIRED');
select test_assert(not has_function_privilege('anon','public.test_fnb_cash_time_candidate(jsonb,timestamptz)','execute'),'anon RPC denied');
\echo 'PASS: offline time candidate with actual checkout chain, first payment, same-transaction replay, exact new receipt, historic sentinel, tenant/branch/auth guards.'
