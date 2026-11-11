-- No existing account, assignment or permission is changed on migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table public.staff_branch_permission_catalog (
 permission_code text primary key, enforcement_version integer not null
);
alter table public.staff_branch_permission_catalog enable row level security;
revoke all on public.staff_branch_permission_catalog from public,anon,authenticated;
-- Only enable a code after every server consumer has been audited and tested.
insert into public.staff_branch_permission_catalog values
 ('pos_fnb.split_bill',1),('pos_fnb.transfer_table',1);
create table public.user_branch_permission_overrides (
 tenant_id uuid not null references public.tenants(id),
 user_id uuid not null references public.profiles(id),
 branch_id uuid not null references public.branches(id),
 permission_code text not null references public.staff_branch_permission_catalog(permission_code),
 override_type text not null check(override_type in ('grant','revoke')),
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),
 primary key(tenant_id,user_id,branch_id,permission_code)
);
alter table public.user_branch_permission_overrides enable row level security;
revoke all on public.user_branch_permission_overrides from public,anon,authenticated;

create function public.user_has_permission_at_branch(p_user_id uuid,p_permission_code text,p_branch_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare target public.profiles; choice text;
begin
 select * into target from public.profiles where id=p_user_id and is_active;
 if target.id is null or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=target.tenant_id) then return false; end if;
 if target.role='owner' then return true; end if;
 if not public.user_has_branch_access(p_user_id,p_branch_id) then return false; end if;
 if exists(select 1 from public.user_permission_overrides where tenant_id=target.tenant_id and user_id=p_user_id
  and permission_code=p_permission_code and override_type='revoke') then return false; end if;
 select override_type into choice from public.user_branch_permission_overrides where tenant_id=target.tenant_id
  and user_id=p_user_id and branch_id=p_branch_id and permission_code=p_permission_code;
 if choice is not null then return choice='grant'; end if;
 return public.user_has_permission(p_user_id,p_permission_code);
end $$;
-- Internal resolver: browser clients must not probe arbitrary users' rights.
-- Existing secured RPCs and bootstrap invoke it as their function owner.
revoke all on function public.user_has_permission_at_branch(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.user_has_permission_at_branch(uuid,text,uuid) to service_role;

create function public._staff_profile_snapshot(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles; target public.profiles; value jsonb;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active and role='owner';
 if actor.id is null then raise exception 'STAFF_OWNER_REQUIRED' using errcode='42501'; end if;
 select * into target from public.profiles where id=p_user_id and tenant_id=actor.tenant_id and role<>'owner';
 if target.id is null then raise exception 'STAFF_TARGET_INVALID' using errcode='42501'; end if;
 select jsonb_build_object(
 'user',jsonb_build_object('id',target.id,'fullName',target.full_name,'roleId',target.role_id,'isActive',target.is_active,'primaryBranchId',target.branch_id,
  'branchIds',coalesce((select jsonb_agg(b order by b) from (select branch_id b from public.user_branches where user_id=target.id
     union select target.branch_id where target.branch_id is not null) x),'[]')),
 'hierarchy',public.get_account_hierarchy(),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'permissions',coalesce((select jsonb_agg(permission_code order by permission_code)
    from public.role_permissions where role_id=r.id),'[]')) order by r.id) from public.roles r where r.tenant_id=actor.tenant_id),'[]'),
 'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'isActive',b.is_active) order by b.id)
    from public.branches b where b.tenant_id=actor.tenant_id and (b.is_active or b.id=target.branch_id
      or exists(select 1 from public.user_branches ub where ub.user_id=target.id and ub.branch_id=b.id))),'[]'),
 'exceptions',coalesce((select jsonb_agg(x.value order by x.value::text) from (
   select jsonb_build_object('branchId',null,'permissionCode',permission_code,'choice',override_type) value
    from public.user_permission_overrides where tenant_id=actor.tenant_id and user_id=target.id
   union all select jsonb_build_object('branchId',branch_id,'permissionCode',permission_code,'choice',override_type)
    from public.user_branch_permission_overrides where tenant_id=actor.tenant_id and user_id=target.id) x),'[]'),
 'branchPermissionCodes',coalesce((select jsonb_agg(permission_code order by permission_code) from public.staff_branch_permission_catalog),'[]')
 ) into value;
 return value||jsonb_build_object('fingerprint',md5(value::text));
end $$;
revoke all on function public._staff_profile_snapshot(uuid) from public,anon,authenticated;
create function public.get_staff_profile_access(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$ select public._staff_profile_snapshot(p_user_id) $$;
revoke all on function public.get_staff_profile_access(uuid) from public,anon;
grant execute on function public.get_staff_profile_access(uuid) to authenticated;

create function public.save_staff_profile_access(p_user_id uuid,p_expected_fingerprint text,p_draft jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare actor public.profiles; target public.profiles; before_state jsonb; after_state jsonb;
 doc jsonb; assignment jsonb; item jsonb; v_branch_ids uuid[]; role_id uuid; patch jsonb; version bigint;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active and role='owner';
 if actor.id is null then raise exception 'STAFF_OWNER_REQUIRED' using errcode='42501'; end if;
 -- Same lock order as existing role/profile writer; serialize shared organization edits.
 perform pg_advisory_xact_lock(hashtextextended('account-hierarchy:'||actor.tenant_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('system-role:'||actor.tenant_id::text,0));
 -- Legacy editors do not all take the advisory lock. Serialize permission/membership
 -- writes too, while allowing normal SELECTs used by checkout and printing.
 lock table public.roles, public.role_permissions, public.user_permission_overrides,
  public.user_branches, public.account_hierarchy_config in share row exclusive mode;
 select * into target from public.profiles where id=p_user_id and tenant_id=actor.tenant_id and role<>'owner' for update;
 if target.id is null then raise exception 'STAFF_TARGET_INVALID' using errcode='42501'; end if;
 before_state:=public._staff_profile_snapshot(p_user_id);
 if p_expected_fingerprint is distinct from before_state->>'fingerprint' then raise exception 'STAFF_PROFILE_STALE' using errcode='40001'; end if;
 if jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>1048576
  or not p_draft ? 'roleId' or jsonb_typeof(p_draft->'branchIds') is distinct from 'array'
  or jsonb_typeof(p_draft->'assignments') is distinct from 'array' or jsonb_typeof(p_draft->'exceptions') is distinct from 'array'
  or jsonb_array_length(p_draft->'exceptions')>4096 or jsonb_array_length(p_draft->'assignments')>32 then raise exception 'STAFF_PROFILE_INVALID'; end if;
 select array_agg(x::uuid order by x) into v_branch_ids from jsonb_array_elements_text(p_draft->'branchIds') x;
 if coalesce(cardinality(v_branch_ids),0)=0 or cardinality(v_branch_ids)<>(select count(distinct x) from unnest(v_branch_ids) x)
  or exists(select 1 from unnest(v_branch_ids) b where b is null or not exists(select 1 from public.branches where id=b and tenant_id=actor.tenant_id
    and (is_active or (before_state->'user'->'branchIds') ? b::text)))
  then raise exception 'STAFF_BRANCH_INVALID'; end if;
 role_id:=(p_draft->>'roleId')::uuid;
 if role_id is not null and not exists(select 1 from public.roles where id=role_id and tenant_id=actor.tenant_id) then raise exception 'STAFF_ROLE_INVALID'; end if;
 doc:=before_state->'hierarchy'->'document'; version:=(before_state->'hierarchy'->>'version')::bigint;
 for assignment in select * from jsonb_array_elements(p_draft->'assignments') loop
  if assignment->>'userId' is distinct from p_user_id::text then raise exception 'STAFF_ASSIGNMENT_INVALID'; end if;
 end loop;
 doc:=jsonb_set(doc,'{assignments}',coalesce((select jsonb_agg(a) from jsonb_array_elements(doc->'assignments') a
   where a->>'userId'<>p_user_id::text),'[]')||(p_draft->'assignments'));
 if exists(select 1 from jsonb_array_elements(p_draft->'exceptions') e
  group by coalesce(e->>'branchId',''),e->>'permissionCode' having count(*)>1) then raise exception 'STAFF_EXCEPTION_DUPLICATE'; end if;
 for item in select * from jsonb_array_elements(p_draft->'exceptions') loop
  if jsonb_typeof(item->'permissionCode') is distinct from 'string' or length(item->>'permissionCode') not between 1 and 120
   or coalesce(item->>'choice','') not in ('grant','revoke') or not item ? 'branchId' then raise exception 'STAFF_EXCEPTION_INVALID'; end if;
  if item->>'branchId' is not null then
   if not exists(select 1 from public.branches where id=(item->>'branchId')::uuid and tenant_id=actor.tenant_id) then raise exception 'STAFF_BRANCH_INVALID'; end if;
   if not exists(select 1 from public.staff_branch_permission_catalog where permission_code=item->>'permissionCode') then raise exception 'BRANCH_PERMISSION_UNSUPPORTED'; end if;
   -- Retain an old exception on a removed branch as dormant; never create a new one outside selected access.
   if not (item->>'branchId')::uuid=any(v_branch_ids) and not (before_state->'exceptions') @> jsonb_build_array(item) then raise exception 'STAFF_BRANCH_INVALID'; end if;
  end if;
 end loop;
 patch:=case when role_id is distinct from target.role_id then jsonb_build_object('role_id',role_id) else '{}'::jsonb end;
 if patch<>'{}'::jsonb then
  perform public.update_managed_user_atomic(p_user_id,patch,null);
 end if;
 if to_jsonb(v_branch_ids) is distinct from before_state->'user'->'branchIds' then
  -- Owner and tenant checks above already validate this exact requested scope.
  -- Delta writes retain the original grant metadata and existing inactive
  -- memberships. The legacy helper rejects even retained inactive branches.
  delete from public.user_branches where user_id=p_user_id and not branch_id=any(v_branch_ids);
  insert into public.user_branches(user_id,branch_id,granted_by)
   select p_user_id,b,actor.id from unnest(v_branch_ids) b
   where not exists(select 1 from public.user_branches ub where ub.user_id=p_user_id and ub.branch_id=b);
  update public.profiles set branch_id=case when target.branch_id=any(v_branch_ids) then target.branch_id else v_branch_ids[1] end,
   updated_at=now() where id=p_user_id and tenant_id=actor.tenant_id;
 end if;
 -- Branch membership must be updated before validating assigned management scope. All changes roll back together.
 perform public._validate_account_hierarchy(actor.tenant_id,doc);
 if doc is distinct from before_state->'hierarchy'->'document' then perform public.save_account_hierarchy(doc,version,md5(doc::text)); end if;
 -- Delta-only writes preserve IDs, notes and authors of all untouched legacy exceptions.
 delete from public.user_permission_overrides o where o.tenant_id=actor.tenant_id and o.user_id=p_user_id
  and not exists(select 1 from jsonb_array_elements(p_draft->'exceptions') e where e->>'branchId' is null and e->>'permissionCode'=o.permission_code);
 for item in select * from jsonb_array_elements(p_draft->'exceptions') where value->>'branchId' is null loop
  if exists(select 1 from public.user_permission_overrides where tenant_id=actor.tenant_id and user_id=p_user_id and permission_code=item->>'permissionCode') then
   update public.user_permission_overrides set override_type=item->>'choice' where tenant_id=actor.tenant_id and user_id=p_user_id
    and permission_code=item->>'permissionCode' and override_type is distinct from item->>'choice';
  else
   insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
    values(actor.tenant_id,p_user_id,item->>'permissionCode',item->>'choice',actor.id);
  end if;
 end loop;
 delete from public.user_branch_permission_overrides o where o.tenant_id=actor.tenant_id and o.user_id=p_user_id
  and not exists(select 1 from jsonb_array_elements(p_draft->'exceptions') e where e->>'branchId'=o.branch_id::text and e->>'permissionCode'=o.permission_code);
 for item in select * from jsonb_array_elements(p_draft->'exceptions') where value->>'branchId' is not null loop
  insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
   values(actor.tenant_id,p_user_id,(item->>'branchId')::uuid,item->>'permissionCode',item->>'choice',actor.id)
   on conflict(tenant_id,user_id,branch_id,permission_code) do update set override_type=excluded.override_type,updated_by=excluded.updated_by,updated_at=now()
   where user_branch_permission_overrides.override_type is distinct from excluded.override_type;
 end loop;
 -- A company-wide all-branches grant must not silently contradict the selected branch list.
 if public.user_has_permission(p_user_id,'reports.view_all_branches') and exists(select 1 from public.branches where tenant_id=actor.tenant_id and is_active and not id=any(v_branch_ids))
  and to_jsonb(v_branch_ids) is distinct from before_state->'user'->'branchIds' then raise exception 'BRANCH_ACCESS_CONFLICT'; end if;
 after_state:=public._staff_profile_snapshot(p_user_id);
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(actor.tenant_id,actor.id,'staff_profile_access_saved','profile',p_user_id,
  jsonb_build_object('user',before_state->'user','assignments',coalesce((select jsonb_agg(a) from jsonb_array_elements(before_state->'hierarchy'->'document'->'assignments') a where a->>'userId'=p_user_id::text),'[]'::jsonb),'exceptions',before_state->'exceptions'),
  jsonb_build_object('user',after_state->'user','assignments',p_draft->'assignments','exceptions',after_state->'exceptions'));
 return after_state;
end $$;
revoke all on function public.save_staff_profile_access(uuid,text,jsonb) from public,anon;
grant execute on function public.save_staff_profile_access(uuid,text,jsonb) to authenticated;

-- Explicit audited consumers. Derive branch from the persisted order, never a browser header.
do $$
declare entry record; oid regprocedure; definition text; pattern text; patched text;
begin
 for entry in select * from (values
  ('public.split_kitchen_order_atomic(uuid,text,uuid[],integer)','pos_fnb.split_bill'),
  ('public.split_kitchen_order_quantities_20261020(uuid,jsonb,uuid)','pos_fnb.split_bill'),
  ('public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)','pos_fnb.transfer_table')
 ) as x(signature,code) loop
  oid:=to_regprocedure(entry.signature);
  if oid is null then raise exception 'STAFF_BRANCH_CONSUMER_MISSING: %',entry.signature; end if;
  definition:=pg_get_functiondef(oid);
  pattern:='user_has_permission\(([^,]+),\s*'''||replace(entry.code,'.','\.')||'''\)';
  patched:=regexp_replace(definition,pattern,'user_has_permission_at_branch(\1,'''||entry.code||''',(select ko.branch_id from public.kitchen_orders ko where ko.id=p_order_id and ko.tenant_id=public.get_user_tenant_id()))','g');
  if patched=definition then raise exception 'STAFF_BRANCH_CONSUMER_CHANGED: %',entry.signature; end if;
  execute patched;
 end loop;
end $$;

-- Additive bootstrap field avoids a new request on every branch switch.
do $$ declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.get_my_auth_bootstrap()'::regprocedure);
 patched:=replace(definition,'''scope'',coalesce(','''branchPermissionAdjustments'',coalesce((select jsonb_agg(jsonb_build_object(''branchId'',o.branch_id,''code'',o.permission_code,''allowed'',public.user_has_permission_at_branch(v_actor,o.permission_code,o.branch_id))) from public.user_branch_permission_overrides o where o.user_id=v_actor and o.tenant_id=v_profile.tenant_id),''[]''::jsonb), ''scope'',coalesce(');
 if patched=definition then raise exception 'STAFF_BOOTSTRAP_CHANGED'; end if;
 execute patched;
end $$;
commit;
