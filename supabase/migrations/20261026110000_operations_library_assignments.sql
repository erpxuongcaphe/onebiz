-- Additive, explicitly initiated branch assignment changes only. No automatic data updates.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.ops_library_assignments_preview(p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id(); bid uuid:=(p_payload->>'branchId')::uuid;
 lib uuid:=(p_payload->>'id')::uuid; mode text:=p_payload->>'mode';
 app public.ops_working_library_applications; row record; selected uuid[]; people uuid[]; prior uuid[]; following uuid[];
 plans jsonb:='[]'; fingerprint text:=''; eligible boolean; touched integer:=0; matched integer:=0;
 today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 if tenant is null or not public.ops_ceo() or not public.ops_has_permission('ops.configure')
  or not public.ops_can(bid,'approve_policy') or not public.ops_q_can(bid,'manage') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 select * into app from public.ops_working_library_applications where tenant_id=tenant and library_id=lib and branch_id=bid;
 if app.id is null then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if mode is null or mode not in ('read','add','remove','replace') then raise exception 'OPS_INVALID_RESULT'; end if;
 if mode<>'read' then
  if jsonb_typeof(p_payload->'familyIds') is distinct from 'array' or jsonb_typeof(p_payload->'managerIds') is distinct from 'array' then raise exception 'OPS_INVALID_RESULT'; end if;
  selected:=array(select jsonb_array_elements_text(p_payload->'familyIds')::uuid);
  people:=array(select jsonb_array_elements_text(p_payload->'managerIds')::uuid);
  if cardinality(selected) not between 1 and 200 or cardinality(people) not between 1 and 20
   or cardinality(selected)<>(select count(distinct x) from unnest(selected) x)
   or cardinality(people)<>(select count(distinct x) from unnest(people) x)
   or array_position(selected,null) is not null or array_position(people,null) is not null then raise exception 'OPS_INVALID_RESULT'; end if;
  -- Removing a formerly eligible person remains possible; additions/replacements require current eligibility.
  if mode<>'remove' and exists(select 1 from unnest(people) u where not public.ops_person_eligible(bid,u,'manager')) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
 end if;
 for row in
  select c.code,c.group_title,c.ends_on,s.*,a.manager_ids
  from (select distinct on (family_id) * from public.ops_q_catalog where tenant_id=tenant and branch_id=bid
    and code like 'WS-'||replace(lib::text,'-','')||'-%' order by family_id,version desc,id) c
  join lateral(select * from public.ops_standards st where st.tenant_id=tenant and st.branch_id=bid and st.family_id=c.family_id order by revision desc limit 1) s on true
  left join public.ops_q_assignments a on a.tenant_id=tenant and a.branch_id=bid and a.family_id=s.family_id
  order by c.code,s.family_id
 loop
  prior:=array(select distinct u from unnest(coalesce(row.manager_ids,array[row.assignee_id])) u order by u);
  following:=prior;
  eligible:=row.status='approved' and (row.stop_after is null or row.stop_after>=today)
    and (row.effective_until is null or row.effective_until>=today) and (row.ends_on is null or row.ends_on>=today);
  if mode<>'read' and row.family_id=any(selected) then
   matched:=matched+1;
   if not eligible then raise exception 'OPS_ASSIGNMENT_STALE'; end if;
   following:=case when mode='replace' then array(select u from unnest(people) u order by u)
    when mode='add' then array(select distinct u from unnest(prior||people) u order by u)
    else array(select u from unnest(prior) u where not u=any(people) order by u) end;
   if cardinality(following)=0 then raise exception 'OPS_ASSIGNMENT_EMPTY'; end if;
   if cardinality(following)>20 or exists(select 1 from unnest(following) u where not public.ops_person_eligible(bid,u,'manager')) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
   if following is distinct from prior then touched:=touched+1; end if;
  end if;
  fingerprint:=fingerprint||to_jsonb(row)::text||prior::text;
  plans:=plans||jsonb_build_array(jsonb_build_object('familyId',row.family_id,'number',substring(row.code from '([0-9]+)$')::integer,
   'title',row.title,'group',row.group_title,'before',to_jsonb(prior),'after',to_jsonb(following),'editable',eligible,'changed',following is distinct from prior));
 end loop;
 if mode<>'read' and matched<>cardinality(selected) then raise exception 'OPS_ASSIGNMENT_STALE'; end if;
 return jsonb_build_object('libraryId',lib,'branchId',bid,'rows',plans,'changed',touched,
  'people',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.id) from public.profiles p
    where p.tenant_id=tenant and exists(select 1 from jsonb_array_elements(plans) r where r->'before' ? p.id::text)),'[]'::jsonb),
  'token',md5(to_jsonb(app)::text||fingerprint||coalesce(selected::text,'')||coalesce(people::text,'')||mode));
end $$;
revoke all on function public.ops_library_assignments_preview(jsonb) from public,anon,authenticated;
grant execute on function public.ops_library_assignments_preview(jsonb) to authenticated;

create function public.ops_library_assignments_execute(p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id(); bid uuid:=(p_payload->>'branchId')::uuid;
 lib uuid:=(p_payload->>'id')::uuid; cached public.ops_requests; plan jsonb; item jsonb; result jsonb;
 reason text:=trim(coalesce(p_payload->>'reason',''));
begin
 if tenant is null or not public.ops_ceo() or not public.ops_has_permission('ops.configure')
  or not public.ops_can(bid,'approve_policy') or not public.ops_q_can(bid,'manage') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or length(reason) not between 5 and 1000
  or p_payload->>'mode' is null or p_payload->>'mode' not in ('add','remove','replace') then raise exception 'OPS_INVALID_RESULT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||'ops-working-library',0));
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||bid::text,0));
 select * into cached from public.ops_requests where tenant_id=tenant and user_id=auth.uid() and request_id=p_request_id;
 if found then
  if cached.request_body is distinct from jsonb_build_object('action','library_assignments','payload',p_payload) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return cached.response;
 end if;
 plan:=public.ops_library_assignments_preview(p_payload);
 if p_payload->>'token' is distinct from plan->>'token' then raise exception 'OPS_ASSIGNMENT_STALE'; end if;
 for item in select value from jsonb_array_elements(plan->'rows') where (value->>'changed')::boolean loop
  perform public.ops_quality_execute('assignment',jsonb_build_object('branchId',bid,'familyId',item->>'familyId','managerIds',item->'after','note',reason),gen_random_uuid());
  insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
    values(tenant,bid,(item->>'familyId')::uuid,'library_assignment_changed',auth.uid(),
      jsonb_build_object('libraryId',lib,'managerIds',item->'before'),jsonb_build_object('libraryId',lib,'managerIds',item->'after'),reason);
 end loop;
 result:=jsonb_build_object('changed',plan->'changed','branchId',bid);
 insert into public.ops_requests(tenant_id,user_id,request_id,request_body,response) values(tenant,auth.uid(),p_request_id,jsonb_build_object('action','library_assignments','payload',p_payload),result);
 return result;
end $$;
revoke all on function public.ops_library_assignments_execute(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_library_assignments_execute(jsonb,uuid) to authenticated;
commit;
