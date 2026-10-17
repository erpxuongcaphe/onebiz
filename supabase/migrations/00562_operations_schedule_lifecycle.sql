-- REVIEW REQUIRED. Hub only; no seed, historical recomputation or ERP writes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$ begin
 if not exists(select 1 from pg_attribute where attrelid='public.ops_standards'::regclass and attname='effective_until' and not attisdropped)
 or to_regprocedure('public.ops_schedule_check(jsonb,boolean)') is null then
  raise exception 'Hub recurrence migration required; abort release';
 end if;
end $$;

do $baseline$
declare item record;
begin
 for item in select * from (values
  ('public.ops_evidence_reserve(text,uuid,text,text,bigint)','5cdd919c031086db7726b2e5a6c48ace'),
  ('public.ops_execute(text,jsonb,uuid)','9968cae6eead5105411bb5ca45a935ab'),
  ('public.ops_execute_core(text,jsonb,uuid)','41e0a6134ebebca61d7b8f3cee06080e'),
  ('public.ops_filtered_page(text,uuid,text,boolean,jsonb,timestamptz,uuid)','7a03e62a89bd58a950a1f482225ef00c'),
  ('public.ops_generate_internal(uuid,date)','1eca9ffcaee4da05f28705cdc04d87a9'),
  ('public.ops_history(uuid,text,text,timestamptz,uuid)','b7106f6821798a62eff1d69a874ece72'),
  ('public.ops_measurements_for(uuid,text,text)','176569a7e394e1f03e94fa4809f90d78'),
  ('public.ops_quality_execute(text,jsonb,uuid)','9c4902111487596ed1b7d298db464076'),
  ('public.ops_quality_read(uuid,text,text,jsonb)','cd211d4268a565c47bf0a04adeb52ac6'),
  ('public.ops_quality_read_before_complete(uuid,text,text,jsonb)','9b57dbd5de4c9e1f4c0bcccf9d4ba13c'),
  ('public.ops_quality_read_core(uuid,text,text,jsonb)','aa4bf5d7de0e8913889b5c034b7549ac'),
  ('public.ops_reward_snapshot(uuid,timestamptz,timestamptz,jsonb,bigint,bigint)','b16057cc09eef01ae265bee7f2f916d9'),
  ('public.ops_tick()','adc9f7c3a5dd1911dfd690106ac7d353'),
  ('public.ops_workspace(uuid,text)','0ef0fc2e26f1924547018796a01c89de')
 ) v(signature,checksum) loop
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from item.checksum then
   raise exception 'Hub lifecycle baseline changed: %; abort release',item.signature;
  end if;
 end loop;
end $baseline$;

alter table public.ops_standards add column stop_after date;
alter table public.ops_runs add column schedule_canceled_at timestamptz;
alter table public.ops_runs add column schedule_cancel_reason text;
alter table public.ops_runs add column current_due_at timestamptz;
alter table public.ops_runs add constraint ops_run_cancellation_reason
 check((schedule_canceled_at is null and schedule_cancel_reason is null) or
       (schedule_canceled_at is not null and length(trim(schedule_cancel_reason))>=5));
alter table public.ops_runs drop constraint ops_runs_tenant_id_branch_id_family_id_period_key_key;
create unique index ops_runs_active_period on public.ops_runs(tenant_id,branch_id,family_id,period_key) where schedule_canceled_at is null;

-- Internal read projection. Canceled empty future tasks stay in the ledger/audit,
-- but cannot inflate pending-work, compliance or reward denominators.
create view public.ops_active_runs with(security_invoker=true) as
 select * from public.ops_runs where schedule_canceled_at is null;
revoke all on public.ops_active_runs from public,anon,authenticated;

create function public.ops_run_schedule_protected(p_run uuid,p_allow_past boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ops_runs r where r.id=p_run and (
  r.state<>'pending' or r.quality<>'unknown' or r.observations<>'[]'::jsonb or r.met_at is not null
  or r.verified_at is not null or r.had_failure or r.critical_failure
  or exists(select 1 from public.ops_q_checks where run_id=r.id)
  or exists(select 1 from public.ops_measurements where run_id=r.id)
  or exists(select 1 from public.ops_evidence where entity_id=r.id)
  or exists(select 1 from public.ops_todos where run_id=r.id)
  or exists(select 1 from public.ops_todo_links where run_id=r.id)
  or exists(select 1 from public.ops_periods where branch_id=r.branch_id and period=to_char(r.original_due_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM'))
  or (not p_allow_past and r.original_due_at<=now())
 ));
$$;
revoke all on function public.ops_run_schedule_protected(uuid,boolean) from public,anon,authenticated;

create function public.ops_schedule_impact(p_standard uuid,p_from date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.ops_standards; empty_rows jsonb; kept_rows jsonb; version_token text; n integer;
begin
 select * into s from public.ops_standards where id=p_standard and tenant_id=public.get_user_tenant_id();
 if s.id is null or not public.ops_ceo() or not public.ops_can(s.branch_id,'approve_policy') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_from is null or p_from<(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'OPS_PAST_EFFECTIVE'; end if;
 with affected as (
  select r.*,public.ops_run_schedule_protected(r.id) protected
  from public.ops_runs r where r.tenant_id=s.tenant_id and r.branch_id=s.branch_id and r.family_id=s.family_id
   and r.schedule_canceled_at is null and ((s.frequency='once' and r.period_key='once') or (r.original_due_at at time zone 'Asia/Ho_Chi_Minh')::date>=p_from)
 ), rows as (
  select id,protected,jsonb_build_object('id',id,'title',title,'due',coalesce(current_due_at,original_due_at)) data from affected
 ) select coalesce(jsonb_agg(data order by id) filter(where not protected),'[]'),
  coalesce(jsonb_agg(data order by id) filter(where protected),'[]'),count(*) into empty_rows,kept_rows,n from rows;
 select md5(coalesce(string_agg(to_jsonb(r)::text,',' order by r.id),'')||
  coalesce((select string_agg(to_jsonb(x)::text,',' order by revision) from public.ops_standards x where x.family_id=s.family_id and x.branch_id=s.branch_id),'')||
  empty_rows::text||kept_rows::text||p_from::text) into version_token
 from public.ops_runs r where r.tenant_id=s.tenant_id and r.branch_id=s.branch_id and r.family_id=s.family_id;
 return jsonb_build_object('token',version_token,'replaceable',empty_rows,'protected',kept_rows,'count',n,
  'previousSchedule',(select to_jsonb(old) from public.ops_standards old where old.branch_id=s.branch_id and old.family_id=s.family_id and old.status='approved' and old.revision<=s.revision order by old.revision desc limit 1));
end $$;
revoke all on function public.ops_schedule_impact(uuid,date) from public,anon,authenticated;
grant execute on function public.ops_schedule_impact(uuid,date) to authenticated;

-- Read functions only: never redirect writes, evidence ownership or history.
do $reads$
declare f record; definition text;
begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and
  (proname in ('ops_workspace','ops_filtered_page','ops_reward_preview','ops_calculate_rewards','ops_reward_snapshot','ops_notify_daily','ops_scheduler_tick','ops_tick','ops_execute_core','ops_measurements_for')
   or proname like 'ops_quality_read%') loop
  definition:=pg_get_functiondef(f.oid);
  if strpos(definition,'from public.ops_runs')>0 then
   execute replace(definition,'from public.ops_runs','from public.ops_active_runs');
  end if;
 end loop;
end $reads$;

-- Work search follows the visible current deadline. KPI/closed-period snapshots
-- still use original_due_at so an extension cannot manufacture on-time results.
do $due_filters$
declare definition text;
begin
 definition:=pg_get_functiondef('public.ops_filtered_page(text,uuid,text,boolean,jsonb,timestamptz,uuid)'::regprocedure);
 if strpos(definition,'r.original_due_at due')=0 then raise exception 'Work filter baseline changed'; end if;
 definition:=replace(definition,'r.original_due_at due','coalesce(r.current_due_at,r.original_due_at) due');
 definition:=replace(definition,'then tail->>''original_due_at''','then coalesce(tail->>''current_due_at'',tail->>''original_due_at'')');
 execute definition;
 definition:=pg_get_functiondef('public.ops_quality_read_core(uuid,text,text,jsonb)'::regprocedure);
 if strpos(definition,'else r.original_due_at end')=0 then raise exception 'Quality work filter baseline changed'; end if;
 definition:=replace(definition,'else r.original_due_at end','else coalesce(r.current_due_at,r.original_due_at) end');
 definition:=replace(definition,'to_char(r.original_due_at at time zone ''Asia/Ho_Chi_Minh'',''YYYY-MM'')=p_period','to_char(coalesce(r.current_due_at,r.original_due_at) at time zone ''Asia/Ho_Chi_Minh'',''YYYY-MM'')=p_period');
 execute definition;
end $due_filters$;

-- Keep generation, preview, approvals and checks on the same branch lock.
do $generator$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.ops_generate_internal(uuid,date)'::regprocedure);
 needle:='last_day:=least(p_until,coalesce(s.effective_until,p_until));';
 if strpos(definition,needle)=0 then raise exception 'Schedule generator baseline changed'; end if;
 definition:=replace(definition,needle,'last_day:=least(p_until,coalesce(s.effective_until,p_until),coalesce(s.stop_after,p_until));');
 definition:=replace(definition,'from public.ops_runs where standard_id=s.id','from public.ops_runs where standard_id=s.id and schedule_canceled_at is null');
 needle:='last_day:=least(p_until,coalesce(s.effective_until,p_until),coalesce(s.stop_after,p_until));';
 definition:=replace(definition,needle,E'if s.frequency=''once'' and exists(select 1 from public.ops_standards newer where newer.family_id=s.family_id and newer.branch_id=s.branch_id and newer.status=''approved'' and newer.revision>s.revision) then continue; end if;\n  '||needle);
 -- A preserved task already represents its original date, even if cadence changes.
 needle:='due:=(d+s.due_time) at time zone ''Asia/Ho_Chi_Minh'';';
 definition:=replace(definition,needle,needle||E'\n   if exists(select 1 from public.ops_runs r where r.branch_id=s.branch_id and r.family_id=s.family_id and r.schedule_canceled_at is null and (r.original_due_at at time zone ''Asia/Ho_Chi_Minh'')::date=d) then continue; end if;');
 execute definition;
end $generator$;

alter function public.ops_execute(text,jsonb,uuid) rename to ops_execute_before_lifecycle;
revoke all on function public.ops_execute_before_lifecycle(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.ops_standards; old public.ops_standards; r public.ops_runs; before_row jsonb;
 b uuid:=(p_payload->>'branchId')::uuid; result jsonb; impact jsonb; from_day date;
 cached public.ops_requests; affected uuid[]; reason text:=trim(coalesce(p_payload->>'reason',''));
begin
 if not public.ops_can(b,'view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_action='retire_standard' then raise exception 'OPS_SCHEDULE_REVIEW_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||'ops-generate',0));
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'OPS_INVALID_RESULT'; end if;
 select * into cached from public.ops_requests where tenant_id=public.get_user_tenant_id() and user_id=auth.uid() and request_id=p_request_id;
 if found then
  if cached.request_body<>jsonb_build_object('action',p_action,'payload',p_payload) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return cached.response;
 end if;
 if p_action in ('result','verify','transfer','move_run') then
  select * into r from public.ops_runs where id=coalesce((p_payload->>'id')::uuid,(p_payload->>'runId')::uuid) and tenant_id=public.get_user_tenant_id() and branch_id=b for update;
  if r.id is null or r.schedule_canceled_at is not null then raise exception 'OPS_SCHEDULE_CANCELED'; end if;
 end if;
 if p_action='move_run' then
  if not public.ops_ceo() or not public.ops_can(b,'approve_policy') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if r.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
  if public.ops_run_schedule_protected(r.id,true) then raise exception 'OPS_SCHEDULE_PROTECTED'; end if;
  if length(reason) not between 5 and 1000 or nullif(p_payload->>'dueAt','') is null or (p_payload->>'dueAt')::timestamptz<=now() then raise exception 'OPS_INVALID_SCHEDULE'; end if;
  before_row:=to_jsonb(r);
  update public.ops_runs set current_due_at=(p_payload->>'dueAt')::timestamptz,version=version+1 where id=r.id returning to_jsonb(ops_runs.*) into result;
  insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
   values(r.tenant_id,b,r.id,p_action,auth.uid(),before_row,result,reason);
 elsif p_action='end_schedule' or p_action='approve_standard' then
  select * into s from public.ops_standards where id=(p_payload->>'id')::uuid and tenant_id=public.get_user_tenant_id() and branch_id=b for update;
  if s.id is null then raise exception 'OPS_INVALID_STATE'; end if;
  if p_action='approve_standard' and s.revision=1 then return public.ops_execute_before_lifecycle(p_action,p_payload,p_request_id); end if;
  if not public.ops_ceo() or not public.ops_can(b,'approve_policy') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if p_action='end_schedule' then
   if s.status<>'approved' or s.frequency in ('once','event') then raise exception 'OPS_INVALID_STATE'; end if;
   from_day:=(p_payload->>'lastDate')::date+1;
   if from_day is null or from_day<=(now() at time zone 'Asia/Ho_Chi_Minh')::date or length(reason) not between 5 and 1000 then raise exception 'OPS_INVALID_SCHEDULE'; end if;
  else
   if s.status not in ('draft','pending') then raise exception 'OPS_INVALID_STATE'; end if;
   from_day:=s.effective_from;
   if exists(select 1 from public.ops_standards x where x.family_id=s.family_id and x.branch_id=b and x.revision>s.revision and x.status='approved') then raise exception 'OPS_STALE'; end if;
  end if;
  impact:=public.ops_schedule_impact(s.id,from_day);
  if coalesce(p_payload->>'impactToken','')<>impact->>'token' then raise exception 'OPS_SCHEDULE_REVIEW_REQUIRED'; end if;
  if coalesce(p_payload->>'futurePolicy','') not in ('replace_empty','keep') then raise exception 'OPS_SCHEDULE_REVIEW_REQUIRED'; end if;
  if p_action='approve_standard' and s.frequency='once' and exists(select 1 from public.ops_runs existing_run where existing_run.family_id=s.family_id and existing_run.branch_id=b and existing_run.period_key='once' and existing_run.schedule_canceled_at is null
    and (public.ops_run_schedule_protected(existing_run.id) or p_payload->>'futurePolicy'='keep')) then raise exception 'OPS_ONEOFF_MOVE_REQUIRED'; end if;
  if p_payload->>'futurePolicy'='replace_empty' then
   select array_agg((x->>'id')::uuid) into affected from jsonb_array_elements(impact->'replaceable') x;
   update public.ops_runs set schedule_canceled_at=now(),schedule_cancel_reason=coalesce(nullif(reason,''),'Thay lịch đã được duyệt'),version=version+1 where id=any(affected);
  end if;
  before_row:=to_jsonb(s);
  if p_action='end_schedule' then
   update public.ops_standards set stop_after=from_day-1 where family_id=s.family_id and branch_id=b and tenant_id=s.tenant_id;
   result:=to_jsonb(s)||jsonb_build_object('stop_after',from_day-1,'impact',impact,'futurePolicy',p_payload->>'futurePolicy');
   insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
    values(s.tenant_id,b,s.id,p_action,auth.uid(),before_row,result,reason);
  else
   -- Same-day revisions supersede configuration, never the original results.
   for old in select * from public.ops_standards where family_id=s.family_id and branch_id=b and status='approved' and effective_from=s.effective_from for update loop
    update public.ops_standards set status='retired' where id=old.id;
    insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
     values(s.tenant_id,b,old.id,'replace_schedule',auth.uid(),to_jsonb(old),jsonb_build_object('replacement',s.id),coalesce(nullif(reason,''),'Duyệt lịch thay thế cùng ngày'));
   end loop;
   result:=public.ops_execute_before_lifecycle(p_action,p_payload,p_request_id);
   perform public.ops_generate_internal(b,least((now() at time zone 'Asia/Ho_Chi_Minh')::date+31,
    greatest((now() at time zone 'Asia/Ho_Chi_Minh')::date,s.effective_from,
     coalesce((select max((original_due_at at time zone 'Asia/Ho_Chi_Minh')::date) from public.ops_runs where id=any(affected)),s.effective_from))));
   insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
    values(s.tenant_id,b,s.id,'apply_schedule_change',auth.uid(),impact->'previousSchedule',result||jsonb_build_object('impact',impact,'futurePolicy',p_payload->>'futurePolicy'),coalesce(nullif(reason,''),'Duyệt thay đổi lịch'));
   return result;
  end if;
 else
  return public.ops_execute_before_lifecycle(p_action,p_payload,p_request_id);
 end if;
 insert into public.ops_requests values(public.get_user_tenant_id(),auth.uid(),p_request_id,jsonb_build_object('action',p_action,'payload',p_payload),result);
 return result;
end $$;
revoke all on function public.ops_execute(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_execute(text,jsonb,uuid) to authenticated;

alter function public.ops_quality_execute(text,jsonb,uuid) rename to ops_quality_execute_before_lifecycle;
revoke all on function public.ops_quality_execute_before_lifecycle(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_quality_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_action='check' then
  perform pg_advisory_xact_lock(hashtextextended((p_payload->>'branchId')||'ops-generate',0));
  if not public.ops_can((p_payload->>'branchId')::uuid,'view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from public.ops_runs where id=(p_payload->>'id')::uuid and tenant_id=public.get_user_tenant_id() and branch_id=(p_payload->>'branchId')::uuid and schedule_canceled_at is not null) then raise exception 'OPS_SCHEDULE_CANCELED'; end if;
 end if;
 return public.ops_quality_execute_before_lifecycle(p_action,p_payload,p_request_id);
end $$;
revoke all on function public.ops_quality_execute(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_quality_execute(text,jsonb,uuid) to authenticated;

-- Reserving an attachment and changing its schedule cannot race each other.
alter function public.ops_evidence_reserve(text,uuid,text,text,bigint) rename to ops_evidence_reserve_before_lifecycle;
revoke all on function public.ops_evidence_reserve_before_lifecycle(text,uuid,text,text,bigint) from public,anon,authenticated;
create function public.ops_evidence_reserve(p_kind text,p_entity uuid,p_name text,p_mime text,p_size bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid; canceled timestamptz;
begin
 if p_kind='run' then
  select branch_id into b from public.ops_runs where id=p_entity and tenant_id=public.get_user_tenant_id();
  if b is null or not public.ops_can(b,'view') then raise exception 'OPS_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(b::text||'ops-generate',0));
  select schedule_canceled_at into canceled from public.ops_runs where id=p_entity for update;
  if canceled is not null then raise exception 'OPS_SCHEDULE_CANCELED'; end if;
 end if;
 return public.ops_evidence_reserve_before_lifecycle(p_kind,p_entity,p_name,p_mime,p_size);
end $$;
revoke all on function public.ops_evidence_reserve(text,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.ops_evidence_reserve(text,uuid,text,text,bigint) to authenticated;

do $history$
declare definition text;
begin
 definition:=pg_get_functiondef('public.ops_history(uuid,text,text,timestamptz,uuid)'::regprocedure);
 if strpos(definition,'a.action=''configure_schedule''')=0 then raise exception 'Schedule history baseline changed'; end if;
 definition:=replace(definition,'a.action=''configure_schedule''','a.action in (''configure_schedule'',''apply_schedule_change'',''end_schedule'',''move_run'')');
 definition:=replace(definition,'''effective_until''))','''effective_until'',''stop_after'',''original_due_at'',''current_due_at''))');
 execute definition;
end $history$;

notify pgrst,'reload schema';
commit;
