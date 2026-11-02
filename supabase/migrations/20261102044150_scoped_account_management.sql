-- Organizational account management. Empty initial configuration never grants access.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table public.account_hierarchy_config (
 tenant_id uuid primary key references public.tenants(id),
 version bigint not null default 0,
 document jsonb not null default '{"positions":[],"departments":[],"assignments":[],"globalAdminIds":[]}',
 updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
alter table public.account_hierarchy_config enable row level security;
revoke all on public.account_hierarchy_config from public,anon,authenticated;
create table public.account_hierarchy_history (
 tenant_id uuid not null references public.tenants(id), version bigint not null,
 changed_by uuid not null references public.profiles(id), changed_at timestamptz not null default now(),
 document jsonb not null, primary key(tenant_id,version)
);
alter table public.account_hierarchy_history enable row level security;
revoke all on public.account_hierarchy_history from public,anon,authenticated;

create function public.account_management_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and is_active and role='owner')
$$;
revoke all on function public.account_management_owner() from public,anon;
grant execute on function public.account_management_owner() to authenticated;

create function public._account_descendant(nodes jsonb,child text,ancestor text,direct_only boolean default false)
returns boolean language plpgsql immutable set search_path='' as $$
declare current_id text:=child; parent_id text; seen text[]:='{}';
begin
 for depth in 1..128 loop
  select n->>'parentId' into parent_id from jsonb_array_elements(nodes) n where n->>'id'=current_id;
  if parent_id is null or current_id=any(seen) then return false; end if;
  if parent_id=ancestor then return true; end if;
  if direct_only then return false; end if;
  seen:=seen||current_id; current_id:=parent_id;
 end loop;
 return false;
end $$;
revoke all on function public._account_descendant(jsonb,text,text,boolean) from public,anon,authenticated;

create function public._validate_account_hierarchy(p_tenant uuid,doc jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare nodes jsonb; n jsonb; x jsonb; user_branch uuid[]; requested uuid[];
begin
 if doc is null or jsonb_typeof(doc)<>'object' or octet_length(doc::text)>1048576 then raise exception 'HIERARCHY_INVALID'; end if;
 foreach nodes in array array[doc->'positions',doc->'departments',doc->'assignments',doc->'globalAdminIds'] loop
  if nodes is null or jsonb_typeof(nodes)<>'array' then raise exception 'HIERARCHY_INVALID'; end if;
 end loop;
 if jsonb_array_length(doc->'positions')>128 or jsonb_array_length(doc->'departments')>128
  or jsonb_array_length(doc->'assignments')>1024 or jsonb_array_length(doc->'globalAdminIds')>128 then raise exception 'HIERARCHY_TOO_LARGE'; end if;
 foreach nodes in array array[doc->'positions',doc->'departments'] loop
  if (select count(*)<>count(distinct node->>'id') from jsonb_array_elements(nodes) node) then raise exception 'HIERARCHY_DUPLICATE'; end if;
  for n in select * from jsonb_array_elements(nodes) loop
   if jsonb_typeof(n)<>'object' or length(coalesce(n->>'id','')) not between 1 and 64
    or length(trim(coalesce(n->>'name',''))) not between 1 and 120
    or (n->>'parentId' is not null and not exists(select 1 from jsonb_array_elements(nodes) p where p->>'id'=n->>'parentId'))
    then raise exception 'HIERARCHY_NODE_INVALID'; end if;
   if n->>'id'=n->>'parentId' or public._account_descendant(nodes,n->>'parentId',n->>'id') then raise exception 'HIERARCHY_CYCLE'; end if;
  end loop;
 end loop;
 for n in select * from jsonb_array_elements(doc->'positions') loop
  if coalesce(n->>'scope','') not in ('branch','assigned','department') or coalesce(n->>'depth','') not in ('direct','all')
   or jsonb_typeof(n->'permissions'->'edit') is distinct from 'boolean'
   or jsonb_typeof(n->'permissions'->'password') is distinct from 'boolean'
   or jsonb_typeof(n->'permissions'->'create') is distinct from 'boolean' then raise exception 'HIERARCHY_POSITION_INVALID'; end if;
 end loop;
 for n in select * from jsonb_array_elements(doc->'assignments') loop
  if not exists(select 1 from public.profiles p where p.id::text=n->>'userId' and p.tenant_id=p_tenant)
   or not exists(select 1 from jsonb_array_elements(doc->'positions') p where p->>'id'=n->>'positionId')
   or ((n->>'departmentId') is not null and not exists(select 1 from jsonb_array_elements(doc->'departments') d where d->>'id'=n->>'departmentId'))
   or jsonb_typeof(n->'managedBranchIds') is distinct from 'array' then raise exception 'HIERARCHY_ASSIGNMENT_INVALID'; end if;
  select coalesce(array_agg(branch_id),'{}') into user_branch from
   (select branch_id from public.user_branches where user_id::text=n->>'userId'
    union select branch_id from public.profiles where id::text=n->>'userId' and branch_id is not null) b;
  select coalesce(array_agg(value::uuid),'{}') into requested from jsonb_array_elements_text(n->'managedBranchIds');
  if not requested<@user_branch or exists(select 1 from unnest(requested) b where not exists
   (select 1 from public.branches where id=b and tenant_id=p_tenant and is_active)) then raise exception 'HIERARCHY_BRANCH_INVALID'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(doc->'assignments') node group by node->>'userId',node->>'positionId',node->>'departmentId' having count(*)>1)
 then raise exception 'HIERARCHY_DUPLICATE_ASSIGNMENT'; end if;
 for x in select * from jsonb_array_elements(doc->'globalAdminIds') loop
  if jsonb_typeof(x)<>'string' or not exists(select 1 from public.profiles p where to_jsonb(p.id::text)=x and p.tenant_id=p_tenant and p.is_active)
  then raise exception 'HIERARCHY_GLOBAL_ADMIN_INVALID'; end if;
 end loop;
end $$;
revoke all on function public._validate_account_hierarchy(uuid,jsonb) from public,anon,authenticated;

create function public._account_decision(p_actor uuid,p_target uuid,p_action text,p_role uuid default null,
 p_branches uuid[] default null,p_position text default null,override_doc jsonb default null,p_department text default null) returns text
language plpgsql stable security definer set search_path='' as $$
declare a public.profiles; t public.profiles; doc jsonb; aa jsonb; ta jsonb; ap jsonb; tp jsonb;
 actor_branches uuid[]; target_branches uuid[]; requested uuid[]; covered boolean; any_target boolean:=false;
begin
 select * into a from public.profiles where id=p_actor and is_active;
 if a.id is null or p_action not in ('edit','password','create','roles') then return 'AUTH_REQUIRED'; end if;
 if p_target is not null then
  select * into t from public.profiles where id=p_target and tenant_id=a.tenant_id;
  if t.id is null then return 'OUTSIDE_TENANT'; end if;
 end if;
 if a.role='owner' then return 'ALLOWED'; end if;
 if p_target=a.id then return 'SELF_ACCESS_PROTECTED'; end if;
 if t.role='owner' then return 'OWNER_PROTECTED'; end if;
 doc:=coalesce(override_doc,(select document from public.account_hierarchy_config where tenant_id=a.tenant_id),'{"positions":[],"departments":[],"assignments":[],"globalAdminIds":[]}');
 if (doc->'globalAdminIds') ? coalesce(p_target::text,'') then return 'ADMIN_PROTECTED'; end if;
 if p_action='roles' then return 'SHARED_ROLE_OWNER_REQUIRED'; end if;
 if exists(select 1 from public.user_permission_overrides o where o.user_id=a.id and o.tenant_id=a.tenant_id
  and o.override_type='revoke' and (o.permission_code=case when p_action='password' then 'system.reset_user_password' else 'system.manage_users' end
   or (p_action='create' and o.permission_code='system.create_user')))
 then return 'PERMISSION_REVOKED'; end if;
 if (doc->'globalAdminIds') ? a.id::text then return 'ALLOWED'; end if;
 if p_target is not null and public.user_has_permission_before_account_hierarchy(p_target,'system.manage_roles') then return 'ADMIN_PROTECTED'; end if;
 if p_action='password' and t.id is not null and not t.is_active then return 'TARGET_INACTIVE'; end if;
 -- A scoped supervisor cannot assign an RBAC role containing privileges they do not hold.
 if p_role is not null and (not exists(select 1 from public.roles where id=p_role and tenant_id=a.tenant_id) or exists
  (select 1 from public.role_permissions rp where rp.role_id=p_role and (rp.permission_code like 'system.%' or not public.user_has_permission(a.id,rp.permission_code))))
 then return 'ROLE_ESCALATION_DENIED'; end if;
 select coalesce(array_agg(branch_id),'{}') into actor_branches from
  (select branch_id from public.user_branches where user_id=a.id union select a.branch_id where a.branch_id is not null) b;
 select coalesce(array_agg(branch_id),'{}') into target_branches from
  (select branch_id from public.user_branches where user_id=p_target union select t.branch_id where t.branch_id is not null) b;
 if p_branches is not null then
  if cardinality(p_branches)=0 then return 'BRANCH_ESCALATION_DENIED'; end if;
  select array_agg(distinct b) into target_branches from unnest(target_branches||p_branches) b;
 end if;
 if p_target is null then
  if p_action<>'create' or p_position is null then return 'POSITION_REQUIRED'; end if;
 end if;
 -- Every assignment on the target must be covered. Sharing one branch/position is insufficient.
 for ta in select value from jsonb_array_elements(doc->'assignments') where value->>'userId'=p_target::text
  union all select jsonb_build_object('positionId',p_position,'departmentId',p_department) where p_target is null loop
  any_target:=true; covered:=false;
  select value into tp from jsonb_array_elements(doc->'positions') where value->>'id'=ta->>'positionId';
  for aa in select value from jsonb_array_elements(doc->'assignments') where value->>'userId'=a.id::text loop
   select value into ap from jsonb_array_elements(doc->'positions') where value->>'id'=aa->>'positionId';
   if coalesce((ap->'permissions'->>p_action)::boolean,false) and public._account_descendant(doc->'positions',tp->>'id',ap->>'id',ap->>'depth'='direct') then
    if ap->>'scope'='department' then
     if ta->>'departmentId' is not null and aa->>'departmentId' is not null and
      (ta->>'departmentId'=aa->>'departmentId' or public._account_descendant(doc->'departments',ta->>'departmentId',aa->>'departmentId')) then covered:=true; end if;
    else
     requested:=actor_branches;
     if ap->>'scope'='assigned' then select coalesce(array_agg(value::uuid),'{}') into requested from jsonb_array_elements_text(aa->'managedBranchIds'); end if;
     if cardinality(target_branches)>0 and target_branches<@requested and requested<@actor_branches then covered:=true; end if;
    end if;
   end if;
   exit when covered;
  end loop;
  if not covered then return 'OUTSIDE_HIERARCHY_OR_UNIT'; end if;
 end loop;
 return case when any_target then 'ALLOWED' else 'POSITION_NOT_ASSIGNED' end;
end $$;
revoke all on function public._account_decision(uuid,uuid,text,uuid,uuid[],text,jsonb,text) from public,anon,authenticated;

create function public.check_account_management_scope(p_target uuid,p_action text,p_role uuid default null,
 p_branches uuid[] default null,p_position text default null,p_department text default null) returns boolean
language sql stable security definer set search_path='' as $$
 select public._account_decision(auth.uid(),p_target,p_action,p_role,p_branches,p_position,null,p_department)='ALLOWED'
$$;
revoke all on function public.check_account_management_scope(uuid,text,uuid,uuid[],text,text) from public,anon;
grant execute on function public.check_account_management_scope(uuid,text,uuid,uuid[],text,text) to authenticated;

create function public.get_account_hierarchy() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.profiles; doc jsonb; version bigint;
begin
 select * into a from public.profiles where id=auth.uid() and is_active and role='owner';
 if a.id is null then raise exception 'ACCOUNT_SCOPE_OWNER_REQUIRED' using errcode='42501'; end if;
 select c.document,c.version into doc,version from public.account_hierarchy_config c where tenant_id=a.tenant_id;
 return jsonb_build_object('version',coalesce(version,0),'document',coalesce(doc,'{"positions":[],"departments":[],"assignments":[],"globalAdminIds":[]}'));
end $$;
revoke all on function public.get_account_hierarchy() from public,anon;
grant execute on function public.get_account_hierarchy() to authenticated;

create function public.preview_account_hierarchy(p_document jsonb,p_expected_version bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.profiles; old_doc jsonb; current_version bigint; changes jsonb; managers uuid[]; people_count bigint;
begin
 select * into a from public.profiles where id=auth.uid() and is_active and role='owner';
 if a.id is null then raise exception 'ACCOUNT_SCOPE_OWNER_REQUIRED' using errcode='42501'; end if;
 perform public._validate_account_hierarchy(a.tenant_id,p_document);
 select document,version into old_doc,current_version from public.account_hierarchy_config where tenant_id=a.tenant_id;
 if coalesce(current_version,0)<>p_expected_version then raise exception 'HIERARCHY_STALE'; end if;
 select coalesce(array_agg(m.id),'{}') into managers from public.profiles m where m.tenant_id=a.tenant_id and m.is_active and m.role<>'owner' and (
  exists(select 1 from (values(old_doc),(p_document)) d(doc)
   cross join lateral jsonb_array_elements(coalesce(d.doc->'assignments','[]')) assignment
   join lateral jsonb_array_elements(coalesce(d.doc->'positions','[]')) position on position->>'id'=assignment->>'positionId'
   where assignment->>'userId'=m.id::text and ((position->'permissions'->>'edit')::boolean or (position->'permissions'->>'password')::boolean))
  or coalesce(old_doc->'globalAdminIds','[]') ? m.id::text or p_document->'globalAdminIds' ? m.id::text);
 select count(*) into people_count from public.profiles where tenant_id=a.tenant_id;
 if cardinality(managers)*people_count>10000 then raise exception 'HIERARCHY_PREVIEW_TOO_LARGE'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('managerId',m.id,'managerName',m.full_name,'targetId',t.id,'targetName',t.full_name,
  'action',x.action,'before',public._account_decision(m.id,t.id,x.action,null,null,null,old_doc),
  'after',public._account_decision(m.id,t.id,x.action,null,null,null,p_document))),'[]') into changes
 from public.profiles m cross join public.profiles t cross join (values('edit'),('password')) x(action)
 where m.id=any(managers) and t.tenant_id=a.tenant_id
 and public._account_decision(m.id,t.id,x.action,null,null,null,old_doc) is distinct from public._account_decision(m.id,t.id,x.action,null,null,null,p_document);
 return jsonb_build_object('version',coalesce(current_version,0),'fingerprint',md5(p_document::text),'changes',changes);
end $$;
revoke all on function public.preview_account_hierarchy(jsonb,bigint) from public,anon;
grant execute on function public.preview_account_hierarchy(jsonb,bigint) to authenticated;

create function public.save_account_hierarchy(p_document jsonb,p_expected_version bigint,p_fingerprint text) returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.profiles; old_doc jsonb; current_version bigint;
begin
 select * into a from public.profiles where id=auth.uid() and is_active and role='owner';
 if a.id is null then raise exception 'ACCOUNT_SCOPE_OWNER_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-hierarchy:'||a.tenant_id::text,0));
 perform public._validate_account_hierarchy(a.tenant_id,p_document);
 select document,version into old_doc,current_version from public.account_hierarchy_config where tenant_id=a.tenant_id for update;
 if coalesce(current_version,0)<>p_expected_version or p_fingerprint is distinct from md5(p_document::text) then raise exception 'HIERARCHY_STALE'; end if;
 insert into public.account_hierarchy_config(tenant_id,version,document,updated_by)
 values(a.tenant_id,p_expected_version+1,p_document,a.id)
 on conflict(tenant_id) do update set version=excluded.version,document=excluded.document,updated_by=a.id,updated_at=now();
 insert into public.account_hierarchy_history(tenant_id,version,changed_by,document)
 values(a.tenant_id,p_expected_version+1,a.id,p_document);
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(a.tenant_id,a.id,'account_hierarchy_changed','account_hierarchy',a.tenant_id,old_doc,
 jsonb_build_object('version',p_expected_version+1,'document',p_document));
 return p_expected_version+1;
end $$;
revoke all on function public.save_account_hierarchy(jsonb,bigint,text) from public,anon;
grant execute on function public.save_account_hierarchy(jsonb,bigint,text) to authenticated;

create function public.get_account_hierarchy_history() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active and role='owner';
 if actor.id is null then raise exception 'ACCOUNT_SCOPE_OWNER_REQUIRED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(h) order by h.version desc) from
  (select h.version,h.changed_at,p.full_name as changed_by from public.account_hierarchy_history h
   join public.profiles p on p.id=h.changed_by where h.tenant_id=actor.tenant_id order by h.version desc limit 30) h),'[]');
end $$;
revoke all on function public.get_account_hierarchy_history() from public,anon;
grant execute on function public.get_account_hierarchy_history() to authenticated;

create function public.get_account_hierarchy_version(p_version bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles; before_doc jsonb; after_doc jsonb;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active and role='owner';
 if actor.id is null then raise exception 'ACCOUNT_SCOPE_OWNER_REQUIRED' using errcode='42501'; end if;
 select document into after_doc from public.account_hierarchy_history where tenant_id=actor.tenant_id and version=p_version;
 if after_doc is null then raise exception 'HIERARCHY_VERSION_NOT_FOUND'; end if;
 select document into before_doc from public.account_hierarchy_history where tenant_id=actor.tenant_id and version=p_version-1;
 return jsonb_build_object('before',coalesce(before_doc,'{"positions":[],"departments":[],"assignments":[],"globalAdminIds":[]}'),'after',after_doc);
end $$;
revoke all on function public.get_account_hierarchy_version(bigint) from public,anon;
grant execute on function public.get_account_hierarchy_version(bigint) to authenticated;

create function public.get_account_management_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.profiles; doc jsonb; targets jsonb;
begin
 select * into a from public.profiles where id=auth.uid() and is_active;
 if a.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select document into doc from public.account_hierarchy_config where tenant_id=a.tenant_id;
 select coalesce(jsonb_object_agg(p.id,jsonb_build_object('edit',public._account_decision(a.id,p.id,'edit')='ALLOWED',
  'password',public._account_decision(a.id,p.id,'password')='ALLOWED')),'{}') into targets
 from public.profiles p where p.tenant_id=a.tenant_id;
 return jsonb_build_object('owner',a.role='owner','scope',jsonb_build_object('global_access',coalesce(doc->'globalAdminIds' ? a.id::text,false),
 'assignable_role_ids',coalesce((select jsonb_agg(r.id) from public.roles r where r.tenant_id=a.tenant_id and not exists
 (select 1 from public.role_permissions rp where rp.role_id=r.id and (rp.permission_code like 'system.%' or not public.user_has_permission(a.id,rp.permission_code)))),'[]')),
 'targets',targets,
 'canCreate',a.role='owner' or (not exists(select 1 from public.user_permission_overrides o where o.tenant_id=a.tenant_id and o.user_id=a.id
  and o.override_type='revoke' and o.permission_code in ('system.manage_users','system.create_user')) and (coalesce(doc->'globalAdminIds' ? a.id::text,false) or exists
  (select 1 from jsonb_array_elements(coalesce(doc->'assignments','[]')) aa join jsonb_array_elements(doc->'positions') p
   on p->>'id'=aa->>'positionId' where aa->>'userId'=a.id::text and (p->'permissions'->>'create')::boolean))),
 'positions',coalesce((select jsonb_agg(p) from jsonb_array_elements(coalesce(doc->'positions','[]')) p where a.role='owner'
  or coalesce(doc->'globalAdminIds' ? a.id::text,false) or exists(select 1 from jsonb_array_elements(doc->'assignments') aa
   where aa->>'userId'=a.id::text and public._account_descendant(doc->'positions',p->>'id',aa->>'positionId'))),'[]'),
 'departments',coalesce(doc->'departments','[]'));
end $$;
revoke all on function public.get_account_management_context() from public,anon;
grant execute on function public.get_account_management_context() to authenticated;

create function public.get_managed_accounts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if actor.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'fullName',p.full_name,'email',coalesce(p.email,''),
  'phone',p.phone,'role',p.role,'roleId',p.role_id,'roleName',r.name,'branchId',p.branch_id,
  'branchIds',coalesce((select jsonb_agg(b.branch_id) from (select branch_id from public.user_branches where user_id=p.id union select p.branch_id where p.branch_id is not null) b),'[]'),
  'isActive',p.is_active,'createdAt',p.created_at) order by p.created_at)
  from public.profiles p left join public.roles r on r.id=p.role_id and r.tenant_id=p.tenant_id
  where p.tenant_id=actor.tenant_id and (public._account_decision(actor.id,p.id,'edit')='ALLOWED'
   or public._account_decision(actor.id,p.id,'password')='ALLOWED')),'[]');
end $$;
revoke all on function public.get_managed_accounts() from public,anon;
grant execute on function public.get_managed_accounts() to authenticated;

-- Definer RPCs and service-role HTTP routes must share the same decision.
create function public._account_position_permission(p_user uuid,p_code text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_code in ('system.manage_users','system.reset_user_password','system.create_user')
 and exists(select 1 from public.profiles p join public.account_hierarchy_config c on c.tenant_id=p.tenant_id
  where p.id=p_user and p.is_active and not exists(select 1 from public.user_permission_overrides o
   where o.tenant_id=p.tenant_id and o.user_id=p.id and o.permission_code=p_code and o.override_type='revoke')
  and ((c.document->'globalAdminIds') ? p.id::text or exists
   (select 1 from jsonb_array_elements(c.document->'assignments') a
    join jsonb_array_elements(c.document->'positions') pos on pos->>'id'=a->>'positionId'
    where a->>'userId'=p.id::text and case p_code
     when 'system.reset_user_password' then coalesce((pos->'permissions'->>'password')::boolean,false)
     when 'system.create_user' then coalesce((pos->'permissions'->>'create')::boolean,false)
     else coalesce((pos->'permissions'->>'edit')::boolean,false) or coalesce((pos->'permissions'->>'create')::boolean,false) end)))
$$;
revoke all on function public._account_position_permission(uuid,text) from public,anon,authenticated;
alter function public.user_has_permission(uuid,text) rename to user_has_permission_before_account_hierarchy;
revoke all on function public.user_has_permission_before_account_hierarchy(uuid,text) from public,anon,authenticated;
create function public.user_has_permission(p_user_id uuid,p_permission_code text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.user_has_permission_before_account_hierarchy(p_user_id,p_permission_code)
 or public._account_position_permission(p_user_id,p_permission_code)
$$;
revoke all on function public.user_has_permission(uuid,text) from public,anon;
grant execute on function public.user_has_permission(uuid,text) to authenticated,service_role;
alter function public.get_user_effective_permissions(uuid) rename to get_user_effective_permissions_before_account_hierarchy;
revoke all on function public.get_user_effective_permissions_before_account_hierarchy(uuid) from public,anon,authenticated;
create function public.get_user_effective_permissions(p_user_id uuid) returns table(permission_code text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles a join public.profiles t on t.tenant_id=a.tenant_id
  where a.id=auth.uid() and a.is_active and t.id=p_user_id) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 return query select p.permission_code from public.get_user_effective_permissions_before_account_hierarchy(p_user_id) p
 union select code from unnest(array['system.manage_users','system.reset_user_password','system.create_user']) code
 where public._account_position_permission(p_user_id,code);
end $$;
revoke all on function public.get_user_effective_permissions(uuid) from public,anon;
grant execute on function public.get_user_effective_permissions(uuid) to authenticated,service_role;

alter function public.update_managed_user_atomic(uuid,jsonb,uuid[]) rename to update_managed_user_before_scope;
revoke all on function public.update_managed_user_before_scope(uuid,jsonb,uuid[]) from public,anon,authenticated;
create function public.update_managed_user_atomic(p_target_user_id uuid,p_profile_patch jsonb default '{}',p_branch_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('account-hierarchy:'||public.get_user_tenant_id()::text,0));
 if not public.check_account_management_scope(p_target_user_id,'edit',nullif(p_profile_patch->>'role_id','')::uuid,p_branch_ids)
 then raise exception 'ACCOUNT_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
 return public.update_managed_user_before_scope(p_target_user_id,p_profile_patch,p_branch_ids);
end $$;
revoke all on function public.update_managed_user_atomic(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.update_managed_user_atomic(uuid,jsonb,uuid[]) to authenticated;

create table public.account_creation_reservations (
 target_id uuid primary key references auth.users(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),position_id text,department_id text,
 expires_at timestamptz not null default now()+interval '2 minutes'
);
alter table public.account_creation_reservations enable row level security;
revoke all on public.account_creation_reservations from public,anon,authenticated;
grant all on public.account_creation_reservations to service_role;
create function public.reserve_account_creation(p_target uuid,p_actor uuid,p_position text default null,p_department text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users where id=p_target and created_at>now()-interval '2 minutes')
  or not exists(select 1 from public.profiles where id=p_actor and is_active) then raise exception 'ACCOUNT_CREATION_RESERVATION_INVALID'; end if;
 insert into public.account_creation_reservations(target_id,actor_id,position_id,department_id) values(p_target,p_actor,p_position,p_department);
end $$;
revoke all on function public.reserve_account_creation(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_account_creation(uuid,uuid,text,text) to service_role;

create function public.begin_managed_password_reset(p_actor uuid,p_target uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare audit_id uuid:=gen_random_uuid(); tenant uuid;
begin
 select tenant_id into tenant from public.profiles where id=p_actor and is_active;
 if public._account_decision(p_actor,p_target,'password')<>'ALLOWED' then raise exception 'ACCOUNT_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
 insert into public.audit_log(id,tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(audit_id,tenant,p_actor,'password_reset_requested','user',p_target,jsonb_build_object('status','pending','must_change_password',true));
 return audit_id;
end $$;
revoke all on function public.begin_managed_password_reset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_managed_password_reset(uuid,uuid) to service_role;
create function public.complete_managed_password_reset(p_audit uuid,p_success boolean) returns void
language sql security definer set search_path='' as $$
 update public.audit_log set action=case when p_success then 'password_reset_completed' else 'password_reset_failed' end,
  new_data=jsonb_build_object('status',case when p_success then 'completed' else 'failed' end,'must_change_password',p_success)
 where id=p_audit and action='password_reset_requested' and entity_type='user'
$$;
revoke all on function public.complete_managed_password_reset(uuid,boolean) from public,anon,authenticated;
grant execute on function public.complete_managed_password_reset(uuid,boolean) to service_role;
alter function public.initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[]) rename to initialize_managed_user_before_scope;
revoke all on function public.initialize_managed_user_before_scope(uuid,text,text,text,uuid,uuid[]) from public,anon,authenticated;
create function public.initialize_managed_user_atomic(p_target_user_id uuid,p_full_name text,p_email text,p_phone text,p_role_id uuid,p_branch_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare reservation public.account_creation_reservations; result jsonb; candidate jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('account-hierarchy:'||public.get_user_tenant_id()::text,0));
 delete from public.account_creation_reservations where target_id=p_target_user_id and actor_id=auth.uid() and expires_at>now() returning * into reservation;
 if not found then raise exception 'ACCOUNT_CREATION_RESERVATION_REQUIRED' using errcode='42501'; end if;
 if not public.check_account_management_scope(null,'create',p_role_id,p_branch_ids,reservation.position_id,reservation.department_id)
 then raise exception 'ACCOUNT_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
 result:=public.initialize_managed_user_before_scope(p_target_user_id,p_full_name,p_email,p_phone,p_role_id,p_branch_ids);
 if reservation.position_id is not null then
  select jsonb_set(document,'{assignments}',document->'assignments'||jsonb_build_array(jsonb_build_object(
   'userId',p_target_user_id,'positionId',reservation.position_id,'departmentId',reservation.department_id,'managedBranchIds','[]'::jsonb)))
  into candidate from public.account_hierarchy_config where tenant_id=public.get_user_tenant_id();
  perform public._validate_account_hierarchy(public.get_user_tenant_id(),candidate);
  update public.account_hierarchy_config set document=candidate,version=version+1,updated_by=auth.uid(),updated_at=now() where tenant_id=public.get_user_tenant_id();
  insert into public.account_hierarchy_history(tenant_id,version,changed_by,document)
  select tenant_id,version,auth.uid(),document from public.account_hierarchy_config where tenant_id=public.get_user_tenant_id();
 end if;
 return result;
end $$;
revoke all on function public.initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[]) from public,anon;
grant execute on function public.initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[]) to authenticated;

alter function public.request_pos_pin_reset_00459(uuid) rename to request_pos_pin_reset_before_scope;
revoke all on function public.request_pos_pin_reset_before_scope(uuid) from public,anon,authenticated;
create function public.request_pos_pin_reset_00459(p_target_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.check_account_management_scope(p_target_user_id,'edit') then raise exception 'ACCOUNT_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
 return public.request_pos_pin_reset_before_scope(p_target_user_id);
end $$;
revoke all on function public.request_pos_pin_reset_00459(uuid) from public,anon;
grant execute on function public.request_pos_pin_reset_00459(uuid) to authenticated;

-- Shared role definitions affect members outside a supervisor's unit; owners only.
do $$ declare tbl text; cmd text; fn record; begin
 foreach tbl in array array['roles','role_permissions','user_permission_overrides'] loop
  foreach cmd in array array['INSERT','UPDATE','DELETE'] loop
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s','account_scope_'||lower(cmd),tbl,cmd,
    case when cmd='INSERT' then 'with check (public.account_management_owner())'
     when cmd='UPDATE' then 'using (public.account_management_owner()) with check (public.account_management_owner())'
     else 'using (public.account_management_owner())' end);
  end loop;
 end loop;
 for fn in select pg_get_functiondef(p.oid) as body from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('save_role_atomic','delete_role_atomic') loop
  execute regexp_replace(fn.body,'(?i)\mbegin\M',E'begin\n if not public.account_management_owner() then raise exception ''ACCOUNT_SCOPE_OWNER_REQUIRED'' using errcode=''42501''; end if;','');
 end loop;
 for fn in select pg_get_functiondef(p.oid) as body from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='remove_user_pos_pin' loop
  execute regexp_replace(fn.body,'(?i)\mbegin\M',E'begin\n if not public.check_account_management_scope(p_target_user_id,''edit'') then raise exception ''ACCOUNT_MANAGEMENT_SCOPE_DENIED'' using errcode=''42501''; end if;','');
 end loop;
end $$;
commit;
