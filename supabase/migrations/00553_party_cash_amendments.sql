-- Financial edits retain the original voucher. Reposting uses existing debt RPCs,
-- in the same transaction; a failure restores both the old cash and debt.
begin;
create table public.cash_amendments (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 request_id uuid not null, original_cash_id uuid not null references public.cash_transactions(id),
 replacement_cash_id uuid references public.cash_transactions(id), reason text not null,
 before_data jsonb not null,after_data jsonb not null,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),unique(tenant_id,request_id)
);
alter table public.cash_amendments enable row level security;
create policy cash_amendment_read on public.cash_amendments for select to authenticated using(
 exists(select 1 from public.cash_transactions c join public.profiles p on p.id=auth.uid() and coalesce(p.is_active,true)
 where c.id=original_cash_id and c.tenant_id=cash_amendments.tenant_id and p.tenant_id=c.tenant_id
 and public.user_has_branch_access(auth.uid(),c.branch_id) and public.user_has_permission(auth.uid(),'finance.view_cash_book')));
revoke all on public.cash_amendments from anon,authenticated;
grant select on public.cash_amendments to authenticated;

-- Cancellation first zeroes an unused supplier overpayment. Zero on an already
-- cancelled source is not proof of allocation; retain the real allocation guard.
create or replace function public.trg_block_allocated_advance_cash_cancel()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='completed' and new.status='cancelled' then
  perform 1 from public.supplier_advances where cash_transaction_id=old.id and tenant_id=old.tenant_id order by id for update;
  perform 1 from public.customer_advances where cash_transaction_id=old.id and tenant_id=old.tenant_id order by id for update;
  if exists(select 1 from public.supplier_advances a where a.cash_transaction_id=old.id and a.tenant_id=old.tenant_id
    and ((a.status<>'cancelled' and a.remaining_amount<a.original_amount)
     or exists(select 1 from public.supplier_advance_allocations x where x.supplier_advance_id=a.id and x.tenant_id=a.tenant_id)))
   or exists(select 1 from public.customer_advances a where a.cash_transaction_id=old.id and a.tenant_id=old.tenant_id
    and ((a.status<>'cancelled' and a.remaining_amount<a.original_amount)
     or exists(select 1 from public.customer_advance_allocations x where x.customer_advance_id=a.id and x.tenant_id=a.tenant_id))) then
   raise exception 'ADVANCE_ALREADY_APPLIED_CANNOT_CANCEL' using errcode='22023';
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.trg_block_allocated_advance_cash_cancel() from public,anon,authenticated;

create function public.amend_party_cash(p_cash_id uuid,p_expected_updated_at timestamptz,p_request_id uuid,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; c public.cash_transactions%rowtype; prior public.cash_amendments%rowtype;
 amount numeric; method text; day date; at_time timestamptz; account_id uuid;
 operation text; payload jsonb; result jsonb; replacement uuid; before_data jsonb; after_data jsonb;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.create_transaction'),false)
  or not coalesce(public.user_has_permission(auth.uid(),'finance.void_transaction'),false) then raise exception 'CASH_AMEND_DENIED' using errcode='42501'; end if;
 if p_cash_id is null or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object'
  or length(btrim(coalesce(p_reason,'')))<3 or length(btrim(coalesce(p_payload->>'note','')))<3 then
  raise exception 'CASH_AMEND_REASON_AND_CONTENT_REQUIRED' using errcode='22023'; end if;
 -- The same request cannot be used for a different voucher or changed payload.
 perform pg_advisory_xact_lock(hashtextextended(t::text||p_request_id::text,553));
 select * into prior from public.cash_amendments where tenant_id=t and request_id=p_request_id;
 if found then
  if prior.original_cash_id<>p_cash_id or prior.after_data->'request_payload' is distinct from p_payload or prior.reason<>btrim(p_reason) then
   raise exception 'CASH_AMEND_REQUEST_REUSED' using errcode='PT409'; end if;
  if not exists(select 1 from public.cash_transactions x where x.id=p_cash_id and x.tenant_id=t and public.user_has_branch_access(auth.uid(),x.branch_id)) then
   raise exception 'CASH_AMEND_DENIED' using errcode='42501'; end if;
  return jsonb_build_object('cash_id',coalesce(prior.replacement_cash_id,p_cash_id),'replacement',prior.replacement_cash_id is not null,'idempotent',true);
 end if;
 select * into c from public.cash_transactions where id=p_cash_id and tenant_id=t for update;
 if not found or not coalesce(public.user_has_branch_access(auth.uid(),c.branch_id),false) then raise exception 'CASH_AMEND_DENIED' using errcode='42501'; end if;
 if c.status<>'completed' then raise exception 'CASH_AMEND_COMPLETED_REQUIRED' using errcode='22023'; end if;
 if c.updated_at is distinct from p_expected_updated_at then raise exception 'CASH_AMEND_CHANGED_RELOAD' using errcode='PT409'; end if;
 amount:=(p_payload->>'amount')::numeric; method:=p_payload->>'paymentMethod';
 day:=(p_payload->>'transactionDate')::date; at_time:=nullif(p_payload->>'occurredAt','')::timestamptz;
 account_id:=nullif(p_payload->>'moneyAccountId','')::uuid;
 if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>9999999999999.99
  or amount<>round(amount,2) or method is null or method not in ('cash','transfer','card','ewallet') then raise exception 'CASH_AMEND_AMOUNT_OR_METHOD_INVALID' using errcode='22023'; end if;
 if day is null or not isfinite(day) or day>(now() at time zone 'Asia/Ho_Chi_Minh')::date
  or (at_time is not null and (not isfinite(at_time) or at_time>now()+interval '5 minutes')) then raise exception 'CASH_AMEND_DATE_INVALID' using errcode='22023'; end if;
 before_data:=to_jsonb(c);
 if amount=c.amount then
  -- Metadata correction never changes a document's financial settlement.
  update public.cash_transactions set payment_method=method,transaction_date=day,occurred_at=at_time,
   time_source=case when at_time is null then 'date_only' else 'entered' end,time_reason=btrim(p_reason),
   money_account_id=account_id,note=btrim(p_payload->>'note'),updated_at=clock_timestamp() where id=c.id returning to_jsonb(cash_transactions.*) into after_data;
 else
  if exists(select 1 from public.supplier_advances a where a.cash_transaction_id=c.id and a.tenant_id=t and a.remaining_amount<a.original_amount and a.status<>'cancelled')
   or exists(select 1 from public.customer_advances a where a.cash_transaction_id=c.id and a.tenant_id=t and a.remaining_amount<a.original_amount and a.status<>'cancelled') then
   raise exception 'CASH_AMEND_ADVANCE_ALREADY_ALLOCATED' using errcode='22023'; end if;
  if c.reference_type='purchase_order' and c.type='payment' then
   if not exists(select 1 from public.purchase_orders d where d.id=c.reference_id and d.tenant_id=t and d.branch_id=c.branch_id and d.status in ('partial','completed')) then raise exception 'CASH_AMEND_DOCUMENT_INVALID' using errcode='22023'; end if;
   operation:='purchase_order';
  elsif c.reference_type='invoice' and c.category='customer_payment' then
   if not exists(select 1 from public.invoices d where d.id=c.reference_id and d.tenant_id=t and d.branch_id=c.branch_id and d.status='completed') then raise exception 'CASH_AMEND_DOCUMENT_INVALID' using errcode='22023'; end if;
   operation:='invoice';
  elsif c.reference_id is null and c.reference_type is null and c.category='supplier_advance' and c.supplier_id is not null then operation:='supplier_advance';
  elsif c.reference_id is null and c.reference_type is null and c.category='customer_advance' and c.customer_id is not null then operation:='customer_advance';
  else raise exception 'CASH_AMEND_USE_SOURCE_WORKFLOW' using errcode='22023'; end if;
  if operation='purchase_order' then perform 1 from public.purchase_orders po where po.id=c.reference_id and po.tenant_id=t for update;
  elsif operation='invoice' then perform 1 from public.invoices i where i.id=c.reference_id and i.tenant_id=t for update; end if;
  if operation='purchase_order' and not exists(select 1 from public.purchase_orders po where po.id=c.reference_id and po.tenant_id=t
   and po.status in ('partial','completed')
   and coalesce(po.debt,0)=greatest(0,coalesce(po.total,0)-coalesce(po.paid,0))
   and coalesce(po.paid,0)>=c.amount-coalesce((select a.original_amount from public.supplier_advances a where a.cash_transaction_id=c.id and a.tenant_id=t),0)) then
   raise exception 'CASH_AMEND_DOCUMENT_RECONCILIATION_REQUIRED' using errcode='22023'; end if;
  if operation='invoice' and not exists(select 1 from public.invoices i where i.id=c.reference_id and i.tenant_id=t
   and i.status='completed'
   and coalesce(i.debt,0)=greatest(0,coalesce(i.total,0)-coalesce(i.paid,0)) and coalesce(i.paid,0)>=c.amount) then
   raise exception 'CASH_AMEND_DOCUMENT_RECONCILIATION_REQUIRED' using errcode='22023'; end if;
  perform public.cancel_cash_transaction(c.id,'Điều chỉnh phiếu: '||btrim(p_reason));
  payload:=jsonb_build_object('referenceId',c.reference_id,'partyId',case when operation='supplier_advance' then c.supplier_id else c.customer_id end,
   'branchId',c.branch_id,'amount',amount,'paymentMethod',method,'note',btrim(p_payload->>'note'));
  if account_id is not null then result:=public.record_cash_with_account(operation,payload,account_id,c.performed_by,at_time,day,btrim(p_reason));
  elsif c.performed_by is not null then result:=public.record_cash_transaction_context(operation,payload,c.performed_by,at_time,day,btrim(p_reason));
  else result:=public.record_cash_transaction_timed(operation,payload,at_time,day,btrim(p_reason)); end if;
  replacement:=coalesce(result->>'cash_transaction_id',result->>'id')::uuid;
  -- Retain the original exact party even for a legacy voucher whose source inferred it.
  update public.cash_transactions set customer_id=coalesce(c.customer_id,customer_id),supplier_id=coalesce(c.supplier_id,supplier_id) where id=replacement and tenant_id=t;
  select to_jsonb(x) into after_data from public.cash_transactions x where x.id=replacement and x.tenant_id=t;
 end if;
 after_data:=after_data||jsonb_build_object('request_payload',p_payload);
 insert into public.cash_amendments(tenant_id,request_id,original_cash_id,replacement_cash_id,reason,before_data,after_data,created_by)
 values(t,p_request_id,c.id,replacement,btrim(p_reason),before_data,after_data,auth.uid());
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(t,auth.uid(),'cash_transaction_amended','cash_transaction',c.id,before_data,after_data||jsonb_build_object('reason',btrim(p_reason),'replacement_cash_id',replacement));
 return jsonb_build_object('cash_id',coalesce(replacement,c.id),'replacement',replacement is not null,'idempotent',false);
end; $$;

-- One page still uses the existing authorized/history-complete reader; enrich it
-- with exact source code, account and advance allocation amounts without name joins.
create function public.get_party_cash_history_detail(p_mode text,p_party_id uuid,p_branch_id uuid default null,p_page integer default 0,p_size integer default 25,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; items jsonb; can_debt boolean;
begin
 r:=public.get_party_cash_history_sources(p_mode,p_party_id,p_branch_id,p_page,p_size,p_filters);
 can_debt:=coalesce(public.user_has_permission(auth.uid(),case when p_mode='supplier' then 'suppliers.view_debt' else 'customers.view_debt' end),false);
 select coalesce(jsonb_agg(j.value||jsonb_build_object(
  'reference_code',coalesce(i.code,po.code), 'money_account_name',a.name,'money_account_code',a.code,
  'advance_original',case when can_debt then coalesce(sa.original_amount,ca.original_amount,0) end,
  'advance_remaining',case when can_debt then case when coalesce(sa.status,ca.status)='active' then coalesce(sa.remaining_amount,ca.remaining_amount,0) else 0 end end,
  'advance_applied',case when can_debt then case when coalesce(sa.status,ca.status)='cancelled' then 0 else coalesce(sa.original_amount-sa.remaining_amount,ca.original_amount-ca.remaining_amount,0) end end,
  'replacement_code',replacement.code,'original_code',original.code
 ) order by j.ordinality),'[]'::jsonb) into items
 from jsonb_array_elements(r->'items') with ordinality j(value,ordinality)
 join public.cash_transactions c on c.id=(j.value->>'id')::uuid
 left join public.money_accounts a on a.id=c.money_account_id and a.tenant_id=c.tenant_id
 left join public.invoices i on i.id=c.reference_id and c.reference_type in ('invoice','invoice_void') and i.tenant_id=c.tenant_id
 left join public.purchase_orders po on po.id=c.reference_id and c.reference_type='purchase_order' and po.tenant_id=c.tenant_id
 left join public.supplier_advances sa on sa.cash_transaction_id=c.id and sa.tenant_id=c.tenant_id
 left join public.customer_advances ca on ca.cash_transaction_id=c.id and ca.tenant_id=c.tenant_id
 left join lateral(select x.code from public.cash_amendments m join public.cash_transactions x on x.id=m.replacement_cash_id and x.tenant_id=c.tenant_id where m.original_cash_id=c.id and m.tenant_id=c.tenant_id order by m.created_at desc limit 1) replacement on true
 left join lateral(select x.code from public.cash_amendments m join public.cash_transactions x on x.id=m.original_cash_id and x.tenant_id=c.tenant_id where m.replacement_cash_id=c.id and m.tenant_id=c.tenant_id order by m.created_at desc limit 1) original on true;
 return jsonb_set(r,'{items}',items);
end; $$;

create function public.get_party_advance_ledger(p_mode text,p_party_id uuid,p_branch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 -- Reuse party existence, permission, tenant and branch validation, even for zero cash rows.
 perform public.get_party_cash_history_sources(p_mode,p_party_id,p_branch_id,0,1,'{}');
 if not coalesce(public.user_has_permission(auth.uid(),case when p_mode='supplier' then 'suppliers.view_debt' else 'customers.view_debt' end),false) then
  raise exception 'PARTY_ADVANCE_READ_DENIED' using errcode='42501'; end if;
 with advances as (
  select a.id,a.tenant_id,a.branch_id,a.cash_transaction_id,a.original_amount,a.remaining_amount,a.status,a.created_at
   from public.supplier_advances a where p_mode='supplier' and a.supplier_id=p_party_id
  union all select a.id,a.tenant_id,a.branch_id,a.cash_transaction_id,a.original_amount,a.remaining_amount,a.status,a.created_at
   from public.customer_advances a where p_mode='customer' and a.customer_id=p_party_id
 ), allocations as (
  select x.supplier_advance_id as advance_id,x.tenant_id,x.branch_id,x.purchase_order_id as document_id,x.amount,x.note,x.created_at from public.supplier_advance_allocations x where p_mode='supplier'
  union all select x.customer_advance_id,x.tenant_id,x.branch_id,x.invoice_id,x.amount,x.note,x.created_at from public.customer_advance_allocations x where p_mode='customer'
 ) select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'branchId',a.branch_id,'branchName',b.name,'cashCode',c.code,
  'originalAmount',a.original_amount,'remainingAmount',case when a.status='active' then a.remaining_amount else 0 end,'status',a.status,'date',c.transaction_date,'note',c.note,
  'allocations',coalesce((select jsonb_agg(jsonb_build_object('documentCode',coalesce(po.code,i.code),'amount',x.amount,'note',x.note,'createdAt',x.created_at) order by x.created_at,x.document_id)
    from allocations x left join public.purchase_orders po on po.id=x.document_id and po.tenant_id=a.tenant_id and p_mode='supplier'
    left join public.invoices i on i.id=x.document_id and i.tenant_id=a.tenant_id and p_mode='customer'
    where x.advance_id=a.id and x.tenant_id=a.tenant_id and x.branch_id=a.branch_id),'[]'::jsonb)
 ) order by a.created_at,a.id),'[]'::jsonb) into r from advances a join public.cash_transactions c on c.id=a.cash_transaction_id and c.tenant_id=a.tenant_id
 join public.branches b on b.id=a.branch_id and b.tenant_id=a.tenant_id
 join public.profiles p on p.id=auth.uid() and p.tenant_id=a.tenant_id and coalesce(p.is_active,true)
 where (p_branch_id is null or a.branch_id=p_branch_id) and public.user_has_branch_access(auth.uid(),a.branch_id);
 return r;
end; $$;
create table public.party_settlement_requests (
 tenant_id uuid not null references public.tenants(id),request_id uuid not null,branch_id uuid not null references public.branches(id),
 payload jsonb not null,result jsonb not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 primary key(tenant_id,request_id)
);
alter table public.party_settlement_requests enable row level security;
revoke all on public.party_settlement_requests from public,anon,authenticated;
create function public.settle_party_documents_atomic(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; b uuid; party uuid; mode text; source text; prior public.party_settlement_requests%rowtype;
 line jsonb; d record; amount numeric; operation text; result jsonb; results jsonb:='[]'; v_document_id uuid; v_code text; v_note text;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 mode:=p_payload->>'mode';source:=p_payload->>'source';b:=(p_payload->>'branchId')::uuid;party:=(p_payload->>'partyId')::uuid;
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.create_transaction'),false)
  or not coalesce(public.user_has_permission(auth.uid(),case when mode='customer' then 'customers.view_debt' else 'suppliers.view_debt' end),false)
  or not exists(select 1 from public.branches where id=b and tenant_id=t)
  or not coalesce(public.user_has_branch_access(auth.uid(),b),false) then raise exception 'PARTY_SETTLEMENT_DENIED' using errcode='42501'; end if;
 if p_request_id is null or mode is null or mode not in ('customer','supplier') or source is null or source not in ('cash','advance')
  or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 500
  or length(btrim(coalesce(p_payload->>'note','')))<3 then raise exception 'PARTY_SETTLEMENT_INPUT_INVALID' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||p_request_id::text,554));
 select * into prior from public.party_settlement_requests where tenant_id=t and request_id=p_request_id;
 if found then
  if prior.payload is distinct from p_payload or prior.created_by<>auth.uid() then raise exception 'PARTY_SETTLEMENT_REQUEST_REUSED' using errcode='PT409'; end if;
  return prior.result||jsonb_build_object('idempotent',true);
 end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_payload->'lines') x)<>jsonb_array_length(p_payload->'lines') then raise exception 'PARTY_SETTLEMENT_DUPLICATE_DOCUMENT' using errcode='22023'; end if;
 -- Lock documents in stable UUID order, independent of presentation/FIFO order.
 for line in select x from jsonb_array_elements(p_payload->'lines') x order by x->>'id' loop
  v_document_id:=(line->>'id')::uuid;amount:=(line->>'amount')::numeric;
  if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>9999999999999.99 or amount<>round(amount,2) then raise exception 'PARTY_SETTLEMENT_AMOUNT_INVALID' using errcode='22023'; end if;
  if mode='supplier' then
   select po.id,po.code,po.debt into d from public.purchase_orders po where po.id=v_document_id and po.tenant_id=t and po.branch_id=b and po.supplier_id=party and po.status in ('partial','completed') for update;
  else
   select i.id,i.code,i.debt into d from public.invoices i where i.id=v_document_id and i.tenant_id=t and i.branch_id=b and i.customer_id=party and i.status='completed' for update;
  end if;
  if not found or coalesce(d.debt,0)<=0 then raise exception 'PARTY_SETTLEMENT_DOCUMENT_CHANGED_RELOAD' using errcode='PT409'; end if;
 end loop;
 for line in select x from jsonb_array_elements(p_payload->'lines') x loop
  v_document_id:=(line->>'id')::uuid;amount:=(line->>'amount')::numeric;
  if mode='supplier' then select po.code into v_code from public.purchase_orders po where po.id=v_document_id and po.tenant_id=t;
  else select i.code into v_code from public.invoices i where i.id=v_document_id and i.tenant_id=t; end if;
  v_note:=btrim(p_payload->>'note')||' · '||v_code;
  if source='advance' then
   if mode='supplier' then result:=public.apply_supplier_advance_to_purchase_order(v_document_id,amount,v_note);
   else result:=public.apply_customer_advance_to_invoice(v_document_id,amount,v_note); end if;
  else
   operation:=case when mode='supplier' then 'purchase_order' else 'invoice' end;
   if nullif(p_payload->>'moneyAccountId','') is not null then
    result:=public.record_cash_with_account(operation,jsonb_build_object('referenceId',v_document_id,'amount',amount,'paymentMethod',p_payload->>'paymentMethod','note',v_note),
     (p_payload->>'moneyAccountId')::uuid,null,nullif(p_payload->>'occurredAt','')::timestamptz,(p_payload->>'transactionDate')::date,p_payload->>'timeReason');
   else result:=public.record_cash_transaction_timed(operation,jsonb_build_object('referenceId',v_document_id,'amount',amount,'paymentMethod',p_payload->>'paymentMethod','note',v_note),
    nullif(p_payload->>'occurredAt','')::timestamptz,(p_payload->>'transactionDate')::date,p_payload->>'timeReason'); end if;
  end if;
  results:=results||jsonb_build_array(result||jsonb_build_object('document_id',v_document_id));
 end loop;
 result:=jsonb_build_object('documents',results,'source',source,'idempotent',false);
 insert into public.party_settlement_requests(tenant_id,request_id,branch_id,payload,result,created_by) values(t,p_request_id,b,p_payload,result,auth.uid());
 return result;
end; $$;

revoke all on function public.settle_party_documents_atomic(uuid,jsonb) from public,anon;
grant execute on function public.settle_party_documents_atomic(uuid,jsonb) to authenticated;
revoke all on function public.amend_party_cash(uuid,timestamptz,uuid,jsonb,text),
 public.get_party_cash_history_detail(text,uuid,uuid,integer,integer,jsonb),public.get_party_advance_ledger(text,uuid,uuid) from public,anon;
grant execute on function public.amend_party_cash(uuid,timestamptz,uuid,jsonb,text),
 public.get_party_cash_history_detail(text,uuid,uuid,integer,integer,jsonb),public.get_party_advance_ledger(text,uuid,uuid) to authenticated;
create function public.get_cash_amendment_history(p_cash_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; b uuid; result jsonb;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 select branch_id into b from public.cash_transactions where id=p_cash_id and tenant_id=t;
 if t is null or b is null
  or not coalesce(public.user_has_permission(auth.uid(),'finance.view_cash_book'),false)
  or not coalesce(public.user_has_branch_access(auth.uid(),b),false) then
  raise exception 'CASH_HISTORY_DENIED' using errcode='42501';
 end if;
 -- Include every retained revision, whether opened from the original or its replacement.
 with recursive connected(id) as (
  select p_cash_id
  union
  select case when a.original_cash_id=c.id then a.replacement_cash_id else a.original_cash_id end
  from connected c join public.cash_amendments a
   on (a.original_cash_id=c.id or a.replacement_cash_id=c.id) and a.tenant_id=t
  join public.cash_transactions original on original.id=a.original_cash_id and original.tenant_id=t and original.branch_id=b
  where a.replacement_cash_id is not null
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,'createdAt',a.created_at,'createdByName',p.full_name,'reason',a.reason,
  'originalCode',a.before_data->>'code','replacementCode',case when a.replacement_cash_id is not null then a.after_data->>'code' end,
  'before',jsonb_build_object('amount',a.before_data->'amount','note',a.before_data->'note',
   'date',a.before_data->'transaction_date','occurredAt',a.before_data->'occurred_at','paymentMethod',a.before_data->'payment_method',
   'accountName',old_account.name),
  'after',jsonb_build_object('amount',a.after_data->'amount','note',a.after_data->'note',
   'date',a.after_data->'transaction_date','occurredAt',a.after_data->'occurred_at','paymentMethod',a.after_data->'payment_method',
   'accountName',new_account.name)
 ) order by a.created_at,a.id),'[]'::jsonb) into result
 from public.cash_amendments a
 join public.cash_transactions original on original.id=a.original_cash_id and original.tenant_id=t and original.branch_id=b
 left join public.profiles p on p.id=a.created_by and p.tenant_id=t
 left join public.money_accounts old_account on old_account.id=nullif(a.before_data->>'money_account_id','')::uuid and old_account.tenant_id=t and old_account.branch_id=b
 left join public.money_accounts new_account on new_account.id=nullif(a.after_data->>'money_account_id','')::uuid and new_account.tenant_id=t and new_account.branch_id=b
 where a.tenant_id=t and a.original_cash_id in(select id from connected);
 return result;
end; $$;
revoke all on function public.get_cash_amendment_history(uuid) from public,anon;
grant execute on function public.get_cash_amendment_history(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
