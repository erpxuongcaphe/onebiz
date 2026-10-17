-- Additive entry point only. Existing work, permissions and results are unchanged.
-- Applying a library creates one set of standards per branch, shared by its managers.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.ops_working_library_execute_v2(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id(); assignment jsonb; assignments jsonb:='[]'; normalized jsonb;
 users jsonb; u jsonb; bid uuid; entry jsonb; result jsonb; cached public.ops_requests; family uuid;
begin
 if tenant is null or not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_action is distinct from 'apply' then
  return public.ops_working_library_execute(p_action,p_payload,p_request_id);
 end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object'
  or jsonb_typeof(p_payload->'assignments') is distinct from 'array'
  or jsonb_array_length(p_payload->'assignments') not between 1 and 20 then raise exception 'OPS_INVALID_SCHEDULE'; end if;
 for assignment in select value from jsonb_array_elements(p_payload->'assignments') loop
  -- Legacy single-manager clients remain valid, without guessing extra managers.
  if assignment ? 'assigneeIds' and assignment ? 'assigneeId' then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  users:=case when assignment ? 'assigneeIds' then assignment->'assigneeIds' else jsonb_build_array(assignment->'assigneeId') end;
  if jsonb_typeof(users) is distinct from 'array' or jsonb_array_length(users) not between 1 and 20 then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  if jsonb_array_length(users)<>(select count(distinct value) from jsonb_array_elements(users)) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  for u in select value from jsonb_array_elements(users) loop
   if jsonb_typeof(u) is distinct from 'string' or u#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  end loop;
  if jsonb_array_length(users)<>(select count(distinct (value#>>'{}')::uuid) from jsonb_array_elements(users)) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  assignments:=assignments||jsonb_build_array((assignment-'assigneeId')||jsonb_build_object('assigneeIds',users,'assigneeId',users->>0));
 end loop;
 normalized:=p_payload||jsonb_build_object('assignments',assignments);
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||'ops-working-library',0));
 select * into cached from public.ops_requests where tenant_id=tenant and user_id=auth.uid() and request_id=p_request_id;
 if found then
  if cached.request_body is distinct from jsonb_build_object('action','working_library:apply','payload',normalized) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return cached.response;
 end if;
 -- Validate every manager before any writes. Never grant membership or permissions here.
 for assignment in select value from jsonb_array_elements(assignments) loop
  bid:=(assignment->>'branchId')::uuid;
  if not public.ops_can(bid,'approve_policy') or not public.ops_q_can(bid,'manage') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  for u in select value from jsonb_array_elements(assignment->'assigneeIds') loop
   if not public.ops_person_eligible(bid,(u#>>'{}')::uuid,'manager') then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  end loop;
 end loop;
 result:=public.ops_working_library_execute(p_action,normalized,p_request_id);
 for assignment in select value from jsonb_array_elements(assignments) loop
  bid:=(assignment->>'branchId')::uuid;
  for entry in select value from jsonb_array_elements(result->'applications') where value->>'branchId'=bid::text loop
   for family in select distinct s.family_id from public.ops_standards s
    where s.tenant_id=tenant and s.branch_id=bid and s.workbook_batch_id=(entry->>'batchId')::uuid loop
    perform public.ops_quality_execute('assignment',jsonb_build_object('branchId',bid,'familyId',family,'managerIds',assignment->'assigneeIds'),gen_random_uuid());
   end loop;
  end loop;
 end loop;
 return result;
end $$;
revoke all on function public.ops_working_library_execute_v2(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_working_library_execute_v2(text,jsonb,uuid) to authenticated;

-- Keep the legacy Excel-import screen consistent: draft first, explicit approval
-- later, with the same shared-manager assignment after activation.
create function public.ops_workbook_import_v2(p_request_id uuid,p_body jsonb,p_activate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id(); batch public.ops_workbook_batches; normalized jsonb:=p_body;
 assignments jsonb:='[]'; assignment jsonb; users jsonb; u jsonb; bid uuid; result jsonb; family uuid;
begin
 if tenant is null or not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'OPS_INVALID_RESULT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||'ops-workbook',0));
 select * into batch from public.ops_workbook_batches where id=p_request_id and tenant_id=tenant for update;
 if p_activate then
  if batch.id is null then raise exception 'OPS_INVALID_STATE'; end if;
  if batch.state='approved' then return public.ops_workbook_import(p_request_id,null,true); end if;
  normalized:=batch.request_body;
 end if;
 if jsonb_typeof(normalized->'assignments') is distinct from 'array' or jsonb_array_length(normalized->'assignments') not between 1 and 100 then raise exception 'OPS_INVALID_ASSIGNMENT'; end if;
 for assignment in select value from jsonb_array_elements(normalized->'assignments') loop
  users:=case when assignment ? 'assigneeIds' then assignment->'assigneeIds' else jsonb_build_array(assignment->'assigneeId') end;
  if jsonb_typeof(users) is distinct from 'array' or jsonb_array_length(users) not between 1 and 20
   or jsonb_array_length(users)<>(select count(distinct value) from jsonb_array_elements(users)) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  if assignment ? 'assigneeId' and assignment ? 'assigneeIds' and assignment->>'assigneeId' is distinct from users->>0 then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  bid:=(assignment->>'branchId')::uuid;
  if not public.ops_can(bid,'approve_policy') or not public.ops_q_can(bid,'manage') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  for u in select value from jsonb_array_elements(users) loop
   if jsonb_typeof(u) is distinct from 'string' or (u#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
   if not public.ops_person_eligible(bid,(u#>>'{}')::uuid,'manager') then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  end loop;
  if jsonb_array_length(users)<>(select count(distinct (value#>>'{}')::uuid) from jsonb_array_elements(users)) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  assignments:=assignments||jsonb_build_array(assignment||jsonb_build_object('assigneeIds',users,'assigneeId',users->>0));
 end loop;
 if p_activate then
  result:=public.ops_workbook_import(p_request_id,null,true);
  for assignment in select value from jsonb_array_elements(assignments) loop
   bid:=(assignment->>'branchId')::uuid;
   for family in select distinct family_id from public.ops_standards where tenant_id=tenant and branch_id=bid and workbook_batch_id=p_request_id loop
    perform public.ops_quality_execute('assignment',jsonb_build_object('branchId',bid,'familyId',family,'managerIds',assignment->'assigneeIds'),gen_random_uuid());
   end loop;
  end loop;
  return result;
 end if;
 return public.ops_workbook_import(p_request_id,normalized||jsonb_build_object('assignments',assignments),false);
end $$;
revoke all on function public.ops_workbook_import_v2(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.ops_workbook_import_v2(uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
