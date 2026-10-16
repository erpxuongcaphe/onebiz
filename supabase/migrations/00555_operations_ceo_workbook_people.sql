-- CEO workbook and branch-scoped people. Apply once after baseline preflight.
-- No delete/seed/rebuild of real business data. All business changes are explicit RPC calls.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $baseline$
begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.ops_execute(text,jsonb,uuid)'::regprocedure) is distinct from '757d991182bc36b33ebf992ca1888b59'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.ops_quality_execute(text,jsonb,uuid)'::regprocedure) is distinct from '2e91a063b3ebb9475561af927e285384'
 then raise exception 'Hub workbook baseline changed; abort release'; end if;
end $baseline$;

create function public.ops_person_eligible(b uuid,u uuid,purpose text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.branches br on br.tenant_id=p.tenant_id
 where p.id=u and p.is_active and br.id=b and br.is_active and p.tenant_id=public.get_user_tenant_id()
 and public.user_has_permission(u,'ops.view') and case purpose
 when 'manager' then public.ops_manager(b,u)
 when 'participant' then public.user_has_permission(u,'ops.work') and (
  exists(select 1 from public.ops_members m where m.branch_id=b and m.user_id=u and m.tenant_id=p.tenant_id and m.active)
  or exists(select 1 from public.ops_q_departments d where d.branch_id=b and d.tenant_id=p.tenant_id and d.active and u=any(d.members)))
 when 'membership' then exists(select 1 from public.user_branches ub where ub.branch_id=b and ub.user_id=u)
  or exists(select 1 from public.ops_members m where m.branch_id=b and m.user_id=u and m.tenant_id=p.tenant_id)
 when 'department' then public.user_has_permission(u,'ops.work')
 when 'qc_grant' then u<>auth.uid() and (public.user_has_permission(u,'ops.verify') or public.user_has_permission(u,'ops.work'))
  and (exists(select 1 from public.user_branches ub where ub.branch_id=b and ub.user_id=u)
    or exists(select 1 from public.ops_q_grants g where g.branch_id=b and g.user_id=u and g.tenant_id=p.tenant_id))
 else false end);
$$;
revoke all on function public.ops_person_eligible(uuid,uuid,text) from public,anon,authenticated;

create function public.ops_eligible_people(p_branch uuid,p_purpose text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ops_can(p_branch,'view') or p_purpose not in ('manager','participant','membership','qc_grant','department')
  or p_purpose='membership' and not public.ops_can(p_branch,'manage_members')
  or p_purpose='department' and not public.ops_q_can(p_branch,'manage')
  or p_purpose='qc_grant' and not public.ops_ceo() then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.full_name,''),p.email,'Tài khoản OneBiz')||case when (select count(*) from public.profiles same where same.tenant_id=p.tenant_id and same.is_active and same.full_name=p.full_name)>1 then ' · '||coalesce(p.email,'Liên hệ quản trị để phân biệt tài khoản') else '' end) order by p.full_name,p.id),'[]')
 into result from public.profiles p where public.ops_person_eligible(p_branch,p.id,p_purpose);
 return result;
end $$;
revoke all on function public.ops_eligible_people(uuid,text) from public,anon,authenticated;
grant execute on function public.ops_eligible_people(uuid,text) to authenticated;

-- Enforce the same branch scope at the write boundary, even for forged requests.
alter function public.ops_execute(text,jsonb,uuid) rename to ops_execute_before_people;
revoke all on function public.ops_execute_before_people(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid:=(p_payload->>'branchId')::uuid; u uuid; s public.ops_standards; old public.ops_standards; result jsonb; cached public.ops_requests;
begin
 if p_action='approve_standard' and exists(select 1 from public.ops_workbook_batches batch,jsonb_array_elements(batch.manifest) e
  where batch.tenant_id=public.get_user_tenant_id() and batch.state='draft' and e->>'standardId'=p_payload->>'id' and e->>'branchId'=b::text) then raise exception 'OPS_WORKBOOK_APPROVAL_REQUIRED'; end if;
 if p_action in ('retire_standard','discard_standard') then
  if not public.ops_ceo() or not public.ops_can(b,'approve_policy') then raise exception 'OPS_FORBIDDEN'; end if;
  if length(trim(coalesce(p_payload->>'reason','')))<5 then raise exception 'OPS_REASON_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(public.get_user_tenant_id()::text||b::text,0));
  select * into cached from public.ops_requests where tenant_id=public.get_user_tenant_id() and user_id=auth.uid() and request_id=p_request_id;
  if found then
   if cached.request_body<>jsonb_build_object('action',p_action,'payload',p_payload) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
   return cached.response;
  end if;
  select * into s from public.ops_standards where id=(p_payload->>'id')::uuid and branch_id=b and tenant_id=public.get_user_tenant_id() for update;
  if s.id is null then raise exception 'OPS_INVALID_STATE'; end if;
  if p_action='retire_standard' and s.status<>'approved' then raise exception 'OPS_INVALID_STATE'; end if;
  if p_action='discard_standard' then
   if s.status<>'draft' or exists(select 1 from public.ops_runs where standard_id=s.id)
    or exists(select 1 from public.ops_q_catalog where standard_id=s.id)
    or exists(select 1 from public.ops_workbook_batches batch,jsonb_array_elements(batch.manifest) e where batch.tenant_id=s.tenant_id and batch.state<>'discarded' and e->>'standardId'=s.id::text) then raise exception 'OPS_INVALID_STATE'; end if;
   delete from public.ops_standards where id=s.id;
   result:=jsonb_build_object('id',s.id,'discarded',true);
   insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
    values(s.tenant_id,b,s.id,p_action,auth.uid(),to_jsonb(s),result,p_payload->>'reason');
  else
   for old in select * from public.ops_standards where tenant_id=s.tenant_id and branch_id=b and family_id=s.family_id and status='approved' for update loop
    update public.ops_standards set status='retired' where id=old.id;
    insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
     values(s.tenant_id,b,old.id,p_action,auth.uid(),to_jsonb(old),to_jsonb(old)||jsonb_build_object('status','retired'),p_payload->>'reason');
   end loop;
   result:=jsonb_build_object('id',s.id,'retired',true);
  end if;
  insert into public.ops_requests values(s.tenant_id,auth.uid(),p_request_id,jsonb_build_object('action',p_action,'payload',p_payload),result);
  return result;
 end if;
 if p_action in ('todo','transfer','todo_update') and p_payload ? 'collaborators' then
  for u in select jsonb_array_elements_text(p_payload->'collaborators')::uuid loop
   if not public.ops_person_eligible(b,u,'participant') then raise exception 'OPS_FORBIDDEN'; end if;
  end loop;
 end if;
 if p_action='member' and not public.ops_person_eligible(b,(p_payload->>'userId')::uuid,'membership') then raise exception 'OPS_FORBIDDEN'; end if;
 return public.ops_execute_before_people(p_action,p_payload,p_request_id);
end $$;
revoke all on function public.ops_execute(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_execute(text,jsonb,uuid) to authenticated;

alter function public.ops_quality_execute(text,jsonb,uuid) rename to ops_quality_execute_before_people;
revoke all on function public.ops_quality_execute_before_people(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_quality_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid:=(p_payload->>'branchId')::uuid; u uuid; item jsonb;
begin
 if p_action in ('department','issue','issue_assign') then
  for u in select jsonb_array_elements_text(coalesce(p_payload->case when p_action='department' then 'members' else 'collaborators' end,'[]'))::uuid loop
   -- Department configuration may explicitly authorize an office user across branches.
   if p_action='department' then
    if not exists(select 1 from public.profiles p where p.id=u and p.tenant_id=public.get_user_tenant_id() and p.is_active and public.user_has_permission(u,'ops.view') and public.user_has_permission(u,'ops.work')) then raise exception 'OPS_FORBIDDEN'; end if;
   elsif not public.ops_person_eligible(b,u,'participant') then raise exception 'OPS_FORBIDDEN'; end if;
  end loop;
  if nullif(p_payload->>'operatorId','') is not null and not public.ops_person_eligible(b,(p_payload->>'operatorId')::uuid,'participant') then raise exception 'OPS_FORBIDDEN'; end if;
 end if;
 if p_action in ('check','adhoc','qc_line','qc_correct') then
  for item in select value from jsonb_array_elements(coalesce(p_payload->'issues','[]')) loop
   if item ? 'assigneeId' then
    if not public.ops_manager(b,(item->>'assigneeId')::uuid) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
    for u in select jsonb_array_elements_text(coalesce(item->'collaborators','[]'))::uuid loop
     if not public.ops_person_eligible(b,u,'participant') then raise exception 'OPS_FORBIDDEN'; end if;
    end loop;
   end if;
  end loop;
 end if;
 return public.ops_quality_execute_before_people(p_action,p_payload,p_request_id);
end $$;
revoke all on function public.ops_quality_execute(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_quality_execute(text,jsonb,uuid) to authenticated;

create table public.ops_workbook_batches(
 id uuid primary key,tenant_id uuid not null references public.tenants,created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(),state text not null check(state in ('draft','approved','discarded')),
 request_body jsonb not null,manifest jsonb not null,approved_at timestamptz
);
alter table public.ops_standards add column workbook_batch_id uuid references public.ops_workbook_batches(id) deferrable initially deferred;
alter table public.ops_workbook_batches enable row level security;
revoke all on public.ops_workbook_batches from public,anon,authenticated;
grant select on public.ops_workbook_batches to authenticated;
create policy workbook_owner_read on public.ops_workbook_batches for select to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.ops_ceo());

create function public.ops_workbook_batches_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)-'request_body' order by x.created_at desc),'[]') into result from
  (select * from public.ops_workbook_batches where tenant_id=public.get_user_tenant_id() order by created_at desc limit 20) x;
 return result;
end $$;
revoke all on function public.ops_workbook_batches_read() from public,anon,authenticated;
grant execute on function public.ops_workbook_batches_read() to authenticated;

create function public.ops_workbook_import(p_request_id uuid,p_body jsonb,p_activate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare batch public.ops_workbook_batches; tenant uuid:=public.get_user_tenant_id(); assignment jsonb; row jsonb; entry jsonb;
 manifest jsonb:='[]'; standard jsonb; b uuid; gid uuid; standard_id uuid; family uuid; criteria jsonb; v_code text;
begin
 if tenant is null or not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||'ops-workbook',0));
 select * into batch from public.ops_workbook_batches where id=p_request_id and tenant_id=tenant for update;
 if p_activate then
  if batch.id is null then raise exception 'OPS_INVALID_STATE'; end if;
  if batch.state='approved' then return to_jsonb(batch)-'request_body'; end if;
  for entry in select value from jsonb_array_elements(batch.manifest) loop
   b:=(entry->>'branchId')::uuid; standard_id:=(entry->>'standardId')::uuid; row:=entry->'row';
   if not public.ops_q_can(b,'manage') then raise exception 'OPS_FORBIDDEN'; end if;
   if not exists(select 1 from public.ops_standards s where s.id=standard_id and s.tenant_id=tenant and s.branch_id=b and s.status='draft'
    and s.title=row->>'title' and s.description=row->>'requirement' and s.criteria=entry->'criteria') then raise exception 'OPS_STALE'; end if;
   -- Private prior entry retains existing permission/audit rules without allowing
   -- individual clients to activate half of an imported work/QC pair.
   perform public.ops_execute_before_people('approve_standard',jsonb_build_object('branchId',b,'id',standard_id),gen_random_uuid());
   select id into gid from public.ops_q_groups where tenant_id=tenant and branch_id=b and lower(trim(title))=lower(trim(row->>'group')) and active;
   if gid is null then
    -- Inactive same-name groups require an explicit configuration decision, not automatic reactivation.
    if exists(select 1 from public.ops_q_groups where tenant_id=tenant and branch_id=b and lower(trim(title))=lower(trim(row->>'group'))) then raise exception 'OPS_INVALID_STATE'; end if;
    insert into public.ops_q_groups(tenant_id,branch_id,title,created_by) values(tenant,b,row->>'group',auth.uid()) returning id into gid;
   end if;
   perform public.ops_quality_execute('catalog',jsonb_build_object('branchId',b,'standardId',standard_id,'code',entry->>'code','category','group:'||gid,
    'scoreType',case when (row->>'points')::numeric>0 then 'bonus' else 'deduct' end,'weight',abs((row->>'points')::numeric),
    'effectiveFrom',batch.request_body->>'effectiveFrom','critical',(row->>'critical')::boolean,'accountingRequired',(row->>'accountingRequired')::boolean),gen_random_uuid());
  end loop;
  update public.ops_workbook_batches set state='approved',approved_at=now() where id=batch.id returning * into batch;
  return to_jsonb(batch)-'request_body';
 end if;
 if batch.id is not null then
  if batch.state='discarded' then raise exception 'OPS_INVALID_STATE'; end if;
  if batch.request_body<>p_body then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return to_jsonb(batch)-'request_body';
 end if;
 if jsonb_typeof(p_body->'rows') is distinct from 'array' or jsonb_array_length(p_body->'rows') not between 1 and 200
  or jsonb_typeof(p_body->'assignments') is distinct from 'array' or jsonb_array_length(p_body->'assignments') not between 1 and 100
  or coalesce(p_body->>'effectiveFrom','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (p_body->>'effectiveFrom')::date<(now() at time zone 'Asia/Ho_Chi_Minh')::date
  or coalesce(p_body->>'dueTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or coalesce((p_body->>'weeklyDay')::integer,0) not between 1 and 7 then raise exception 'OPS_INVALID_SCHEDULE'; end if;
 if (select count(*) from jsonb_array_elements(p_body->'rows'))<>(select count(distinct r->>'number') from jsonb_array_elements(p_body->'rows') r)
  or (select count(*) from jsonb_array_elements(p_body->'assignments'))<>(select count(distinct r->>'branchId') from jsonb_array_elements(p_body->'assignments') r) then raise exception 'OPS_INVALID_ASSIGNMENT'; end if;
 for row in select value from jsonb_array_elements(p_body->'rows') loop
  if jsonb_typeof(row->'number') is distinct from 'number' or jsonb_typeof(row->'points') is distinct from 'number'
   or jsonb_typeof(row->'group') is distinct from 'string' or jsonb_typeof(row->'title') is distinct from 'string' or jsonb_typeof(row->'requirement') is distinct from 'string'
   or coalesce(trim(row->>'group'),'')='' or length(row->>'group')>120 or coalesce(trim(row->>'title'),'')='' or length(row->>'title')>200
   or coalesce(trim(row->>'requirement'),'')='' or length(row->>'requirement')>300 or row->>'scope' is distinct from 'Chung'
   or coalesce(row->>'frequency','') not in ('daily','weekly') or (row->>'number')::integer not between 1 and 9999
   or (row->>'points')::numeric=0 or abs((row->>'points')::numeric)>1000 or round((row->>'points')::numeric,2)<>(row->>'points')::numeric
   or jsonb_typeof(row->'critical') is distinct from 'boolean' or jsonb_typeof(row->'accountingRequired') is distinct from 'boolean' then raise exception 'OPS_INVALID_CRITERIA'; end if;
  family:=gen_random_uuid(); v_code:='WS-'||lpad(row->>'number',4,'0');
  criteria:=jsonb_build_array(jsonb_build_object('id',v_code,'title',row->>'requirement','kind','boolean','operator','eq','threshold',1,'samples',1,'critical',(row->>'critical')::boolean,'evidenceRequired',false));
  for assignment in select value from jsonb_array_elements(p_body->'assignments') loop
   b:=(assignment->>'branchId')::uuid;
   if not public.ops_q_can(b,'manage') or not public.ops_manager(b,(assignment->>'assigneeId')::uuid) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
   if exists(select 1 from public.ops_workbook_batches old,jsonb_array_elements(old.manifest) e where old.tenant_id=tenant and old.state<>'discarded' and e->>'branchId'=b::text and e->>'code'=v_code)
    or exists(select 1 from public.ops_q_catalog c where c.tenant_id=tenant and c.branch_id=b and c.code=v_code) then raise exception 'OPS_WORKBOOK_DUPLICATE'; end if;
   standard:=public.ops_execute('standard',jsonb_build_object('branchId',b,'familyId',family,'revision',1,'scope','common','title',row->>'title','description',row->>'requirement',
    'assigneeId',assignment->>'assigneeId','frequency',row->>'frequency','dayNumber',case when row->>'frequency'='weekly' then (p_body->>'weeklyDay')::integer else 1 end,
    'dueTime',p_body->>'dueTime','effectiveFrom',p_body->>'effectiveFrom','criteria',criteria),gen_random_uuid());
   update public.ops_standards set workbook_batch_id=p_request_id where id=(standard->>'id')::uuid;
   manifest:=manifest||jsonb_build_array(jsonb_build_object('branchId',b,'standardId',standard->>'id','row',row,'criteria',criteria,'code',v_code));
  end loop;
 end loop;
 insert into public.ops_workbook_batches values(p_request_id,tenant,auth.uid(),now(),'draft',p_body,manifest,null) returning * into batch;
 return to_jsonb(batch)-'request_body';
end $$;
revoke all on function public.ops_workbook_import(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.ops_workbook_import(uuid,jsonb,boolean) to authenticated;

create function public.ops_workbook_discard(p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare batch public.ops_workbook_batches; entry jsonb; sid uuid; b uuid;
begin
 if not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'OPS_REASON_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(public.get_user_tenant_id()::text||'ops-workbook',0));
 select * into batch from public.ops_workbook_batches where id=p_id and tenant_id=public.get_user_tenant_id() for update;
 if batch.id is null or batch.state<>'draft' then raise exception 'OPS_INVALID_STATE'; end if;
 for entry in select value from jsonb_array_elements(batch.manifest) loop
  sid:=(entry->>'standardId')::uuid; b:=(entry->>'branchId')::uuid;
  if not public.ops_q_can(b,'manage') or not exists(select 1 from public.ops_standards s where s.id=sid and s.branch_id=b and s.tenant_id=batch.tenant_id and s.status='draft')
   or exists(select 1 from public.ops_runs where standard_id=sid) or exists(select 1 from public.ops_q_catalog where standard_id=sid) then raise exception 'OPS_INVALID_STATE'; end if;
 end loop;
 for entry in select value from jsonb_array_elements(batch.manifest) loop
  sid:=(entry->>'standardId')::uuid; b:=(entry->>'branchId')::uuid;
  insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
   select tenant_id,branch_id,id,'discard_workbook_draft',auth.uid(),to_jsonb(s),'{}',p_reason from public.ops_standards s where id=sid;
  delete from public.ops_standards where id=sid;
 end loop;
 update public.ops_workbook_batches set state='discarded' where id=batch.id;
 return jsonb_build_object('id',batch.id,'state','discarded');
end $$;
revoke all on function public.ops_workbook_discard(uuid,text) from public,anon,authenticated;
grant execute on function public.ops_workbook_discard(uuid,text) to authenticated;

-- Retiring a work family excludes it only from NEW QC audits. Existing snapshots
-- and historical run catalog lookups remain unchanged.
do $patch$
declare f record; definition text; old text:='c.effective_from<=(now() at time zone ''Asia/Ho_Chi_Minh'')::date order by c.family_id,c.effective_from desc,c.version desc loop'; replacements integer:=0;
begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'ops_quality_execute%' loop
  definition:=pg_get_functiondef(f.signature);
  if strpos(definition,old)>0 then
   execute replace(definition,old,'c.effective_from<=(now() at time zone ''Asia/Ho_Chi_Minh'')::date and exists(select 1 from public.ops_standards active_standard where active_standard.tenant_id=c.tenant_id and active_standard.branch_id=c.branch_id and active_standard.family_id=c.family_id and active_standard.status=''approved'') order by c.family_id,c.effective_from desc,c.version desc loop');
   replacements:=replacements+1;
  end if;
 end loop;
 if replacements<>1 then raise exception 'QC retirement baseline changed; abort'; end if;
end $patch$;
notify pgrst,'reload schema';
commit;
