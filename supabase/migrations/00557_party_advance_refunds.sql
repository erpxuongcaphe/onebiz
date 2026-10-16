begin;

create table public.party_advance_refunds (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 request_id uuid not null, branch_id uuid not null references public.branches(id),
 mode text not null check(mode in ('customer','supplier')), party_id uuid not null,
 advance_id uuid not null, source_cash_id uuid not null references public.cash_transactions(id),
 cash_id uuid not null unique references public.cash_transactions(id),
 amount numeric(15,2) not null check(amount>0), request_payload jsonb not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 status text not null default 'completed' check(status in ('completed','cancelled')),
 cancelled_by uuid references public.profiles(id), cancelled_at timestamptz, cancellation_reason text,
 unique(tenant_id,request_id)
);
create index party_advance_refunds_source on public.party_advance_refunds(tenant_id,mode,advance_id);
create index party_advance_refunds_active_cash on public.party_advance_refunds(tenant_id,source_cash_id) where status='completed';
alter table public.party_advance_refunds enable row level security;
revoke all on public.party_advance_refunds from public,anon,authenticated;
create policy party_advance_refund_read on public.party_advance_refunds for select to authenticated using(
 tenant_id=public.get_user_tenant_id() and public.user_has_branch_access(auth.uid(),branch_id)
 and public.user_has_permission(auth.uid(),'finance.view_cash_book')
 and public.user_has_permission(auth.uid(),case mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end)
);
grant select on public.party_advance_refunds to authenticated;

create function public.refund_party_advance(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; m text; b uuid; party uuid; aid uuid; amount numeric; a record;
 c public.cash_transactions%rowtype; prior public.party_advance_refunds%rowtype;
 result jsonb; cid uuid; rid uuid; note text; remaining numeric; account uuid;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 m:=p_payload->>'mode';b:=(p_payload->>'branchId')::uuid;party:=(p_payload->>'partyId')::uuid;
 aid:=(p_payload->>'advanceId')::uuid;amount:=(p_payload->>'amount')::numeric;
 account:=(p_payload->>'moneyAccountId')::uuid;
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.create_transaction'),false)
  or not coalesce(public.user_has_permission(auth.uid(),'finance.view_cash_book'),false)
  or not coalesce(public.user_has_permission(auth.uid(),case m when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end),false)
  or not coalesce(public.user_has_branch_access(auth.uid(),b),false)
  or not exists(select 1 from public.branches where id=b and tenant_id=t) then
  raise exception 'ADVANCE_REFUND_DENIED' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or m is null or m not in ('customer','supplier')
  or party is null or aid is null or account is null or amount is null or amount::text in ('NaN','Infinity','-Infinity')
  or amount<=0 or amount>9999999999999.99 or amount<>round(amount,2)
  or length(btrim(coalesce(p_payload->>'note','')))<3
  or nullif(p_payload->>'transactionDate','') is null or nullif(p_payload->>'occurredAt','') is null then
  raise exception 'ADVANCE_REFUND_INPUT_INVALID' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||p_request_id::text,555));
 select * into prior from public.party_advance_refunds where tenant_id=t and request_id=p_request_id;
 if found then
  if prior.request_payload is distinct from p_payload or prior.created_by<>auth.uid() then
   raise exception 'ADVANCE_REFUND_REQUEST_REUSED' using errcode='PT409'; end if;
  select * into c from public.cash_transactions where id=prior.cash_id and tenant_id=t;
  return jsonb_build_object('cash_id',c.id,'cash_code',c.code,'amount',prior.amount,'status',prior.status,'idempotent',true);
 end if;
 -- Same order as payment amendments: lock source voucher, then its advance.
 if m='supplier' then
  select cash_transaction_id into cid from public.supplier_advances where id=aid and tenant_id=t and supplier_id=party and branch_id=b;
 else
  select cash_transaction_id into cid from public.customer_advances where id=aid and tenant_id=t and customer_id=party and branch_id=b;
 end if;
 select * into c from public.cash_transactions where id=cid and tenant_id=t and branch_id=b for update;
 if not found or c.status<>'completed' then raise exception 'ADVANCE_REFUND_SOURCE_CHANGED' using errcode='PT409'; end if;
 if m='supplier' then select * into a from public.supplier_advances where id=aid and tenant_id=t for update;
 else select * into a from public.customer_advances where id=aid and tenant_id=t for update;end if;
 if a.status<>'active' or amount>a.remaining_amount then raise exception 'ADVANCE_REFUND_EXCEEDS_AVAILABLE' using errcode='PT409';end if;
 if c.occurred_at is not null and date_trunc('minute',(p_payload->>'occurredAt')::timestamptz)<date_trunc('minute',c.occurred_at) then
  raise exception 'ADVANCE_REFUND_BEFORE_SOURCE' using errcode='22023';end if;
 note:=btrim(p_payload->>'note')||' · '||c.code;
 result:=public.record_cash_with_account('manual',jsonb_build_object('branchId',b,
  'type',case m when 'supplier' then 'receipt' else 'payment' end,
  'category',case m when 'supplier' then 'supplier_advance_refund' else 'customer_advance_refund' end,
  'amount',amount,'counterparty',c.counterparty,'paymentMethod',p_payload->>'paymentMethod','note',note),
  account,auth.uid(),(p_payload->>'occurredAt')::timestamptz,(p_payload->>'transactionDate')::date,p_payload->>'timeReason');
 cid:=(result->>'id')::uuid;
 update public.cash_transactions set reference_type='advance_refund',reference_id=aid,
  customer_id=case when m='customer' then party end,supplier_id=case when m='supplier' then party end
 where id=cid and tenant_id=t;
 remaining:=a.remaining_amount-amount;
 if m='supplier' then
  update public.supplier_advances set remaining_amount=remaining,status=case when remaining=0 then 'exhausted' else 'active' end,updated_at=now() where id=aid and tenant_id=t;
 else
  update public.customer_advances set remaining_amount=remaining,status=case when remaining=0 then 'exhausted' else 'active' end,updated_at=now() where id=aid and tenant_id=t;
  insert into public.customer_debt_adjustments(tenant_id,branch_id,customer_id,amount,reason,idempotency_key,cash_transaction_id,created_by)
   values(t,b,party,amount,note,'customer-advance-refund:'||cid,cid,auth.uid());
  perform public.recompute_customer_debt(party);
 end if;
 insert into public.party_advance_refunds(tenant_id,request_id,branch_id,mode,party_id,advance_id,source_cash_id,cash_id,amount,request_payload,created_by)
 values(t,p_request_id,b,m,party,aid,c.id,cid,amount,p_payload,auth.uid()) returning id into rid;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(t,auth.uid(),'advance_refunded','cash_transaction',cid,jsonb_build_object('remaining',a.remaining_amount),
  jsonb_build_object('source_cash_id',c.id,'advance_id',aid,'amount',amount,'remaining',remaining,'refund_id',rid));
 return jsonb_build_object('cash_id',cid,'cash_code',result->>'code','amount',amount,'remaining',remaining,'status','completed','idempotent',false);
end;$$;

create function public.cancel_party_advance_refund(p_cash_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;r public.party_advance_refunds%rowtype;c public.cash_transactions%rowtype;a record;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 select * into r from public.party_advance_refunds where cash_id=p_cash_id and tenant_id=t;
 if not found or not coalesce(public.user_has_permission(auth.uid(),'finance.void_transaction'),false)
  or not coalesce(public.user_has_permission(auth.uid(),'finance.view_cash_book'),false)
  or not coalesce(public.user_has_permission(auth.uid(),case r.mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end),false)
  or not coalesce(public.user_has_branch_access(auth.uid(),r.branch_id),false) then
  raise exception 'ADVANCE_REFUND_CANCEL_DENIED' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'ADVANCE_REFUND_REASON_REQUIRED' using errcode='22023';end if;
 perform 1 from public.cash_transactions where id=r.source_cash_id and tenant_id=t for update;
 select * into c from public.cash_transactions where id=p_cash_id and tenant_id=t for update;
 select * into r from public.party_advance_refunds where cash_id=p_cash_id and tenant_id=t for update;
 if r.status='cancelled' then return jsonb_build_object('cash_id',p_cash_id,'idempotent',true);end if;
 if c.status<>'completed' then raise exception 'ADVANCE_REFUND_SOURCE_CHANGED' using errcode='PT409';end if;
 if r.mode='supplier' then select * into a from public.supplier_advances where id=r.advance_id and tenant_id=t for update;
 else select * into a from public.customer_advances where id=r.advance_id and tenant_id=t for update;end if;
 if a.status='cancelled' or a.remaining_amount+r.amount>a.original_amount then
  raise exception 'ADVANCE_REFUND_SOURCE_CHANGED' using errcode='PT409';end if;
 update public.party_advance_refunds set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=btrim(p_reason) where id=r.id;
 if r.mode='supplier' then
  update public.supplier_advances set remaining_amount=remaining_amount+r.amount,status='active',updated_at=now() where id=a.id and tenant_id=t;
 else
  update public.customer_advances set remaining_amount=remaining_amount+r.amount,status='active',updated_at=now() where id=a.id and tenant_id=t;
  insert into public.customer_debt_adjustments(tenant_id,branch_id,customer_id,amount,reason,idempotency_key,cash_transaction_id,created_by)
   values(t,r.branch_id,r.party_id,-r.amount,btrim(p_reason),'cancel-customer-advance-refund:'||r.id,null,auth.uid());
  perform public.recompute_customer_debt(r.party_id);
 end if;
 update public.cash_transactions set status='cancelled',updated_at=clock_timestamp(),note=concat_ws(E'\n',note,'[HỦY HOÀN ỨNG] '||btrim(p_reason)) where id=p_cash_id and tenant_id=t;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(t,auth.uid(),'advance_refund_cancelled','cash_transaction',p_cash_id,to_jsonb(c),jsonb_build_object('reason',btrim(p_reason),'restored_amount',r.amount));
 return jsonb_build_object('cash_id',p_cash_id,'idempotent',false);
end;$$;

create function public.guard_advance_refund_cash() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='completed' and new.status='cancelled' and exists(select 1 from public.party_advance_refunds where source_cash_id=old.id and tenant_id=old.tenant_id and status='completed') then
  raise exception 'ADVANCE_REFUND_SOURCE_IN_USE' using errcode='22023';end if;
 if exists(select 1 from public.party_advance_refunds where cash_id=old.id and tenant_id=old.tenant_id) then
  if new.tenant_id is distinct from old.tenant_id or new.code is distinct from old.code or new.amount is distinct from old.amount or new.type is distinct from old.type or new.category is distinct from old.category
   or new.reference_id is distinct from old.reference_id or new.reference_type is distinct from old.reference_type
   or new.branch_id is distinct from old.branch_id or new.customer_id is distinct from old.customer_id or new.supplier_id is distinct from old.supplier_id
   or (new.status is distinct from old.status and (new.status<>'cancelled' or exists(select 1 from public.party_advance_refunds where cash_id=old.id and status<>'cancelled'))) then
   raise exception 'ADVANCE_REFUND_USE_CANCEL_WORKFLOW' using errcode='22023';end if;
 end if;
 return new;
end;$$;
create trigger aaa_advance_refund_cash_guard before update on public.cash_transactions for each row execute function public.guard_advance_refund_cash();
revoke all on function public.guard_advance_refund_cash() from public,anon,authenticated;

-- Preserve the existing report implementations and reject unexpected definition drift.
do $$ declare name text; source text; old text;begin
 foreach name in array array['public.get_counterparty_balance_summary(uuid)','public.get_counterparty_open_debt_aging(uuid)'] loop
  source:=pg_get_functiondef(name::regprocedure);
  old:=case when name like '%balance_summary%' then 'coalesce(ct.category,'''') <> ''customer_advance''' else 'coalesce(ct.category, '''') <> ''customer_advance''' end;
  if (length(source)-length(replace(source,old,'')))/length(old)<>1 then raise exception 'ADVANCE_REFUND_SUMMARY_DRIFT: %',name;end if;
  source:=replace(source,old,case when name like '%balance_summary%' then 'coalesce(ct.category,'''') not in (''customer_advance'',''customer_advance_refund'')' else 'coalesce(ct.category, '''') not in (''customer_advance'',''customer_advance_refund'')' end);
  if name like '%balance_summary%' then
   old:='a.idempotency_key not like ''customer-advance-allocation:%''';
   if strpos(source,old)=0 then raise exception 'ADVANCE_REFUND_ADJUSTMENT_DRIFT';end if;
   source:=replace(source,old,old||' and a.idempotency_key not like ''cancel-customer-advance-refund:%''');
  end if;
  execute source;
 end loop;
end;$$;

alter function public.get_party_advance_ledger(text,uuid,uuid) rename to get_party_advance_ledger_00553;
revoke all on function public.get_party_advance_ledger_00553(text,uuid,uuid) from public,anon,authenticated;
create function public.get_party_advance_ledger(p_mode text,p_party_id uuid,p_branch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;result jsonb;
begin
 rows:=public.get_party_advance_ledger_00553(p_mode,p_party_id,p_branch_id);
 select coalesce(jsonb_agg(row||jsonb_build_object(
  'appliedAmount',coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(row->'allocations') x),0),
  'refundedAmount',coalesce((select sum(r.amount) from public.party_advance_refunds r where r.advance_id=(row->>'id')::uuid and r.mode=p_mode and r.tenant_id=public.get_user_tenant_id() and r.branch_id=(row->>'branchId')::uuid and r.status='completed'),0),
  'refunds',coalesce((select jsonb_agg(jsonb_build_object('cashId',r.cash_id,'cashCode',c.code,'amount',r.amount,'date',c.transaction_date,'note',c.note,'status',r.status,'cancellationReason',r.cancellation_reason) order by r.created_at,r.id)
    from public.party_advance_refunds r join public.cash_transactions c on c.id=r.cash_id and c.tenant_id=r.tenant_id
    where r.advance_id=(row->>'id')::uuid and r.mode=p_mode and r.branch_id=(row->>'branchId')::uuid
     and r.tenant_id=public.get_user_tenant_id()),'[]'::jsonb)) order by n),'[]'::jsonb) into result
 from jsonb_array_elements(rows) with ordinality x(row,n);
 return result;
end;$$;

alter function public.get_party_cash_history_detail(text,uuid,uuid,integer,integer,jsonb) rename to get_party_cash_history_detail_00553;
revoke all on function public.get_party_cash_history_detail_00553(text,uuid,uuid,integer,integer,jsonb) from public,anon,authenticated;
create function public.get_party_cash_history_detail(p_mode text,p_party_id uuid,p_branch_id uuid default null,p_page integer default 0,p_size integer default 25,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;items jsonb;begin
 result:=public.get_party_cash_history_detail_00553(p_mode,p_party_id,p_branch_id,p_page,p_size,p_filters);
 select coalesce(jsonb_agg(row||jsonb_build_object(
  'advance_refunded',case when row->>'advance_original' is not null then coalesce((select sum(r.amount) from public.party_advance_refunds r where r.source_cash_id=(row->>'id')::uuid and r.tenant_id=public.get_user_tenant_id() and r.status='completed'),0) end,
  'advance_applied',case when row->>'advance_original' is not null then greatest(0,(row->>'advance_applied')::numeric-coalesce((select sum(r.amount) from public.party_advance_refunds r where r.source_cash_id=(row->>'id')::uuid and r.tenant_id=public.get_user_tenant_id() and r.status='completed'),0)) end,
  'refund_source_code',(select c.code from public.party_advance_refunds r join public.cash_transactions c on c.id=r.source_cash_id and c.tenant_id=r.tenant_id where r.cash_id=(row->>'id')::uuid and r.tenant_id=public.get_user_tenant_id())
 ) order by n),'[]'::jsonb) into items from jsonb_array_elements(result->'items') with ordinality x(row,n);
 return result||jsonb_build_object('items',items);
end;$$;
revoke all on function public.refund_party_advance(uuid,jsonb),public.cancel_party_advance_refund(uuid,text),
 public.get_party_advance_ledger(text,uuid,uuid),public.get_party_cash_history_detail(text,uuid,uuid,integer,integer,jsonb) from public,anon;
grant execute on function public.refund_party_advance(uuid,jsonb),public.cancel_party_advance_refund(uuid,text),
 public.get_party_advance_ledger(text,uuid,uuid),public.get_party_cash_history_detail(text,uuid,uuid,integer,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
