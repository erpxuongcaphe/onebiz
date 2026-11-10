-- One owner-confirmed transaction for structure, business permissions and explicit
-- role assignments. No existing grants/data are changed by this migration.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
create or replace function public.save_staff_access(
 p_document jsonb, p_expected_version bigint, p_fingerprint text,
 p_roles jsonb default '[]', p_assignments jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.profiles; item jsonb; saved jsonb; doc jsonb:=p_document;
 role_map jsonb:='{}'; v_role_id uuid; actual text[]; expected text[]; codes text[];
 target public.profiles; result_version bigint;
begin
 select * into a from public.profiles where id=auth.uid() and is_active and role='owner';
 if a.id is null then raise exception 'ACCOUNT_SCOPE_OWNER_REQUIRED' using errcode='42501'; end if;
 if jsonb_typeof(p_roles) is distinct from 'array' or jsonb_typeof(p_assignments) is distinct from 'array'
  or jsonb_array_length(p_roles)>128 or jsonb_array_length(p_assignments)>1024
  or octet_length(p_roles::text)>1048576 or octet_length(p_assignments::text)>1048576 then raise exception 'STAFF_ACCESS_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-hierarchy:'||a.tenant_id::text,0));
 if p_fingerprint is distinct from md5(p_document::text) or
  coalesce((select version from public.account_hierarchy_config where tenant_id=a.tenant_id),0)<>p_expected_version
  then raise exception 'HIERARCHY_STALE'; end if;
 perform public._validate_account_hierarchy(a.tenant_id,doc);
 if exists(select 1 from jsonb_array_elements(p_roles) r group by r->>'id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_assignments) r group by r->>'userId' having count(*)>1)
  then raise exception 'STAFF_ACCESS_DUPLICATE'; end if;
 for item in select * from jsonb_array_elements(p_roles) order by value->>'id' loop
  if jsonb_typeof(item->'permissions') is distinct from 'array'
   or jsonb_typeof(item->'expectedPermissions') is distinct from 'array'
   or jsonb_typeof(item->'isNew') is distinct from 'boolean' then raise exception 'STAFF_ACCESS_INVALID'; end if;
  select coalesce(array_agg(value order by value),'{}') into codes from jsonb_array_elements_text(item->'permissions');
  if (item->>'isNew')::boolean then
   if not exists(select 1 from jsonb_array_elements(doc->'positions') p where p->>'roleId'=item->>'id') then raise exception 'STAFF_ROLE_UNUSED'; end if;
   saved:=public.save_role_atomic(null,jsonb_build_object('name',item->>'name'),codes);
   role_map:=role_map||jsonb_build_object(item->>'id',saved->>'id');
  else
   v_role_id:=(item->>'id')::uuid;
   perform 1 from public.roles where id=v_role_id and tenant_id=a.tenant_id for update;
   if not found then raise exception 'STAFF_ROLE_NOT_FOUND'; end if;
   select coalesce(array_agg(permission_code order by permission_code),'{}') into actual from public.role_permissions where role_permissions.role_id=v_role_id;
   select coalesce(array_agg(value order by value),'{}') into expected from jsonb_array_elements_text(item->'expectedPermissions');
   if actual is distinct from expected then raise exception 'STAFF_ROLE_STALE'; end if;
   perform public.save_role_atomic(v_role_id,'{}',codes);
  end if;
 end loop;
 select jsonb_set(doc,'{positions}',coalesce(jsonb_agg(case when role_map ? (p->>'roleId') then
  jsonb_set(p,'{roleId}',role_map->(p->>'roleId')) else p end),'[]')) into doc
 from jsonb_array_elements(doc->'positions') p;
 if exists(select 1 from jsonb_array_elements(doc->'positions') p where p->>'roleId' is not null
  and not exists(select 1 from public.roles r where r.id::text=p->>'roleId' and r.tenant_id=a.tenant_id)) then raise exception 'STAFF_ROLE_NOT_FOUND'; end if;
 result_version:=public.save_account_hierarchy(doc,p_expected_version,md5(doc::text));
 for item in select * from jsonb_array_elements(p_assignments) order by value->>'userId' loop
  select * into target from public.profiles where id=(item->>'userId')::uuid and tenant_id=a.tenant_id for update;
  if target.id is null or target.role='owner' then raise exception 'STAFF_TARGET_INVALID'; end if;
  if not (item ? 'expectedRoleId') or target.role_id::text is distinct from (item->>'expectedRoleId') then raise exception 'STAFF_USER_STALE'; end if;
  v_role_id:=coalesce(role_map->>(item->>'roleId'),item->>'roleId')::uuid;
  if not exists(select 1 from jsonb_array_elements(doc->'assignments') aa
   join jsonb_array_elements(doc->'positions') p on p->>'id'=aa->>'positionId'
   where aa->>'userId'=target.id::text and p->>'roleId'=v_role_id::text) then raise exception 'STAFF_ASSIGNMENT_MISMATCH'; end if;
  perform public.update_managed_user_atomic(target.id,jsonb_build_object('role_id',v_role_id),null);
 end loop;
 return jsonb_build_object('version',result_version,'document',doc);
end $$;
revoke all on function public.save_staff_access(jsonb,bigint,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_staff_access(jsonb,bigint,text,jsonb,jsonb) to authenticated;
commit;
