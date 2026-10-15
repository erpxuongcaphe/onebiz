begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.ops_quality_read(p_branch uuid,p_period text,p_kind text default 'work',p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; visible boolean; rows jsonb; n integer; off integer:=coalesce((p_filters->>'offset')::integer,0);
 entity uuid:=(p_filters->>'entity')::uuid; search text:=lower(coalesce(p_filters->>'search',''));
 start_at timestamptz:=(p_filters->>'from')::timestamptz; end_at timestamptz:=(p_filters->>'to')::timestamptz; result jsonb;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED'; end if;
 if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' or off not between 0 and 100000 or p_kind not in ('work','issues','qc','settings','report','history') or length(search)>200
  or num_nonnulls(start_at,end_at) not in (0,2) or start_at>=end_at then raise exception 'OPS_INVALID_RANGE'; end if;
 visible:=public.ops_q_can(p_branch,'view');
 if not visible and not (p_kind in ('issues','history') and exists(select 1 from public.ops_q_issues i join public.ops_todos t on t.id=i.todo_id where i.branch_id=p_branch and i.tenant_id=p.tenant_id and public.ops_todo_visible(t.id))) then raise exception 'OPS_FORBIDDEN'; end if;

 if p_kind='work' then
  with items as (
   select to_jsonb(r)||jsonb_build_object('frequency',s.frequency,'category',coalesce(c.category,'other'),'code',c.code,
    'manager_ids',coalesce(x.manager_ids,array[r.assignee_id]),
    'checks',(select coalesce(jsonb_agg(to_jsonb(k) order by k.created_at desc,k.id desc),'[]') from (select * from public.ops_q_checks where run_id=r.id order by created_at desc,id desc limit 10) k)) data
   from public.ops_runs r join public.ops_standards s on s.id=r.standard_id
   left join public.ops_q_assignments x on x.tenant_id=r.tenant_id and x.branch_id=r.branch_id and x.family_id=r.family_id
   left join lateral(select * from public.ops_q_catalog where branch_id=r.branch_id and family_id=r.family_id and effective_from<=(r.original_due_at at time zone 'Asia/Ho_Chi_Minh')::date order by effective_from desc,version desc limit 1) c on true
   where r.branch_id=p_branch and r.tenant_id=p.tenant_id
    and position(search in lower(r.title||' '||coalesce(c.code,'')))>0
    and (coalesce(p_filters->>'frequency','')='' or s.frequency=p_filters->>'frequency')
    and (coalesce(p_filters->>'result','')='' or r.quality=p_filters->>'result')
    and (coalesce(p_filters->>'category','')='' or coalesce(c.category,'other')=p_filters->>'category')
    and (nullif(p_filters->>'assignee','') is null or (p_filters->>'assignee')::uuid=any(coalesce(x.manager_ids,array[r.assignee_id])))
    and (coalesce(p_filters->>'mine','false')<>'true' or p.id=any(coalesce(x.manager_ids,array[r.assignee_id])))
    and (coalesce(p_filters->>'overdue','false')<>'true' or r.quality<>'met' and r.original_due_at<now())
    and (start_at is null and to_char(r.original_due_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM')=p_period or start_at is not null and
     case when p_filters->>'dateField'='checked' then (select max(created_at) from public.ops_q_checks where run_id=r.id) when p_filters->>'dateField'='completed' then r.met_at else r.original_due_at end>=start_at and
     case when p_filters->>'dateField'='checked' then (select max(created_at) from public.ops_q_checks where run_id=r.id) when p_filters->>'dateField'='completed' then r.met_at else r.original_due_at end<end_at)
  ) select (select count(*) from items),coalesce((select jsonb_agg(data) from (select data from items order by data->>'original_due_at',data->>'id' limit 50 offset off) page),'[]') into n,rows;
 elsif p_kind='issues' then
  with items as (
   select to_jsonb(t)||to_jsonb(i)||jsonb_build_object('state',i.stage,'version',t.version,'sources',(select coalesce(jsonb_agg(to_jsonb(src)),'[]') from public.ops_q_sources src where src.issue_id=i.id),'rechecks',(select coalesce(jsonb_agg(to_jsonb(rc) order by rc.created_at desc),'[]') from public.ops_q_rechecks rc where rc.issue_id=i.id)) data
   from public.ops_q_issues i join public.ops_todos t on t.id=i.todo_id
   where i.branch_id=p_branch and i.tenant_id=p.tenant_id and public.ops_todo_visible(t.id)
    and (entity is null or i.id=entity) and position(search in lower(t.title||' '||t.description))>0
    and (coalesce(p_filters->>'state','')='' or i.stage=p_filters->>'state')
    and (coalesce(p_filters->>'category','')='' or t.category=p_filters->>'category')
    and (coalesce(p_filters->>'priority','')='' or t.priority=p_filters->>'priority')
    and (nullif(p_filters->>'assignee','') is null or t.assignee_id=(p_filters->>'assignee')::uuid)
    and (nullif(p_filters->>'operator','') is null or i.operator_id=(p_filters->>'operator')::uuid)
    and (nullif(p_filters->>'department','') is null or i.department_id=(p_filters->>'department')::uuid)
    and (coalesce(p_filters->>'mine','false')<>'true' or t.assignee_id=p.id or i.operator_id=p.id or p.id=any(t.collaborators))
    and (coalesce(p_filters->>'overdue','false')<>'true' or i.stage not in ('done','canceled') and t.due_at<now())
    and (start_at is null or case p_filters->>'dateField' when 'created' then t.created_at when 'completed' then t.completed_at else t.due_at end>=start_at and case p_filters->>'dateField' when 'created' then t.created_at when 'completed' then t.completed_at else t.due_at end<end_at)
  ) select (select count(*) from items),coalesce((select jsonb_agg(data) from (select data from items order by data->>'due_at',data->>'id' limit 50 offset off) page),'[]') into n,rows;
 elsif p_kind='qc' then
  if entity is null then
   with items as(select * from public.ops_q_audits a where a.branch_id=p_branch and a.tenant_id=p.tenant_id and a.period=p_period
    and (coalesce(p_filters->>'state','')='' or a.state=p_filters->>'state') and position(search in lower(a.title))>0
    and (nullif(p_filters->>'assignee','') is null or a.auditor_id=(p_filters->>'assignee')::uuid)
    and (start_at is null or a.created_at>=start_at and a.created_at<end_at))
   select (select count(*) from items),coalesce((select jsonb_agg(to_jsonb(page)) from(select * from items order by created_at desc,id desc limit 50 offset off) page),'[]') into n,rows;
  else
   if not exists(select 1 from public.ops_q_audits where id=entity and tenant_id=p.tenant_id and branch_id=p_branch) then raise exception 'OPS_FORBIDDEN'; end if;
   with items as(select to_jsonb(l)||jsonb_build_object('version',l.version+(select count(*) from public.ops_q_corrections where line_id=l.id),'issue_ids',(select coalesce(jsonb_agg(issue_id),'[]') from public.ops_q_sources where qc_line_id=l.id),
    'corrections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc),'[]') from public.ops_q_corrections c where c.line_id=l.id)) data
    from public.ops_q_lines l where l.audit_id=entity and (coalesce(p_filters->>'result','')='' or l.result=p_filters->>'result') and position(search in lower(l.item_snapshot->>'title'))>0)
   select (select count(*) from items),coalesce((select jsonb_agg(data) from (select data from items order by data->>'id' limit 50 offset off) page),'[]') into n,rows;
  end if;
 elsif p_kind='history' then
  if entity is null then raise exception 'OPS_INVALID_RANGE'; end if;
  if not visible and not exists(select 1 from public.ops_q_issues where id=entity and tenant_id=p.tenant_id and branch_id=p_branch and public.ops_todo_visible(todo_id)) then raise exception 'OPS_FORBIDDEN'; end if;
  select count(*),coalesce(jsonb_agg(to_jsonb(page)),'[]') into n,rows from (
   select a.id,a.action,a.created_at,coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz') actor_name,a.before_data,a.after_data,a.reason
   from public.ops_audit a join public.profiles u on u.id=a.actor_id and u.tenant_id=a.tenant_id where a.entity_id=entity and a.branch_id=p_branch and a.tenant_id=p.tenant_id order by a.created_at desc,a.id desc limit 50 offset off
  ) page;
 elsif p_kind='report' then
  with items as(select e.id,e.audit_id,e.delta,e.critical_delta,e.kind,e.reason,e.created_at,a.title audit_title,l.item_snapshot->>'title' item_title,
   coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz') actor_name
   from public.ops_q_events e join public.ops_q_audits a on a.id=e.audit_id join public.ops_q_lines l on l.id=e.line_id join public.profiles u on u.id=e.actor_id
   where e.branch_id=p_branch and e.tenant_id=p.tenant_id and e.period=p_period
    and position(search in lower(a.title||' '||(l.item_snapshot->>'title')||' '||e.reason))>0
    and (nullif(p_filters->>'assignee','') is null or e.actor_id=(p_filters->>'assignee')::uuid)
    and (start_at is null or e.created_at>=start_at and e.created_at<end_at))
  select (select count(*) from items),coalesce((select jsonb_agg(to_jsonb(page)) from (select * from items order by created_at desc,id desc limit 50 offset off) page),'[]') into n,rows;
 else rows:='[]'; n:=0;
 end if;
 result:=jsonb_build_object('rows',rows,'total',n,'offset',off,'limit',50,
  'audit',case when p_kind='qc' and entity is not null then (select to_jsonb(a) from public.ops_q_audits a where a.id=entity and a.branch_id=p_branch and a.tenant_id=p.tenant_id) else null end,
  'can',jsonb_build_object('manage',public.ops_q_can(p_branch,'manage'),'work',public.ops_q_can(p_branch,'work'),'qc',public.ops_q_can(p_branch,'qc'),'correct',public.ops_q_can(p_branch,'correct'),'accounting',public.ops_q_can(p_branch,'accounting'),'close',public.ops_q_can(p_branch,'close')),
  'departments',coalesce((select jsonb_agg(to_jsonb(d)) from public.ops_q_departments d where d.branch_id=p_branch and d.tenant_id=p.tenant_id and (visible or p.id=any(d.members))),'[]'),
  'assignments',case when visible then coalesce((select jsonb_agg(to_jsonb(x)) from public.ops_q_assignments x where x.branch_id=p_branch and x.tenant_id=p.tenant_id),'[]') else '[]'::jsonb end,
  'grants',case when public.ops_q_can(p_branch,'manage') then coalesce((select jsonb_agg(to_jsonb(g)) from public.ops_q_grants g where g.branch_id=p_branch and g.tenant_id=p.tenant_id),'[]') else '[]'::jsonb end,
  'catalog',case when visible then coalesce((select jsonb_agg(to_jsonb(c)) from (select distinct on(family_id) * from public.ops_q_catalog where branch_id=p_branch and tenant_id=p.tenant_id order by family_id,effective_from desc,version desc) c),'[]') else '[]'::jsonb end,
  'rules',case when visible then coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.ops_q_rules where branch_id=p_branch and tenant_id=p.tenant_id order by created_at desc limit 50) r),'[]') else '[]'::jsonb end,
  'score',case when visible then public.ops_q_score(p_branch,p_period) else null end,
  'settlement',case when visible then (select jsonb_build_object('id',s.id,'revision',s.revision,'snapshot',s.snapshot,'created_at',s.created_at) from public.ops_q_settlements s where s.branch_id=p_branch and s.tenant_id=p.tenant_id and s.period=p_period order by revision desc limit 1) else null end,
  'accounting',case when visible then coalesce((select jsonb_agg(to_jsonb(x)) from public.ops_q_accounting x where x.branch_id=p_branch and x.tenant_id=p.tenant_id and x.period=p_period),'[]') else '[]'::jsonb end);
 return result;
end $$;
revoke all on function public.ops_quality_read(uuid,text,text,jsonb) from public,anon;
grant execute on function public.ops_quality_read(uuid,text,text,jsonb) to authenticated;
commit;
