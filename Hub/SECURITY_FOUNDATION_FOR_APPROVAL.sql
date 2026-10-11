-- Proposed security change. NOT APPLIED to production.
-- Only catalog/ACL/policies/functions; no business-row updates.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

-- Stop instead of silently installing against a different database contract.
do $$
declare signature text; function_record record;
begin
 foreach signature in array array[
  'public.get_user_tenant_id()', 'public.user_has_permission(uuid,text)',
  'public.update_own_profile_atomic(text,text)',
  'public.update_managed_user_atomic(uuid,jsonb,uuid[])',
  'public.initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[])',
  'public.save_role_atomic(uuid,jsonb,text[])', 'public.delete_role_atomic(uuid)',
  'public.save_branch_atomic(uuid,jsonb)', 'public.update_branch_settings_atomic(uuid,jsonb)',
  'public.patch_tenant_settings_atomic(text,jsonb,boolean)'
 ] loop
  if to_regprocedure(signature) is null then
   raise exception 'FOUNDATION_CONTRACT_MISSING: %',signature;
  end if;
  select p.prosecdef, r.rolsuper, r.rolbypassrls into function_record
   from pg_proc p join pg_roles r on r.oid=p.proowner
   where p.oid=to_regprocedure(signature);
  if not function_record.prosecdef or not (function_record.rolsuper or function_record.rolbypassrls) then
   raise exception 'FOUNDATION_FUNCTION_OWNER_UNSAFE: %',signature;
  end if;
 end loop;
end $$;

-- Existing RPCs are SECURITY DEFINER. Direct table mutation is not needed.
do $$
declare table_name text; column_name text;
begin
 foreach table_name in array array['profiles','branches','tenants','roles','role_permissions','user_branches'] loop
  execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from public,anon,authenticated',table_name);
  for column_name in select a.attname from pg_attribute a
    where a.attrelid=to_regclass('public.'||table_name) and a.attnum>0 and not a.attisdropped loop
   execute format('revoke insert(%I),update(%I),references(%I) on public.%I from public,anon,authenticated',column_name,column_name,column_name,table_name);
  end loop;
 end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.branches enable row level security;
alter table public.tenants enable row level security;

-- Active-state read helper has no parameters and reveals no business data.
create function public.foundation_actor_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and coalesce(is_active,true));
$$;
revoke all on function public.foundation_actor_active() from public,anon;
grant execute on function public.foundation_actor_active() to authenticated;
-- Avoid querying profiles recursively from its own RLS policy.
create policy foundation_profile_scope on public.profiles as restrictive for select to authenticated using(
 id=auth.uid() or (tenant_id=public.get_user_tenant_id() and public.foundation_actor_active()));
create policy foundation_profile_read on public.profiles for select to authenticated
 using(id=auth.uid() or tenant_id=public.get_user_tenant_id());
create policy foundation_branch_scope on public.branches as restrictive for select to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.foundation_actor_active());
create policy foundation_branch_read on public.branches for select to authenticated
 using(tenant_id=public.get_user_tenant_id());
create policy foundation_tenant_scope on public.tenants as restrictive for select to authenticated
 using(id=public.get_user_tenant_id() and public.foundation_actor_active());
create policy foundation_tenant_read on public.tenants for select to authenticated
 using(id=public.get_user_tenant_id());

-- Keep existing own-tenant reads; mutation requires actual OneBiz permission.
drop policy if exists overrides_admin_write on public.user_permission_overrides;
create function public.foundation_override_allowed(p_tenant uuid,p_target uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles actor join public.profiles target on target.tenant_id=actor.tenant_id
  where actor.id=auth.uid() and coalesce(actor.is_active,true) and actor.tenant_id=p_tenant and target.id=p_target
   and public.user_has_permission(actor.id,'system.manage_roles')
   and (actor.role='owner' or (target.id<>actor.id and target.role<>'owner')));
$$;
revoke all on function public.foundation_override_allowed(uuid,uuid) from public,anon;
grant execute on function public.foundation_override_allowed(uuid,uuid) to authenticated;
create policy foundation_override_insert on public.user_permission_overrides for insert to authenticated
 with check(public.foundation_override_allowed(tenant_id,user_id));
create policy foundation_override_update on public.user_permission_overrides for update to authenticated
 using(public.foundation_override_allowed(tenant_id,user_id)) with check(public.foundation_override_allowed(tenant_id,user_id));
create policy foundation_override_delete on public.user_permission_overrides for delete to authenticated
 using(public.foundation_override_allowed(tenant_id,user_id));
create policy foundation_override_insert_fence on public.user_permission_overrides as restrictive for insert to authenticated
 with check(public.foundation_override_allowed(tenant_id,user_id));
create policy foundation_override_update_fence on public.user_permission_overrides as restrictive for update to authenticated
 using(public.foundation_override_allowed(tenant_id,user_id)) with check(public.foundation_override_allowed(tenant_id,user_id));
create policy foundation_override_delete_fence on public.user_permission_overrides as restrictive for delete to authenticated
 using(public.foundation_override_allowed(tenant_id,user_id));

-- Insert narrow guards into the inspected definitions; preserve all other logic.
do $$
declare signature text; definition text; guard text; marker text;
begin
 for signature,guard in values
 ('public.update_managed_user_atomic(uuid,jsonb,uuid[])',
  'if p_target_user_id=auth.uid() and (p_profile_patch ? ''role_id'' or p_branch_ids is not null) then raise exception ''SELF_ACCESS_CHANGE_DENIED'' using errcode=''42501''; end if;'),
 ('public.initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[])',
  'if p_target_user_id=auth.uid() then raise exception ''SELF_ACCESS_CHANGE_DENIED'' using errcode=''42501''; end if;'),
 ('public.save_role_atomic(uuid,jsonb,text[])',
  'if exists(select 1 from public.profiles where id=auth.uid() and role<>''owner'' and role_id=p_role_id) then raise exception ''SELF_ROLE_CHANGE_DENIED'' using errcode=''42501''; end if;'),
 ('public.delete_role_atomic(uuid)',
  'if exists(select 1 from public.profiles where id=auth.uid() and role<>''owner'' and role_id=p_role_id) then raise exception ''SELF_ROLE_CHANGE_DENIED'' using errcode=''42501''; end if;')
 loop
  definition:=pg_get_functiondef(to_regprocedure(signature));
  marker:=case when position(E'begin\r\n' in definition)>0 then E'begin\r\n' else E'begin\n' end;
  if position(marker in definition)=0 or position(guard in definition)>0 then
   raise exception 'FOUNDATION_FUNCTION_DRIFT: %',signature;
  end if;
  -- Only the outer BEGIN; preserve nested blocks without inserting guards again.
  execute overlay(definition placing marker||guard||E'\n' from position(marker in definition) for length(marker));
 end loop;
end $$;
commit;
