CREATE OR REPLACE FUNCTION public.cancel_party_advance_refund(p_cash_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t uuid;r public.party_advance_refunds%rowtype;c public.cash_transactions%rowtype;a record;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 select * into r from public.party_advance_refunds where cash_id=p_cash_id and tenant_id=t;
 if not found or not coalesce(public._staff_permission_at_scope(auth.uid(),'finance.void_transaction',(select __staff_c.branch_id from public.cash_transactions __staff_c where __staff_c.id=p_cash_id and __staff_c.tenant_id=public.get_user_tenant_id())),false)
  or not coalesce(public._staff_my_cash_book_view(r.branch_id),false)
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
end;$function$;

CREATE OR REPLACE FUNCTION public.get_party_advance_ledger_00553(p_mode text, p_party_id uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 where (p_branch_id is null or a.branch_id=p_branch_id) and public.user_has_branch_access(auth.uid(),a.branch_id) and public._staff_my_cash_book_view(a.branch_id);
 return r;
end; $function$;

CREATE OR REPLACE FUNCTION public.get_party_cash_history_detail_00553(p_mode text, p_party_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_page integer DEFAULT 0, p_size integer DEFAULT 25, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end; $function$;

CREATE OR REPLACE FUNCTION public.refund_party_advance(p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t uuid; m text; b uuid; party uuid; aid uuid; amount numeric; a record;
 c public.cash_transactions%rowtype; prior public.party_advance_refunds%rowtype;
 result jsonb; cid uuid; rid uuid; note text; remaining numeric; account uuid;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 m:=p_payload->>'mode';b:=(p_payload->>'branchId')::uuid;party:=(p_payload->>'partyId')::uuid;
 aid:=(p_payload->>'advanceId')::uuid;amount:=(p_payload->>'amount')::numeric;
 account:=(p_payload->>'moneyAccountId')::uuid;
 if t is null or not coalesce(public._staff_permission_at_scope(auth.uid(),'finance.create_transaction',b),false)
  or not coalesce(public._staff_my_cash_book_view(b),false)
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
end;$function$;

CREATE OR REPLACE FUNCTION public.settle_party_documents_atomic(p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t uuid; b uuid; party uuid; mode text; source text; prior public.party_settlement_requests%rowtype;
 line jsonb; d record; amount numeric; operation text; result jsonb; results jsonb:='[]'; v_document_id uuid; v_code text; v_note text;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 mode:=p_payload->>'mode';source:=p_payload->>'source';b:=(p_payload->>'branchId')::uuid;party:=(p_payload->>'partyId')::uuid;
 if t is null or not coalesce(public._staff_permission_at_scope(auth.uid(),'finance.create_transaction',b),false)
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
   select i.id,i.code,i.debt into d from public.invoices i where i.id=v_document_id and i.tenant_id=t and i.branch_id=b and i.customer_id=any(onebiz_identity.family_ids(t,party)) and i.status='completed' for update;
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
end; $function$;
