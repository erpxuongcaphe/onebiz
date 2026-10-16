-- Money accounts are explicit, branch-scoped and independent of income recognition.
-- No old voucher is assigned to an account and no opening amount is inferred.
begin;
create table public.money_accounts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id), code text not null, name text not null,
 kind text not null check(kind in ('cash','bank','ewallet','clearing')),
 bank_name text, account_number text, account_holder text,
 active boolean not null default true,
 opening_date date, opening_amount numeric(18,2), revision integer not null default 1,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(tenant_id,code),
 check(code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'), check(length(btrim(name)) between 1 and 160),
 check(kind<>'bank' or (length(btrim(coalesce(bank_name,'')))>0 and length(btrim(coalesce(account_number,'')))>0 and length(btrim(coalesce(account_holder,'')))>0)),
 check((opening_date is null) = (opening_amount is null)),
 check(opening_amount is null or (opening_amount::text not in ('NaN','Infinity','-Infinity') and abs(opening_amount)<=9999999999999.99))
);
alter table public.money_accounts enable row level security;
create policy money_account_read on public.money_accounts for select to authenticated using(
 tenant_id=(select p.tenant_id from public.profiles p where p.id=auth.uid() and coalesce(p.is_active,true))
 and public.user_has_branch_access(auth.uid(),branch_id)
 and (public.user_has_permission(auth.uid(),'finance.view_cash_book') or public.user_has_permission(auth.uid(),'finance.create_transaction')));
revoke all on public.money_accounts from anon,authenticated;
grant select on public.money_accounts to authenticated;
alter table public.cash_transactions add column money_account_id uuid references public.money_accounts(id);

create function public.guard_cash_money_account() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.money_accounts%rowtype;
begin
 if new.money_account_id is null then return new; end if;
 select * into a from public.money_accounts where id=new.money_account_id and tenant_id=new.tenant_id;
 if not found or a.branch_id is distinct from new.branch_id
  or (tg_op='INSERT' and not a.active)
  or (tg_op='UPDATE' and new.money_account_id is distinct from old.money_account_id and not a.active)
  or (new.payment_method='cash' and a.kind<>'cash')
  or (new.payment_method='transfer' and a.kind<>'bank')
  or (new.payment_method='card' and a.kind not in ('bank','clearing'))
  or (new.payment_method='ewallet' and a.kind not in ('ewallet','bank','clearing')) then
  raise exception 'MONEY_ACCOUNT_METHOD_OR_BRANCH_INVALID' using errcode='22023';
 end if;
 return new;
end; $$;
create trigger cash_money_account_guard before insert or update of money_account_id,branch_id,payment_method on public.cash_transactions
for each row execute function public.guard_cash_money_account();
revoke all on function public.guard_cash_money_account() from public,anon,authenticated;

create function public.save_money_account(p_id uuid,p_expected_revision integer,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; a public.money_accounts%rowtype; old_row jsonb; b uuid; op_date date; op_amount numeric;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.create_transaction'),false)
  or not coalesce(public.user_has_permission(auth.uid(),'finance.void_transaction'),false) then raise exception 'MONEY_ACCOUNT_MANAGE_DENIED' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'MONEY_ACCOUNT_REASON_REQUIRED' using errcode='22023'; end if;
 b:=(p_payload->>'branchId')::uuid;
 if not exists(select 1 from public.branches where id=b and tenant_id=t)
  or not coalesce(public.user_has_branch_access(auth.uid(),b),false) then raise exception 'MONEY_ACCOUNT_BRANCH_DENIED' using errcode='42501'; end if;
 op_date:=nullif(p_payload->>'openingDate','')::date; op_amount:=nullif(p_payload->>'openingAmount','')::numeric;
 if (op_date is null)<>(op_amount is null) or not coalesce(isfinite(op_date),true)
  or op_date>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'MONEY_ACCOUNT_OPENING_INVALID' using errcode='22023'; end if;
 if p_id is not null then
  select * into a from public.money_accounts where id=p_id and tenant_id=t for update;
  if not found or not coalesce(public.user_has_branch_access(auth.uid(),a.branch_id),false) then raise exception 'MONEY_ACCOUNT_NOT_FOUND' using errcode='42501'; end if;
  if a.revision is distinct from p_expected_revision then raise exception 'MONEY_ACCOUNT_CHANGED_RELOAD' using errcode='PT409'; end if;
  if a.branch_id<>b or a.kind is distinct from p_payload->>'kind' then raise exception 'MONEY_ACCOUNT_IDENTITY_IMMUTABLE' using errcode='22023'; end if;
  old_row:=to_jsonb(a);
  update public.money_accounts set name=btrim(p_payload->>'name'), bank_name=nullif(btrim(p_payload->>'bankName'),''),
   account_number=nullif(btrim(p_payload->>'accountNumber'),''),account_holder=nullif(btrim(p_payload->>'accountHolder'),''),
   active=coalesce((p_payload->>'active')::boolean,true),opening_date=op_date,opening_amount=op_amount,
   revision=revision+1,updated_at=now() where id=p_id returning * into a;
 else
  insert into public.money_accounts(tenant_id,branch_id,code,name,kind,bank_name,account_number,account_holder,opening_date,opening_amount,created_by)
  values(t,b,upper(btrim(p_payload->>'code')),btrim(p_payload->>'name'),p_payload->>'kind',nullif(btrim(p_payload->>'bankName'),''),
   nullif(btrim(p_payload->>'accountNumber'),''),nullif(btrim(p_payload->>'accountHolder'),''),op_date,op_amount,auth.uid()) returning * into a;
 end if;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(t,auth.uid(),'money_account_saved','money_account',a.id,old_row,to_jsonb(a)||jsonb_build_object('reason',btrim(p_reason)));
 return to_jsonb(a);
end; $$;

create function public.get_money_account_workspace(p_branch_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t uuid; result jsonb;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.view_cash_book'),false)
  or p_branch_id is null or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=t)
  or not coalesce(public.user_has_branch_access(auth.uid(),p_branch_id),false) then raise exception 'MONEY_ACCOUNT_READ_DENIED' using errcode='42501'; end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to then raise exception 'MONEY_ACCOUNT_DATES_INVALID' using errcode='22023'; end if;
 select jsonb_build_object('accounts',coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object(
  'opening_balance',case when a.opening_date<=p_from then a.opening_amount+coalesce(m.before_net,0) end,
  'receipts',coalesce(m.receipts,0),'payments',coalesce(m.payments,0),
  'closing_balance',case when a.opening_date<=p_from then a.opening_amount+coalesce(m.before_net,0)+coalesce(m.receipts,0)-coalesce(m.payments,0) end
 ) order by a.kind,a.code),'[]'::jsonb),
 'unassigned_count',(select count(*) from public.cash_transactions c where c.tenant_id=t and c.branch_id=p_branch_id
  and c.money_account_id is null and c.status='completed' and c.transaction_date between p_from and p_to)) into result
 from public.money_accounts a left join lateral (
  select sum(case when c.type='receipt' then c.amount else -c.amount end) filter(where c.transaction_date<p_from and c.transaction_date>=a.opening_date) as before_net,
  sum(c.amount) filter(where c.type='receipt' and c.transaction_date between p_from and p_to) as receipts,
  sum(c.amount) filter(where c.type='payment' and c.transaction_date between p_from and p_to) as payments
  from public.cash_transactions c where c.tenant_id=t and c.branch_id=p_branch_id and c.money_account_id=a.id and c.status='completed'
 ) m on true where a.tenant_id=t and a.branch_id=p_branch_id;
 return result;
end; $$;

-- A wrapper keeps old callers valid. Explicit account selection and money posting commit together.
create function public.record_cash_with_account(p_operation text,p_payload jsonb,p_money_account_id uuid,p_performed_by uuid default null,
 p_occurred_at timestamptz default null,p_transaction_date date default null,p_time_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; cash_id uuid; t uuid;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.create_transaction'),false) then raise exception 'CASH_CREATE_DENIED' using errcode='42501'; end if;
 if p_money_account_id is null then raise exception 'MONEY_ACCOUNT_REQUIRED' using errcode='22023'; end if;
 if p_performed_by is null then r:=public.record_cash_transaction_timed(p_operation,p_payload,p_occurred_at,p_transaction_date,p_time_reason);
 else r:=public.record_cash_transaction_context(p_operation,p_payload,p_performed_by,p_occurred_at,p_transaction_date,p_time_reason); end if;
 cash_id:=coalesce(r->>'cash_transaction_id',r->>'id')::uuid;
 update public.cash_transactions c set money_account_id=p_money_account_id where c.id=cash_id and c.tenant_id=t
  and public.user_has_branch_access(auth.uid(),c.branch_id);
 if not found then raise exception 'MONEY_ACCOUNT_CASH_NOT_FOUND' using errcode='42501'; end if;
 if p_operation='manual' then select to_jsonb(c) into r from public.cash_transactions c where c.id=cash_id; end if;
 return r||jsonb_build_object('money_account_id',p_money_account_id);
end; $$;
revoke all on function public.save_money_account(uuid,integer,jsonb,text),public.get_money_account_workspace(uuid,date,date),
 public.record_cash_with_account(text,jsonb,uuid,uuid,timestamptz,date,text) from public,anon;
grant execute on function public.save_money_account(uuid,integer,jsonb,text),public.get_money_account_workspace(uuid,date,date),
 public.record_cash_with_account(text,jsonb,uuid,uuid,timestamptz,date,text) to authenticated;

create function public.save_management_finance_with_account(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; c uuid; t uuid;
begin
 r:=public.save_management_finance_document(p_request_id,p_payload);
 if nullif(p_payload#>>'{payment,moneyAccountId}','') is not null then
  select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
  c:=(r#>>'{cash,id}')::uuid;
  update public.cash_transactions x set money_account_id=(p_payload#>>'{payment,moneyAccountId}')::uuid where x.id=c and x.tenant_id=t and public.user_has_branch_access(auth.uid(),x.branch_id);
  if not found then raise exception 'MONEY_ACCOUNT_CASH_NOT_FOUND' using errcode='42501'; end if;
 end if;
 return r;
end; $$;
create function public.settle_management_finance_with_account(p_event_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; t uuid;
begin
 r:=public.settle_management_finance_event(p_event_id,p_request_id,p_payload);
 if nullif(p_payload->>'moneyAccountId','') is not null then
  select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
  update public.cash_transactions x set money_account_id=(p_payload->>'moneyAccountId')::uuid where x.id=(r->>'id')::uuid and x.tenant_id=t and public.user_has_branch_access(auth.uid(),x.branch_id);
  if not found then raise exception 'MONEY_ACCOUNT_CASH_NOT_FOUND' using errcode='42501'; end if;
 end if;
 return r;
end; $$;
revoke all on function public.save_management_finance_with_account(uuid,jsonb),public.settle_management_finance_with_account(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_management_finance_with_account(uuid,jsonb),public.settle_management_finance_with_account(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
