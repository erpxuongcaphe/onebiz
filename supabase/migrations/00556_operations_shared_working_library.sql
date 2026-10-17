-- Shared definitions only. No seed, rewrite, grant or business-data cleanup.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- A library has its own stable work-code namespace. Legacy imports keep WS-0001.
-- Replace only this expression; abort if the existing Hub function has changed.
do $namespace$
declare definition text; old text:=$old$v_code:='WS-'||lpad(row->>'number',4,'0');$old$;
begin
 select pg_get_functiondef('public.ops_workbook_import(uuid,jsonb,boolean)'::regprocedure) into definition;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.ops_workbook_import(uuid,jsonb,boolean)'::regprocedure) is distinct from '8fe5f36e82e11052075bae89874fb673' then raise exception 'Hub workbook baseline changed; abort release'; end if;
 if strpos(definition,old)=0 then raise exception 'Hub workbook namespace baseline changed; abort release'; end if;
 execute replace(definition,old,$new$v_code:='WS-'||case when p_body->>'libraryKey' is not null then replace((p_body->>'libraryKey')::uuid::text,'-','')||'-' else '' end||lpad(row->>'number',4,'0');$new$);
end $namespace$;

create table public.ops_working_libraries (
 id uuid primary key, tenant_id uuid not null references public.tenants,
 title text not null check(length(trim(title)) between 1 and 200), version integer not null default 1 check(version>0),
 rows jsonb not null check(jsonb_typeof(rows)='array' and jsonb_array_length(rows) between 1 and 200),
 notes text not null default '' check(length(notes)<=10000), source_key text check(source_key='ceo-working-20261014'),
 archived boolean not null default false, created_by uuid not null references public.profiles,
 updated_by uuid not null references public.profiles, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,source_key)
);
create table public.ops_working_library_versions (
 library_id uuid not null references public.ops_working_libraries, tenant_id uuid not null references public.tenants,
 version integer not null, document jsonb not null, reason text not null,
 actor_id uuid not null references public.profiles, created_at timestamptz not null default now(), primary key(library_id,version)
);
create table public.ops_working_library_applications (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 library_id uuid not null references public.ops_working_libraries, library_version integer not null,
 branch_id uuid not null references public.branches, batch_id uuid not null references public.ops_workbook_batches,
 settings jsonb not null, created_by uuid not null references public.profiles, created_at timestamptz not null default now(),
 unique(tenant_id,library_id,branch_id), foreign key(library_id,library_version) references public.ops_working_library_versions(library_id,version)
);
create index ops_working_library_scope on public.ops_working_libraries(tenant_id,updated_at desc);
create index ops_working_application_scope on public.ops_working_library_applications(tenant_id,library_id);
alter table public.ops_working_libraries enable row level security;
alter table public.ops_working_library_versions enable row level security;
alter table public.ops_working_library_applications enable row level security;
revoke all on public.ops_working_libraries,public.ops_working_library_versions,public.ops_working_library_applications from public,anon,authenticated;
grant select on public.ops_working_libraries,public.ops_working_library_versions,public.ops_working_library_applications to authenticated;
create policy library_owner_read on public.ops_working_libraries for select to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.ops_ceo() and public.ops_has_permission('ops.configure'));
create policy library_version_owner_read on public.ops_working_library_versions for select to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.ops_ceo() and public.ops_has_permission('ops.configure'));
create policy library_application_owner_read on public.ops_working_library_applications for select to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.ops_ceo() and public.ops_has_permission('ops.configure'));

create function public.ops_working_library_check(p_rows jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare r jsonb;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then raise exception 'OPS_INVALID_CRITERIA'; end if;
 if jsonb_array_length(p_rows)<>(select count(distinct value->>'number') from jsonb_array_elements(p_rows)) then raise exception 'OPS_INVALID_CRITERIA'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r->'number') is distinct from 'number' or jsonb_typeof(r->'points') is distinct from 'number'
   or (r->>'number')::numeric<>trunc((r->>'number')::numeric) or (r->>'number')::numeric not between 1 and 9999
   or jsonb_typeof(r->'group') is distinct from 'string' or length(trim(r->>'group')) not between 1 and 120
   or jsonb_typeof(r->'title') is distinct from 'string' or length(trim(r->>'title')) not between 1 and 200
   or jsonb_typeof(r->'requirement') is distinct from 'string' or length(trim(r->>'requirement')) not between 1 and 300
   or r->>'scope' is distinct from 'Chung' or coalesce(r->>'frequency','') not in ('daily','weekly')
   or (r->>'points')::numeric=0 or abs((r->>'points')::numeric)>1000 or round((r->>'points')::numeric,2)<>(r->>'points')::numeric
   or jsonb_typeof(r->'critical') is distinct from 'boolean' or jsonb_typeof(r->'accountingRequired') is distinct from 'boolean' then raise exception 'OPS_INVALID_CRITERIA'; end if;
 end loop;
end $$;
revoke all on function public.ops_working_library_check(jsonb) from public,anon,authenticated;

create function public.ops_working_library_read() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object(
  'libraries',coalesce((select jsonb_agg(to_jsonb(l) order by l.updated_at desc) from public.ops_working_libraries l where l.tenant_id=public.get_user_tenant_id()),'[]'),
  'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.ops_working_library_applications a where a.tenant_id=public.get_user_tenant_id()),'[]'));
end $$;
revoke all on function public.ops_working_library_read() from public,anon,authenticated;
grant execute on function public.ops_working_library_read() to authenticated;

create function public.ops_working_library_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id(); lib public.ops_working_libraries; cached public.ops_requests;
 result jsonb; assignment jsonb; batch jsonb; bid uuid; appid uuid; manifest jsonb:='[]'; body jsonb;
begin
 if tenant is null or not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_request_id is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' or p_action not in ('save','archive','restore','apply') then raise exception 'OPS_INVALID_RESULT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||'ops-working-library',0));
 select * into cached from public.ops_requests where tenant_id=tenant and user_id=auth.uid() and request_id=p_request_id;
 if found then
  if cached.request_body is distinct from jsonb_build_object('action','working_library:'||p_action,'payload',p_payload) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return cached.response;
 end if;
 if nullif(p_payload->>'id','') is not null then
  select * into lib from public.ops_working_libraries where id=(p_payload->>'id')::uuid and tenant_id=tenant for update;
  if lib.id is null or (lib.archived and p_action<>'restore') or (not lib.archived and p_action='restore') or lib.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_LIBRARY_STALE'; end if;
 elsif p_action<>'save' or p_payload->>'version' is not null then raise exception 'OPS_LIBRARY_STALE'; end if;
 if p_action in ('save','archive','restore') then
  if length(trim(coalesce(p_payload->>'reason',''))) not between 5 and 1000 then raise exception 'OPS_REASON_REQUIRED'; end if;
  if p_action='save' then
   perform public.ops_working_library_check(p_payload->'rows');
   if length(trim(coalesce(p_payload->>'title',''))) not between 1 and 200 or jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes')>10000
    or p_payload->>'sourceKey' is not null and p_payload->>'sourceKey'<>'ceo-working-20261014' then raise exception 'OPS_INVALID_CRITERIA'; end if;
   if lib.id is null then
    if p_payload->>'sourceKey' is not null and exists(select 1 from public.ops_working_libraries where tenant_id=tenant and source_key=p_payload->>'sourceKey') then raise exception 'OPS_LIBRARY_EXISTS'; end if;
    insert into public.ops_working_libraries(id,tenant_id,title,rows,notes,source_key,created_by,updated_by)
     values(p_request_id,tenant,trim(p_payload->>'title'),p_payload->'rows',p_payload->>'notes',p_payload->>'sourceKey',auth.uid(),auth.uid()) returning * into lib;
   else
    if lib.source_key is distinct from p_payload->>'sourceKey' then raise exception 'OPS_INVALID_CRITERIA'; end if;
    update public.ops_working_libraries set title=trim(p_payload->>'title'),rows=p_payload->'rows',notes=p_payload->>'notes',version=version+1,updated_by=auth.uid(),updated_at=now()
     where id=lib.id returning * into lib;
   end if;
  else
   update public.ops_working_libraries set archived=(p_action='archive'),version=version+1,updated_by=auth.uid(),updated_at=now() where id=lib.id returning * into lib;
  end if;
  insert into public.ops_working_library_versions(library_id,tenant_id,version,document,reason,actor_id)
   values(lib.id,tenant,lib.version,to_jsonb(lib),trim(p_payload->>'reason'),auth.uid());
  result:=to_jsonb(lib);
 else
  if jsonb_typeof(p_payload->'assignments') is distinct from 'array' or jsonb_array_length(p_payload->'assignments') not between 1 and 20
   or jsonb_array_length(p_payload->'assignments')<>(select count(distinct a->>'branchId') from jsonb_array_elements(p_payload->'assignments') a) then raise exception 'OPS_INVALID_SCHEDULE'; end if;
  -- Existing branch applications are never silently replaced by common edits.
  for assignment in select value from jsonb_array_elements(p_payload->'assignments') loop
   bid:=(assignment->>'branchId')::uuid;
   if not public.ops_can(bid,'approve_policy') or not public.ops_q_can(bid,'manage') then raise exception 'OPS_FORBIDDEN'; end if;
   if not public.ops_person_eligible(bid,(assignment->>'assigneeId')::uuid,'manager') then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
   if exists(select 1 from public.ops_working_library_applications where tenant_id=tenant and library_id=lib.id and branch_id=bid) then raise exception 'OPS_LIBRARY_APPLIED'; end if;
   body:=jsonb_build_object('libraryKey',lib.id,'rows',lib.rows,'assignments',jsonb_build_array(jsonb_build_object('branchId',bid,'assigneeId',assignment->>'assigneeId')),
    'effectiveFrom',assignment->>'effectiveFrom','dueTime',assignment->>'dueTime','weeklyDay',assignment->'weeklyDay');
   appid:=gen_random_uuid(); batch:=public.ops_workbook_import(appid,body,false);
   batch:=public.ops_workbook_import(appid,null,true);
   insert into public.ops_working_library_applications(tenant_id,library_id,library_version,branch_id,batch_id,settings,created_by)
    values(tenant,lib.id,lib.version,bid,appid,assignment,auth.uid());
   manifest:=manifest||jsonb_build_array(jsonb_build_object('branchId',bid,'batchId',appid,'count',jsonb_array_length(lib.rows)));
  end loop;
  result:=jsonb_build_object('libraryId',lib.id,'version',lib.version,'applications',manifest);
 end if;
 insert into public.ops_requests(tenant_id,user_id,request_id,request_body,response)
  values(tenant,auth.uid(),p_request_id,jsonb_build_object('action','working_library:'||p_action,'payload',p_payload),result);
 return result;
end $$;
revoke all on function public.ops_working_library_execute(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_working_library_execute(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
