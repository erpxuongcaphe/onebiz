-- Definition only; existing accounts and business data are not changed on apply.
-- 00515 is already used by the parallel operational-unit release.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create table public.user_system_role_changes (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 target_id uuid not null references public.profiles(id),
 request_id uuid not null,
 request_body jsonb not null,
 before_role text not null,
 after_role text not null,
 reason text not null,
 created_at timestamptz not null default now(),
 unique(tenant_id,actor_id,request_id)
);
create index user_system_role_changes_target on public.user_system_role_changes(tenant_id,target_id,created_at desc);
alter table public.user_system_role_changes enable row level security;
revoke all on public.user_system_role_changes from public,anon,authenticated;
grant select on public.user_system_role_changes to authenticated;
create policy system_role_history_owner on public.user_system_role_changes for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.tenant_id=user_system_role_changes.tenant_id and p.role='owner' and p.is_active));

create function public.set_user_system_role_atomic(p_target uuid,p_expected_role text,p_make_owner boolean,
 p_reason text,p_confirmation text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target public.profiles; previous public.user_system_role_changes;
 body jsonb; next_role text; change_id uuid;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if actor.id is null then raise exception 'ROLE_AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('system-role:'||actor.tenant_id::text,0));
 select * into actor from public.profiles where id=auth.uid() and is_active for update;
 if actor.id is null or actor.role<>'owner' then raise exception 'ROLE_OWNER_REQUIRED' using errcode='42501'; end if;
 if p_target=actor.id then raise exception 'ROLE_SELF_CHANGE' using errcode='42501'; end if;
 if p_request is null or p_make_owner is null or length(trim(coalesce(p_reason,''))) not between 5 and 1000
   or length(coalesce(p_expected_role,'')) not between 1 and 32
   then raise exception 'ROLE_INVALID_REQUEST'; end if;
 select * into target from public.profiles where id=p_target and tenant_id=actor.tenant_id for update;
 if target.id is null then raise exception 'ROLE_TARGET_NOT_FOUND' using errcode='42501'; end if;
 if lower(trim(coalesce(p_confirmation,'')))<>lower(coalesce(target.email,'')) or coalesce(target.email,'')=''
  then raise exception 'ROLE_CONFIRMATION'; end if;
 body:=jsonb_build_object('target',p_target,'expectedRole',p_expected_role,'makeOwner',p_make_owner,'reason',trim(p_reason),'confirmation',lower(trim(p_confirmation)));
 select * into previous from public.user_system_role_changes where tenant_id=actor.tenant_id and actor_id=actor.id and request_id=p_request;
 if found then
  if previous.request_body is distinct from body then raise exception 'ROLE_REQUEST_CONFLICT'; end if;
  return jsonb_build_object('id',previous.id,'role',previous.after_role);
 end if;
 if target.role is distinct from p_expected_role then raise exception 'ROLE_STALE'; end if;
 if not target.is_active then raise exception 'ROLE_TARGET_INACTIVE'; end if;
 if p_make_owner=(target.role='owner') then raise exception 'ROLE_STALE'; end if;
 if not p_make_owner and not exists(select 1 from public.profiles p where p.tenant_id=actor.tenant_id and p.id<>target.id and p.role='owner' and p.is_active)
  then raise exception 'ROLE_LAST_OWNER'; end if;
 next_role:=case when p_make_owner then 'owner' else 'staff' end;
 update public.profiles set role=next_role where id=target.id and tenant_id=actor.tenant_id;
 insert into public.user_system_role_changes(tenant_id,actor_id,target_id,request_id,request_body,before_role,after_role,reason)
 values(actor.tenant_id,actor.id,target.id,p_request,body,target.role,next_role,trim(p_reason)) returning id into change_id;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(actor.tenant_id,actor.id,'update','user',target.id,
  jsonb_build_object('system_role',target.role),jsonb_build_object('system_role',next_role,'reason',trim(p_reason),'request_id',p_request,'atomic',true));
 return jsonb_build_object('id',change_id,'role',next_role);
end $$;
revoke all on function public.set_user_system_role_atomic(uuid,text,boolean,text,text,uuid) from public,anon;
grant execute on function public.set_user_system_role_atomic(uuid,text,boolean,text,text,uuid) to authenticated;

-- Keep ordinary profile updates, but require ownership withdrawal before disabling an owner.
alter function public.update_managed_user_atomic(uuid,jsonb,uuid[]) rename to update_managed_user_pre_system_roles;
revoke all on function public.update_managed_user_pre_system_roles(uuid,jsonb,uuid[]) from public,anon,authenticated;
create function public.update_managed_user_atomic(p_target_user_id uuid,p_profile_patch jsonb default '{}'::jsonb,p_branch_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target public.profiles;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if actor.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('system-role:'||actor.tenant_id::text,0));
 select * into target from public.profiles where id=p_target_user_id and tenant_id=actor.tenant_id for update;
 if target.role='owner' and p_profile_patch ? 'is_active' and not (p_profile_patch->>'is_active')::boolean
  then raise exception 'OWNER_WITHDRAW_BEFORE_DEACTIVATION' using errcode='42501'; end if;
 return public.update_managed_user_pre_system_roles(p_target_user_id,p_profile_patch,p_branch_ids);
end $$;
revoke all on function public.update_managed_user_atomic(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.update_managed_user_atomic(uuid,jsonb,uuid[]) to authenticated;
commit;
