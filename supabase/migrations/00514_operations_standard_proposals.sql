-- Add proposal workflow only. No changes to existing business rows or permissions.
-- Release number adjusted to avoid the already-published F&B migrations 00510-00513.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
alter table public.ops_standards add column review_note text;
alter table public.ops_standards drop constraint ops_standards_status_check;
alter table public.ops_standards add constraint ops_standards_status_check
 check(status in ('draft','pending','approved','retired','changes_requested'));

create function public.ops_standard_proposal(p_action text,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; branch uuid; source public.ops_standards; result jsonb; old jsonb;
 family uuid; revision integer; expected integer; assignee uuid; effective date; frequency text;
begin
 select * into p from public.profiles where id=auth.uid() and is_active for update;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED' using errcode='42501'; end if;
 branch:=(p_payload->>'branchId')::uuid;
 if not public.ops_can(branch,'view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_action='propose_standard' then
  if not public.ops_manager(branch,p.id) or not public.ops_can(branch,'work') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 elsif p_action='request_standard_changes' then
  if not public.ops_ceo() then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 else raise exception 'OPS_INVALID_PROPOSAL'; end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'OPS_INVALID_PROPOSAL'; end if;
 select response into result from public.ops_requests where tenant_id=p.tenant_id and user_id=p.id and request_id=p_request_id;
 if found then
  if (select request_body from public.ops_requests where tenant_id=p.tenant_id and user_id=p.id and request_id=p_request_id)
    is distinct from jsonb_build_object('action',p_action,'payload',p_payload) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return result;
 end if;
 if p_action='request_standard_changes' then
  if length(trim(coalesce(p_payload->>'reason',''))) not between 1 and 2000 then raise exception 'OPS_REASON_REQUIRED'; end if;
  select * into source from public.ops_standards where id=(p_payload->>'id')::uuid and tenant_id=p.tenant_id and branch_id=branch for update;
  if source.id is null or source.status<>'pending' then raise exception 'OPS_INVALID_STATE'; end if;
  if source.revision is distinct from (p_payload->>'revision')::integer then raise exception 'OPS_STALE'; end if;
  old:=to_jsonb(source);
  update public.ops_standards set status='changes_requested',review_note=trim(p_payload->>'reason') where id=source.id
   returning to_jsonb(ops_standards.*) into result;
 else
  if coalesce(p_payload->>'scope','branch')<>'branch' or p_payload ? 'assignments' then raise exception 'OPS_PROPOSAL_SCOPE'; end if;
  assignee:=(p_payload->>'assigneeId')::uuid;
  if not public.ops_manager(branch,assignee) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  frequency:=p_payload->>'frequency'; effective:=(p_payload->>'effectiveFrom')::date;
  if length(trim(coalesce(p_payload->>'title',''))) not between 1 and 200
   or length(coalesce(p_payload->>'description',''))>20000
   or frequency is null or frequency not in ('daily','weekly','monthly','event')
   or effective is null or effective<(now() at time zone 'Asia/Ho_Chi_Minh')::date
   or (p_payload->>'dueTime')::time is null
   or (p_payload->>'dayNumber')::integer is null
   or (p_payload->>'dayNumber')::integer not between 1 and (case when frequency='weekly' then 7 else 31 end)
   then raise exception 'OPS_INVALID_PROPOSAL'; end if;
  perform public.ops_check_criteria(p_payload->'criteria');
  if nullif(p_payload->>'sourceId','') is not null then
   select * into source from public.ops_standards where id=(p_payload->>'sourceId')::uuid and tenant_id=p.tenant_id and branch_id=branch;
   if source.id is null or source.scope<>'branch' or not (source.status='approved' or (source.status='changes_requested' and source.created_by=p.id))
    then raise exception 'OPS_PROPOSAL_SCOPE'; end if;
   family:=source.family_id; revision:=source.revision+1;
   perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||family::text,0));
   select max(s.revision)+1 into expected from public.ops_standards s where s.tenant_id=p.tenant_id and s.branch_id=branch and s.family_id=family;
   if expected<>revision then raise exception 'OPS_STALE'; end if;
   old:=to_jsonb(source);
  else
   if p_payload ? 'familyId' or p_payload ? 'revision' or p_payload ? 'id' then raise exception 'OPS_PROPOSAL_SCOPE'; end if;
   family:=gen_random_uuid(); revision:=1;
  end if;
  insert into public.ops_standards(tenant_id,branch_id,family_id,revision,title,description,scope,assignee_id,frequency,day_number,due_time,effective_from,criteria,status,created_by)
   values(p.tenant_id,branch,family,revision,trim(p_payload->>'title'),coalesce(p_payload->>'description',''),'branch',assignee,frequency,
    (p_payload->>'dayNumber')::integer,(p_payload->>'dueTime')::time,effective,p_payload->'criteria','pending',p.id)
   returning to_jsonb(ops_standards.*) into result;
 end if;
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
  values(p.tenant_id,branch,(result->>'id')::uuid,p_action,p.id,old,result,nullif(trim(p_payload->>'reason'),''));
 insert into public.ops_requests(tenant_id,user_id,request_id,request_body,response)
  values(p.tenant_id,p.id,p_request_id,jsonb_build_object('action',p_action,'payload',p_payload),result);
 return result;
end $$;
revoke all on function public.ops_standard_proposal(text,jsonb,uuid) from public,anon,authenticated;

alter function public.ops_execute(text,jsonb,uuid) rename to ops_execute_pre_proposals;
revoke all on function public.ops_execute_pre_proposals(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_execute(p_action text,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_action in ('standard','common_standard','approve_standard') and not public.ops_ceo()
  then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_action in ('propose_standard','request_standard_changes') then
  return public.ops_standard_proposal(p_action,p_payload,p_request_id);
 end if;
 return public.ops_execute_pre_proposals(p_action,p_payload,p_request_id);
end $$;
revoke all on function public.ops_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.ops_execute(text,jsonb,uuid) to authenticated;
commit;
