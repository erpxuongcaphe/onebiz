-- New schedules only. Existing definitions, runs, results and money/stock are not rewritten.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $baseline$
declare item record;
begin
 for item in select * from (values
  ('public.ops_execute(text,jsonb,uuid)','7ff485fc26273883a26c6b5065607cc6'),
  ('public.ops_generate_internal(uuid,date)','fb7d4b23b558abdfe91b624db58806ae'),
  ('public.ops_history(uuid,text,text,timestamptz,uuid)','4ad9161e9699f90cbe1df991f4a40e97'),
  ('public.ops_access_context()','695d9a97385296c5546f23f8018492fa'),
  ('public.ops_standard_proposal(text,jsonb,uuid)','04a58cf23e7abf2c59b55c26bb87ebd3'),
  ('public.ops_filtered_page(text,uuid,text,boolean,jsonb,timestamptz,uuid)','ace576fd790491bc3dcf6115079e131a'),
  ('public.ops_working_library_check(jsonb)','110dfd81cc9bb75e3cb3d2fe46e2f838'),
  ('public.ops_workbook_import(uuid,jsonb,boolean)','45b3c4d654f8a5767bed339f03a9a5ea'),
  ('public.ops_working_library_execute(text,jsonb,uuid)','fd64e5c1659842cca6e5d60059346ba2'),
  ('public.ops_working_library_read()','89d000a35494063592495459400fb112')
 ) v(signature,checksum) loop
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from item.checksum then
   raise exception 'Hub recurrence baseline changed: %; abort release',item.signature;
  end if;
 end loop;
end $baseline$;

alter table public.ops_standards drop constraint ops_standards_frequency_check;
alter table public.ops_standards add constraint ops_standards_frequency_check
 check(frequency in ('once','daily','weekly','monthly','quarterly','yearly','event'));
alter table public.ops_standards add column month_number integer check(month_number between 1 and 12);
alter table public.ops_standards add column effective_until date check(effective_until>=effective_from);

create table public.ops_schedule_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, standard_id uuid not null references public.ops_standards,
 actor_id uuid references public.profiles, title text not null, schedule jsonb not null,
 generated integer not null check(generated>0), created_at timestamptz not null default now()
);
alter table public.ops_schedule_events enable row level security;
revoke all on public.ops_schedule_events from public,anon,authenticated;
create index ops_schedule_events_history on public.ops_schedule_events(tenant_id,branch_id,created_at desc,id desc);

create function public.ops_schedule_check(p jsonb,p_template boolean default false) returns void
language plpgsql immutable set search_path='' as $$
declare f text:=p->>'frequency'; d integer; m integer; first_date date; last_date date;
begin
 if coalesce(f,'') not in ('once','daily','weekly','monthly','quarterly','yearly','event') then raise exception 'OPS_INVALID_SCHEDULE'; end if;
 if p ? 'dayNumber' and p->'dayNumber'<>'null'::jsonb then
  if jsonb_typeof(p->'dayNumber') is distinct from 'number' or (p->>'dayNumber')::numeric<>trunc((p->>'dayNumber')::numeric) then raise exception 'OPS_INVALID_SCHEDULE'; end if;
  d:=(p->>'dayNumber')::integer;
 end if;
 if p ? 'monthNumber' and p->'monthNumber'<>'null'::jsonb then
  if jsonb_typeof(p->'monthNumber') is distinct from 'number' or (p->>'monthNumber')::numeric<>trunc((p->>'monthNumber')::numeric) then raise exception 'OPS_INVALID_SCHEDULE'; end if;
  m:=(p->>'monthNumber')::integer;
 end if;
 if d is not null and d not between 1 and 31 or f='weekly' and d is not null and d>7
  or f in ('monthly','quarterly','yearly') and d is null
  or f in ('quarterly','yearly') and (m is null or m not between 1 and case when f='quarterly' then 3 else 12 end)
  or not p_template and d is null then raise exception 'OPS_INVALID_SCHEDULE'; end if;
 if not p_template then
  if coalesce(p->>'effectiveFrom','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(p->>'dueTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'OPS_INVALID_SCHEDULE'; end if;
  first_date:=(p->>'effectiveFrom')::date;
  if nullif(p->>'effectiveUntil','') is not null then
   last_date:=(p->>'effectiveUntil')::date;
   if last_date<first_date or f in ('once','event') then raise exception 'OPS_INVALID_SCHEDULE'; end if;
  end if;
 end if;
end $$;
revoke all on function public.ops_schedule_check(jsonb,boolean) from public,anon,authenticated;

-- Preserve the existing permission, proposal, idempotency and audit chain.
alter function public.ops_execute(text,jsonb,uuid) rename to ops_execute_before_recurrence;
revoke all on function public.ops_execute_before_recurrence(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; replay boolean; previous jsonb; updated jsonb;
begin
 if p_action not in ('standard','propose_standard','common_standard') then
  return public.ops_execute_before_recurrence(p_action,p_payload,p_request_id);
 end if;
 perform public.ops_schedule_check(p_payload,false);
 perform pg_advisory_xact_lock(hashtextextended(public.get_user_tenant_id()::text||auth.uid()::text||p_request_id::text||'ops-schedule',0));
 select exists(select 1 from public.ops_requests where tenant_id=public.get_user_tenant_id() and user_id=auth.uid() and request_id=p_request_id) into replay;
 result:=public.ops_execute_before_recurrence(p_action,p_payload,p_request_id);
 if replay or p_action='common_standard' then return result; end if;
 select to_jsonb(s) into previous from public.ops_standards s where id=(result->>'id')::uuid
  and tenant_id=public.get_user_tenant_id() and created_by=auth.uid() and status in ('draft','pending') for update;
 if previous is null then raise exception 'OPS_STALE'; end if;
 update public.ops_standards set month_number=case when frequency in ('quarterly','yearly') then (p_payload->>'monthNumber')::integer else null end,
  effective_until=nullif(p_payload->>'effectiveUntil','')::date
  where id=(result->>'id')::uuid returning to_jsonb(ops_standards.*) into updated;
 select to_jsonb(s) into previous from public.ops_standards s where tenant_id=public.get_user_tenant_id()
  and branch_id=(updated->>'branch_id')::uuid and family_id=(updated->>'family_id')::uuid
  and revision<(updated->>'revision')::integer order by revision desc limit 1;
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
 values(public.get_user_tenant_id(),(updated->>'branch_id')::uuid,(updated->>'id')::uuid,'configure_schedule',auth.uid(),previous,updated,coalesce(nullif(p_payload->>'reason',''),'Thiết lập lịch thực hiện'));
 update public.ops_requests set response=updated where tenant_id=public.get_user_tenant_id() and user_id=auth.uid() and request_id=p_request_id;
 return updated;
end $$;
revoke all on function public.ops_execute(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_execute(text,jsonb,uuid) to authenticated;

-- Fail closed if any function differs from the reviewed baseline.
do $patch$
declare item record; definition text; needle text; replacement text;
begin
 for item in select * from (values
  ('public.ops_standard_proposal(text,jsonb,uuid)', 'not in (''daily'',''weekly'',''monthly'',''event'')', 'not in (''once'',''daily'',''weekly'',''monthly'',''quarterly'',''yearly'',''event'')'),
  ('public.ops_filtered_page(text,uuid,text,boolean,jsonb,timestamptz,uuid)', 'not in ('''',''daily'',''weekly'',''monthly'',''event'')', 'not in ('''',''once'',''daily'',''weekly'',''monthly'',''quarterly'',''yearly'',''event'')'),
  ('public.ops_access_context()', 'jsonb_build_object(''allowed'',allowed,', 'jsonb_build_object(''recurrenceVersion'',1,''allowed'',allowed,'),
  ('public.ops_working_library_check(jsonb)', 'not in (''daily'',''weekly'')', 'not in (''once'',''daily'',''weekly'',''monthly'',''quarterly'',''yearly'')'),
  ('public.ops_workbook_import(uuid,jsonb,boolean)', 'not in (''daily'',''weekly'')', 'not in (''once'',''daily'',''weekly'',''monthly'',''quarterly'',''yearly'')'),
  ('public.ops_workbook_import(uuid,jsonb,boolean)', '''dayNumber'',case when row->>''frequency''=''weekly'' then (p_body->>''weeklyDay'')::integer else 1 end', '''dayNumber'',coalesce((row->>''dayNumber'')::integer,case when row->>''frequency''=''weekly'' then (p_body->>''weeklyDay'')::integer else 1 end)'),
  ('public.ops_workbook_import(uuid,jsonb,boolean)', '''effectiveFrom'',p_body->>''effectiveFrom'',''criteria'',criteria', '''effectiveFrom'',p_body->>''effectiveFrom'',''monthNumber'',row->''monthNumber'',''effectiveUntil'',case when row->>''frequency''=''once'' then null else p_body->''effectiveUntil'' end,''criteria'',criteria'),
  ('public.ops_working_library_execute(text,jsonb,uuid)', '''effectiveFrom'',assignment->>''effectiveFrom'',''dueTime'',assignment->>''dueTime'',''weeklyDay'',assignment->''weeklyDay''', '''effectiveFrom'',assignment->>''effectiveFrom'',''effectiveUntil'',assignment->''effectiveUntil'',''dueTime'',assignment->>''dueTime'',''weeklyDay'',assignment->''weeklyDay''')
 ) v(signature,old_text,new_text) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  needle:=item.old_text; replacement:=item.new_text;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Recurrence baseline changed: %',item.signature; end if;
  execute replace(definition,needle,replacement);
 end loop;
 -- Validate recurrence metadata even for direct library RPC calls.
 definition:=pg_get_functiondef('public.ops_working_library_check(jsonb)'::regprocedure);
 needle:='for r in select value from jsonb_array_elements(p_rows) loop';
 if strpos(definition,needle)=0 then raise exception 'Library validation baseline changed'; end if;
 execute replace(definition,needle,needle||E'\n  perform public.ops_schedule_check(r,true);');
end $patch$;

create or replace function public.ops_generate_internal(p_branch uuid,p_until date) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.ops_standards; d date; first_day date; last_day date; due timestamptz; key text;
 n integer:=0; added integer; created_count integer; today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 if p_until is null or p_until>today+31 then raise exception 'OPS_INVALID_RANGE'; end if;
 -- Serialize generation for a branch; unique run keys remain the final duplicate guard.
 perform pg_advisory_xact_lock(hashtextextended(p_branch::text||'ops-generate',0));
 for s in select * from public.ops_standards where branch_id=p_branch and status='approved' and frequency<>'event' order by effective_from loop
  select greatest(s.effective_from,coalesce(max((original_due_at at time zone 'Asia/Ho_Chi_Minh')::date)+1,s.effective_from)) into first_day from public.ops_runs where standard_id=s.id;
  last_day:=least(p_until,coalesce(s.effective_until,p_until));
  if s.frequency='once' then last_day:=least(last_day,s.effective_from); end if;
  select least(last_day,coalesce(min(effective_from)-1,last_day)) into last_day from public.ops_standards
   where family_id=s.family_id and branch_id=s.branch_id and status='approved' and effective_from>s.effective_from;
  if first_day>last_day then continue; end if;
  if last_day-first_day>366 then raise exception 'OPS_CATCHUP_RANGE'; end if;
  created_count:=0;
  for d in select generate_series(first_day,last_day,'1 day')::date loop
   if s.frequency='weekly' and extract(isodow from d)<>s.day_number then continue; end if;
   if s.frequency in ('monthly','quarterly','yearly') and extract(day from d)<>least(s.day_number,extract(day from (date_trunc('month',d)+interval '1 month - 1 day'))) then continue; end if;
   if s.frequency='quarterly' and ((extract(month from d)::integer-1)%3)+1<>s.month_number then continue; end if;
   if s.frequency='yearly' and extract(month from d)<>s.month_number then continue; end if;
   due:=(d+s.due_time) at time zone 'Asia/Ho_Chi_Minh';
   if s.frequency<>'once' and d=s.effective_from and due<coalesce(s.approved_at,s.created_at) then continue; end if;
   key:=case s.frequency when 'once' then 'once' when 'daily' then to_char(d,'YYYY-MM-DD') when 'weekly' then to_char(d,'IYYY-IW') when 'quarterly' then to_char(d,'YYYY-"Q"Q') when 'yearly' then to_char(d,'YYYY') else to_char(d,'YYYY-MM') end;
   insert into public.ops_runs(tenant_id,branch_id,standard_id,family_id,period_key,title,criteria,assignee_id,original_due_at)
   values(s.tenant_id,s.branch_id,s.id,s.family_id,key,s.title,s.criteria,s.assignee_id,due) on conflict do nothing;
   get diagnostics added=row_count; n:=n+added; created_count:=created_count+added;
  end loop;
  if created_count>0 then
   insert into public.ops_schedule_events(tenant_id,branch_id,standard_id,actor_id,title,schedule,generated)
    values(s.tenant_id,s.branch_id,s.id,auth.uid(),s.title,jsonb_build_object('frequency',s.frequency,'day_number',s.day_number,'month_number',s.month_number,'effective_from',s.effective_from,'effective_until',s.effective_until,'due_time',s.due_time,'from',first_day,'until',last_day),created_count);
  end if;
 end loop;
 return n;
end $$;
revoke all on function public.ops_generate_internal(uuid,date) from public,anon,authenticated;

-- Shared library and workspace reads expose a version, so clients never silently
-- send a new recurrence rule to an older database.
do $read_version$
declare item text; definition text; needle text:='return jsonb_build_object(';
begin
 foreach item in array array['public.ops_working_library_read()'] loop
  definition:=pg_get_functiondef(item::regprocedure);
  if strpos(definition,needle)=0 then raise exception 'Library read baseline changed'; end if;
  execute replace(definition,needle,needle||'''recurrenceVersion'',1,');
 end loop;
end $read_version$;

create function public.ops_library_application_log() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data,reason)
 values(new.tenant_id,new.branch_id,new.id,'apply_working_library',auth.uid(),to_jsonb(new)||jsonb_build_object('title',(select title from public.ops_working_libraries where id=new.library_id)),'Áp dụng bộ tiêu chí và lịch cho chi nhánh');
 return new;
end $$;
revoke all on function public.ops_library_application_log() from public,anon,authenticated;
create trigger ops_library_application_audit after insert on public.ops_working_library_applications
 for each row execute function public.ops_library_application_log();

create or replace function public.ops_history(p_branch uuid,p_period text,p_kind text default 'audit',p_cursor_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; start_at timestamptz; end_at timestamptz; items jsonb; tail jsonb;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED' using errcode='42501'; end if;
 if not public.ops_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if coalesce(p_period,'') !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_kind not in ('audit','todos') or (p_cursor_at is null)<>(p_cursor_id is null) then raise exception 'OPS_INVALID_RANGE'; end if;
 start_at:=(p_period||'-01')::timestamp at time zone 'Asia/Ho_Chi_Minh';
 end_at:=((p_period||'-01')::date+interval '1 month') at time zone 'Asia/Ho_Chi_Minh';
 if p_kind='audit' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into items from (
   select * from (
    select a.id,a.action,a.created_at,a.reason,coalesce(a.after_data->>'title',a.before_data->>'title','') title,
     coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz') actor_name,
     case when a.action='configure_schedule' then (select jsonb_object_agg(key,value) from jsonb_each(a.before_data) where key in ('frequency','day_number','month_number','due_time','effective_from','effective_until')) end before_schedule,
     case when a.action='configure_schedule' then (select jsonb_object_agg(key,value) from jsonb_each(a.after_data) where key in ('frequency','day_number','month_number','due_time','effective_from','effective_until')) end after_schedule
    from public.ops_audit a left join public.profiles u on u.id=a.actor_id and u.tenant_id=p.tenant_id
    where a.tenant_id=p.tenant_id and a.branch_id=p_branch and a.created_at>=start_at and a.created_at<end_at
     and (p_cursor_at is null or (a.created_at,a.id)<(p_cursor_at,p_cursor_id))
    union all
    select md5(v.library_id::text||':'||v.version::text)::uuid,
     'working_library:'||case when (v.document->>'archived')::boolean then 'archive'
      when (select (old.document->>'archived')::boolean from public.ops_working_library_versions old where old.library_id=v.library_id and old.version=v.version-1) then 'restore' else 'save' end,
     v.created_at,v.reason,'Bộ tiêu chí chung · '||coalesce(v.document->>'title',''),
     coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz'),null::jsonb,null::jsonb
    from public.ops_working_library_versions v left join public.profiles u on u.id=v.actor_id and u.tenant_id=p.tenant_id
    where v.tenant_id=p.tenant_id and public.ops_ceo() and public.ops_has_permission('ops.configure')
     and v.created_at>=start_at and v.created_at<end_at
     and (p_cursor_at is null or (v.created_at,md5(v.library_id::text||':'||v.version::text)::uuid)<(p_cursor_at,p_cursor_id))
    union all
    select e.id,'generate_schedule',e.created_at,'Đã tạo '||e.generated::text||' công việc',e.title,
     case when e.actor_id is null then 'Hệ thống' else coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz') end,
     null::jsonb,e.schedule
    from public.ops_schedule_events e left join public.profiles u on u.id=e.actor_id and u.tenant_id=p.tenant_id
    where e.tenant_id=p.tenant_id and e.branch_id=p_branch and e.created_at>=start_at and e.created_at<end_at
     and (p_cursor_at is null or (e.created_at,e.id)<(p_cursor_at,p_cursor_id))
   ) combined order by created_at desc,id desc limit 51
  ) x;
 else
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into items from (
   select t.id,t.title,t.state action,t.created_at,null::text reason,coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz') actor_name
   from public.ops_todos t left join public.profiles u on u.id=t.assignee_id and u.tenant_id=p.tenant_id
   where t.tenant_id=p.tenant_id and t.branch_id=p_branch and t.created_at>=start_at and t.created_at<end_at
    and (p_cursor_at is null or (t.created_at,t.id)<(p_cursor_at,p_cursor_id)) order by t.created_at desc,t.id desc limit 51
  ) x;
 end if;
 if jsonb_array_length(items)>50 then tail:=items->49; items:=items-50; end if;
 return jsonb_build_object('rows',items,'next',case when tail is not null then jsonb_build_object('at',tail->>'created_at','id',tail->>'id') else null end);
end $$;
revoke all on function public.ops_history(uuid,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.ops_history(uuid,text,text,timestamptz,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
