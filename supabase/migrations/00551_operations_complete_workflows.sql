-- Hub completion companion; not the concurrent FnB 00541 migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.ops_q_references (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches,issue_id uuid not null references public.ops_q_issues,
 source_type text not null check(source_type in ('product','lot','supplier','purchase','supplier_return')),
 source_id uuid not null,label text not null,note text not null default '',created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(),unique(issue_id,source_type,source_id)
);
alter table public.ops_q_references enable row level security;
revoke all on public.ops_q_references from public,anon,authenticated;

-- Read only whitelisted source metadata; never expose costs/debts or perform ERP writes.
create function public.ops_q_reference_rows(p_branch uuid,p_type text,p_search text,p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tab text; permission text; label text; result jsonb; scoped boolean;
begin
 if not public.ops_q_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN'; end if;
 tab:=case p_type when 'product' then 'products' when 'lot' then 'product_lots' when 'supplier' then 'suppliers' when 'purchase' then 'purchase_orders' when 'supplier_return' then 'supplier_returns' end;
 permission:=case p_type when 'product' then 'products.view' when 'supplier' then 'suppliers.view' else 'inventory.view' end;
 if tab is null or length(coalesce(p_search,''))>200 or not coalesce(public.user_has_permission(auth.uid(),permission),false) then raise exception 'OPS_FORBIDDEN'; end if;
 scoped:=p_type not in ('product','supplier');
 if scoped and not coalesce(public._can_read_branch_inventory_00476(auth.uid(),public.get_user_tenant_id(),p_branch),false) then raise exception 'OPS_FORBIDDEN'; end if;
 execute format($query$
  select coalesce(jsonb_agg(x),'[]') from (
   select j->>'id' id,coalesce(j->>'code',j->>'lot_number','') code,
    coalesce(j->>'name',j->>'lot_number',j->>'code','Hồ sơ nguồn') title,
    j->>'product_id' product_id,j->>'supplier_id' supplier_id,j->>'status' status,
    j->>'expiry_date' expiry_date,j->>'received_date' received_date,j->>'created_at' created_at
   from (select to_jsonb(t) j from public.%I t where t.tenant_id=$1) source
   where (not $2 or j->>'branch_id'=$3::text) and ($4 is null or j->>'id'=$4::text)
    and position(lower($5) in lower(coalesce(j->>'code','')||' '||coalesce(j->>'name','')||' '||coalesce(j->>'lot_number','')))>0
   order by coalesce(j->>'code',j->>'lot_number',j->>'name'),j->>'id' limit 25
  ) x
 $query$,tab) into result using public.get_user_tenant_id(),scoped,p_branch,p_id,coalesce(p_search,'');
 return result;
end $$;

alter function public.ops_quality_execute(text,jsonb,uuid) rename to ops_quality_execute_before_complete;
revoke all on function public.ops_quality_execute_before_complete(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_quality_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare p public.profiles;b uuid:=(p_payload->>'branchId')::uuid;eid uuid:=(p_payload->>'id')::uuid;
 result jsonb;old_body jsonb;body jsonb:=jsonb_build_object('action','quality:'||p_action,'payload',p_payload);
 standard public.ops_standards;ev jsonb;row jsonb;iid uuid;issue public.ops_q_issues;td public.ops_todos;
 label text;bounds record;other record;new_id uuid;period text:=p_payload->>'period';
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED'; end if;
 if p_request_id is null or not exists(select 1 from public.branches where id=b and tenant_id=p.tenant_id and is_active) then raise exception 'OPS_FORBIDDEN'; end if;
 if p_action='revenue_batch' then
  if not public.ops_q_can(b,'manage') then raise exception 'OPS_FORBIDDEN'; end if;
  return public.ops_execute(p_action,p_payload,p_request_id);
 end if;
 if p_action in ('target','revenue','approve_revenue','onebiz_revenue') then
  if not public.ops_q_can(b,'manage') then raise exception 'OPS_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||b::text,0));
  if p_action='approve_revenue' then select r.period into period from public.ops_revenues r where r.id=eid and r.tenant_id=p.tenant_id and r.branch_id=b; end if;
  perform 1 from public.ops_q_period_bounds(b,period);
  if exists(select 1 from public.ops_q_settlements where branch_id=b and ops_q_settlements.period=period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  return public.ops_execute(p_action,p_payload,p_request_id);
 end if;
 if p_action not in ('period','group','adhoc','reference') then
  if p_action='rule_approve' and public.ops_q_can(b,'manage') then
   select config into row from public.ops_q_rules where id=eid and tenant_id=p.tenant_id and branch_id=b;
   if exists(select 1 from jsonb_array_elements(coalesce(row->'bonusLimits','[]')) lim
    where not exists(select 1 from public.ops_q_catalog c where c.branch_id=b and c.tenant_id=p.tenant_id and c.family_id=(lim->>'familyId')::uuid and c.score_type='bonus')) then
    raise exception 'OPS_Q_POLICY_INCOMPLETE';
   end if;
  end if;
  if p_action='qc_create' then
   perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||b::text,0));
   select * into bounds from public.ops_q_period_bounds(b,period);
   for other in select distinct a.period from public.ops_q_audits a where a.branch_id=b and a.period<>period loop
    if exists(select 1 from public.ops_q_period_bounds(b,other.period) r where daterange(r.starts_on,r.ends_on,'[]')&&daterange(bounds.starts_on,bounds.ends_on,'[]')) then raise exception 'OPS_Q_PERIOD_OVERLAP'; end if;
   end loop;
  end if;
  return public.ops_quality_execute_before_complete(p_action,p_payload,p_request_id);
 end if;
 if not (case when p_action in ('period','group') then public.ops_q_can(b,'manage')
  when p_action='adhoc' then public.ops_q_can(b,'work')
  else public.ops_q_can(b,'work') end) then raise exception 'OPS_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||b::text,0));
 select response,request_body into result,old_body from public.ops_requests where tenant_id=p.tenant_id and user_id=p.id and request_id=p_request_id;
 if found then if old_body<>body then raise exception 'OPS_REQUEST_CONFLICT'; end if;return result;end if;
 if p_action='period' then
  if eid is not null then raise exception 'OPS_Q_LOCKED'; end if;
  if (p_payload->>'startsOn')::date is null or (p_payload->>'endsOn')::date is null then raise exception 'OPS_INVALID_RANGE'; end if;
  if exists(select 1 from public.ops_q_periods where branch_id=b and daterange(starts_on,ends_on,'[]')&&daterange((p_payload->>'startsOn')::date,(p_payload->>'endsOn')::date,'[]')) then raise exception 'OPS_Q_PERIOD_OVERLAP'; end if;
  insert into public.ops_q_periods(tenant_id,branch_id,title,starts_on,ends_on,created_by)
   values(p.tenant_id,b,p_payload->>'title',(p_payload->>'startsOn')::date,(p_payload->>'endsOn')::date,p.id) returning id into eid;
 elsif p_action='group' then
  if eid is null then insert into public.ops_q_groups(tenant_id,branch_id,title,created_by) values(p.tenant_id,b,p_payload->>'title',p.id) returning id into eid;
  else
   update public.ops_q_groups set title=p_payload->>'title',active=(p_payload->>'active')::boolean,version=version+1
    where id=eid and tenant_id=p.tenant_id and branch_id=b and version=(p_payload->>'version')::integer;
   if not found then raise exception 'OPS_STALE'; end if;
  end if;
 elsif p_action='adhoc' then
  select * into standard from public.ops_standards where id=(p_payload->>'standardId')::uuid and tenant_id=p.tenant_id and branch_id=b and status='approved' and effective_from<=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
  if standard.id is null then raise exception 'OPS_INVALID_STANDARD'; end if;
  if exists(select 1 from public.ops_q_assignments where branch_id=b and family_id=standard.family_id and not p.id=any(manager_ids))
   or not exists(select 1 from public.ops_q_assignments where branch_id=b and family_id=standard.family_id) and standard.assignee_id<>p.id then raise exception 'OPS_FORBIDDEN'; end if;
  ev:=public.ops_evaluate(standard.criteria,p_payload->'observations');
  if ev->>'quality'='unknown' then raise exception 'OPS_Q_MISSING_RESULT'; end if;
  if coalesce(trim(p_payload->>'note'),'')='' then raise exception 'OPS_REASON_REQUIRED'; end if;
  insert into public.ops_q_checks(tenant_id,branch_id,kind,standard_snapshot,observations,result,note,actor_id)
   values(p.tenant_id,b,'adhoc',jsonb_build_object('standardId',standard.id,'familyId',standard.family_id,'title',standard.title,'criteria',standard.criteria),ev->'observations',ev->>'quality',p_payload->>'note',p.id) returning id into eid;
  if ev->>'quality'='unmet' then
   if jsonb_typeof(p_payload->'issues') is distinct from 'array' or jsonb_array_length(p_payload->'issues') not between 1 and 20 then raise exception 'OPS_Q_ISSUE_REQUIRED'; end if;
   for row in select value from jsonb_array_elements(p_payload->'issues') loop
    iid:=(row->>'issueId')::uuid;
    if iid is null then iid:=public.ops_q_new_issue(b,row,standard.family_id);
    elsif not exists(select 1 from public.ops_q_issues where id=iid and branch_id=b and tenant_id=p.tenant_id and stage not in ('done','canceled') and (family_id is null or family_id=standard.family_id)) then raise exception 'OPS_Q_INVALID_LINK'; end if;
    insert into public.ops_q_sources(tenant_id,branch_id,issue_id,check_id) values(p.tenant_id,b,iid,eid) on conflict do nothing;
    insert into public.ops_notifications(tenant_id,branch_id,user_id,entity_id,title,due_at,kind,day)
     select t.tenant_id,b,pr.id,t.id,t.title,t.due_at,'todo',(now() at time zone 'Asia/Ho_Chi_Minh')::date
      from public.ops_q_issues i join public.ops_todos t on t.id=i.todo_id
      join public.profiles pr on (pr.id=t.assignee_id or pr.id=any(t.collaborators) or pr.id=i.operator_id)
      where i.id=iid and pr.tenant_id=p.tenant_id and pr.is_active
     on conflict(user_id,entity_id,kind,day) do update set title=excluded.title,created_at=now(),read_at=null;
   end loop;
  end if;
 elsif p_action='reference' then
  select * into issue from public.ops_q_issues where id=(p_payload->>'issueId')::uuid and tenant_id=p.tenant_id and branch_id=b for update;
  select * into td from public.ops_todos where id=issue.todo_id;
  if issue.id is null or td.assignee_id<>p.id or issue.stage in ('done','canceled') then raise exception 'OPS_FORBIDDEN'; end if;
  select value->>'title' into label from jsonb_array_elements(public.ops_q_reference_rows(b,p_payload->>'sourceType','',(p_payload->>'sourceId')::uuid));
  if label is null then raise exception 'OPS_FORBIDDEN'; end if;
  insert into public.ops_q_references(tenant_id,branch_id,issue_id,source_type,source_id,label,note,created_by)
   values(p.tenant_id,b,issue.id,p_payload->>'sourceType',(p_payload->>'sourceId')::uuid,label,coalesce(p_payload->>'note',''),p.id)
   on conflict(issue_id,source_type,source_id) do nothing returning id into eid;
  if eid is null then select id into eid from public.ops_q_references where issue_id=issue.id and source_type=p_payload->>'sourceType' and source_id=(p_payload->>'sourceId')::uuid; end if;
 end if;
 result:=jsonb_build_object('id',eid,'saved',true);
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data,reason) values(p.tenant_id,b,eid,'quality:'||p_action,p.id,p_payload,p_payload->>'note');
 insert into public.ops_requests values(p.tenant_id,p.id,p_request_id,body,result);
 return result;
end $$;

alter function public.ops_quality_read(uuid,text,text,jsonb) rename to ops_quality_read_before_complete;
revoke all on function public.ops_quality_read_before_complete(uuid,text,text,jsonb) from public,anon,authenticated;
create function public.ops_quality_read(p_branch uuid,p_period text,p_kind text default 'work',p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; period_data jsonb; bounds record; work_data jsonb; issue_data jsonb; data record;type text:=p_filters->>'sourceType';
begin
 if p_kind='references' then
  return jsonb_build_object('rows',public.ops_q_reference_rows(p_branch,type,coalesce(p_filters->>'search',''),(p_filters->>'entity')::uuid));
 end if;
 if p_filters->>'periodRange'='true' then
  select * into bounds from public.ops_q_period_bounds(p_branch,p_period);
  p_filters:=p_filters||jsonb_build_object('from',bounds.starts_on::timestamp at time zone 'Asia/Ho_Chi_Minh','to',(bounds.ends_on+1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
 end if;
 result:=public.ops_quality_read_before_complete(p_branch,p_period,case when p_kind in ('overview','adhoc') then 'settings' else p_kind end,p_filters);
 if not public.ops_q_can(p_branch,'view') then return result; end if;
 select * into bounds from public.ops_q_period_bounds(p_branch,p_period);
 result:=result||jsonb_build_object(
  'periods',coalesce((select jsonb_agg(jsonb_build_object('key','custom:'||p.id::text,'title',p.title,'starts_on',p.starts_on,'ends_on',p.ends_on,'closed',exists(select 1 from public.ops_q_settlements s where s.branch_id=p_branch and s.period='custom:'||p.id::text)) order by p.starts_on desc,p.id) from public.ops_q_periods p where p.branch_id=p_branch and p.tenant_id=public.get_user_tenant_id()),'[]'),
  'groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.title,g.id) from public.ops_q_groups g where g.branch_id=p_branch and g.tenant_id=public.get_user_tenant_id()),'[]'),
  'target',(select to_jsonb(t) from public.ops_targets t where t.branch_id=p_branch and t.period=p_period and t.tenant_id=public.get_user_tenant_id()),
  'revenues',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from public.ops_revenues r where r.branch_id=p_branch and r.period=p_period and r.tenant_id=public.get_user_tenant_id()),'[]'),
  'adhoc',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id) from(select k.* from public.ops_q_checks k where k.branch_id=p_branch and k.tenant_id=public.get_user_tenant_id() and k.kind='adhoc' and k.created_at>=bounds.starts_on::timestamp at time zone 'Asia/Ho_Chi_Minh' and k.created_at<(bounds.ends_on+1)::timestamp at time zone 'Asia/Ho_Chi_Minh' order by k.created_at desc,k.id desc limit 50) c),'[]'));
 if p_kind='overview' then
  select count(*) filter(where original_due_at<=now()) due,count(*) filter(where original_due_at<=now() and quality<>'unknown') checked,
   count(*) filter(where original_due_at<=now() and quality='met' and met_at<=original_due_at) met,
   count(*) filter(where original_due_at<=now() and quality='met' and met_at>original_due_at) late,
   count(*) filter(where original_due_at<=now() and quality='unknown') unknown,
   count(*) filter(where quality<>'met' and original_due_at<now()) overdue
  into data from public.ops_runs r where r.branch_id=p_branch and r.tenant_id=public.get_user_tenant_id() and r.original_due_at>=bounds.starts_on::timestamp at time zone 'Asia/Ho_Chi_Minh' and r.original_due_at<(bounds.ends_on+1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  result:=result||jsonb_build_object('compliance',to_jsonb(data));
  select count(*) filter(where i.stage not in ('done','canceled')) opened,count(*) filter(where i.stage='pending_review') awaiting,
   count(*) filter(where i.stage not in ('done','canceled') and t.due_at<now()) overdue,count(*) filter(where i.stage='done') closed
  into data from public.ops_q_issues i join public.ops_todos t on t.id=i.todo_id where i.branch_id=p_branch and i.tenant_id=public.get_user_tenant_id() and public.ops_todo_visible(t.id)
   and t.due_at>=bounds.starts_on::timestamp at time zone 'Asia/Ho_Chi_Minh' and t.due_at<(bounds.ends_on+1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  result:=result||jsonb_build_object('issueSummary',to_jsonb(data));
 end if;
 if p_kind='adhoc' then
  with matches as (
   select c.* from public.ops_q_checks c where c.branch_id=p_branch and c.tenant_id=public.get_user_tenant_id() and c.kind='adhoc'
    and position(lower(coalesce(p_filters->>'search','')) in lower(coalesce(c.standard_snapshot->>'title','')||' '||c.note))>0
    and (coalesce(p_filters->>'result','')='' or c.result=p_filters->>'result')
    and (coalesce(p_filters->>'assignee','')='' or c.actor_id=(p_filters->>'assignee')::uuid)
    and (coalesce(p_filters->>'mine','false')<>'true' or c.actor_id=auth.uid())
    and (p_filters->>'from' is null or c.created_at>=(p_filters->>'from')::timestamptz and c.created_at<(p_filters->>'to')::timestamptz)
  ) select count(*) total,(select coalesce(jsonb_agg(to_jsonb(page)),'[]') from (select * from matches order by created_at desc,id desc limit 50 offset coalesce((p_filters->>'offset')::integer,0)) page) rows into data from matches;
  result:=result||jsonb_build_object('rows',data.rows,'total',data.total,'offset',coalesce((p_filters->>'offset')::integer,0),'limit',50);
 end if;
 if p_kind='issues' then
  result:=jsonb_set(result,'{rows}',coalesce((select jsonb_agg(row||jsonb_build_object('references',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source_type',r.source_type,'source_id',r.source_id,'label',r.label,'note',r.note,'created_at',r.created_at)) from public.ops_q_references r where r.issue_id=(row->>'id')::uuid and r.tenant_id=public.get_user_tenant_id()),'[]'))) from jsonb_array_elements(result->'rows') row),'[]'));
 end if;
 return result;
end $$;

-- Adapt internal finance commands to custom bounds, keeping their existing guards and audit.
do $patch$
declare f record;def text;
begin
 for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname like 'ops_execute%' loop
  def:=pg_get_functiondef(f.sig);
  if strpos(def,'v_period')>0 and strpos(def,'start_at:=(v_period||')>0 then
   def:=replace(def,'coalesce(v_period,'''') !~ ''^\d{4}-(0[1-9]|1[0-2])$''','not public.ops_q_period_valid(branch,v_period)');
   def:=replace(def,'start_at:=(v_period||''-01'')::timestamp at time zone ''Asia/Ho_Chi_Minh'';','start_at:=(select starts_on::timestamp at time zone ''Asia/Ho_Chi_Minh'' from public.ops_q_period_bounds(branch,v_period));');
   def:=replace(def,'end_at:=((v_period||''-01'')::date+interval ''1 month'') at time zone ''Asia/Ho_Chi_Minh'';','end_at:=(public.ops_q_period_end(branch,v_period)+1)::timestamp at time zone ''Asia/Ho_Chi_Minh'';');
   execute def;
  end if;
 end loop;
end $patch$;

-- The legacy endpoint must obey the same settlement lock as the new Hub UI.
alter function public.ops_execute(text,jsonb,uuid) rename to ops_execute_before_complete;
revoke all on function public.ops_execute_before_complete(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid:=(p_payload->>'branchId')::uuid; selected_period text:=p_payload->>'period'; tenant uuid:=public.get_user_tenant_id();
begin
 if p_action in ('target','revenue','approve_revenue','onebiz_revenue') then
  if not public.ops_q_can(b,'view') then raise exception 'OPS_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||b::text,0));
  if p_action='approve_revenue' then
   select r.period into selected_period from public.ops_revenues r where r.id=(p_payload->>'id')::uuid and r.tenant_id=tenant and r.branch_id=b;
  end if;
  perform 1 from public.ops_q_period_bounds(b,selected_period);
  if exists(select 1 from public.ops_q_settlements s where s.tenant_id=tenant and s.branch_id=b and s.period=selected_period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
 end if;
 return public.ops_execute_before_complete(p_action,p_payload,p_request_id);
end $$;
revoke all on function public.ops_execute(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_execute(text,jsonb,uuid) to authenticated;
revoke all on function public.ops_quality_execute(text,jsonb,uuid),public.ops_quality_read(uuid,text,text,jsonb),public.ops_q_reference_rows(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.ops_quality_execute(text,jsonb,uuid),public.ops_quality_read(uuid,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
