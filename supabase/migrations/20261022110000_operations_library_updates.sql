-- Additive Hub mechanism only; no automatic application to branch work.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.ops_q_catalog add column ends_on date;
alter table public.ops_q_catalog add constraint ops_q_catalog_end_date check(ends_on is null or ends_on >= effective_from);

-- A stopped shared criterion must not enter a new QC audit after its end date.
-- Existing audit snapshots and score events are deliberately untouched.
do $patch$
declare f record; definition text; count_patched integer := 0;
 needle text := 'c.effective_from<=(now() at time zone ''Asia/Ho_Chi_Minh'')::date and exists';
begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname like 'ops_quality_execute%' loop
  definition := pg_get_functiondef(f.oid);
  if strpos(definition,needle)>0 then
   execute replace(definition,needle,'(c.ends_on is null or c.ends_on>=(now() at time zone ''Asia/Ho_Chi_Minh'')::date) and '||needle);
   count_patched := count_patched+1;
  end if;
 end loop;
 if count_patched<>1 then raise exception 'Hub QC baseline changed; abort library update installation'; end if;
end $patch$;

create function public.ops_library_update_preview(p_library uuid,p_version integer,p_branches uuid[],p_effective date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid := public.get_user_tenant_id(); lib public.ops_working_libraries; app public.ops_working_library_applications;
 b uuid; old_rows jsonb; old_row jsonb; new_row jsonb; change_row record; s public.ops_standards; c public.ops_q_catalog;
 v_code text; row_conflict boolean; changes jsonb; plans jsonb := '[]'; impact jsonb; current_rows jsonb; fingerprints text := '';
 today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; managers uuid[];
begin
 if tenant is null or not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_effective is null or p_effective<=today or p_branches is null or cardinality(p_branches) not between 1 and 20
  or cardinality(p_branches)<>(select count(distinct x) from unnest(p_branches) x) then raise exception 'OPS_INVALID_SCHEDULE'; end if;
 select * into lib from public.ops_working_libraries where id=p_library and tenant_id=tenant and not archived;
 if lib.id is null or lib.version is distinct from p_version then raise exception 'OPS_LIBRARY_STALE'; end if;
 perform public.ops_working_library_check(lib.rows);
 for b in select x from unnest(p_branches) x order by x loop
  if not public.ops_can(b,'approve_policy') or not public.ops_q_can(b,'manage') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  select * into app from public.ops_working_library_applications where tenant_id=tenant and library_id=lib.id and branch_id=b;
  if app.id is null or app.library_version>=lib.version then raise exception 'OPS_LIBRARY_UPDATE_NOT_NEEDED'; end if;
  if nullif(app.settings->>'libraryUpdateFrom','')::date>today then raise exception 'OPS_LIBRARY_UPDATE_PENDING'; end if;
  select document->'rows' into old_rows from public.ops_working_library_versions where tenant_id=tenant and library_id=lib.id and version=app.library_version;
  if old_rows is null then raise exception 'OPS_LIBRARY_STALE'; end if;
  changes := '[]';
  for change_row in
   select coalesce(o.value->>'number',n.value->>'number')::integer number,o.value old_value,n.value new_value
   from jsonb_array_elements(old_rows) o full join jsonb_array_elements(lib.rows) n on o.value->>'number'=n.value->>'number'
   where o.value is distinct from n.value order by 1
  loop
   old_row := change_row.old_value; new_row := change_row.new_value;
   v_code := 'WS-'||replace(lib.id::text,'-','')||'-'||lpad(change_row.number::text,4,'0');
   select * into c from public.ops_q_catalog where tenant_id=tenant and branch_id=b and ops_q_catalog.code=v_code order by version desc limit 1;
   select * into s from public.ops_standards where tenant_id=tenant and branch_id=b and family_id=c.family_id order by revision desc limit 1;
   row_conflict := false; impact := null;
   if old_row is null then
    row_conflict := c.id is not null;
   else
    -- Never overwrite a branch override or an unfinished local proposal.
    row_conflict := s.id is null or s.status<>'approved' or s.stop_after is not null or c.ends_on is not null
     or s.title is distinct from old_row->>'title' or s.description is distinct from old_row->>'requirement'
     or s.frequency is distinct from old_row->>'frequency'
     or s.day_number is distinct from coalesce((old_row->>'dayNumber')::integer,case when old_row->>'frequency'='weekly' then coalesce((app.settings->>'weeklyDay')::integer,1) else 1 end)
     or s.month_number is distinct from (old_row->>'monthNumber')::integer
     or s.due_time is distinct from (app.settings->>'dueTime')::time
     or s.effective_until is distinct from case when old_row->>'frequency'='once' then null else nullif(app.settings->>'effectiveUntil','')::date end
     or c.weight is distinct from abs((old_row->>'points')::numeric)
     or c.score_type is distinct from case when (old_row->>'points')::numeric>0 then 'bonus' else 'deduct' end
     or lower(trim(c.group_title)) is distinct from lower(trim(old_row->>'group'))
     or c.critical is distinct from (old_row->>'critical')::boolean
     or c.accounting_required is distinct from (old_row->>'accountingRequired')::boolean
     or s.criteria is distinct from jsonb_build_array(jsonb_build_object('id',v_code,'title',old_row->>'requirement','kind','boolean','operator','eq','threshold',1,'samples',1,'critical',(old_row->>'critical')::boolean,'evidenceRequired',false))
     or s.effective_from>=p_effective or s.effective_until<p_effective;
    if s.id is not null then
     impact := public.ops_schedule_impact(s.id,p_effective);
     select manager_ids into managers from public.ops_q_assignments where tenant_id=tenant and branch_id=b and family_id=s.family_id;
     if managers is null or exists(select 1 from unnest(managers) person where not public.ops_person_eligible(b,person,'manager')) then row_conflict := true; end if;
     fingerprints := fingerprints||to_jsonb(s)::text||to_jsonb(c)::text||coalesce(managers::text,'')||impact::text;
    end if;
   end if;
   if old_row is null then
    managers := case when app.settings ? 'assigneeIds' then array(select jsonb_array_elements_text(app.settings->'assigneeIds')::uuid) else array[(app.settings->>'assigneeId')::uuid] end;
    if managers is null or cardinality(managers)=0 or exists(select 1 from unnest(managers) person where not public.ops_person_eligible(b,person,'manager')) then row_conflict := true; end if;
   end if;
   if new_row is not null and new_row->>'frequency'='weekly' and new_row->>'dayNumber' is null then row_conflict := true; end if;
   changes := changes||jsonb_build_array(jsonb_build_object('number',change_row.number,'kind',case when old_row is null then 'add' when new_row is null then 'remove' else 'edit' end,
    'before',old_row,'after',new_row,'standardId',s.id,'conflict',row_conflict,'impact',impact,
    'current',case when s.id is null then null else jsonb_build_object('title',s.title,'requirement',s.description,'group',c.group_title,
      'frequency',s.frequency,'dueTime',s.due_time,'points',case when c.score_type='bonus' then c.weight else -c.weight end,
      'criteria',s.criteria,'status',s.status,'stopAfter',s.stop_after,'effectiveUntil',s.effective_until) end));
  end loop;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.family_id),'[]') into current_rows from public.ops_q_assignments a where a.tenant_id=tenant and a.branch_id=b;
  fingerprints := fingerprints||to_jsonb(app)::text||current_rows::text;
  plans := plans||jsonb_build_array(jsonb_build_object('branchId',b,'fromVersion',app.library_version,'changes',changes));
 end loop;
 return jsonb_build_object('libraryId',lib.id,'version',lib.version,'effectiveFrom',p_effective,'branches',plans,
  'token',md5(to_jsonb(lib)::text||plans::text||fingerprints||p_effective::text));
end $$;
revoke all on function public.ops_library_update_preview(uuid,integer,uuid[],date) from public,anon,authenticated;
grant execute on function public.ops_library_update_preview(uuid,integer,uuid[],date) to authenticated;

create function public.ops_library_update_execute(p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid := public.get_user_tenant_id(); cached public.ops_requests; lib public.ops_working_libraries; app public.ops_working_library_applications;
 plan jsonb; branch_plan jsonb; change_row jsonb; row jsonb; s public.ops_standards; created jsonb; impact jsonb;
 bid uuid; gid uuid; sid uuid; family uuid; managers uuid[]; criteria jsonb; code text; result jsonb; before_row jsonb;
 from_day date := (p_payload->>'effectiveFrom')::date; reason text := trim(coalesce(p_payload->>'reason','')); branches uuid[];
begin
 if tenant is null or not public.ops_ceo() or not public.ops_has_permission('ops.configure') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or length(reason) not between 5 and 1000
  or jsonb_typeof(p_payload->'branchIds') is distinct from 'array' then raise exception 'OPS_INVALID_RESULT'; end if;
 branches := array(select jsonb_array_elements_text(p_payload->'branchIds')::uuid);
 if cardinality(branches) not between 1 and 20 or cardinality(branches)<>(select count(distinct x) from unnest(branches) x) then raise exception 'OPS_INVALID_SCHEDULE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||'ops-working-library',0));
 perform 1 from public.profiles where id=auth.uid() and tenant_id=tenant and is_active for update;
 for bid in select x from unnest(branches) x loop
  if not public.ops_can(bid,'approve_policy') or not public.ops_q_can(bid,'manage') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 end loop;
 select * into cached from public.ops_requests where tenant_id=tenant and user_id=auth.uid() and request_id=p_request_id;
 if found then
  if cached.request_body is distinct from jsonb_build_object('action','working_library:update','payload',p_payload) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return cached.response;
 end if;
 for bid in select x from unnest(branches) x order by x loop
  perform pg_advisory_xact_lock(hashtextextended(bid::text||'ops-generate',0));
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||bid::text,0));
 end loop;
 plan := public.ops_library_update_preview((p_payload->>'id')::uuid,(p_payload->>'version')::integer,branches,from_day);
 if plan->>'token' is distinct from p_payload->>'token' then raise exception 'OPS_LIBRARY_UPDATE_STALE'; end if;
 if exists(select 1 from jsonb_array_elements(plan->'branches') b,jsonb_array_elements(b->'changes') r where (r->>'conflict')::boolean) then raise exception 'OPS_LIBRARY_BRANCH_OVERRIDE'; end if;
 select * into lib from public.ops_working_libraries where id=(p_payload->>'id')::uuid and tenant_id=tenant for update;
 for branch_plan in select value from jsonb_array_elements(plan->'branches') loop
  bid := (branch_plan->>'branchId')::uuid;
  select * into app from public.ops_working_library_applications where tenant_id=tenant and library_id=lib.id and branch_id=bid for update;
  for change_row in select value from jsonb_array_elements(branch_plan->'changes') loop
   row := change_row->'after';
   code := 'WS-'||replace(lib.id::text,'-','')||'-'||lpad(change_row->>'number',4,'0');
   select * into s from public.ops_standards where id=(change_row->>'standardId')::uuid and tenant_id=tenant and branch_id=bid for update;
   if change_row->>'kind'='remove' then
    -- Cancel only empty future instances; completed/linked instances remain intact.
    impact := public.ops_schedule_impact(s.id,from_day);
    update public.ops_runs set schedule_canceled_at=now(),schedule_cancel_reason=reason,version=version+1
     where tenant_id=tenant and branch_id=bid and id in (select (value->>'id')::uuid from jsonb_array_elements(impact->'replaceable'));
    update public.ops_standards set stop_after=from_day-1 where tenant_id=tenant and branch_id=bid and family_id=s.family_id;
    update public.ops_q_catalog set ends_on=from_day-1 where tenant_id=tenant and branch_id=bid and family_id=s.family_id and (ends_on is null or ends_on>=from_day);
    insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
     values(tenant,bid,s.id,'library_remove_criterion',auth.uid(),to_jsonb(s),jsonb_build_object('stop_after',from_day-1,'impact',impact),reason);
   else
    if s.id is null then
     family := gen_random_uuid();
     managers := case when app.settings ? 'assigneeIds' then array(select jsonb_array_elements_text(app.settings->'assigneeIds')::uuid) else array[(app.settings->>'assigneeId')::uuid] end;
    else
     family := s.family_id;
     select manager_ids into managers from public.ops_q_assignments where tenant_id=tenant and branch_id=bid and family_id=family;
    end if;
    criteria := jsonb_build_array(jsonb_build_object('id',code,'title',row->>'requirement','kind','boolean','operator','eq','threshold',1,'samples',1,'critical',(row->>'critical')::boolean,'evidenceRequired',false));
    created := public.ops_execute('standard',jsonb_build_object('branchId',bid,'familyId',family,'revision',coalesce(s.revision,0)+1,
     'scope','common','title',row->>'title','description',row->>'requirement','assigneeId',managers[1],
     'frequency',row->>'frequency','dayNumber',coalesce((row->>'dayNumber')::integer,1),'monthNumber',row->'monthNumber',
     'dueTime',app.settings->>'dueTime','effectiveFrom',from_day,'effectiveUntil',case when row->>'frequency'='once' then null else app.settings->'effectiveUntil' end,'criteria',criteria,'reason',reason),gen_random_uuid());
    sid := (created->>'id')::uuid;
    if s.id is null then
     perform public.ops_execute('approve_standard',jsonb_build_object('branchId',bid,'id',sid),gen_random_uuid());
    else
     impact := public.ops_schedule_impact(sid,from_day);
     perform public.ops_execute('approve_standard',jsonb_build_object('branchId',bid,'id',sid,'impactToken',impact->>'token','futurePolicy','replace_empty','reason',reason),gen_random_uuid());
    end if;
    perform public.ops_quality_execute('assignment',jsonb_build_object('branchId',bid,'familyId',family,'managerIds',to_jsonb(managers)),gen_random_uuid());
    select id into gid from public.ops_q_groups where tenant_id=tenant and branch_id=bid and lower(trim(title))=lower(trim(row->>'group')) and active;
    if gid is null then
     if exists(select 1 from public.ops_q_groups where tenant_id=tenant and branch_id=bid and lower(trim(title))=lower(trim(row->>'group'))) then raise exception 'OPS_LIBRARY_BRANCH_OVERRIDE'; end if;
     insert into public.ops_q_groups(tenant_id,branch_id,title,created_by) values(tenant,bid,row->>'group',auth.uid()) returning id into gid;
    end if;
    perform public.ops_quality_execute('catalog',jsonb_build_object('branchId',bid,'standardId',sid,'code',code,'category','group:'||gid,
     'scoreType',case when (row->>'points')::numeric>0 then 'bonus' else 'deduct' end,'weight',abs((row->>'points')::numeric),
     'effectiveFrom',from_day,'critical',(row->>'critical')::boolean,'accountingRequired',(row->>'accountingRequired')::boolean),gen_random_uuid());
   end if;
  end loop;
  before_row := to_jsonb(app);
  update public.ops_working_library_applications set library_version=lib.version,settings=settings||jsonb_build_object('libraryUpdateFrom',from_day)
   where id=app.id returning to_jsonb(ops_working_library_applications.*) into result;
  insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason)
   values(tenant,bid,app.id,'library_update',auth.uid(),before_row,result||jsonb_build_object('changes',branch_plan->'changes'),reason);
 end loop;
 result := plan-'token';
 insert into public.ops_requests values(tenant,auth.uid(),p_request_id,jsonb_build_object('action','working_library:update','payload',p_payload),result);
 return result;
end $$;
revoke all on function public.ops_library_update_execute(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ops_library_update_execute(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
