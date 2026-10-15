-- Additive Hub only. Apply/test on an isolated database before explicit production approval.
-- No automatic conversion of legacy verification, scores, stock or financial records.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.ops_q_departments (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, title text not null check(length(trim(title)) between 1 and 120),
 members uuid[] not null default '{}', active boolean not null default true, version integer not null default 1,
 unique(tenant_id,branch_id,title)
);
create table public.ops_q_assignments (
 tenant_id uuid not null references public.tenants, branch_id uuid not null references public.branches,
 family_id uuid not null, manager_ids uuid[] not null check(cardinality(manager_ids) between 1 and 20),
 primary key(tenant_id,branch_id,family_id)
);
create table public.ops_q_grants (
 tenant_id uuid not null references public.tenants, branch_id uuid not null references public.branches,
 user_id uuid not null references public.profiles, can_audit boolean not null default false,
 can_correct boolean not null default false, can_accounting boolean not null default false,
 active boolean not null default true, primary key(tenant_id,branch_id,user_id)
);
create table public.ops_q_catalog (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, standard_id uuid not null references public.ops_standards,
 family_id uuid not null, code text not null check(length(trim(code)) between 1 and 80),
 title text not null, category text not null, score_type text not null check(score_type in ('deduct','bonus')),
 weight numeric(8,2) not null check(weight between 0 and 1000), criteria jsonb not null,
 critical boolean not null default false, effective_from date not null, version integer not null,
 created_by uuid not null references public.profiles, created_at timestamptz not null default now(),
 unique(tenant_id,branch_id,family_id,version), unique(tenant_id,branch_id,code,effective_from)
);
create table public.ops_q_rules (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, title text not null check(length(trim(title)) between 1 and 200),
 effective_from date not null, config jsonb not null, state text not null default 'draft' check(state in ('draft','approved')),
 created_by uuid not null references public.profiles, approved_by uuid references public.profiles,
 created_at timestamptz not null default now(), approved_at timestamptz
);
create unique index ops_q_rule_effective on public.ops_q_rules(tenant_id,branch_id,effective_from) where state='approved';
create table public.ops_q_checks (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, run_id uuid not null references public.ops_runs,
 standard_snapshot jsonb not null, observations jsonb not null, result text not null check(result in ('met','unmet','unknown')),
 note text not null default '', actor_id uuid not null references public.profiles,
 created_at timestamptz not null default now(), correction_of uuid references public.ops_q_checks
);
create index ops_q_checks_run on public.ops_q_checks(tenant_id,run_id,created_at desc,id desc);
create table public.ops_q_issues (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, todo_id uuid not null unique references public.ops_todos,
 family_id uuid, department_id uuid references public.ops_q_departments, operator_id uuid references public.profiles,
 stage text not null default 'pending' check(stage in ('pending','in_progress','pending_review','done','canceled')),
 recurrence_of uuid references public.ops_q_issues, updated_at timestamptz not null default now()
);
create index ops_q_issues_scope on public.ops_q_issues(tenant_id,branch_id,stage,updated_at desc);
create table public.ops_q_sources (
 tenant_id uuid not null references public.tenants, branch_id uuid not null references public.branches,
 issue_id uuid not null references public.ops_q_issues, check_id uuid references public.ops_q_checks,
 qc_line_id uuid, created_at timestamptz not null default now(), check(num_nonnulls(check_id,qc_line_id)=1)
);
create unique index ops_q_source_check on public.ops_q_sources(issue_id,check_id) where check_id is not null;
create unique index ops_q_source_qc on public.ops_q_sources(issue_id,qc_line_id) where qc_line_id is not null;
create table public.ops_q_rechecks (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, issue_id uuid not null references public.ops_q_issues,
 result text not null check(result in ('met','unmet')), note text not null check(length(trim(note))>0),
 evidence text not null default '', actor_id uuid not null references public.profiles, created_at timestamptz not null default now()
);
create table public.ops_q_audits (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, period text not null check(period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 title text not null check(length(trim(title)) between 1 and 200), auditor_id uuid not null references public.profiles,
 rule_id uuid references public.ops_q_rules, state text not null default 'draft' check(state in ('draft','completed')),
 version integer not null default 1, created_at timestamptz not null default now(), completed_at timestamptz
);
create index ops_q_audit_period on public.ops_q_audits(tenant_id,branch_id,period,state);
create table public.ops_q_lines (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, audit_id uuid not null references public.ops_q_audits,
 item_id uuid not null references public.ops_q_catalog, item_snapshot jsonb not null,
 result text not null default 'unknown' check(result in ('unknown','met','unmet','excluded')),
 observations jsonb not null default '[]', evidence text not null default '', note text not null default '',
 critical boolean not null default false, version integer not null default 1, unique(audit_id,item_id)
);
alter table public.ops_q_sources add foreign key(qc_line_id) references public.ops_q_lines;
create table public.ops_q_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, audit_id uuid not null references public.ops_q_audits,
 line_id uuid not null references public.ops_q_lines, period text not null,
 delta numeric(8,2) not null, critical_delta integer not null default 0 check(critical_delta between -1 and 1),
 kind text not null check(kind in ('initial','reversal','correction')), reverses uuid unique references public.ops_q_events,
 reason text not null, actor_id uuid not null references public.profiles, created_at timestamptz not null default now()
);
create unique index ops_q_initial_line on public.ops_q_events(line_id) where kind='initial';
create index ops_q_events_period on public.ops_q_events(tenant_id,branch_id,period);
create table public.ops_q_corrections (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, line_id uuid not null references public.ops_q_lines,
 before_data jsonb not null, after_data jsonb not null, reason text not null, evidence text not null,
 actor_id uuid not null references public.profiles, created_at timestamptz not null default now()
);
create table public.ops_q_accounting (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, period text not null check(period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 title text not null, numerator numeric not null check(numerator>=0), denominator numeric not null check(denominator>0),
 unit text not null check(length(trim(unit))>0), evidence text not null check(length(trim(evidence))>0),
 state text not null default 'pending' check(state in ('pending','approved')), version integer not null default 1,
 created_by uuid not null references public.profiles, approved_by uuid references public.profiles, created_at timestamptz not null default now(),
 check(numerator<=denominator)
);
create table public.ops_q_settlements (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, period text not null,
 revision integer not null, snapshot jsonb not null, reason text not null,
 actor_id uuid not null references public.profiles, created_at timestamptz not null default now(),
 unique(tenant_id,branch_id,period,revision)
);

create function public.ops_q_can(p_branch uuid,p_cap text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
 where p.id=auth.uid() and p.is_active and b.id=p_branch and b.is_active and public.ops_has_permission('ops.view') and
 case p_cap
 when 'manage' then public.ops_can(b.id,'approve_policy')
 when 'close' then public.ops_can(b.id,'close_period')
 when 'work' then public.ops_manager(b.id,p.id) and public.ops_can(b.id,'work')
 when 'qc' then public.ops_has_permission('ops.verify') and not exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=b.id and m.user_id=p.id and m.active and m.member_role='manager')
   and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active and g.can_audit)
 when 'correct' then public.ops_has_permission('ops.verify') and not exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=b.id and m.user_id=p.id and m.active and m.member_role='manager')
   and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active and g.can_correct)
 when 'accounting' then public.ops_has_permission('ops.work') and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active and g.can_accounting)
 when 'view' then public.ops_can(b.id,'view')
 else false end);
$$;

create function public.ops_q_rule_errors(c jsonb,p_reward boolean default false) returns jsonb
language plpgsql immutable set search_path='' as $$
declare e jsonb:='[]'; k text;
begin
 if jsonb_typeof(c) is distinct from 'object' then return '["Chưa có chính sách."]'::jsonb; end if;
 foreach k in array array['baseScore','minimumScore','floorScore','capScore','bonusCap'] loop
  if jsonb_typeof(c->k) is distinct from 'number' then e:=e||to_jsonb('Chưa cấu hình '||k);
  elsif (c->>k)::numeric not between 0 and 1000 or round((c->>k)::numeric,2)<>(c->>k)::numeric then e:=e||to_jsonb('Giá trị không hợp lệ: '||k); end if;
 end loop;
 if (c->>'floorScore')::numeric>(c->>'capScore')::numeric then e:=e||'"Sàn lớn hơn trần."'::jsonb; end if;
 if coalesce(c->>'repeatMode','') not in ('each_audit','once_per_issue') then e:=e||'"Chưa chọn quy tắc lỗi lặp."'::jsonb; end if;
 if coalesce(c->>'thresholdBasis','') not in ('before_bonus','after_bonus') then e:=e||'"Chưa chọn cách xét ngưỡng."'::jsonb; end if;
 if jsonb_typeof(c->'allowAbove100') is distinct from 'boolean' then e:=e||'"Chưa chọn chương trình vượt 100."'::jsonb; end if;
 if p_reward then
  if jsonb_typeof(c->'qcFundCents') is distinct from 'number' then e:=e||'"Chưa có quỹ QC."'::jsonb;
  elsif (c->>'qcFundCents')::numeric not between 0 and 9007199254740991 or (c->>'qcFundCents')::numeric<>trunc((c->>'qcFundCents')::numeric) then e:=e||'"Quỹ QC không hợp lệ."'::jsonb; end if;
  if jsonb_typeof(c->'allocations') is distinct from 'array' then e:=e||'"Chưa phân bổ quỹ."'::jsonb;
  elsif jsonb_array_length(c->'allocations')=0 or exists(select 1 from jsonb_array_elements(c->'allocations') a where coalesce(a->>'userId','')='' or jsonb_typeof(a->'shareBps') is distinct from 'number') then e:=e||'"Phân bổ chưa hợp lệ."'::jsonb;
  elsif (select sum((a->>'shareBps')::numeric) from jsonb_array_elements(c->'allocations') a)<>10000 or exists(select 1 from jsonb_array_elements(c->'allocations') a where (a->>'shareBps')::numeric not between 1 and 10000 or (a->>'shareBps')::numeric<>trunc((a->>'shareBps')::numeric))
   or (select count(distinct a->>'userId') from jsonb_array_elements(c->'allocations') a)<>jsonb_array_length(c->'allocations') then e:=e||'"Phân bổ cần đủ 100%, không trùng người."'::jsonb; end if;
 end if;
  foreach k in array array['businessFundCents','businessThresholdBps','businessCapBps'] loop
   if c->k is not null and jsonb_typeof(c->k)<>'null' and (jsonb_typeof(c->k)<>'number' or (c->>k)::numeric<0 or (c->>k)::numeric>9007199254740991 or (c->>k)::numeric<>trunc((c->>k)::numeric)) then e:=e||to_jsonb('Giá trị kinh doanh không hợp lệ: '||k); end if;
  end loop;
  if jsonb_typeof(c->'businessThresholdBps')='number' and jsonb_typeof(c->'businessCapBps')='number' and (c->>'businessCapBps')::numeric<(c->>'businessThresholdBps')::numeric then e:=e||'"Trần kinh doanh thấp hơn ngưỡng."'::jsonb; end if;
 return e;
end $$;

create function public.ops_q_score(p_branch uuid,p_period text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb; d numeric; bonus numeric; critical integer; n integer; score numeric; raw numeric; threshold numeric; errors jsonb; reward numeric;
begin
 if not public.ops_q_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN'; end if;
 select count(*) into n from public.ops_q_audits where branch_id=p_branch and period=p_period and state='completed';
 select r.config into c from public.ops_q_audits a join public.ops_q_rules r on r.id=a.rule_id where a.branch_id=p_branch and a.period=p_period and a.state='completed' order by a.completed_at,a.id limit 1;
 select coalesce(sum(delta) filter(where delta<0),0),coalesce(sum(delta) filter(where delta>0),0),coalesce(sum(critical_delta),0) into d,bonus,critical from (
  select sum(delta) delta,sum(critical_delta) critical_delta from public.ops_q_events where branch_id=p_branch and period=p_period group by line_id
 ) net;
 errors:=public.ops_q_rule_errors(c,false);
 if n>0 and jsonb_array_length(errors)=0 then
  raw:=(c->>'baseScore')::numeric+d+bonus;
  score:=greatest((c->>'floorScore')::numeric,least((c->>'capScore')::numeric,case when (c->>'allowAbove100')::boolean then 1000 else 100 end,(c->>'baseScore')::numeric+d+least(bonus,(c->>'bonusCap')::numeric)));
  errors:=public.ops_q_rule_errors(c,true);
  if jsonb_array_length(errors)=0 then
   threshold:=case c->>'thresholdBasis' when 'before_bonus' then (c->>'baseScore')::numeric+d else score end;
   reward:=case when critical>0 or threshold<(c->>'minimumScore')::numeric then 0 else round(score*(c->>'qcFundCents')::numeric/100) end;
   if reward>9007199254740991 then reward:=null; errors:=errors||'"Thưởng vượt giới hạn số tiền an toàn."'::jsonb; end if;
  end if;
 elsif n=0 then errors:='["Chưa có kết quả QC."]'; end if;
 return jsonb_build_object('official',n>0 and score is not null,'completedAudits',n,'deductions',d,'bonus',bonus,'rawScore',raw,'score',score,'critical',critical>0,'rewardReady',reward is not null,'rewardCents',reward,'reasons',errors,'config',c);
end $$;

create function public.ops_q_new_issue(p_branch uuid,p_payload jsonb,p_family uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.profiles; new_id uuid; tid uuid; dept public.ops_q_departments; manager uuid:=(p_payload->>'assigneeId')::uuid; op uuid:=(p_payload->>'operatorId')::uuid; previous public.ops_q_issues; collaborators uuid[];
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if not public.ops_q_can(p_branch,'work') and not public.ops_q_can(p_branch,'qc') then raise exception 'OPS_FORBIDDEN'; end if;
 if not public.ops_manager(p_branch,manager) or coalesce(trim(p_payload->>'title'),'')='' or coalesce(trim(p_payload->>'description'),'')='' or (p_payload->>'dueAt')::timestamptz is null then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
 if p_payload->>'departmentId' is not null then
  select * into dept from public.ops_q_departments where id=(p_payload->>'departmentId')::uuid and tenant_id=p.tenant_id and branch_id=p_branch and active;
  if dept.id is null then raise exception 'OPS_FORBIDDEN'; end if;
 end if;
 collaborators:=array(select distinct x from unnest(coalesce(dept.members,'{}'::uuid[])||coalesce(array(select jsonb_array_elements_text(p_payload->'collaborators')::uuid),'{}')) x);
 if exists(select 1 from unnest(collaborators||case when op is null then '{}'::uuid[] else array[op] end) u where not exists(select 1 from public.profiles where id=u and tenant_id=p.tenant_id and is_active and public.user_has_permission(id,'ops.view') and public.user_has_permission(id,'ops.work'))) then raise exception 'OPS_FORBIDDEN'; end if;
 if op is not null and op<>manager and not op=any(collaborators) then raise exception 'OPS_FORBIDDEN'; end if;
 if p_payload->>'recurrenceOf' is not null then
  select * into previous from public.ops_q_issues where id=(p_payload->>'recurrenceOf')::uuid and branch_id=p_branch and tenant_id=p.tenant_id and stage='done';
  if previous.id is null then raise exception 'OPS_INVALID_RESULT'; end if;
 end if;
 insert into public.ops_todos(tenant_id,branch_id,title,description,category,priority,assignee_id,collaborators,due_at,original_due_at,created_by)
 values(p.tenant_id,p_branch,p_payload->>'title',p_payload->>'description',p_payload->>'category',p_payload->>'priority',manager,collaborators,(p_payload->>'dueAt')::timestamptz,(p_payload->>'dueAt')::timestamptz,p.id) returning ops_todos.id into tid;
 insert into public.ops_q_issues(tenant_id,branch_id,todo_id,family_id,department_id,operator_id,recurrence_of)
 values(p.tenant_id,p_branch,tid,p_family,dept.id,op,previous.id) returning ops_q_issues.id into new_id;
 return new_id;
end $$;

-- Canonical ordering makes once-per-issue deductions stable after corrections.
-- Reconciliation appends reversals/replacements; it never edits an existing event.
create function public.ops_q_reconcile(p_branch uuid,p_period text) returns void
language plpgsql security definer set search_path='' as $$
declare l record; snapshot jsonb; previous public.ops_q_events; cfg jsonb; claimed text[]:='{}'; linked text[]; expected numeric; critical integer;
begin
 select r.config into cfg from public.ops_q_audits a join public.ops_q_rules r on r.id=a.rule_id where a.branch_id=p_branch and a.period=p_period and a.state='completed' order by a.completed_at,a.id limit 1;
 for l in select line.*,a.completed_at,a.tenant_id audit_tenant from public.ops_q_lines line join public.ops_q_audits a on a.id=line.audit_id where a.branch_id=p_branch and a.period=p_period and a.state='completed' order by a.completed_at,a.id,line.id loop
  select c.after_data into snapshot from public.ops_q_corrections c where c.line_id=l.id order by c.created_at desc,c.id desc limit 1;
  snapshot:=coalesce(snapshot,to_jsonb(l));
  expected:=case when snapshot->>'result'='met' and snapshot->'item_snapshot'->>'score_type'='bonus' then (snapshot->'item_snapshot'->>'weight')::numeric when snapshot->>'result'='unmet' and snapshot->'item_snapshot'->>'score_type'='deduct' then -(snapshot->'item_snapshot'->>'weight')::numeric else 0 end;
  if expected<0 and cfg->>'repeatMode'='once_per_issue' then
   select array_agg((l.item_snapshot->>'family_id')||':'||issue_id::text) into linked from public.ops_q_sources where qc_line_id=l.id;
   if linked is null then raise exception 'OPS_Q_ISSUE_REQUIRED'; end if;
   if not exists(select 1 from unnest(linked) u where not u=any(claimed)) then expected:=0; end if;
   claimed:=array(select distinct u from unnest(claimed||linked) u);
  end if;
  critical:=case when coalesce((snapshot->>'critical')::boolean,false) then 1 else 0 end;
  select e.* into previous from public.ops_q_events e where e.line_id=l.id and e.kind in ('initial','correction') and not exists(select 1 from public.ops_q_events r where r.reverses=e.id) order by e.created_at desc,e.id desc limit 1;
  if previous.id is null then raise exception 'OPS_Q_LOCKED'; end if;
  if previous.delta<>expected or previous.critical_delta<>critical then
   insert into public.ops_q_events(tenant_id,branch_id,audit_id,line_id,period,delta,critical_delta,kind,reverses,reason,actor_id) values(l.audit_tenant,p_branch,l.audit_id,l.id,p_period,-previous.delta,-previous.critical_delta,'reversal',previous.id,'Đối soát quy tắc lỗi lặp sau cập nhật QC',auth.uid());
   insert into public.ops_q_events(tenant_id,branch_id,audit_id,line_id,period,delta,critical_delta,kind,reason,actor_id) values(l.audit_tenant,p_branch,l.audit_id,l.id,p_period,expected,critical,'correction','Đối soát quy tắc lỗi lặp sau cập nhật QC',auth.uid());
  end if;
 end loop;
end $$;

create function public.ops_q_allocations(p_allocations jsonb,p_qc numeric,p_business numeric) returns jsonb
language sql immutable set search_path='' as $$
 with shares as (select value->>'userId' user_id,(value->>'shareBps')::numeric share,
  floor(p_qc*(value->>'shareBps')::numeric/10000) qc,floor(p_business*(value->>'shareBps')::numeric/10000) business
  from jsonb_array_elements(p_allocations)), amounts as(select *,row_number() over(order by user_id) rn,sum(qc) over() sum_qc,sum(business) over() sum_business from shares)
 select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'shareBps',share,'qcCents',qc+case when rn=1 then p_qc-sum_qc else 0 end,'businessCents',business+case when rn=1 then p_business-sum_business else 0 end) order by user_id),'[]') from amounts;
$$;

create function public.ops_quality_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare p public.profiles; b uuid:=(p_payload->>'branchId')::uuid; eid uuid:=(p_payload->>'id')::uuid;
 r public.ops_runs; t public.ops_todos; issue public.ops_q_issues; a public.ops_q_audits; line public.ops_q_lines;
 pol public.ops_q_rules; item public.ops_q_catalog; old_event public.ops_q_events; acc public.ops_q_accounting;
 result jsonb; old_body jsonb; old_data jsonb; ev jsonb; row jsonb; issues jsonb; checks uuid; iid uuid; nextstage text;
 period text:=p_payload->>'period'; delta numeric; crit integer; ver integer; users uuid[]; conf jsonb; revenue public.ops_revenues; target public.ops_targets; business numeric; snap jsonb; rev integer; closed public.ops_q_settlements;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED'; end if;
 if p_request_id is null or not exists(select 1 from public.branches where id=b and tenant_id=p.tenant_id and is_active) or not public.ops_has_permission('ops.view') then raise exception 'OPS_FORBIDDEN'; end if;
 if not (case
  when p_action in ('department','assignment','qc_grant','catalog','catalog_import','rule','rule_approve','accounting_approve') then public.ops_q_can(b,'manage')
  when p_action in ('check','issue','recheck','issue_assign') then public.ops_q_can(b,'work')
  when p_action in ('qc_create','qc_line','qc_complete') then public.ops_q_can(b,'qc')
  when p_action='qc_correct' then public.ops_q_can(b,'correct')
  when p_action='accounting' then public.ops_q_can(b,'accounting')
  when p_action='settle' then public.ops_q_can(b,'close')
  when p_action='issue_update' then public.ops_has_permission('ops.work') and exists(select 1 from public.ops_q_issues i join public.ops_todos td on td.id=i.todo_id where i.id=eid and i.tenant_id=p.tenant_id and i.branch_id=b and public.ops_todo_visible(td.id) and (public.ops_q_can(b,'work') or p.id=any(td.collaborators)))
  else false end) then raise exception 'OPS_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||b::text,0));
 select response,request_body into result,old_body from public.ops_requests where tenant_id=p.tenant_id and user_id=p.id and request_id=p_request_id;
 if found then
  if old_body<>jsonb_build_object('action','quality:'||p_action,'payload',p_payload) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return result;
 end if;

 if p_action='department' then
  users:=array(select distinct jsonb_array_elements_text(p_payload->'members')::uuid);
  if exists(select 1 from unnest(users) u where not exists(select 1 from public.profiles where id=u and tenant_id=p.tenant_id and is_active and public.user_has_permission(id,'ops.view') and public.user_has_permission(id,'ops.work'))) then raise exception 'OPS_FORBIDDEN'; end if;
  if eid is null then
   insert into public.ops_q_departments(tenant_id,branch_id,title,members) values(p.tenant_id,b,p_payload->>'title',users) returning id into eid;
  else
   update public.ops_q_departments set title=p_payload->>'title',members=users,active=(p_payload->>'active')::boolean,version=version+1 where id=eid and tenant_id=p.tenant_id and branch_id=b and version=(p_payload->>'version')::integer;
   if not found then raise exception 'OPS_STALE'; end if;
  end if;
 elsif p_action='assignment' then
  users:=array(select distinct jsonb_array_elements_text(p_payload->'managerIds')::uuid);
  if not exists(select 1 from public.ops_standards where family_id=(p_payload->>'familyId')::uuid and tenant_id=p.tenant_id and branch_id=b) or exists(select 1 from unnest(users) u where not public.ops_manager(b,u)) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  insert into public.ops_q_assignments values(p.tenant_id,b,(p_payload->>'familyId')::uuid,users) on conflict(tenant_id,branch_id,family_id) do update set manager_ids=excluded.manager_ids;
 elsif p_action='qc_grant' then
  eid:=(p_payload->>'userId')::uuid;
  if not public.ops_ceo() or eid=p.id or not exists(select 1 from public.profiles where id=eid and tenant_id=p.tenant_id and is_active and public.user_has_permission(id,'ops.view')) then raise exception 'OPS_FORBIDDEN'; end if;
  insert into public.ops_q_grants values(p.tenant_id,b,eid,coalesce((p_payload->>'canAudit')::boolean,false),coalesce((p_payload->>'canCorrect')::boolean,false),coalesce((p_payload->>'canAccounting')::boolean,false),coalesce((p_payload->>'active')::boolean,true))
  on conflict(tenant_id,branch_id,user_id) do update set can_audit=excluded.can_audit,can_correct=excluded.can_correct,can_accounting=excluded.can_accounting,active=excluded.active;
 elsif p_action in ('catalog','catalog_import') then
  issues:=case when p_action='catalog' then jsonb_build_array(p_payload) else p_payload->'rows' end;
  if jsonb_typeof(issues) is distinct from 'array' or jsonb_array_length(issues) not between 1 and 200 then raise exception 'OPS_INVALID_RESULT'; end if;
  for row in select value from jsonb_array_elements(issues) loop
   if jsonb_typeof(row->'weight') is distinct from 'number' or (row->>'weight')::numeric<0 or round((row->>'weight')::numeric,2)<>(row->>'weight')::numeric then raise exception 'OPS_INVALID_RESULT'; end if;
   select * into r from public.ops_runs where false;
   select * into item from public.ops_q_catalog where false;
   if not exists(select 1 from public.ops_standards s where s.id=(row->>'standardId')::uuid and s.branch_id=b and s.tenant_id=p.tenant_id and s.status='approved') then raise exception 'OPS_INVALID_STANDARD'; end if;
   if (row->>'effectiveFrom')::date<(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'OPS_PAST_EFFECTIVE'; end if;
   select coalesce(max(version),0)+1 into ver from public.ops_q_catalog where branch_id=b and family_id=(select family_id from public.ops_standards where id=(row->>'standardId')::uuid);
   insert into public.ops_q_catalog(tenant_id,branch_id,standard_id,family_id,code,title,category,score_type,weight,criteria,critical,effective_from,version,created_by)
   select p.tenant_id,b,s.id,s.family_id,row->>'code',s.title,row->>'category',row->>'scoreType',(row->>'weight')::numeric,s.criteria,coalesce((row->>'critical')::boolean,false),(row->>'effectiveFrom')::date,ver,p.id from public.ops_standards s where s.id=(row->>'standardId')::uuid returning * into item;
   if item.id is null or item.category not in ('operations','hr','maintenance','complaint','food_safety','product','goods','cleaning','space','equipment','other') then raise exception 'OPS_INVALID_RESULT'; end if;
  end loop;
  eid:=item.id;
 elsif p_action='rule' then
  conf:=p_payload->'config';
  if jsonb_typeof(conf) is distinct from 'object' or pg_column_size(conf)>30000 then raise exception 'OPS_INVALID_POLICY'; end if;
  insert into public.ops_q_rules(tenant_id,branch_id,title,effective_from,config,created_by)
  values(p.tenant_id,b,p_payload->>'title',(p_payload->>'effectiveFrom')::date,conf,p.id) returning id into eid;
 elsif p_action='rule_approve' then
  select * into pol from public.ops_q_rules where id=eid and tenant_id=p.tenant_id and branch_id=b for update;
  if pol.id is null or pol.state<>'draft' then raise exception 'OPS_STALE'; end if;
  if pol.effective_from<(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'OPS_PAST_EFFECTIVE'; end if;
  if jsonb_array_length(public.ops_q_rule_errors(pol.config,false))>0 then raise exception 'OPS_Q_POLICY_INCOMPLETE'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(pol.config->'allocations','[]')) u where not public.ops_manager(b,(u->>'userId')::uuid)) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  update public.ops_q_rules set state='approved',approved_by=p.id,approved_at=now() where id=eid;
 elsif p_action='check' then
  select * into r from public.ops_runs where id=eid and tenant_id=p.tenant_id and branch_id=b for update;
  if r.id is null or r.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
  if exists(select 1 from public.ops_q_assignments x where x.branch_id=b and x.family_id=r.family_id and not p.id=any(x.manager_ids)) or not exists(select 1 from public.ops_q_assignments x where x.branch_id=b and x.family_id=r.family_id) and r.assignee_id<>p.id then raise exception 'OPS_FORBIDDEN'; end if;
  if exists(select 1 from public.ops_periods where branch_id=b and period=to_char(r.original_due_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM')) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  ev:=public.ops_evaluate(r.criteria,p_payload->'observations');
  if ev->>'quality'='unknown' then raise exception 'OPS_Q_MISSING_RESULT'; end if;
  insert into public.ops_q_checks(tenant_id,branch_id,run_id,standard_snapshot,observations,result,note,actor_id)
  values(p.tenant_id,b,r.id,jsonb_build_object('standardId',r.standard_id,'familyId',r.family_id,'criteria',r.criteria,'title',r.title,'period',r.period_key),ev->'observations',ev->>'quality',coalesce(p_payload->>'note',''),p.id) returning id into checks;
  if ev->>'quality'='unmet' then
   issues:=p_payload->'issues';
   if jsonb_typeof(issues) is distinct from 'array' or jsonb_array_length(issues) not between 1 and 20 then raise exception 'OPS_Q_ISSUE_REQUIRED'; end if;
   for row in select value from jsonb_array_elements(issues) loop
    iid:=(row->>'issueId')::uuid;
    if iid is null then iid:=public.ops_q_new_issue(b,row,r.family_id);
    elsif not exists(select 1 from public.ops_q_issues where id=iid and branch_id=b and tenant_id=p.tenant_id and stage not in ('done','canceled')) then raise exception 'OPS_Q_INVALID_LINK'; end if;
    insert into public.ops_q_sources(tenant_id,branch_id,issue_id,check_id) values(p.tenant_id,b,iid,checks) on conflict do nothing;
   end loop;
  end if;
  update public.ops_runs set quality=ev->>'quality',observations=ev->'observations',had_failure=had_failure or ev->>'quality'='unmet',
   state=case when ev->>'quality'='met' then 'done' else 'transferred' end,
   met_at=case when ev->>'quality'='met' then coalesce(met_at,now()) else null end,
   critical_failure=critical_failure or coalesce((ev->>'critical')::boolean,false),version=version+1 where id=r.id;
  eid:=checks;
 elsif p_action='issue' then
  eid:=public.ops_q_new_issue(b,p_payload,(p_payload->>'familyId')::uuid);
 elsif p_action in ('issue_update','recheck','issue_assign') then
  select * into issue from public.ops_q_issues where id=eid and tenant_id=p.tenant_id and branch_id=b for update;
  select * into t from public.ops_todos where id=issue.todo_id for update;
  if issue.id is null or t.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
  if issue.stage in ('done','canceled') then raise exception 'OPS_Q_LOCKED'; end if;
  old_data:=to_jsonb(t)||to_jsonb(issue);
  if p_action='issue_assign' then
   if t.assignee_id<>p.id or coalesce(trim(p_payload->>'note'),'')='' then raise exception 'OPS_FORBIDDEN'; end if;
   nextstage:=issue.stage;
  elsif p_action='recheck' then
   if not public.ops_q_can(b,'work') or t.assignee_id<>p.id then raise exception 'OPS_FORBIDDEN'; end if;
   if issue.stage<>'pending_review' and not coalesce((p_payload->>'selfFix')::boolean,false) then raise exception 'OPS_Q_RECHECK_REQUIRED'; end if;
   if coalesce(trim(p_payload->>'note'),'')='' or coalesce(p_payload->>'result','') not in ('met','unmet') then raise exception 'OPS_INVALID_RESULT'; end if;
   if coalesce((p_payload->>'selfFix')::boolean,false) and coalesce(trim(p_payload->>'resolution'),'')='' then raise exception 'OPS_REASON_REQUIRED'; end if;
   insert into public.ops_q_rechecks(tenant_id,branch_id,issue_id,result,note,evidence,actor_id) values(p.tenant_id,b,eid,p_payload->>'result',p_payload->>'note',coalesce(p_payload->>'evidence',''),p.id);
   nextstage:=case p_payload->>'result' when 'met' then 'done' else 'in_progress' end;
  else
   nextstage:=p_payload->>'state';
   if nextstage not in ('in_progress','pending_review','canceled') then raise exception 'OPS_INVALID_RESULT'; end if;
   if nextstage='canceled' and (not public.ops_can(b,'cancel_todo') or coalesce(trim(p_payload->>'note'),'')='') then raise exception 'OPS_FORBIDDEN'; end if;
   if nextstage='in_progress' and issue.stage<>'pending' then raise exception 'OPS_Q_RECHECK_REQUIRED'; end if;
   if nextstage='pending_review' and (issue.stage<>'in_progress' or coalesce(trim(p_payload->>'resolution'),'')='') then raise exception 'OPS_Q_RESOLUTION_REQUIRED'; end if;
   if nextstage='in_progress' and issue.operator_id is null then
    if p.id<>t.assignee_id and not p.id=any(t.collaborators) then raise exception 'OPS_FORBIDDEN'; end if;
    update public.ops_q_issues set operator_id=p.id where id=eid;
   elsif nextstage='pending_review' and issue.operator_id is distinct from p.id and t.assignee_id<>p.id then raise exception 'OPS_FORBIDDEN'; end if;
  end if;
  if p_payload ? 'assigneeId' or p_payload ? 'dueAt' then
   if not public.ops_q_can(b,'work') or t.assignee_id<>p.id or coalesce(trim(p_payload->>'note'),'')='' then raise exception 'OPS_FORBIDDEN'; end if;
   if p_payload ? 'assigneeId' and not public.ops_manager(b,(p_payload->>'assigneeId')::uuid) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  end if;
  update public.ops_q_issues set stage=nextstage,updated_at=now() where id=eid;
  update public.ops_todos set state=case nextstage when 'pending_review' then 'waiting' else nextstage end,
   resolution=coalesce(nullif(p_payload->>'resolution',''),resolution),cancel_reason=case when nextstage='canceled' then p_payload->>'note' else cancel_reason end,
   due_at=coalesce((p_payload->>'dueAt')::timestamptz,due_at),assignee_id=coalesce((p_payload->>'assigneeId')::uuid,assignee_id),
   completed_at=case when nextstage='done' then now() else null end,version=version+1 where id=t.id;
  -- Rechecks deliberately do not change self-check runs, QC lines or score events.
 elsif p_action='qc_create' then
  if period is null or period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'OPS_INVALID_RANGE'; end if;
  if exists(select 1 from public.ops_q_settlements where branch_id=b and ops_q_settlements.period=period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  select pr.* into pol from public.ops_q_audits prior join public.ops_q_rules pr on pr.id=prior.rule_id where prior.branch_id=b and prior.period=period and prior.state='completed' order by prior.completed_at,prior.id limit 1;
  if pol.id is null then select * into pol from public.ops_q_rules where branch_id=b and state='approved' and effective_from<=least(((period||'-01')::date+interval '1 month'-interval '1 day')::date,(now() at time zone 'Asia/Ho_Chi_Minh')::date) order by effective_from desc limit 1; end if;
  if exists(select 1 from public.ops_q_audits where branch_id=b and ops_q_audits.period=period and state='completed' and rule_id is distinct from pol.id) then raise exception 'OPS_Q_POLICY_CHANGED'; end if;
  insert into public.ops_q_audits(tenant_id,branch_id,period,title,auditor_id,rule_id) values(p.tenant_id,b,period,p_payload->>'title',p.id,pol.id) returning * into a;
  for item in select distinct on(c.family_id) c.* from public.ops_q_catalog c where c.branch_id=b and c.tenant_id=p.tenant_id and c.effective_from<=(now() at time zone 'Asia/Ho_Chi_Minh')::date order by c.family_id,c.effective_from desc,c.version desc loop
   insert into public.ops_q_lines(tenant_id,branch_id,audit_id,item_id,item_snapshot) values(p.tenant_id,b,a.id,item.id,to_jsonb(item));
  end loop;
  if not exists(select 1 from public.ops_q_lines where audit_id=a.id) then raise exception 'OPS_Q_CATALOG_REQUIRED'; end if;
  eid:=a.id;
 elsif p_action in ('qc_line','qc_complete','qc_correct') then
  if p_action in ('qc_line','qc_correct') then
   select * into line from public.ops_q_lines where id=eid and tenant_id=p.tenant_id and branch_id=b for update;
   select * into a from public.ops_q_audits where id=line.audit_id for update;
   if line.id is null or (line.version+(select count(*)::integer from public.ops_q_corrections where line_id=line.id)) is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
  else
   select * into a from public.ops_q_audits where id=eid and tenant_id=p.tenant_id and branch_id=b for update;
   if a.id is null or a.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
  end if;
  if p_action<>'qc_correct' and (a.state<>'draft' or a.auditor_id<>p.id) then raise exception 'OPS_FORBIDDEN'; end if;
  select * into closed from public.ops_q_settlements where branch_id=b and ops_q_settlements.period=a.period order by revision desc limit 1;
  if closed.id is not null and not (p_action='qc_correct' and public.ops_q_can(b,'close') and coalesce((p_payload->>'closedConfirm')::boolean,false) and (p_payload->>'settlementRevision')::integer=closed.revision) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  if p_action in ('qc_line','qc_correct') then
   if p_action='qc_correct' and (a.state<>'completed' or coalesce(trim(p_payload->>'note'),'')='' or coalesce(trim(p_payload->>'evidence'),'')='') then raise exception 'OPS_REASON_REQUIRED'; end if;
   old_data:=to_jsonb(line);
   if p_payload->>'result'='excluded' then
    if coalesce(trim(p_payload->>'note'),'')='' then raise exception 'OPS_REASON_REQUIRED'; end if;
    ev:=jsonb_build_object('quality','excluded','observations','[]'::jsonb,'critical',false);
   else
    ev:=public.ops_evaluate(line.item_snapshot->'criteria',p_payload->'observations');
    if ev->>'quality'='unknown' then raise exception 'OPS_Q_MISSING_RESULT'; end if;
   end if;
   if ev->>'quality'='met' and line.item_snapshot->>'score_type'='bonus' and coalesce(trim(p_payload->>'evidence'),'')='' then raise exception 'OPS_Q_EVIDENCE_REQUIRED'; end if;
   if ev->>'quality'='unmet' then
    issues:=p_payload->'issues';
    if jsonb_typeof(issues) is distinct from 'array' or jsonb_array_length(issues) not between 1 and 20 then raise exception 'OPS_Q_ISSUE_REQUIRED'; end if;
    for row in select value from jsonb_array_elements(issues) loop
     iid:=(row->>'issueId')::uuid;
     if iid is null then iid:=public.ops_q_new_issue(b,row,(line.item_snapshot->>'family_id')::uuid);
     elsif not exists(select 1 from public.ops_q_issues i where i.id=iid and i.branch_id=b and i.tenant_id=p.tenant_id and (i.stage not in ('done','canceled') or p_action='qc_correct' and exists(select 1 from public.ops_q_sources src where src.issue_id=i.id and src.qc_line_id=line.id))) then raise exception 'OPS_Q_INVALID_LINK'; end if;
     insert into public.ops_q_sources(tenant_id,branch_id,issue_id,qc_line_id) values(p.tenant_id,b,iid,line.id) on conflict do nothing;
    end loop;
   end if;
   if p_action='qc_line' then
    update public.ops_q_lines set result=ev->>'quality',observations=ev->'observations',evidence=coalesce(p_payload->>'evidence',''),note=coalesce(p_payload->>'note',''),critical=ev->>'quality'='unmet' and ((line.item_snapshot->>'critical')::boolean or (ev->>'critical')::boolean),version=version+1 where id=line.id returning * into line;
   else
    line.result:=ev->>'quality'; line.observations:=ev->'observations'; line.evidence:=p_payload->>'evidence'; line.note:=p_payload->>'note';
    line.critical:=line.result='unmet' and ((line.item_snapshot->>'critical')::boolean or (ev->>'critical')::boolean);
    insert into public.ops_q_corrections(tenant_id,branch_id,line_id,before_data,after_data,reason,evidence,actor_id)
    values(p.tenant_id,b,line.id,old_data,to_jsonb(line),line.note,line.evidence,p.id);
   end if;
   if p_action='qc_correct' then
    select * into old_event from public.ops_q_events where line_id=line.id and kind in ('initial','correction') and not exists(select 1 from public.ops_q_events x where x.reverses=ops_q_events.id) order by created_at desc,id desc limit 1;
    if old_event.id is null then raise exception 'OPS_Q_LOCKED'; end if;
    insert into public.ops_q_events(tenant_id,branch_id,audit_id,line_id,period,delta,critical_delta,kind,reverses,reason,actor_id) values(p.tenant_id,b,a.id,line.id,a.period,-old_event.delta,-old_event.critical_delta,'reversal',old_event.id,p_payload->>'note',p.id);
   end if;
   update public.ops_q_audits set version=version+1 where id=a.id;
  end if;
  if p_action in ('qc_complete','qc_correct') then
   select * into pol from public.ops_q_rules where id=a.rule_id and state='approved';
   if pol.id is null and p_action='qc_complete' and a.rule_id is null then
    select * into pol from public.ops_q_rules where branch_id=b and state='approved' and effective_from<=least(((a.period||'-01')::date+interval '1 month'-interval '1 day')::date,(now() at time zone 'Asia/Ho_Chi_Minh')::date) order by effective_from desc limit 1;
    if pol.id is not null then update public.ops_q_audits set rule_id=pol.id where id=a.id; a.rule_id:=pol.id; end if;
   end if;
   if exists(select 1 from public.ops_q_audits other where other.branch_id=b and other.period=a.period and other.state='completed' and other.rule_id is distinct from a.rule_id) then raise exception 'OPS_Q_POLICY_CHANGED'; end if;
   if pol.id is null or jsonb_array_length(public.ops_q_rule_errors(pol.config,false))>0 then raise exception 'OPS_Q_POLICY_INCOMPLETE'; end if;
   if p_action='qc_complete' and (not exists(select 1 from public.ops_q_lines l where l.audit_id=a.id and l.result in ('met','unmet')) or exists(select 1 from public.ops_q_lines l where l.audit_id=a.id and (l.result='unknown' or l.result='unmet' and not exists(select 1 from public.ops_q_sources where qc_line_id=l.id)))) then raise exception 'OPS_Q_MISSING_RESULT'; end if;
   for row in select to_jsonb(l) data from public.ops_q_lines l where l.audit_id=a.id and (p_action='qc_complete' or l.id=eid) order by l.id loop
    if p_action='qc_complete' then select * into line from jsonb_populate_record(null::public.ops_q_lines,row); end if;
    delta:=case when line.result='met' and line.item_snapshot->>'score_type'='bonus' then (line.item_snapshot->>'weight')::numeric when line.result='unmet' and line.item_snapshot->>'score_type'='deduct' then -(line.item_snapshot->>'weight')::numeric else 0 end;
    if delta<0 and pol.config->>'repeatMode'='once_per_issue' then
     if exists(select 1 from public.ops_q_sources s join public.ops_q_sources other on other.issue_id=s.issue_id join public.ops_q_events e on e.line_id=other.qc_line_id where s.qc_line_id=line.id and other.qc_line_id<>line.id and e.period=a.period and e.delta<0 and not exists(select 1 from public.ops_q_events x where x.reverses=e.id)) then delta:=0; end if;
    end if;
    crit:=case when line.critical then 1 else 0 end;
    insert into public.ops_q_events(tenant_id,branch_id,audit_id,line_id,period,delta,critical_delta,kind,reason,actor_id)
    values(p.tenant_id,b,a.id,line.id,a.period,delta,crit,case when p_action='qc_complete' then 'initial' else 'correction' end,coalesce(p_payload->>'note','Hoàn tất đợt QC'),p.id);
   end loop;
   if p_action='qc_complete' then update public.ops_q_audits set state='completed',completed_at=now(),version=version+1 where id=a.id; end if;
   perform public.ops_q_reconcile(b,a.period);
   if closed.id is not null then
    result:=public.ops_q_score(b,a.period); conf:=result->'config';
    if (result->>'rewardReady')::boolean is distinct from true then raise exception 'OPS_Q_REWARD_INCOMPLETE'; end if;
    revenue:=jsonb_populate_record(null::public.ops_revenues,closed.snapshot->'business'->'revenue');
    target:=jsonb_populate_record(null::public.ops_targets,closed.snapshot->'business'->'target');
    business:=revenue.amount_cents::numeric/target.amount_cents*10000;
    business:=case when business<(conf->>'businessThresholdBps')::numeric or (conf->>'blockBusinessOnCritical')::boolean and (result->>'critical')::boolean then 0 else round(least(greatest(0,business),(conf->>'businessCapBps')::numeric)*(conf->>'businessFundCents')::numeric/10000) end;
    snap:=closed.snapshot||jsonb_build_object('qc',result,'business',(closed.snapshot->'business')||jsonb_build_object('rewardCents',business),'allocationAmounts',public.ops_q_allocations(conf->'allocations',(result->>'rewardCents')::numeric,business),'adjustment',jsonb_build_object('lineId',line.id,'note',p_payload->>'note','evidence',p_payload->>'evidence','previousRevision',closed.revision),'events',(select jsonb_agg(to_jsonb(e)) from public.ops_q_events e where e.branch_id=b and e.period=a.period));
    insert into public.ops_q_settlements(tenant_id,branch_id,period,revision,snapshot,reason,actor_id) values(p.tenant_id,b,a.period,closed.revision+1,snap,p_payload->>'note',p.id);
   end if;
  end if;
 elsif p_action='accounting' then
  if period is null or period !~ '^\d{4}-(0[1-9]|1[0-2])$' or exists(select 1 from public.ops_q_settlements where branch_id=b and ops_q_settlements.period=period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  insert into public.ops_q_accounting(tenant_id,branch_id,period,title,numerator,denominator,unit,evidence,created_by)
  values(p.tenant_id,b,period,p_payload->>'title',(p_payload->>'numerator')::numeric,(p_payload->>'denominator')::numeric,p_payload->>'unit',p_payload->>'evidence',p.id) returning id into eid;
 elsif p_action='accounting_approve' then
  select * into acc from public.ops_q_accounting where id=eid and branch_id=b and tenant_id=p.tenant_id for update;
  if acc.id is null or acc.state<>'pending' or acc.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
  if exists(select 1 from public.ops_q_settlements where branch_id=b and ops_q_settlements.period=acc.period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  update public.ops_q_accounting set state='approved',approved_by=p.id,version=version+1 where id=eid;
 elsif p_action='settle' then
  if period is null or period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'OPS_INVALID_RANGE'; end if;
  if ((period||'-01')::date+interval '1 month')::date>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'OPS_PERIOD_NOT_ENDED'; end if;
  if exists(select 1 from public.ops_q_settlements where branch_id=b and ops_q_settlements.period=period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  result:=public.ops_q_score(b,period); conf:=result->'config';
  if (result->>'rewardReady')::boolean is distinct from true then raise exception 'OPS_Q_REWARD_INCOMPLETE'; end if;
  if exists(select 1 from jsonb_array_elements(conf->'allocations') x where not public.ops_manager(b,(x->>'userId')::uuid)) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  select * into revenue from public.ops_revenues where branch_id=b and ops_revenues.period=period and state='approved';
  select * into target from public.ops_targets where branch_id=b and ops_targets.period=period;
  if jsonb_typeof(conf->'businessFundCents') is distinct from 'number' or jsonb_typeof(conf->'businessThresholdBps') is distinct from 'number' or jsonb_typeof(conf->'businessCapBps') is distinct from 'number' or jsonb_typeof(conf->'blockBusinessOnCritical') is distinct from 'boolean'
   or revenue.id is null or target.amount_cents is null or revenue.definition<>target.definition then raise exception 'OPS_DEFINITION_MISMATCH'; end if;
  business:=revenue.amount_cents::numeric/target.amount_cents*10000;
  business:=case when business<(conf->>'businessThresholdBps')::numeric or (conf->>'blockBusinessOnCritical')::boolean and (result->>'critical')::boolean then 0 else round(least(greatest(0,business),(conf->>'businessCapBps')::numeric)*(conf->>'businessFundCents')::numeric/10000) end;
  snap:=jsonb_build_object('qc',result,'business',jsonb_build_object('revenue',to_jsonb(revenue),'target',to_jsonb(target),'rewardCents',business),'allocations',conf->'allocations','allocationAmounts',public.ops_q_allocations(conf->'allocations',(result->>'rewardCents')::numeric,business),'events',(select jsonb_agg(to_jsonb(e)) from public.ops_q_events e where e.branch_id=b and e.period=period));
  insert into public.ops_q_settlements(tenant_id,branch_id,period,revision,snapshot,reason,actor_id) values(p.tenant_id,b,period,1,snap,coalesce(p_payload->>'note','Chốt kết quả QC và kinh doanh'),p.id) returning id into eid;
 end if;
 result:=jsonb_build_object('id',eid,'saved',true);
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason) values(p.tenant_id,b,eid,'quality:'||p_action,p.id,old_data,p_payload,p_payload->>'note');
 if p_action in ('issue','check','qc_line','issue_update','recheck') then
  insert into public.ops_notifications(tenant_id,branch_id,user_id,entity_id,title,due_at,kind,day)
  select td.tenant_id,td.branch_id,u.id,td.id,td.title,td.due_at,'todo',(now() at time zone 'Asia/Ho_Chi_Minh')::date
   from public.ops_q_issues i join public.ops_todos td on td.id=i.todo_id join public.profiles u on u.tenant_id=td.tenant_id and u.is_active and (u.id=td.assignee_id or u.id=any(td.collaborators))
   where i.branch_id=b and (i.id=eid or i.id=iid or exists(select 1 from public.ops_q_sources src where src.issue_id=i.id and (src.check_id=eid or src.qc_line_id=eid)))
   on conflict(user_id,entity_id,kind,day) do update set title=excluded.title,created_at=now(),read_at=null;
 end if;
 insert into public.ops_requests values(p.tenant_id,p.id,p_request_id,jsonb_build_object('action','quality:'||p_action,'payload',p_payload),result);
 return result;
end $$;

-- Existing endpoint may not bypass the new independent result / recheck workflow.
alter function public.ops_execute(text,jsonb,uuid) rename to ops_execute_pre_quality;
revoke all on function public.ops_execute_pre_quality(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_action='todo_update' and exists(select 1 from public.ops_q_issues where todo_id=(p_payload->>'id')::uuid) then raise exception 'OPS_Q_USE_WORKFLOW'; end if;
 if p_action in ('result','verify','transfer') and exists(select 1 from public.ops_runs r where r.id=coalesce((p_payload->>'id')::uuid,(p_payload->>'runId')::uuid) and (exists(select 1 from public.ops_q_checks where run_id=r.id) or exists(select 1 from public.ops_q_assignments x where x.branch_id=r.branch_id and x.family_id=r.family_id))) then raise exception 'OPS_Q_USE_WORKFLOW'; end if;
 return public.ops_execute_pre_quality(p_action,p_payload,p_request_id);
end $$;

do $$ declare t text; f record; begin
 foreach t in array array['ops_q_departments','ops_q_assignments','ops_q_grants','ops_q_catalog','ops_q_rules','ops_q_checks','ops_q_issues','ops_q_sources','ops_q_rechecks','ops_q_audits','ops_q_lines','ops_q_events','ops_q_corrections','ops_q_accounting','ops_q_settlements'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'ops_q_%' or proname in ('ops_quality_execute','ops_execute')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.ops_quality_execute(text,jsonb,uuid),public.ops_execute(text,jsonb,uuid) to authenticated;
commit;
