begin;

-- Import identity is durable and independent of amount, date, filename or device.
create table public.management_finance_import_sources (
  tenant_id uuid not null references public.tenants(id),
  source_system text not null check(length(source_system) between 1 and 64),
  source_code text not null check(length(source_code) between 1 and 100),
  branch_id uuid not null references public.branches(id),
  request_payload jsonb not null,
  result jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(tenant_id,source_system,source_code)
);
alter table public.management_finance_import_sources enable row level security;
revoke all on public.management_finance_import_sources from public,anon,authenticated;

create function public.preview_management_finance_import(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.create_transaction'); v_row jsonb; v_existing record; v_result jsonb:='[]'; v_branch uuid; v_reference uuid;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
  raise exception 'FINANCE_IMPORT_BATCH_INVALID' using errcode='22023'; end if;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_branch:=(v_row->>'branchId')::uuid;
  if not public.user_has_branch_access(auth.uid(),v_branch) or not exists(select 1 from public.branches where id=v_branch and tenant_id=v_tenant and coalesce(is_active,true)) then
   raise exception 'FINANCE_IMPORT_BRANCH_DENIED' using errcode='42501'; end if;
  select * into v_existing from public.management_finance_import_sources where tenant_id=v_tenant and source_system=upper(btrim(v_row->>'sourceSystem')) and source_code=btrim(v_row->>'sourceCode');
  if found then
   if not public.user_has_branch_access(auth.uid(),v_existing.branch_id) then raise exception 'FINANCE_IMPORT_SOURCE_DENIED' using errcode='42501'; end if;
   v_result:=v_result||jsonb_build_array(jsonb_build_object('sourceCode',v_row->>'sourceCode','state',case when v_existing.request_payload=v_row then 'imported' else 'conflict' end));
   continue;
  end if;
  if v_row->>'operation'='record' then
   if not exists(select 1 from public.management_finance_categories where id=(v_row#>>'{payload,categoryId}')::uuid and tenant_id=v_tenant and is_active and not is_group)
    then raise exception 'FINANCE_IMPORT_CATEGORY_INVALID' using errcode='22023'; end if;
  elsif v_row->>'operation'='settle' then
   select id into v_reference from public.management_finance_events where tenant_id=v_tenant and code=v_row->>'referenceCode';
   if v_reference is null or exists(select 1 from public.management_finance_allocations where event_id=v_reference and not public.user_has_branch_access(auth.uid(),branch_id)) then
    raise exception 'FINANCE_IMPORT_REFERENCE_INVALID' using errcode='22023'; end if;
  elsif v_row->>'operation'='invoice' then
   if (select count(*) from public.invoices where tenant_id=v_tenant and branch_id=v_branch and code=v_row->>'referenceCode' and status='completed' and deleted_at is null)<>1 then
    raise exception 'FINANCE_IMPORT_REFERENCE_INVALID' using errcode='22023'; end if;
  elsif v_row->>'operation'='purchase_order' then
   if (select count(*) from public.purchase_orders where tenant_id=v_tenant and branch_id=v_branch and code=v_row->>'referenceCode' and status in ('completed','partial'))<>1 then
    raise exception 'FINANCE_IMPORT_REFERENCE_INVALID' using errcode='22023'; end if;
  else raise exception 'FINANCE_IMPORT_OPERATION_INVALID' using errcode='22023'; end if;
  v_result:=v_result||jsonb_build_array(jsonb_build_object('sourceCode',v_row->>'sourceCode','state','new'));
 end loop;
 return v_result;
end; $$;

create function public.commit_management_finance_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.create_transaction'); v_row jsonb; v_existing record;
 v_system text; v_code text; v_branch uuid; v_operation text; v_result jsonb; v_items jsonb:='[]'; v_request uuid;
 v_reference uuid; v_payload jsonb; v_seen text[]:='{}'; v_key text;
begin
 perform public.preview_management_finance_import(p_rows);
 -- Deterministic lock order prevents reversed-file imports deadlocking each other.
 for v_row in select value from jsonb_array_elements(p_rows) order by upper(btrim(value->>'sourceSystem')),btrim(value->>'sourceCode') loop
  v_system:=upper(btrim(v_row->>'sourceSystem')); v_code:=btrim(v_row->>'sourceCode'); v_branch:=(v_row->>'branchId')::uuid;
  if v_system is null or length(v_system) not between 1 and 64 or v_code is null or length(v_code) not between 1 and 100 then raise exception 'FINANCE_IMPORT_SOURCE_REQUIRED' using errcode='22023'; end if;
  v_key:=jsonb_build_array(v_system,v_code)::text;
  if v_key=any(v_seen) then raise exception 'FINANCE_IMPORT_DUPLICATE_ROW' using errcode='22023'; end if;
  v_seen:=array_append(v_seen,v_key);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||v_key,521));
 end loop;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_system:=upper(btrim(v_row->>'sourceSystem')); v_code:=btrim(v_row->>'sourceCode'); v_branch:=(v_row->>'branchId')::uuid;
  select * into v_existing from public.management_finance_import_sources where tenant_id=v_tenant and source_system=v_system and source_code=v_code;
  if found then
   if not public.user_has_branch_access(auth.uid(),v_existing.branch_id) then raise exception 'FINANCE_IMPORT_SOURCE_DENIED' using errcode='42501'; end if;
   if v_existing.request_payload is distinct from v_row then raise exception 'FINANCE_IMPORT_SOURCE_CONFLICT' using errcode='PT409'; end if;
   v_items:=v_items||jsonb_build_array(jsonb_build_object('sourceCode',v_code,'state','imported','result',v_existing.result));
   continue;
  end if;
  v_request:=gen_random_uuid(); v_operation:=v_row->>'operation'; v_payload:=v_row->'payload';
  if v_operation<>'record' and (v_payload->>'branchId')::uuid is distinct from v_branch then raise exception 'FINANCE_IMPORT_SCOPE_INVALID' using errcode='22023'; end if;
  v_payload:=v_payload||jsonb_build_object('note',coalesce(v_payload->>'note','')||E'\nNguon: '||v_system||' / '||v_code);
  if jsonb_typeof(v_payload->'payment')='object' then v_payload:=jsonb_set(v_payload,'{payment,note}',to_jsonb(coalesce(v_payload#>>'{payment,note}','')||E'\nNguon: '||v_system||' / '||v_code)); end if;
  if v_payload->>'paymentMethod'='bank_transfer' then v_payload:=jsonb_set(v_payload,'{paymentMethod}','"transfer"'); end if;
  if v_payload#>>'{payment,paymentMethod}'='bank_transfer' then v_payload:=jsonb_set(v_payload,'{payment,paymentMethod}','"transfer"'); end if;
  if v_operation='record' then
   if jsonb_typeof(v_payload->'allocations') is distinct from 'array' or jsonb_array_length(v_payload->'allocations')<>1
    or (v_payload#>>'{allocations,0,branchId}')::uuid is distinct from v_branch
    or (v_payload ? 'payment' and (v_payload#>>'{payment,branchId}')::uuid is distinct from v_branch) then raise exception 'FINANCE_IMPORT_SCOPE_INVALID' using errcode='22023'; end if;
   v_result:=public.save_management_finance_document(v_request,v_payload);
  elsif v_operation='settle' then
   select id into v_reference from public.management_finance_events where tenant_id=v_tenant and code=v_row->>'referenceCode';
   if v_reference is null or (v_payload->>'branchId')::uuid is distinct from v_branch then raise exception 'FINANCE_IMPORT_REFERENCE_INVALID' using errcode='22023'; end if;
   v_result:=public.settle_management_finance_event(v_reference,v_request,v_payload);
  elsif v_operation in ('invoice','purchase_order') then
   if v_operation='invoice' then
    select id into v_reference from public.invoices where tenant_id=v_tenant and branch_id=v_branch and code=v_row->>'referenceCode' and status='completed' and deleted_at is null;
   else
    select id into v_reference from public.purchase_orders where tenant_id=v_tenant and branch_id=v_branch and code=v_row->>'referenceCode' and status in ('completed','partial');
   end if;
   if v_reference is null then raise exception 'FINANCE_IMPORT_REFERENCE_INVALID' using errcode='22023'; end if;
   v_result:=public.record_cash_transaction_context(v_operation,v_payload||jsonb_build_object('referenceId',v_reference),
    (v_payload->>'performedBy')::uuid,(v_payload->>'occurredAt')::timestamptz,(v_payload->>'transactionDate')::date,v_payload->>'timeReason');
  else raise exception 'FINANCE_IMPORT_OPERATION_INVALID' using errcode='22023'; end if;
  insert into public.management_finance_import_sources(tenant_id,source_system,source_code,branch_id,request_payload,result,created_by)
  values(v_tenant,v_system,v_code,v_branch,v_row,v_result,auth.uid());
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
  values(v_tenant,auth.uid(),'imported','management_finance_import',v_request,jsonb_build_object('sourceSystem',v_system,'sourceCode',v_code,'branchId',v_branch,'operation',v_operation));
  v_items:=v_items||jsonb_build_array(jsonb_build_object('sourceCode',v_code,'state','new','result',v_result));
 end loop;
 return v_items;
end; $$;
revoke all on function public.preview_management_finance_import(jsonb),public.commit_management_finance_import(jsonb) from public,anon;
grant execute on function public.preview_management_finance_import(jsonb),public.commit_management_finance_import(jsonb) to authenticated;
commit;
