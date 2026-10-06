begin;

-- New management documents only. Never reinterpret or update historic cash rows.
create table public.management_finance_categories (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  code text not null check(code ~ '^[A-Z][A-Z0-9_-]{1,31}$'), name text not null check(length(btrim(name))>0),
  kind text not null check(kind in ('income','expense','non_pnl')),
  parent_id uuid references public.management_finance_categories(id), is_group boolean not null default false,
  is_active boolean not null default true, unique(tenant_id,code)
);
create table public.management_finance_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  code text not null, request_id uuid not null, request_payload jsonb not null,
  category_id uuid not null references public.management_finance_categories(id),
  category_code text not null, category_name text not null, kind text not null check(kind in ('income','expense','non_pnl')),
  business_date date not null, amount numeric(18,2) not null check(amount>0),
  counterparty text not null check(length(btrim(counterparty))>0), note text,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  status text not null default 'posted' check(status in ('posted','cancelled')), cancellation_reason text,
  unique(tenant_id,code), unique(tenant_id,request_id)
);
create table public.management_finance_allocations (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.management_finance_events(id),
  branch_id uuid not null references public.branches(id), recognition_date date not null,
  amount numeric(18,2) not null check(amount>0), unique(event_id,branch_id,recognition_date)
);
create table public.management_finance_settlements (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.management_finance_events(id),
  cash_transaction_id uuid not null unique references public.cash_transactions(id),
  request_id uuid not null unique, request_payload jsonb not null,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.management_finance_counters (
  tenant_id uuid not null references public.tenants(id),kind text not null, next_value bigint not null default 1,
  primary key(tenant_id,kind), check(next_value>0)
);
create index management_finance_allocations_scope on public.management_finance_allocations(branch_id,recognition_date,event_id);
create index management_finance_events_scope on public.management_finance_events(tenant_id,business_date,id);
create index management_finance_settlements_event on public.management_finance_settlements(event_id);

alter table public.management_finance_categories enable row level security;
alter table public.management_finance_events enable row level security;
alter table public.management_finance_allocations enable row level security;
alter table public.management_finance_settlements enable row level security;
alter table public.management_finance_counters enable row level security;
revoke all on public.management_finance_categories,public.management_finance_events,public.management_finance_allocations,
  public.management_finance_settlements,public.management_finance_counters from public,anon,authenticated;

-- Group headings are never valid posting targets; classification uses a leaf ID.
insert into public.management_finance_categories(tenant_id,code,name,kind,is_group)
select t.id,c.code,c.name,c.kind,true from public.tenants t cross join (values
 ('CP-VH','Vận hành','expense'),('CP-NS','Nhân sự','expense'),('CP-BH','Bán hàng','expense'),
 ('CP-TC','Tài chính','expense'),('CP-KH','Chi phí khác','expense'),('TN-TC','Thu nhập tài chính','income'),
 ('TN-KH','Thu nhập khác','income'),('NG-PNL','Ngoài kết quả kinh doanh','non_pnl')
) c(code,name,kind);
insert into public.management_finance_categories(tenant_id,code,name,kind,parent_id)
select p.tenant_id,c.code,c.name,p.kind,p.id from public.management_finance_categories p join (values
 ('CP-VH','CP-VH-DIEN','Điện'),('CP-VH','CP-VH-NUOC','Nước'),('CP-VH','CP-VH-THUE','Thuê mặt bằng'),
 ('CP-VH','CP-VH-INTERNET','Internet'),('CP-VH','CP-VH-SUACHUA','Sửa chữa'),('CP-VH','CP-VH-TIEUHAO','Vật tư tiêu hao'),
 ('CP-NS','CP-NS-LUONG','Lương'),('CP-NS','CP-NS-PHUCAP','Phụ cấp'),('CP-BH','CP-BH-QUANGCAO','Quảng cáo'),
 ('CP-BH','CP-BH-GIAOHANG','Phí giao hàng'),('CP-BH','CP-BH-NENTANG','Phí nền tảng'),
 ('CP-TC','CP-TC-NGANHANG','Phí ngân hàng'),('CP-TC','CP-TC-LAIVAY','Lãi vay'),('CP-KH','CP-KH-KHAC','Chi phí khác'),
 ('TN-TC','TN-TC-LAI','Lãi tiền gửi'),('TN-KH','TN-KH-KHAC','Thu nhập khác'),
 ('NG-PNL','NG-PNL-VON','Góp vốn / rút vốn'),('NG-PNL','NG-PNL-VAY','Vay / trả gốc vay'),
 ('NG-PNL','NG-PNL-TAISAN','Mua tài sản / công cụ'),('NG-PNL','NG-PNL-TRATRUOC','Khoản trả trước')
) c(parent_code,code,name) on p.code=c.parent_code;

create function public.management_finance_actor(p_permission text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid; begin
 select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if v_tenant is null or not public.user_has_permission(auth.uid(),p_permission) then
  raise exception 'MANAGEMENT_FINANCE_DENIED' using errcode='42501'; end if;
 return v_tenant;
end; $$;
revoke all on function public.management_finance_actor(text) from public,anon,authenticated;

create function public.get_management_finance_categories() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.view_cash_book'); v_result jsonb; begin
 select coalesce(jsonb_agg(to_jsonb(c) order by c.code),'[]'::jsonb) into v_result
 from public.management_finance_categories c where c.tenant_id=v_tenant and c.is_active;
 return v_result;
end; $$;

create function public.save_management_finance_category(p_code text,p_name text,p_kind text,p_parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.create_transaction'); v_row public.management_finance_categories; begin
 if p_parent_id is null or not exists(select 1 from public.management_finance_categories where id=p_parent_id
  and tenant_id=v_tenant and kind=p_kind and is_group and is_active) then raise exception 'FINANCE_PARENT_REQUIRED' using errcode='22023'; end if;
 insert into public.management_finance_categories(tenant_id,code,name,kind,parent_id)
 values(v_tenant,upper(btrim(p_code)),btrim(p_name),p_kind,p_parent_id) returning * into v_row;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(v_tenant,auth.uid(),'create','management_finance_category',v_row.id,to_jsonb(v_row));
 return to_jsonb(v_row);
end; $$;

create function public.post_management_finance_event(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.create_transaction'); v_event public.management_finance_events;
 v_category public.management_finance_categories; v_amount numeric; v_total numeric; v_number bigint; v_code text; v_row jsonb;
 v_branch uuid; v_date date; v_business date; v_seen text[]:='{}'; v_key text;
begin
 if p_request_id is null or p_payload is null then raise exception 'FINANCE_REQUEST_REQUIRED' using errcode='22023'; end if;
 -- Serialize retries before querying request_id; different requests use the counter row lock.
 perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||p_request_id::text,0));
 select * into v_event from public.management_finance_events where tenant_id=v_tenant and request_id=p_request_id;
 if found then
  if exists(select 1 from public.management_finance_allocations a where a.event_id=v_event.id
   and not public.user_has_branch_access(auth.uid(),a.branch_id)) then raise exception 'FINANCE_EVENT_DENIED' using errcode='42501'; end if;
  if v_event.request_payload is distinct from p_payload then raise exception 'FINANCE_REQUEST_CONFLICT' using errcode='PT409'; end if;
  return to_jsonb(v_event);
 end if;
 select * into v_category from public.management_finance_categories where id=(p_payload->>'categoryId')::uuid and tenant_id=v_tenant and is_active and not is_group;
 if not found then raise exception 'FINANCE_LEAF_CATEGORY_REQUIRED' using errcode='22023'; end if;
 v_amount:=(p_payload->>'amount')::numeric; v_business:=(p_payload->>'businessDate')::date;
 if v_amount is null or v_amount<=0 or v_amount::text in ('NaN','Infinity','-Infinity') or round(v_amount,2)<>v_amount
  or v_business is null or not isfinite(v_business) or v_business>(now() at time zone 'Asia/Ho_Chi_Minh')::date
  or nullif(btrim(p_payload->>'counterparty'),'') is null then raise exception 'FINANCE_EVENT_INVALID' using errcode='22023'; end if;
 if jsonb_typeof(p_payload->'allocations') is distinct from 'array' or jsonb_array_length(p_payload->'allocations')=0
  or jsonb_array_length(p_payload->'allocations')>120 then raise exception 'FINANCE_ALLOCATION_REQUIRED' using errcode='22023'; end if;
 v_total:=0;
 for v_row in select value from jsonb_array_elements(p_payload->'allocations') loop
  v_branch:=(v_row->>'branchId')::uuid; v_date:=(v_row->>'recognitionDate')::date;
  v_key:=v_branch::text||'/'||v_date::text;
  if v_branch is null or v_date is null or not isfinite(v_date) or v_key=any(v_seen)
   or (v_row->>'amount')::numeric is null or (v_row->>'amount')::numeric<=0 or (v_row->>'amount')::numeric::text in ('NaN','Infinity','-Infinity')
   or round((v_row->>'amount')::numeric,2)<>(v_row->>'amount')::numeric then raise exception 'FINANCE_ALLOCATION_INVALID' using errcode='22023'; end if;
  if not exists(select 1 from public.branches where id=v_branch and tenant_id=v_tenant and coalesce(is_active,true))
   or not public.user_has_branch_access(auth.uid(),v_branch) then raise exception 'FINANCE_BRANCH_DENIED' using errcode='42501'; end if;
  v_seen:=array_append(v_seen,v_key); v_total:=v_total+(v_row->>'amount')::numeric;
 end loop;
 if v_total is distinct from v_amount then raise exception 'FINANCE_ALLOCATION_UNBALANCED' using errcode='22023'; end if;
 insert into public.management_finance_counters(tenant_id,kind) values(v_tenant,v_category.kind) on conflict do nothing;
 select next_value into v_number from public.management_finance_counters where tenant_id=v_tenant and kind=v_category.kind for update;
 v_code:=(case v_category.kind when 'expense' then 'CP' when 'income' then 'TN' else 'NG' end)||lpad(v_number::text,greatest(6,length(v_number::text)),'0');
 update public.management_finance_counters set next_value=v_number+1 where tenant_id=v_tenant and kind=v_category.kind;
 insert into public.management_finance_events(tenant_id,code,request_id,request_payload,category_id,category_code,category_name,kind,business_date,amount,counterparty,note,created_by)
 values(v_tenant,v_code,p_request_id,p_payload,v_category.id,v_category.code,v_category.name,v_category.kind,v_business,v_amount,btrim(p_payload->>'counterparty'),nullif(btrim(p_payload->>'note'),''),auth.uid()) returning * into v_event;
 insert into public.management_finance_allocations(event_id,branch_id,recognition_date,amount)
 select v_event.id,(a->>'branchId')::uuid,(a->>'recognitionDate')::date,(a->>'amount')::numeric from jsonb_array_elements(p_payload->'allocations') a;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(v_tenant,auth.uid(),'posted','management_finance_event',v_event.id,to_jsonb(v_event)-'request_payload');
 return to_jsonb(v_event);
end; $$;

create function public.settle_management_finance_event(p_event_id uuid,p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.create_transaction'); v_event public.management_finance_events;
 v_existing public.management_finance_settlements; v_paid numeric; v_amount numeric; v_cash jsonb; v_cash_id uuid;
begin
 if p_request_id is null or p_payload is null then raise exception 'FINANCE_REQUEST_REQUIRED' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||p_request_id::text,0));
 select * into v_event from public.management_finance_events where id=p_event_id and tenant_id=v_tenant for update;
 if not found or exists(select 1 from public.management_finance_allocations a where a.event_id=p_event_id
  and not public.user_has_branch_access(auth.uid(),a.branch_id)) then raise exception 'FINANCE_EVENT_DENIED' using errcode='42501'; end if;
 select * into v_existing from public.management_finance_settlements where request_id=p_request_id;
 if found then
  if v_existing.event_id<>p_event_id or v_existing.request_payload is distinct from p_payload then raise exception 'FINANCE_REQUEST_CONFLICT' using errcode='PT409'; end if;
  return jsonb_build_object('id',v_existing.cash_transaction_id,'event_id',p_event_id);
 end if;
 if v_event.status<>'posted' then raise exception 'FINANCE_EVENT_CANCELLED' using errcode='PT409'; end if;
 v_amount:=(p_payload->>'amount')::numeric;
 if v_amount is null or v_amount<=0 or v_amount::text in ('NaN','Infinity','-Infinity') or round(v_amount,2)<>v_amount then raise exception 'FINANCE_AMOUNT_INVALID' using errcode='22023'; end if;
 select coalesce(sum(c.amount),0) into v_paid from public.management_finance_settlements s join public.cash_transactions c on c.id=s.cash_transaction_id
 where s.event_id=p_event_id and coalesce(c.status,'completed')='completed';
 if v_paid+v_amount>v_event.amount then raise exception 'FINANCE_SETTLEMENT_EXCEEDS_BALANCE' using errcode='22023'; end if;
 if v_event.kind='non_pnl' and coalesce(p_payload->>'direction','') not in ('receipt','payment') then raise exception 'FINANCE_DIRECTION_REQUIRED' using errcode='22023'; end if;
 v_cash:=public.record_cash_transaction_context('manual',jsonb_build_object('branchId',p_payload->>'branchId',
  'type',case v_event.kind when 'expense' then 'payment' when 'income' then 'receipt' else p_payload->>'direction' end,
  'category',case v_event.kind when 'expense' then 'management_expense' when 'income' then 'management_income' else 'management_non_pnl' end,
  'amount',v_amount,'counterparty',v_event.counterparty,'paymentMethod',p_payload->>'paymentMethod','note',v_event.code||' - '||coalesce(p_payload->>'note',v_event.note,'')),
  (p_payload->>'performedBy')::uuid,(p_payload->>'occurredAt')::timestamptz,(p_payload->>'transactionDate')::date,p_payload->>'timeReason');
 v_cash_id:=(v_cash->>'id')::uuid;
 insert into public.management_finance_settlements(event_id,cash_transaction_id,request_id,request_payload,created_by)
 values(p_event_id,v_cash_id,p_request_id,p_payload,auth.uid());
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(v_tenant,auth.uid(),'settled','management_finance_event',p_event_id,jsonb_build_object('cash_transaction_id',v_cash_id,'amount',v_amount,'atomic',true));
 return v_cash||jsonb_build_object('event_id',p_event_id);
end; $$;

-- Immediate/partial payment is part of the same transaction as recognition.
create function public.save_management_finance_document(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_event jsonb; v_cash jsonb; begin
 v_event:=public.post_management_finance_event(p_request_id,p_payload);
 if jsonb_typeof(p_payload->'payment')='object' then
  v_cash:=public.settle_management_finance_event((v_event->>'id')::uuid,p_request_id,p_payload->'payment');
 end if;
 return jsonb_build_object('event',v_event,'cash',v_cash);
end; $$;

create function public.cancel_management_finance_event(p_event_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.void_transaction'); v_event public.management_finance_events; begin
 select * into v_event from public.management_finance_events where id=p_event_id and tenant_id=v_tenant for update;
 if not found or exists(select 1 from public.management_finance_allocations a where a.event_id=p_event_id
  and not public.user_has_branch_access(auth.uid(),a.branch_id)) then raise exception 'FINANCE_EVENT_DENIED' using errcode='42501'; end if;
 if coalesce(length(btrim(p_reason)),0)<3 then raise exception 'FINANCE_CANCEL_REASON_REQUIRED' using errcode='22023'; end if;
 if exists(select 1 from public.management_finance_settlements s join public.cash_transactions c on c.id=s.cash_transaction_id
  where s.event_id=p_event_id and coalesce(c.status,'completed')='completed') then raise exception 'FINANCE_REVERSE_CASH_FIRST' using errcode='PT409'; end if;
 if v_event.status='cancelled' then return; end if;
 update public.management_finance_events set status='cancelled',cancellation_reason=btrim(p_reason) where id=p_event_id;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(v_tenant,auth.uid(),'cancelled','management_finance_event',p_event_id,jsonb_build_object('reason',btrim(p_reason)));
end; $$;

create function public.get_management_finance_workspace(p_date_from date,p_date_to date,p_branch_id uuid default null,
 p_kind text default null,p_category_id uuid default null,p_search text default null,p_page integer default 0,p_page_size integer default 50,
 p_status text default null,p_payment_state text default null,p_sort text default 'date_desc')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.view_cash_book'); v_result jsonb; begin
 if p_date_from is null or p_date_to is null or not isfinite(p_date_from) or not isfinite(p_date_to) or p_date_from>p_date_to
  or p_page<0 or p_page_size<1 or p_page_size>200 then raise exception 'FINANCE_REPORT_RANGE_INVALID' using errcode='22023'; end if;
 if (p_kind is not null and p_kind not in ('income','expense','non_pnl'))
  or (p_status is not null and p_status not in ('posted','cancelled'))
  or (p_payment_state is not null and p_payment_state not in ('unpaid','partial','paid'))
  or p_sort is null or p_sort not in ('date_desc','date_asc','amount_desc','amount_asc') then raise exception 'FINANCE_FILTER_INVALID' using errcode='22023'; end if;
 if p_branch_id is not null and (not public.user_has_branch_access(auth.uid(),p_branch_id)
  or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=v_tenant)) then raise exception 'FINANCE_BRANCH_DENIED' using errcode='42501'; end if;
 with scoped as (
  select e.*, (select sum(a.amount) from public.management_finance_allocations a where a.event_id=e.id and a.recognition_date between p_date_from and p_date_to
   and (p_branch_id is null or a.branch_id=p_branch_id)) report_amount,
   (select coalesce(sum(c.amount),0) from public.management_finance_settlements s join public.cash_transactions c on c.id=s.cash_transaction_id
    where s.event_id=e.id and coalesce(c.status,'completed')='completed' and c.transaction_date<=p_date_to) settled_amount,
   (select jsonb_agg(jsonb_build_object('branch_id',a.branch_id,'branch_name',b.name,'recognition_date',a.recognition_date,'amount',a.amount) order by a.recognition_date,b.name,a.id)
    from public.management_finance_allocations a join public.branches b on b.id=a.branch_id where a.event_id=e.id) allocations,
   (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'amount',c.amount,'status',c.status,'transaction_date',c.transaction_date,
    'occurred_at',c.occurred_at,'performed_by_name',c.performed_by_name,'branch_id',c.branch_id,'payment_method',c.payment_method) order by c.transaction_date,c.id),'[]'::jsonb)
    from public.management_finance_settlements s join public.cash_transactions c on c.id=s.cash_transaction_id where s.event_id=e.id) settlements,
   p.full_name created_by_name
  from public.management_finance_events e join public.profiles p on p.id=e.created_by
  where e.tenant_id=v_tenant and not exists(select 1 from public.management_finance_allocations a where a.event_id=e.id and not public.user_has_branch_access(auth.uid(),a.branch_id))
   and (p_kind is null or e.kind=p_kind) and (p_category_id is null or e.category_id=p_category_id)
   and (nullif(btrim(p_search),'') is null or e.code ilike '%'||replace(replace(p_search,'%','\%'),'_','\_')||'%'
    or e.counterparty ilike '%'||replace(replace(p_search,'%','\%'),'_','\_')||'%')
 ), filtered as (select * from scoped where report_amount is not null
  and (p_status is null or status=p_status)
  and (p_payment_state is null or (status='posted' and case p_payment_state
   when 'unpaid' then settled_amount=0 when 'partial' then settled_amount>0 and settled_amount<amount
   when 'paid' then settled_amount>=amount else false end))),
 ranked as (select *,row_number() over(order by
  case when p_sort='amount_desc' then report_amount end desc,
  case when p_sort='amount_asc' then report_amount end asc,
  case when p_sort='date_asc' then business_date end asc,
  business_date desc,created_at desc,id) rn from filtered)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)-'request_payload'-'rn' order by rn) from ranked r
  where rn>p_page*p_page_size and rn<=(p_page+1)*p_page_size),'[]'::jsonb),
  'total',(select count(*) from filtered),'summary',jsonb_build_object(
   'income',(select coalesce(sum(report_amount) filter(where kind='income' and status='posted'),0) from filtered),
   'expense',(select coalesce(sum(report_amount) filter(where kind='expense' and status='posted'),0) from filtered),
   'non_pnl',(select coalesce(sum(report_amount) filter(where kind='non_pnl' and status='posted'),0) from filtered)),
  'basis','recognition_date','as_of',p_date_to) into v_result;
 return v_result;
end; $$;

revoke all on function public.get_management_finance_categories(),public.save_management_finance_category(text,text,text,uuid),
 public.post_management_finance_event(uuid,jsonb),public.settle_management_finance_event(uuid,uuid,jsonb),
 public.save_management_finance_document(uuid,jsonb),
 public.cancel_management_finance_event(uuid,text),public.get_management_finance_workspace(date,date,uuid,text,uuid,text,integer,integer,text,text,text) from public,anon;
grant execute on function public.get_management_finance_categories(),public.save_management_finance_category(text,text,text,uuid),
 public.post_management_finance_event(uuid,jsonb),public.settle_management_finance_event(uuid,uuid,jsonb),
 public.save_management_finance_document(uuid,jsonb),
 public.cancel_management_finance_event(uuid,text),public.get_management_finance_workspace(date,date,uuid,text,uuid,text,integer,integer,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
