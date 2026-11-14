-- Save explicitly edited Hub memberships and the existing staff profile in one
-- transaction. Untouched memberships, QC grants and rights remain unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.get_staff_operations_access(uuid)') is null
  or not exists(select 1 from pg_proc where oid=to_regprocedure('public.save_staff_profile_access(uuid,text,jsonb)')
    and prosecdef and md5(replace(prosrc,chr(13),''))='21a828c04eca15710f6647067ad26086')
  or to_regprocedure('public.save_staff_profile_operations(uuid,text,jsonb,text,jsonb,jsonb)') is not null then
  raise exception 'STAFF_OPS_SAVE_BASELINE_CHANGED'; end if;
end$$;
create function public.save_staff_profile_operations(
 p_user_id uuid,p_profile_fingerprint text,p_draft jsonb,p_ops_fingerprint text,p_changes jsonb,p_deactivate_qc jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare actor uuid:=auth.uid();tenant uuid;profile_before jsonb;ops_before jsonb;after_profile jsonb;after_ops jsonb;
 item jsonb; branch uuid; branches uuid[]; affected uuid[]; caps text[]; before_row jsonb; after_row jsonb; qrow jsonb;
begin
 -- Existing private snapshot checks owner, active account, tenant and target.
 profile_before:=public._staff_profile_snapshot(p_user_id);
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false) and p.role='owner';
 if tenant is null then raise exception 'STAFF_OWNER_REQUIRED' using errcode='42501';end if;
 if jsonb_typeof(p_draft) is distinct from 'object' or jsonb_typeof(p_draft->'branchIds') is distinct from 'array'
  or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>200
  or jsonb_typeof(p_deactivate_qc) is distinct from 'array' or jsonb_array_length(p_deactivate_qc)>200 then
  raise exception 'STAFF_OPS_INVALID' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_changes) e where jsonb_typeof(e) is distinct from 'object'
  or jsonb_typeof(e->'branchId') is distinct from 'string' or coalesce(e->>'role','') not in ('manager','coordinator','reviewer')
  or jsonb_typeof(e->'active') is distinct from 'boolean' or jsonb_typeof(e->'capabilities') is distinct from 'array')
  or exists(select 1 from jsonb_array_elements_text(p_deactivate_qc) v where v is null)
  or (select count(*) from jsonb_array_elements(p_changes))<>(select count(distinct e->>'branchId') from jsonb_array_elements(p_changes) e)
  or (select count(*) from jsonb_array_elements_text(p_deactivate_qc))<>(select count(distinct v) from jsonb_array_elements_text(p_deactivate_qc) v)
  then raise exception 'STAFF_OPS_INVALID' using errcode='22023';end if;
 branches:=array(select jsonb_array_elements_text(p_draft->'branchIds')::uuid);
 -- Match the Hub writer's tenant/branch advisory lock order before taking the
 -- membership table locks. Sorted order avoids cross-branch lock inversion.
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into affected from (
  select m.branch_id id from public.ops_members m where m.tenant_id=tenant and m.user_id=p_user_id
  union select g.branch_id from public.ops_q_grants g where g.tenant_id=tenant and g.user_id=p_user_id
  union select (e->>'branchId')::uuid from jsonb_array_elements(p_changes) e
  union select v::uuid from jsonb_array_elements_text(p_deactivate_qc) v
 ) x;
 foreach branch in array affected loop perform pg_advisory_xact_lock(hashtextextended(tenant::text||branch::text,0));end loop;
 lock table public.ops_members,public.ops_q_grants in share row exclusive mode;
 ops_before:=public.get_staff_operations_access(p_user_id);
 if p_ops_fingerprint is distinct from ops_before->>'fingerprint' then raise exception 'STAFF_OPS_STALE' using errcode='40001';end if;
 -- Only a previously assigned branch being removed is constrained. Historical
 -- out-of-scope memberships are preserved and explicitly shown in the editor.
 if exists(select 1 from public.ops_members m where m.tenant_id=tenant and m.user_id=p_user_id and m.active
  and (profile_before->'user'->'branchIds') ? m.branch_id::text and not m.branch_id=any(branches)
  and not exists(select 1 from jsonb_array_elements(p_changes) e where e->>'branchId'=m.branch_id::text and (e->>'active')::boolean=false)) then
  raise exception 'STAFF_OPS_BRANCH_CONFLICT' using errcode='22023';end if;
 if exists(select 1 from public.ops_q_grants g where g.tenant_id=tenant and g.user_id=p_user_id and g.active
  and (profile_before->'user'->'branchIds') ? g.branch_id::text and not g.branch_id=any(branches)
  and not (p_deactivate_qc ? g.branch_id::text)) then raise exception 'STAFF_OPS_QC_BRANCH_CONFLICT' using errcode='22023';end if;
 -- Check all explicit changes, and require a deliberate QC disable before an
 -- active manager assignment would suppress an existing auditor/corrector.
 for item in select * from jsonb_array_elements(p_changes) loop
  branch:=(item->>'branchId')::uuid;
  if not exists(select 1 from public.branches b where b.id=branch and b.tenant_id=tenant)
   or ((item->>'active')::boolean and (not branch=any(branches) or not exists(select 1 from public.branches b where b.id=branch and b.tenant_id=tenant and b.is_active))) then
   raise exception 'STAFF_OPS_BRANCH_INVALID' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements_text(item->'capabilities') v where v not in ('verify','close_period','cancel_todo','approve_policy','manage_members')
    and not exists(select 1 from public.ops_members old where old.tenant_id=tenant and old.user_id=p_user_id and old.branch_id=branch and v=any(old.capabilities)))
   or (select count(*) from jsonb_array_elements_text(item->'capabilities'))<>(select count(distinct v) from jsonb_array_elements_text(item->'capabilities') v) then
   raise exception 'STAFF_OPS_CAPABILITIES_INVALID' using errcode='22023';end if;
  if (item->>'active')::boolean and item->>'role'='manager' and exists(select 1 from public.ops_q_grants g
   where g.tenant_id=tenant and g.user_id=p_user_id and g.branch_id=branch and g.active and (g.can_audit or g.can_correct))
   and not (p_deactivate_qc ? branch::text) then raise exception 'STAFF_OPS_QC_CONFLICT' using errcode='22023';end if;
 end loop;
 for branch in select value::uuid from jsonb_array_elements_text(p_deactivate_qc) loop
  select to_jsonb(g) into qrow from public.ops_q_grants g where g.tenant_id=tenant and g.user_id=p_user_id and g.branch_id=branch and g.active;
  if qrow is null then raise exception 'STAFF_OPS_QC_INVALID' using errcode='22023';end if;
  update public.ops_q_grants set active=false where tenant_id=tenant and user_id=p_user_id and branch_id=branch;
  insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
   values(tenant,branch,p_user_id,'staff_profile_qc_deactivated',actor,qrow,qrow||jsonb_build_object('active',false),'Explicit staff profile change');
 end loop;
 -- All staff and Hub writes share this transaction; a subsequent error rolls back both.
 after_profile:=public.save_staff_profile_access(p_user_id,p_profile_fingerprint,p_draft);
 for item in select * from jsonb_array_elements(p_changes) loop
  branch:=(item->>'branchId')::uuid;
  if (item->>'active')::boolean and (not coalesce(public.user_has_permission(p_user_id,'ops.view'),false)
    or not exists(select 1 from public.profiles p where p.id=p_user_id and p.tenant_id=tenant and p.is_active)) then
   raise exception 'STAFF_OPS_VIEW_REQUIRED' using errcode='22023';end if;
  select to_jsonb(m) into before_row from public.ops_members m where m.tenant_id=tenant and m.user_id=p_user_id and m.branch_id=branch;
  caps:=array(select value from jsonb_array_elements_text(item->'capabilities') order by value);
  if before_row is not null and before_row->>'member_role'=item->>'role' and (before_row->>'active')::boolean=(item->>'active')::boolean
   and (select coalesce(array_agg(v order by v),'{}'::text[]) from jsonb_array_elements_text(before_row->'capabilities') v)=caps then continue;end if;
  insert into public.ops_members(tenant_id,branch_id,user_id,member_role,capabilities,active)
   values(tenant,branch,p_user_id,item->>'role',caps,(item->>'active')::boolean)
   on conflict(tenant_id,branch_id,user_id) do update set member_role=excluded.member_role,capabilities=excluded.capabilities,active=excluded.active
   returning to_jsonb(ops_members.*) into after_row;
  insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
   values(tenant,branch,p_user_id,'staff_profile_membership_saved',actor,before_row,after_row,'Explicit staff profile change');
 end loop;
 after_ops:=public.get_staff_operations_access(p_user_id);
 return jsonb_build_object('profile',after_profile,'operations',after_ops);
end$$;
revoke all on function public.save_staff_profile_operations(uuid,text,jsonb,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_staff_profile_operations(uuid,text,jsonb,text,jsonb,jsonb) to authenticated;
-- Old browser sessions must refresh rather than bypassing the Hub/QC check.
-- The new SECURITY DEFINER wrapper retains permission to call this function.
revoke execute on function public.save_staff_profile_access(uuid,text,jsonb) from authenticated;
commit;
