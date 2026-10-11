-- Additive Operations Hub. No writes to stock, sales, finance, or MKT tables.
-- Apply to an isolated database and run acceptance tests before production.
begin;

create table public.ops_members (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  user_id uuid not null references public.profiles(id),
  member_role text not null check (member_role in ('manager','coordinator','reviewer')),
  capabilities text[] not null default '{}',
  active boolean not null default true,
  primary key (tenant_id, branch_id, user_id)
);
create table public.ops_standards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  family_id uuid not null,
  revision integer not null check (revision > 0),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  scope text not null default 'branch' check(scope in ('common','branch')),
  assignee_id uuid not null references public.profiles(id),
  frequency text not null check (frequency in ('daily','weekly','monthly','event')),
  day_number integer not null default 1 check (day_number between 1 and 31),
  due_time time not null,
  effective_from date not null,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'array'),
  status text not null default 'draft' check (status in ('draft','pending','approved','retired')),
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, branch_id, family_id, revision)
);
create unique index ops_standard_effective on public.ops_standards(tenant_id,branch_id,family_id,effective_from) where status='approved';
create table public.ops_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  standard_id uuid not null references public.ops_standards(id),
  family_id uuid not null,
  period_key text not null,
  title text not null,
  criteria jsonb not null,
  assignee_id uuid not null references public.profiles(id),
  original_due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','done','transferred')),
  quality text not null default 'unknown' check (quality in ('met','unmet','unknown')),
  observations jsonb not null default '[]',
  met_at timestamptz,
  critical_failure boolean not null default false,
  had_failure boolean not null default false,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  verification_note text,
  version integer not null default 1,
  unique(tenant_id,branch_id,family_id,period_key)
);
create index ops_runs_due on public.ops_runs(tenant_id,branch_id,original_due_at);
create table public.ops_todos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  run_id uuid references public.ops_runs(id),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  category text not null check (category in ('operations','hr','maintenance','complaint','food_safety','product','goods','cleaning','space','equipment','other')),
  priority text not null check (priority in ('important_urgent','important','urgent','normal')),
  state text not null default 'pending' check (state in ('pending','in_progress','waiting','done','canceled')),
  assignee_id uuid not null references public.profiles(id),
  collaborators uuid[] not null default '{}',
  due_at timestamptz not null,
  original_due_at timestamptz not null,
  waiting_note text,
  follow_up_at timestamptz,
  resolution text,
  cancel_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  version integer not null default 1
);
create unique index ops_one_open_todo on public.ops_todos(run_id) where run_id is not null and state not in ('done','canceled');
create index ops_todos_due on public.ops_todos(tenant_id,branch_id,due_at);
create table public.ops_todo_links (
 tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),
 todo_id uuid not null references public.ops_todos(id),
 run_id uuid not null references public.ops_runs(id),
 primary key(todo_id,run_id), unique(run_id)
);
alter table public.ops_todo_links enable row level security;
revoke all on public.ops_todo_links from anon,authenticated;
create table public.ops_revenues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  source text not null check (source in ('onebiz','manual','xlsx')),
  definition jsonb not null check (jsonb_typeof(definition)='object'),
  source_name text not null,
  amount_cents bigint not null check (abs(amount_cents::numeric)<=9007199254740991),
  evidence text not null,
  note text not null default '',
  source_key text not null,
  state text not null default 'pending' check (state in ('pending','approved','superseded')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  unique (tenant_id, branch_id, period, source_key)
);
create unique index ops_one_revenue on public.ops_revenues(tenant_id,branch_id,period) where state='approved';
create table public.ops_targets (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount_cents bigint not null check (amount_cents>0 and amount_cents<=9007199254740991),
  definition jsonb not null,
  approved_by uuid not null references public.profiles(id),
  primary key(tenant_id,branch_id,period)
);
create table public.ops_reward_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  title text not null,
  effective_from date not null,
  config jsonb not null,
  state text not null default 'draft' check (state in ('draft','approved')),
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index ops_policy_effective on public.ops_reward_policies(tenant_id,branch_id,effective_from) where state='approved';
create table public.ops_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  period text not null,
  snapshot jsonb not null,
  closed_by uuid not null references public.profiles(id),
  closed_at timestamptz not null default now(),
  revision integer not null default 1,
  reason text not null,
  unique(tenant_id,branch_id,period,revision)
);
create table public.ops_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  entity_id uuid,
  action text not null,
  actor_id uuid not null references public.profiles(id),
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create table public.ops_remediations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),
 run_id uuid not null references public.ops_runs(id),
 observations jsonb not null,
 quality text not null check(quality in ('met','unmet','unknown')),
 actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index ops_remediations_run on public.ops_remediations(run_id,created_at desc);
create index ops_audit_scope on public.ops_audit(tenant_id,branch_id,created_at desc);
create table public.ops_requests (
  tenant_id uuid not null,
  user_id uuid not null,
  request_id uuid not null,
  request_body jsonb not null,
  response jsonb not null,
  primary key(tenant_id,user_id,request_id)
);

create function public.ops_ceo() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and is_active and role='owner');
$$;
create function public.ops_has_permission(p_code text) returns boolean language sql stable security definer set search_path='' as $$
 select p_code=any(array['ops.view','ops.work','ops.verify','ops.configure','ops.close_period','ops.cancel_todo','ops.manage_members'])
 and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
  and public.user_has_permission(p.id,p_code));
$$;
revoke all on function public.ops_has_permission(text) from public,anon;
grant execute on function public.ops_has_permission(text) to authenticated;
create function public.ops_can(p_branch uuid,p_cap text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
 where p.id=auth.uid() and p.is_active and b.id=p_branch and b.is_active
 and public.ops_has_permission('ops.view')
 and public.ops_has_permission(case p_cap
  when 'view' then 'ops.view' when 'work' then 'ops.work'
  when 'verify' then 'ops.verify' when 'approve_policy' then 'ops.configure'
  when 'close_period' then 'ops.close_period' when 'cancel_todo' then 'ops.cancel_todo'
  when 'manage_members' then 'ops.manage_members' else null end) and
 (public.ops_ceo() or exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=b.id and m.user_id=p.id and m.active
 and ((p_cap='view' and m.member_role in ('manager','reviewer')) or p_cap=any(m.capabilities) or (p_cap='work' and m.member_role='manager')))));
$$;
create function public.ops_manager(p_branch uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ops_members m join public.profiles p on p.id=m.user_id and p.tenant_id=m.tenant_id
 where m.branch_id=p_branch and m.user_id=p_user and m.active and p.is_active and m.member_role='manager'
 and public.user_has_permission(p.id,'ops.view') and public.user_has_permission(p.id,'ops.work'));
$$;
create function public.ops_todo_visible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ops_todos t join public.profiles p on p.tenant_id=t.tenant_id
 where t.id=p_id and p.id=auth.uid() and p.is_active and public.ops_has_permission('ops.view')
 and (public.ops_can(t.branch_id,'view') or p.id=any(t.collaborators)));
$$;

do $$ declare t text; begin
 foreach t in array array['ops_members','ops_standards','ops_runs','ops_revenues','ops_targets','ops_reward_policies','ops_periods','ops_audit','ops_todos','ops_requests','ops_remediations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
 foreach t in array array['ops_members','ops_standards','ops_runs','ops_revenues','ops_targets','ops_reward_policies','ops_periods','ops_audit','ops_remediations'] loop
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy ops_read on public.%I for select to authenticated using (tenant_id=public.get_user_tenant_id() and public.ops_can(branch_id,''view''))',t);
 end loop;
end $$;
grant select on public.ops_todos to authenticated;
create policy ops_read on public.ops_todos for select to authenticated using(public.ops_todo_visible(id));

create function public.ops_check_criteria(p_criteria jsonb) returns void language plpgsql immutable set search_path='' as $$
declare c jsonb; begin
 if jsonb_typeof(p_criteria) is distinct from 'array' or jsonb_array_length(p_criteria) not between 1 and 30 then raise exception 'OPS_INVALID_CRITERIA'; end if;
 for c in select value from jsonb_array_elements(p_criteria) loop
  if coalesce(c->>'id','')='' or coalesce(c->>'title','')='' or coalesce(c->>'kind','') not in ('boolean','number','percent','duration')
  or coalesce(c->>'operator','') not in ('eq','lte','gte','lt') or jsonb_typeof(c->'threshold') is distinct from 'number'
  or jsonb_typeof(c->'samples') is distinct from 'number' or (c->>'samples')::numeric<>trunc((c->>'samples')::numeric)
  or coalesce((c->>'samples')::integer,0) not between 1 and 50 or jsonb_typeof(c->'critical') is distinct from 'boolean'
  or jsonb_typeof(c->'evidenceRequired') is distinct from 'boolean' then raise exception 'OPS_INVALID_CRITERIA'; end if;
  if (c->>'kind'='boolean' and (c->>'threshold')::numeric not in (0,1)) or (c->>'kind'='percent' and (c->>'threshold')::numeric not between 0 and 100) or (c->>'kind'='duration' and (c->>'threshold')::numeric<0) then raise exception 'OPS_INVALID_CRITERIA'; end if;
  if length(coalesce(c->>'measurementScope',''))>300 or length(coalesce(c->>'ratioBasis',''))>300 then raise exception 'OPS_INVALID_CRITERIA'; end if;
  if c ? 'measurementTimes' then
   if jsonb_typeof(c->'measurementTimes') is distinct from 'array' then raise exception 'OPS_INVALID_CRITERIA'; end if;
   if jsonb_array_length(c->'measurementTimes')>0 then
    if jsonb_array_length(c->'measurementTimes')<>(c->>'samples')::integer or exists(select 1 from jsonb_array_elements_text(c->'measurementTimes') t where t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     or (select count(distinct t) from jsonb_array_elements_text(c->'measurementTimes') t)<>jsonb_array_length(c->'measurementTimes') then raise exception 'OPS_INVALID_CRITERIA'; end if;
   end if;
  end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_criteria))<>jsonb_array_length(p_criteria) then raise exception 'OPS_DUPLICATE_CRITERION'; end if;
end $$;
create function public.ops_evaluate(p_criteria jsonb,p_observations jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare c jsonb; o jsonb; n integer; passed boolean; missing boolean:=false; failed boolean:=false; critical boolean:=false; v numeric; normalized jsonb:='[]';
begin
 perform public.ops_check_criteria(p_criteria);
 if jsonb_typeof(p_observations) is distinct from 'array' or jsonb_array_length(p_observations)>1500 then raise exception 'OPS_INVALID_RESULT'; end if;
 if (select count(distinct (value->>'criterionId',value->>'slot')) from jsonb_array_elements(p_observations))<>jsonb_array_length(p_observations) then raise exception 'OPS_DUPLICATE_OBSERVATION'; end if;
 for o in select value from jsonb_array_elements(p_observations) loop
  if not exists(select 1 from jsonb_array_elements(p_criteria) x where x->>'id'=o->>'criterionId') or coalesce(o->>'slot','')='' or jsonb_typeof(o->'value') is distinct from 'number' then raise exception 'OPS_INVALID_RESULT'; end if;
  if o->>'slot' !~ '^[1-9][0-9]*$' or (o->>'slot')::integer>(select (value->>'samples')::integer from jsonb_array_elements(p_criteria) where value->>'id'=o->>'criterionId') then raise exception 'OPS_INVALID_RESULT'; end if;
 end loop;
 for c in select value from jsonb_array_elements(p_criteria) loop
  n:=0;
  for o in select value from jsonb_array_elements(p_observations) where value->>'criterionId'=c->>'id' loop
   n:=n+1; v:=(o->>'value')::numeric;
   if c->>'kind'='percent' then
    if jsonb_typeof(o->'numerator') is distinct from 'number' or jsonb_typeof(o->'denominator') is distinct from 'number' or (o->>'denominator')::numeric<=0 or (o->>'numerator')::numeric<0 or (o->>'numerator')::numeric>(o->>'denominator')::numeric then raise exception 'OPS_INVALID_RATIO'; end if;
    v:=(o->>'numerator')::numeric/(o->>'denominator')::numeric*100;
    o:=jsonb_set(o,'{value}',to_jsonb(v));
   end if;
   normalized:=normalized||jsonb_build_array(o);
   if c->>'kind'='boolean' and v not in (0,1) then raise exception 'OPS_INVALID_RESULT'; end if;
   passed:=case c->>'operator' when 'eq' then v=(c->>'threshold')::numeric when 'lt' then v<(c->>'threshold')::numeric when 'lte' then v<=(c->>'threshold')::numeric else v>=(c->>'threshold')::numeric end;
   if (c->>'evidenceRequired')::boolean and coalesce(trim(o->>'evidence'),'')='' then missing:=true; end if;
   if not passed then failed:=true; if (c->>'critical')::boolean then critical:=true; end if; end if;
  end loop;
  if n<(c->>'samples')::integer then missing:=true; end if;
 end loop;
 return jsonb_build_object('quality',case when failed then 'unmet' when missing then 'unknown' else 'met' end,'critical',critical,'observations',normalized);
end $$;

create function public.ops_check_reward(p jsonb) returns void language plpgsql immutable set search_path='' as $$
declare k text; t jsonb; previous integer:=-1; begin
 if jsonb_typeof(p) is distinct from 'object' or coalesce(p->>'version','')='' or coalesce(p->>'subjectKind','') not in ('manager','employee','position') then raise exception 'OPS_INVALID_POLICY'; end if;
 foreach k in array array['operationsWeightBps','businessWeightBps','minimumOperationsBps','minimumBusinessBps'] loop
  if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric<>trunc((p->>k)::numeric) or (p->>k)::numeric not between 0 and 10000 then raise exception 'OPS_INVALID_POLICY'; end if;
 end loop;
 if (p->>'operationsWeightBps')::integer+(p->>'businessWeightBps')::integer<>10000 then raise exception 'OPS_INVALID_POLICY'; end if;
 foreach k in array array['baseCents','capCents','roundingCents','maximumBusinessContributionBps'] loop
  if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric<>trunc((p->>k)::numeric) or (p->>k)::numeric not between 0 and 9007199254740991 then raise exception 'OPS_INVALID_POLICY'; end if;
 end loop;
 if (p->>'roundingCents')::numeric<1 or (p->>'maximumBusinessContributionBps')::numeric>100000 or jsonb_typeof(p->'requireFullVerification') is distinct from 'boolean' or jsonb_typeof(p->'blockCriticalFailure') is distinct from 'boolean' then raise exception 'OPS_INVALID_POLICY'; end if;
 if jsonb_typeof(p->'tiers') is distinct from 'array' or jsonb_array_length(p->'tiers') not between 1 and 30 then raise exception 'OPS_INVALID_POLICY'; end if;
 for t in select value from jsonb_array_elements(p->'tiers') loop
  if jsonb_typeof(t->'minimumScoreBps') is distinct from 'number' or jsonb_typeof(t->'payoutBps') is distinct from 'number' or (t->>'minimumScoreBps')::numeric<>trunc((t->>'minimumScoreBps')::numeric) or (t->>'payoutBps')::numeric<>trunc((t->>'payoutBps')::numeric) or (t->>'minimumScoreBps')::integer not between 0 and 10000 or (t->>'minimumScoreBps')::integer<=previous or (t->>'payoutBps')::integer not between 0 and 100000 then raise exception 'OPS_INVALID_POLICY'; end if;
  previous:=(t->>'minimumScoreBps')::integer;
 end loop;
 if p ? 'allocations' then
  if jsonb_typeof(p->'allocations') is distinct from 'array' or jsonb_array_length(p->'allocations') not between 1 and 50 then raise exception 'OPS_INVALID_POLICY'; end if;
  for t in select value from jsonb_array_elements(p->'allocations') loop
   if coalesce(t->>'userId','')='' or jsonb_typeof(t->'shareBps') is distinct from 'number' or (t->>'shareBps')::numeric<>trunc((t->>'shareBps')::numeric) or (t->>'shareBps')::numeric not between 1 and 10000 then raise exception 'OPS_INVALID_POLICY'; end if;
  end loop;
  if (select sum((value->>'shareBps')::numeric) from jsonb_array_elements(p->'allocations'))<>10000 or (select count(distinct value->>'userId') from jsonb_array_elements(p->'allocations'))<>jsonb_array_length(p->'allocations') then raise exception 'OPS_INVALID_POLICY'; end if;
 end if;
end $$;

-- Bounded catch-up, also callable by a scheduler with an authenticated operator.
create function public.ops_generate_internal(p_branch uuid,p_until date) returns integer language plpgsql security definer set search_path='' as $$
declare s public.ops_standards; d date; first_day date; due timestamptz; key text; n integer:=0; added integer; today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 if p_until is null or p_until>today+31 then raise exception 'OPS_INVALID_RANGE'; end if;
 for s in select * from public.ops_standards where branch_id=p_branch and status='approved' and frequency<>'event' order by effective_from loop
  select greatest(s.effective_from,coalesce(max((original_due_at at time zone 'Asia/Ho_Chi_Minh')::date)+1,s.effective_from)) into first_day from public.ops_runs where standard_id=s.id;
  if p_until-first_day>366 then raise exception 'OPS_CATCHUP_RANGE'; end if;
  for d in select generate_series(first_day,p_until,'1 day')::date loop
   if exists(select 1 from public.ops_standards newer where newer.family_id=s.family_id and newer.branch_id=s.branch_id and newer.status='approved' and newer.effective_from>s.effective_from and newer.effective_from<=d) then continue; end if;
   if s.frequency='weekly' and extract(isodow from d)<>s.day_number then continue; end if;
   if s.frequency='monthly' and extract(day from d)<>least(s.day_number,extract(day from (date_trunc('month',d)+interval '1 month - 1 day'))) then continue; end if;
   due:=(d+s.due_time) at time zone 'Asia/Ho_Chi_Minh';
   if d=s.effective_from and due<coalesce(s.approved_at,s.created_at) then continue; end if;
   key:=case s.frequency when 'daily' then to_char(d,'YYYY-MM-DD') when 'weekly' then to_char(d,'IYYY-IW') else to_char(d,'YYYY-MM') end;
   insert into public.ops_runs(tenant_id,branch_id,standard_id,family_id,period_key,title,criteria,assignee_id,original_due_at)
   values(s.tenant_id,s.branch_id,s.id,s.family_id,key,s.title,s.criteria,s.assignee_id,due) on conflict do nothing;
   get diagnostics added=row_count; n:=n+added;
  end loop;
 end loop;
 return n;
end $$;

-- Snapshot calculation uses numeric integer arithmetic, matching the browser preview.
revoke all on function public.ops_generate_internal(uuid,date) from public,anon,authenticated;
create function public.ops_generate(p_branch uuid,p_until date) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not public.ops_can(p_branch,'approve_policy') and not public.ops_can(p_branch,'close_period') and not public.ops_can(p_branch,'work') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 return public.ops_generate_internal(p_branch,p_until);
end $$;

create function public.ops_reward_values(p_runs jsonb,p_config jsonb,p_revenue bigint,p_target bigint)
returns jsonb language plpgsql immutable set search_path='' as $$
declare allocation jsonb; results jsonb:='[]'; due_count bigint; ontime bigint; verified bigint; critical boolean;
 ops numeric; business numeric; score numeric; base numeric; cap numeric; step numeric; payout numeric; amount numeric; uid uuid; unavailable text;
begin
 perform public.ops_check_reward(p_config);
 if jsonb_typeof(p_config->'allocations') is distinct from 'array' then raise exception 'OPS_INVALID_POLICY'; end if;
 for allocation in select value from jsonb_array_elements(p_config->'allocations') loop
  uid:=(allocation->>'userId')::uuid;
  select count(*),count(*) filter(where quality='met' and met_at<=original_due_at),count(*) filter(where verified_at is not null),coalesce(bool_or(critical_failure),false)
   into due_count,ontime,verified,critical from jsonb_to_recordset(p_runs) as r(assignee_id uuid,quality text,met_at timestamptz,original_due_at timestamptz,verified_at timestamptz,critical_failure boolean) where assignee_id=uid;
  unavailable:=null;
  if due_count=0 or p_target<=0 then unavailable:='Chưa đủ dữ liệu KPI hợp lệ.';
  elsif (p_config->>'requireFullVerification')::boolean and verified<>due_count then unavailable:='Kết quả chưa được xác minh đầy đủ.'; end if;
  if unavailable is not null then results:=results||jsonb_build_array(jsonb_build_object('userId',uid,'state','unavailable','reason',unavailable)); continue; end if;
  ops:=round(ontime::numeric/due_count*10000); business:=round(p_revenue::numeric/p_target*10000);
  if business<0 then results:=results||jsonb_build_array(jsonb_build_object('userId',uid,'state','unavailable','reason','Chưa đủ dữ liệu KPI hợp lệ.')); continue; end if;
  score:=floor((ops*(p_config->>'operationsWeightBps')::numeric+least(business,(p_config->>'maximumBusinessContributionBps')::numeric)*(p_config->>'businessWeightBps')::numeric+5000)/10000);
  base:=floor((p_config->>'baseCents')::numeric*(allocation->>'shareBps')::numeric/10000);
  cap:=floor((p_config->>'capCents')::numeric*(allocation->>'shareBps')::numeric/10000);
  step:=(p_config->>'roundingCents')::numeric;
  select (tier->>'payoutBps')::numeric into payout from jsonb_array_elements(p_config->'tiers') tier where (tier->>'minimumScoreBps')::numeric<=score order by (tier->>'minimumScoreBps')::numeric desc limit 1;
  amount:=least(cap,floor((base*coalesce(payout,0)+10000*step/2)/(10000*step))*step);
  if ((p_config->>'blockCriticalFailure')::boolean and critical) or ops<(p_config->>'minimumOperationsBps')::numeric or business<(p_config->>'minimumBusinessBps')::numeric then amount:=0; end if;
  results:=results||jsonb_build_array(jsonb_build_object('userId',uid,'shareBps',allocation->'shareBps','state','calculated','scoreBps',score,'amountCents',amount));
 end loop;
 return results;
end $$;
revoke all on function public.ops_reward_values(jsonb,jsonb,bigint,bigint) from public,anon,authenticated;
create function public.ops_reward_snapshot(p_branch uuid,p_start timestamptz,p_end timestamptz,p_config jsonb,p_revenue bigint,p_target bigint)
returns jsonb language sql security definer set search_path='' as $$
 select public.ops_reward_values(coalesce((select jsonb_agg(to_jsonb(r)) from public.ops_runs r where branch_id=p_branch and original_due_at>=p_start and original_due_at<p_end),'[]'),p_config,p_revenue,p_target);
$$;
revoke all on function public.ops_reward_snapshot(uuid,timestamptz,timestamptz,jsonb,bigint,bigint) from public,anon,authenticated;

create function public.ops_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; branch uuid:=(p_payload->>'branchId')::uuid; eid uuid:=(p_payload->>'id')::uuid; result jsonb; old jsonb;
 s public.ops_standards; r public.ops_runs; t public.ops_todos; rev public.ops_revenues; pol public.ops_reward_policies; evaluation jsonb;
 v_period text:=p_payload->>'period'; start_at timestamptz; end_at timestamptz; lock_period text; target public.ops_targets; a uuid; c uuid; row jsonb;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED' using errcode='42501'; end if;
 if p_request_id is null or branch is null or not exists(select 1 from public.branches where id=branch and tenant_id=p.tenant_id and is_active) then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if not public.ops_can(branch,'view') and not (p_action='comment' and public.ops_todo_visible(eid)) then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 -- Replayed requests must still respect a permission revoked since the first save.
 if not (case
  when p_action='member' then public.ops_can(branch,'manage_members')
  when p_action in ('standard','common_standard','approve_standard','policy','approve_policy','target','generate','event') then public.ops_can(branch,'approve_policy')
  when p_action in ('verify','approve_revenue') then public.ops_can(branch,'verify')
  when p_action='close_period' then public.ops_can(branch,'close_period')
  when p_action='todo_update' and p_payload->>'state'='canceled' then public.ops_can(branch,'cancel_todo')
  when p_action='result' then public.ops_can(branch,'work')
  when p_action in ('todo','transfer','todo_update','revenue','revenue_batch','onebiz_revenue') then public.ops_can(branch,'work') or public.ops_can(branch,'approve_policy')
  when p_action='ensure_schedule' then public.ops_can(branch,'work') or public.ops_can(branch,'approve_policy') or public.ops_can(branch,'close_period')
  when p_action='comment' then public.ops_todo_visible(eid)
  else false end) then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||branch::text,0));
 select response into result from public.ops_requests where tenant_id=p.tenant_id and user_id=p.id and request_id=p_request_id;
 if found then
  if (select request_body from public.ops_requests where tenant_id=p.tenant_id and user_id=p.id and request_id=p_request_id)<>jsonb_build_object('action',p_action,'payload',p_payload) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return result;
 end if;
 if not public.ops_can(branch,'view') and not (p_action='comment' and public.ops_todo_visible(eid)) then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_action in ('standard','common_standard','approve_standard','policy','approve_policy','target','generate','event') and not public.ops_can(branch,'approve_policy') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_action='member' and not public.ops_can(branch,'manage_members') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_action='member' then
  a:=(p_payload->>'userId')::uuid;
  if not exists(select 1 from public.profiles where id=a and tenant_id=p.tenant_id and is_active) then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if coalesce(p_payload->>'memberRole','') not in ('manager','reviewer','coordinator') or jsonb_typeof(p_payload->'capabilities') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(p_payload->'capabilities') v where v not in ('verify','close_period','cancel_todo','approve_policy','manage_members')) then raise exception 'OPS_INVALID_MEMBER'; end if;
  -- Delegation never grants central permissions, and cannot expand the delegator's scope.
  if not public.ops_ceo() and (a=p.id
   or (p_payload->>'memberRole'='manager' and not public.ops_can(branch,'work'))
   or exists(select 1 from public.profiles u where u.id=a and u.role='owner')
   or exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=branch and m.user_id=a
    and ((m.member_role='manager' and not public.ops_can(branch,'work'))
     or exists(select 1 from unnest(m.capabilities) cap where cap='manage_members' or not public.ops_can(branch,cap))))
   or exists(select 1 from jsonb_array_elements_text(p_payload->'capabilities') v where v='manage_members' or not public.ops_can(branch,v))) then
   raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  insert into public.ops_members(tenant_id,branch_id,user_id,member_role,capabilities,active) values(p.tenant_id,branch,a,p_payload->>'memberRole',array(select jsonb_array_elements_text(p_payload->'capabilities')),coalesce((p_payload->>'active')::boolean,true))
  on conflict(tenant_id,branch_id,user_id) do update set member_role=excluded.member_role,capabilities=excluded.capabilities,active=excluded.active returning to_jsonb(ops_members.*) into result;
 elsif p_action='common_standard' then
  if jsonb_typeof(p_payload->'assignments') is distinct from 'array' or jsonb_array_length(p_payload->'assignments') not between 1 and 100 then raise exception 'OPS_INVALID_ASSIGNMENT'; end if;
  if (select count(*) from jsonb_array_elements(p_payload->'assignments'))<>(select count(distinct item->>'branchId') from jsonb_array_elements(p_payload->'assignments') item) then raise exception 'OPS_INVALID_ASSIGNMENT'; end if;
  a:=gen_random_uuid(); result:='[]';
  for row in select value from jsonb_array_elements(p_payload->'assignments') loop
   result:=result||jsonb_build_array(public.ops_execute('standard',(p_payload-'assignments'-'id')||jsonb_build_object('scope','common','familyId',a,'revision',1,'branchId',row->>'branchId','assigneeId',row->>'assigneeId'),gen_random_uuid()));
  end loop;
 elsif p_action='standard' then
  perform public.ops_check_criteria(p_payload->'criteria');
  a:=(p_payload->>'assigneeId')::uuid;
  if not public.ops_manager(branch,a) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  if p_payload->>'frequency'='weekly' and (p_payload->>'dayNumber')::integer>7 then raise exception 'OPS_INVALID_SCHEDULE'; end if;
  eid:=coalesce(eid,gen_random_uuid());
  insert into public.ops_standards(id,tenant_id,branch_id,family_id,revision,title,description,scope,assignee_id,frequency,day_number,due_time,effective_from,criteria,created_by)
  values(eid,p.tenant_id,branch,coalesce((p_payload->>'familyId')::uuid,eid),coalesce((p_payload->>'revision')::integer,1),p_payload->>'title',coalesce(p_payload->>'description',''),coalesce(p_payload->>'scope','branch'),a,p_payload->>'frequency',(p_payload->>'dayNumber')::integer,(p_payload->>'dueTime')::time,(p_payload->>'effectiveFrom')::date,p_payload->'criteria',p.id) returning to_jsonb(ops_standards.*) into result;
 elsif p_action='approve_standard' then
  select * into s from public.ops_standards where id=eid and tenant_id=p.tenant_id and branch_id=branch for update;
  if s.id is null or s.status not in ('draft','pending') then raise exception 'OPS_INVALID_STATE'; end if;
  if s.effective_from<(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'OPS_PAST_EFFECTIVE'; end if;
  if not public.ops_manager(branch,s.assignee_id) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  old:=to_jsonb(s); update public.ops_standards set status='approved',approved_by=p.id,approved_at=now() where id=eid returning to_jsonb(ops_standards.*) into result;
 elsif p_action='ensure_schedule' then
  result:=jsonb_build_object('generated',public.ops_generate(branch,(now() at time zone 'Asia/Ho_Chi_Minh')::date));
 elsif p_action='generate' then
  result:=jsonb_build_object('generated',public.ops_generate(branch,(p_payload->>'until')::date));
 elsif p_action='event' then
  select * into s from public.ops_standards where id=(p_payload->>'standardId')::uuid and tenant_id=p.tenant_id and branch_id=branch and frequency='event' and status='approved';
  if s.id is null or coalesce(trim(p_payload->>'eventKey'),'')='' or (p_payload->>'dueAt')::timestamptz<now() then raise exception 'OPS_INVALID_EVENT'; end if;
  insert into public.ops_runs(tenant_id,branch_id,standard_id,family_id,period_key,title,criteria,assignee_id,original_due_at)
  values(p.tenant_id,branch,s.id,s.family_id,'event:'||(p_payload->>'eventKey'),s.title,s.criteria,s.assignee_id,(p_payload->>'dueAt')::timestamptz)
  on conflict do nothing
  returning to_jsonb(ops_runs.*) into result;
  if result is null then
   select to_jsonb(existing) into result from public.ops_runs existing where existing.tenant_id=p.tenant_id and existing.branch_id=branch and existing.family_id=s.family_id and existing.period_key='event:'||(p_payload->>'eventKey');
   if result->>'standard_id'<>s.id::text or (result->>'original_due_at')::timestamptz<>(p_payload->>'dueAt')::timestamptz then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  end if;
 elsif p_action in ('result','verify') then
  select * into r from public.ops_runs where id=eid and tenant_id=p.tenant_id and branch_id=branch for update;
  if r.id is null then raise exception 'OPS_NOT_FOUND'; end if;
  if r.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
  lock_period:=to_char(r.original_due_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM');
  if exists(select 1 from public.ops_periods where tenant_id=p.tenant_id and branch_id=branch and period=lock_period) then
   if p_action<>'result' or r.state<>'transferred' or r.assignee_id<>p.id or not public.ops_can(branch,'work')
     or not exists(select 1 from public.ops_todo_links l join public.ops_todos linked on linked.id=l.todo_id where l.run_id=r.id and linked.state not in ('done','canceled')) then raise exception 'OPS_PERIOD_LOCKED'; end if;
   evaluation:=public.ops_evaluate(r.criteria,p_payload->'observations');
   insert into public.ops_remediations(tenant_id,branch_id,run_id,observations,quality,actor_id)
    values(p.tenant_id,branch,r.id,evaluation->'observations',evaluation->>'quality',p.id) returning to_jsonb(ops_remediations.*) into result;
   insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data) values(p.tenant_id,branch,r.id,'remediation',p.id,result);
   insert into public.ops_requests values(p.tenant_id,p.id,p_request_id,jsonb_build_object('action',p_action,'payload',p_payload),result);
   return result;
  end if;
  old:=to_jsonb(r);
  if p_action='result' then
   if r.assignee_id<>p.id or not public.ops_can(branch,'work') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
   if r.state='done' then raise exception 'OPS_RESULT_LOCKED'; end if;
   evaluation:=public.ops_evaluate(r.criteria,p_payload->'observations');
   update public.ops_runs set observations=evaluation->'observations',quality=evaluation->>'quality',critical_failure=critical_failure or (evaluation->>'critical')::boolean,had_failure=had_failure or evaluation->>'quality'='unmet',
   state=case when state='transferred' then state when evaluation->>'quality'='met' then 'done' else state end,met_at=case when state<>'transferred' and evaluation->>'quality'='met' then now() else null end,
   verified_by=null,verified_at=null,version=version+1 where id=eid returning to_jsonb(ops_runs.*) into result;
  else
   if not public.ops_can(branch,'verify') or r.assignee_id=p.id then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
   if (r.quality='unknown' and r.original_due_at>now()) or coalesce(trim(p_payload->>'note'),'')='' then raise exception 'OPS_VERIFICATION_REQUIRED'; end if;
   if coalesce((p_payload->>'correction')::boolean,false) then
    evaluation:=public.ops_evaluate(r.criteria,p_payload->'observations');
    update public.ops_runs set observations=evaluation->'observations',quality=evaluation->>'quality',critical_failure=(evaluation->>'critical')::boolean,
    state=case when state='transferred' then state when evaluation->>'quality'='met' then 'done' else 'pending' end,
    met_at=case when state<>'transferred' and evaluation->>'quality'='met' then coalesce(met_at,now()) else null end where id=eid;
   end if;
   update public.ops_runs set verified_by=p.id,verified_at=now(),verification_note=p_payload->>'note',version=version+1 where id=eid returning to_jsonb(ops_runs.*) into result;
  end if;
 elsif p_action in ('todo','transfer') then
  if not (p_action='transfer' and p_payload->>'todoId' is not null) and ((p_payload->>'dueAt')::timestamptz is null or (p_payload->>'dueAt')::timestamptz<now()) then raise exception 'OPS_INVALID_DEADLINE'; end if;
  a:=(p_payload->>'assigneeId')::uuid;
  if not public.ops_manager(branch,a) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  if not public.ops_can(branch,'work') and not public.ops_can(branch,'approve_policy') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if p_action='transfer' then
   select * into r from public.ops_runs where id=(p_payload->>'runId')::uuid and tenant_id=p.tenant_id and branch_id=branch for update;
   if r.id is null or r.assignee_id<>p.id or r.state='done' then raise exception 'OPS_INVALID_STATE'; end if;
   if r.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
   if exists(select 1 from public.ops_todo_links where run_id=r.id) then raise exception 'OPS_SOURCE_LINKED'; end if;
   a:=r.assignee_id;
   if exists(select 1 from public.ops_periods where branch_id=branch and period=to_char(r.original_due_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM')) then raise exception 'OPS_PERIOD_LOCKED'; end if;
   update public.ops_runs set state='transferred',version=version+1 where id=r.id;
  end if;
  for c in select jsonb_array_elements_text(coalesce(p_payload->'collaborators','[]'))::uuid loop
   if not exists(select 1 from public.profiles where id=c and tenant_id=p.tenant_id and is_active) then raise exception 'OPS_INVALID_COLLABORATOR'; end if;
  end loop;
  if p_action='transfer' and p_payload ? 'todoId' and p_payload->>'todoId' is not null then
   select * into t from public.ops_todos where id=(p_payload->>'todoId')::uuid and tenant_id=p.tenant_id and branch_id=branch and state not in ('done','canceled') for update;
   if t.id is null then raise exception 'OPS_NOT_FOUND'; end if;
   insert into public.ops_todo_links values(p.tenant_id,branch,t.id,r.id);
   result:=to_jsonb(t); eid:=t.id;
  else
  insert into public.ops_todos(tenant_id,branch_id,run_id,title,description,category,priority,assignee_id,collaborators,due_at,original_due_at,created_by)
  values(p.tenant_id,branch,case when p_action='transfer' then r.id else null end,p_payload->>'title',coalesce(p_payload->>'description',''),p_payload->>'category',p_payload->>'priority',a,array(select jsonb_array_elements_text(coalesce(p_payload->'collaborators','[]'))::uuid),(p_payload->>'dueAt')::timestamptz,(p_payload->>'dueAt')::timestamptz,p.id) returning to_jsonb(ops_todos.*) into result;
  eid:=(result->>'id')::uuid;
  if p_action='transfer' then insert into public.ops_todo_links values(p.tenant_id,branch,eid,r.id); end if;
  end if;
 elsif p_action='todo_update' then
  select * into t from public.ops_todos where id=eid and tenant_id=p.tenant_id and branch_id=branch for update;
  if t.id is null then raise exception 'OPS_NOT_FOUND'; end if;
  if t.version is distinct from (p_payload->>'version')::integer then raise exception 'OPS_STALE'; end if;
  if t.state in ('done','canceled') then raise exception 'OPS_INVALID_STATE'; end if;
  if p_payload->>'state'='canceled' then
   if not public.ops_can(branch,'cancel_todo') or coalesce(trim(p_payload->>'reason'),'')='' then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  elsif (t.assignee_id<>p.id or not public.ops_can(branch,'work')) and not public.ops_can(branch,'approve_policy') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  old:=to_jsonb(t);
  if (p_payload->>'dueAt')::timestamptz<>t.due_at and coalesce(trim(p_payload->>'reason'),'')='' then raise exception 'OPS_REASON_REQUIRED'; end if;
  if (p_payload->>'assigneeId')::uuid is distinct from t.assignee_id and p_payload ? 'assigneeId' and coalesce(trim(p_payload->>'reason'),'')='' then raise exception 'OPS_REASON_REQUIRED'; end if;
  if p_payload->>'state'='waiting' and (coalesce(trim(p_payload->>'waitingNote'),'')='' or (p_payload->>'followUpAt')::timestamptz is null) then raise exception 'OPS_WAITING_REQUIRED'; end if;
  if p_payload->>'state'='done' and coalesce(trim(p_payload->>'resolution'),'')='' then raise exception 'OPS_RESOLUTION_REQUIRED'; end if;
  if p_payload->>'state'='done' then
   if exists(select 1 from public.ops_runs source_run join public.ops_todo_links l on l.run_id=source_run.id where l.todo_id=t.id and
    case when exists(select 1 from public.ops_periods closed where closed.branch_id=branch and closed.period=to_char(source_run.original_due_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM'))
      then coalesce((select quality from public.ops_remediations fix where fix.run_id=source_run.id order by fix.created_at desc,fix.id desc limit 1),source_run.quality)
      else source_run.quality end <>'met') then raise exception 'OPS_SOURCE_UNMET'; end if;
   update public.ops_runs source_run set state='done',met_at=now(),verified_at=null,verified_by=null,version=version+1 where source_run.id in(select run_id from public.ops_todo_links where todo_id=t.id)
    and not exists(select 1 from public.ops_periods closed where closed.branch_id=branch and closed.period=to_char(source_run.original_due_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM'));
  end if;
  a:=coalesce((p_payload->>'assigneeId')::uuid,t.assignee_id);
  if not public.ops_manager(branch,a) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  for c in select jsonb_array_elements_text(coalesce(p_payload->'collaborators',to_jsonb(t.collaborators)))::uuid loop
   if not exists(select 1 from public.profiles where id=c and tenant_id=p.tenant_id and is_active) then raise exception 'OPS_INVALID_COLLABORATOR'; end if;
  end loop;
  update public.ops_todos set state=p_payload->>'state',due_at=coalesce((p_payload->>'dueAt')::timestamptz,due_at),assignee_id=a,
  title=coalesce(p_payload->>'title',title),description=coalesce(p_payload->>'description',description),category=coalesce(p_payload->>'category',category),priority=coalesce(p_payload->>'priority',priority),collaborators=array(select jsonb_array_elements_text(coalesce(p_payload->'collaborators',to_jsonb(t.collaborators)))::uuid),waiting_note=p_payload->>'waitingNote',follow_up_at=(p_payload->>'followUpAt')::timestamptz,resolution=p_payload->>'resolution',cancel_reason=case when p_payload->>'state'='canceled' then p_payload->>'reason' else null end,
  completed_at=case when p_payload->>'state'='done' then now() else null end,version=version+1 where id=eid returning to_jsonb(ops_todos.*) into result;
 elsif p_action='comment' then
  if not public.ops_todo_visible(eid) or coalesce(trim(p_payload->>'note'),'')='' then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.ops_todos where id=eid and tenant_id=p.tenant_id and branch_id=branch) then raise exception 'OPS_NOT_FOUND'; end if;
  result:=jsonb_build_object('note',p_payload->>'note');
 elsif p_action='target' then
  if exists(select 1 from public.ops_periods where branch_id=branch and ops_periods.period=v_period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  if jsonb_typeof(p_payload->'definition')<>'object' or coalesce(p_payload->'definition'->>'label','')='' then raise exception 'OPS_DEFINITION_REQUIRED'; end if;
  select to_jsonb(ops_targets.*) into old from public.ops_targets where branch_id=branch and ops_targets.period=v_period;
  if old is not null and coalesce(trim(p_payload->>'reason'),'')='' then raise exception 'OPS_REASON_REQUIRED'; end if;
  insert into public.ops_targets(tenant_id,branch_id,period,amount_cents,definition,approved_by) values(p.tenant_id,branch,v_period,(p_payload->>'amountCents')::bigint,p_payload->'definition',p.id)
  on conflict(tenant_id,branch_id,period) do update set amount_cents=excluded.amount_cents,definition=excluded.definition,approved_by=excluded.approved_by returning to_jsonb(ops_targets.*) into result;
 elsif p_action='revenue' then
  if not public.ops_can(branch,'work') and not public.ops_can(branch,'approve_policy') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from public.ops_periods where branch_id=branch and ops_periods.period=v_period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  if coalesce(trim(p_payload->>'sourceName'),'')='' or coalesce(trim(p_payload->>'evidence'),'')='' or jsonb_typeof(p_payload->'definition')<>'object' or coalesce(p_payload->'definition'->>'label','')='' then raise exception 'OPS_EVIDENCE_REQUIRED'; end if;
  if p_payload->>'source'='onebiz' then raise exception 'OPS_USE_ONEBIZ_REVENUE'; end if;
  insert into public.ops_revenues(tenant_id,branch_id,period,source,definition,source_name,amount_cents,evidence,note,source_key,created_by)
  values(p.tenant_id,branch,v_period,p_payload->>'source',p_payload->'definition',p_payload->>'sourceName',(p_payload->>'amountCents')::bigint,p_payload->>'evidence',coalesce(p_payload->>'note',''),p_payload->>'sourceKey',p.id) returning to_jsonb(ops_revenues.*) into result;
 elsif p_action='revenue_batch' then
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 100 then raise exception 'OPS_INVALID_IMPORT'; end if;
  result:='[]';
  for row in select value from jsonb_array_elements(p_payload->'rows') loop
   if row->>'branchId' is distinct from branch::text or row->>'source' is distinct from 'xlsx' then raise exception 'OPS_INVALID_IMPORT'; end if;
   result:=result||jsonb_build_array(public.ops_execute('revenue',row,(row->>'requestId')::uuid));
  end loop;
 elsif p_action='onebiz_revenue' then
  if not public.ops_can(branch,'approve_policy') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if coalesce(v_period,'') !~ '^\d{4}-(0[1-9]|1[0-2])$' or exists(select 1 from public.ops_periods where branch_id=branch and period=v_period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  select * into target from public.ops_targets where branch_id=branch and period=v_period;
  if target.definition is distinct from '{"label":"OneBiz FnB: tổng hóa đơn hoàn thành sau giảm giá, gồm thuế, trừ trả hàng hoàn thành; ngày tạo chứng từ, giờ Việt Nam"}'::jsonb then raise exception 'OPS_DEFINITION_MISMATCH'; end if;
  start_at:=(v_period||'-01')::timestamp at time zone 'Asia/Ho_Chi_Minh';
  end_at:=((v_period||'-01')::date+interval '1 month') at time zone 'Asia/Ho_Chi_Minh';
  select jsonb_build_object('invoiceCount',count(*),'gross',coalesce(sum(i.total),0)) into result from public.invoices i where i.tenant_id=p.tenant_id and i.branch_id=branch and i.source='fnb' and i.status='completed' and i.created_at>=start_at and i.created_at<end_at;
  select result||jsonb_build_object('returnCount',count(*),'returns',coalesce(sum(sr.total),0)) into result from public.sales_returns sr join public.invoices i on i.id=sr.invoice_id and i.tenant_id=sr.tenant_id where sr.tenant_id=p.tenant_id and sr.branch_id=branch and i.branch_id=branch and i.source='fnb' and sr.status='completed' and sr.created_at>=start_at and sr.created_at<end_at;
  insert into public.ops_revenues(tenant_id,branch_id,period,source,definition,source_name,amount_cents,evidence,note,source_key,created_by)
  values(p.tenant_id,branch,v_period,'onebiz',target.definition,'OneBiz FnB',round(((result->>'gross')::numeric-(result->>'returns')::numeric)*100)::bigint,'Đối chiếu hóa đơn và phiếu trả FnB',result::text,p_request_id::text,p.id) returning to_jsonb(ops_revenues.*) into result;
 elsif p_action='approve_revenue' then
  if not public.ops_can(branch,'verify') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  select * into rev from public.ops_revenues where id=eid and branch_id=branch and tenant_id=p.tenant_id for update;
  if rev.id is null or rev.state<>'pending' then raise exception 'OPS_INVALID_STATE'; end if;
  if exists(select 1 from public.ops_periods where branch_id=branch and ops_periods.period=rev.period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  select * into target from public.ops_targets where branch_id=branch and ops_targets.period=rev.period;
  if target.tenant_id is null or target.definition<>rev.definition then raise exception 'OPS_DEFINITION_MISMATCH'; end if;
  if exists(select 1 from public.ops_revenues where branch_id=branch and ops_revenues.period=rev.period and state='approved') and coalesce(trim(p_payload->>'reason'),'')='' then raise exception 'OPS_REPLACE_REASON_REQUIRED'; end if;
  update public.ops_revenues set state='superseded' where branch_id=branch and ops_revenues.period=rev.period and state='approved';
  old:=to_jsonb(rev); update public.ops_revenues set state='approved',approved_by=p.id where id=eid returning to_jsonb(ops_revenues.*) into result;
 elsif p_action='policy' then
  perform public.ops_check_reward(p_payload->'config');
  insert into public.ops_reward_policies(tenant_id,branch_id,title,effective_from,config,created_by) values(p.tenant_id,branch,p_payload->>'title',(p_payload->>'effectiveFrom')::date,p_payload->'config',p.id) returning to_jsonb(ops_reward_policies.*) into result;
 elsif p_action='approve_policy' then
  select * into pol from public.ops_reward_policies where id=eid and tenant_id=p.tenant_id and branch_id=branch for update;
  if pol.id is null or pol.state<>'draft' or pol.effective_from<(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'OPS_INVALID_STATE'; end if;
  perform public.ops_check_reward(pol.config);
  if jsonb_typeof(pol.config->'allocations') is distinct from 'array' then raise exception 'OPS_ALLOCATION_REQUIRED'; end if;
  for row in select value from jsonb_array_elements(pol.config->'allocations') loop
   if not public.ops_manager(branch,(row->>'userId')::uuid) then raise exception 'OPS_INVALID_ASSIGNEE'; end if;
  end loop;
  old:=to_jsonb(pol); update public.ops_reward_policies set state='approved',approved_by=p.id where id=eid returning to_jsonb(ops_reward_policies.*) into result;
 elsif p_action='close_period' then
  if not public.ops_can(branch,'close_period') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
  if coalesce(v_period,'') !~ '^\d{4}-(0[1-9]|1[0-2])$' or coalesce(trim(p_payload->>'reason'),'')='' then raise exception 'OPS_REASON_REQUIRED'; end if;
  start_at:=(v_period||'-01')::timestamp at time zone 'Asia/Ho_Chi_Minh';
  end_at:=((v_period||'-01')::date+interval '1 month') at time zone 'Asia/Ho_Chi_Minh';
  if now()<end_at then raise exception 'OPS_PERIOD_NOT_ENDED'; end if;
  if exists(select 1 from public.ops_periods where branch_id=branch and period=v_period) then raise exception 'OPS_PERIOD_LOCKED'; end if;
  perform public.ops_generate(branch,(end_at at time zone 'Asia/Ho_Chi_Minh')::date-1);
  if not exists(select 1 from public.ops_runs where branch_id=branch and original_due_at>=start_at and original_due_at<end_at)
    or exists(select 1 from public.ops_runs where branch_id=branch and original_due_at>=start_at and original_due_at<end_at and verified_at is null) then raise exception 'OPS_VERIFICATION_REQUIRED'; end if;
  select * into target from public.ops_targets where branch_id=branch and period=v_period;
  select * into rev from public.ops_revenues where branch_id=branch and period=v_period and state='approved';
  select * into pol from public.ops_reward_policies where branch_id=branch and state='approved' and effective_from<=(v_period||'-01')::date order by effective_from desc limit 1;
  if target.tenant_id is null or rev.id is null or pol.id is null or target.definition<>rev.definition then raise exception 'OPS_DEFINITION_MISMATCH'; end if;
  result:=jsonb_build_object('runs',(select jsonb_agg(to_jsonb(x)) from public.ops_runs x where branch_id=branch and original_due_at>=start_at and original_due_at<end_at),
    'target',to_jsonb(target),'revenue',to_jsonb(rev),'policy',to_jsonb(pol),
    'rewards',public.ops_reward_snapshot(branch,start_at,end_at,pol.config,rev.amount_cents,target.amount_cents),'calculatedAt',now());
  insert into public.ops_periods(tenant_id,branch_id,period,snapshot,closed_by,reason) values(p.tenant_id,branch,v_period,result,p.id,p_payload->>'reason') returning to_jsonb(ops_periods.*) into result;
  eid:=(result->>'id')::uuid;
 else raise exception 'OPS_UNKNOWN_ACTION';
 end if;
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,before_data,after_data,reason) values(p.tenant_id,branch,eid,p_action,p.id,old,result,p_payload->>'reason');
 insert into public.ops_requests values(p.tenant_id,p.id,p_request_id,jsonb_build_object('action',p_action,'payload',p_payload),result);
 return result;
end $$;

-- Function privileges are deliberately explicit; helpers cannot be used to mutate data.
revoke all on function public.ops_execute(text,jsonb,uuid),public.ops_generate(uuid,date) from public,anon;
grant execute on function public.ops_execute(text,jsonb,uuid),public.ops_generate(uuid,date) to authenticated;
revoke all on function public.ops_ceo(),public.ops_can(uuid,text),public.ops_manager(uuid,uuid),public.ops_todo_visible(uuid),public.ops_check_criteria(jsonb),public.ops_evaluate(jsonb,jsonb),public.ops_check_reward(jsonb) from public,anon;
grant execute on function public.ops_ceo(),public.ops_can(uuid,text),public.ops_manager(uuid,uuid),public.ops_todo_visible(uuid) to authenticated;

-- A single bounded workspace read; no per-row profile queries or polling loop.
create function public.ops_workspace(p_branch uuid,p_period text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; output jsonb; start_at timestamptz; end_at timestamptz; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED' using errcode='42501'; end if;
 if coalesce(p_period,'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'OPS_INVALID_RANGE'; end if;
 if not public.ops_has_permission('ops.view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if p_branch is not null and not public.ops_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 start_at:=(p_period||'-01')::timestamp at time zone 'Asia/Ho_Chi_Minh';
 end_at:=((p_period||'-01')::date+interval '1 month') at time zone 'Asia/Ho_Chi_Minh';
 output:=jsonb_build_object('userId',p.id,'isCeo',public.ops_ceo(),'period',p_period,
 'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code,'capabilities',array(select c from unnest(array['work','verify','close_period','cancel_todo','approve_policy','manage_members']) c where public.ops_can(b.id,c)))) from public.branches b where b.tenant_id=p.tenant_id and b.is_active and public.ops_can(b.id,'view')),'[]'),
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz'))) from public.profiles u where u.tenant_id=p.tenant_id and u.is_active and (public.ops_ceo() or public.ops_can(p_branch,'view') or exists(select 1 from public.ops_todos t where t.tenant_id=p.tenant_id and p.id=any(t.collaborators) and (t.assignee_id=u.id or t.created_by=u.id or u.id=any(t.collaborators))))),'[]'),
 'members',coalesce((select jsonb_agg(to_jsonb(m)) from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=p_branch),'[]'),
 'standards',coalesce((select jsonb_agg(to_jsonb(s)) from public.ops_standards s where s.tenant_id=p.tenant_id and s.branch_id=p_branch),'[]'),
 'runs',coalesce((select jsonb_agg(to_jsonb(r) order by r.original_due_at) from public.ops_runs r where r.tenant_id=p.tenant_id and r.branch_id=p_branch and r.original_due_at>=start_at and r.original_due_at<end_at),'[]'),
 'todosOverdue',(select count(*) from public.ops_todos t where t.tenant_id=p.tenant_id and ((t.branch_id=p_branch and public.ops_can(t.branch_id,'view')) or p.id=any(t.collaborators)) and t.state not in ('done','canceled') and t.due_at<now()),
 'todos',coalesce((select jsonb_agg(to_jsonb(t) order by (t.state in ('done','canceled')),t.due_at) from (select * from public.ops_todos t where t.tenant_id=p.tenant_id and ((t.branch_id=p_branch and public.ops_can(t.branch_id,'view')) or p.id=any(t.collaborators)) order by (t.state in ('done','canceled')),t.due_at limit 500) t),'[]'),
 'revenues',coalesce((select jsonb_agg(to_jsonb(r)) from public.ops_revenues r where r.tenant_id=p.tenant_id and r.branch_id=p_branch and r.period=p_period),'[]'),
 'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.ops_targets t where t.tenant_id=p.tenant_id and t.branch_id=p_branch and t.period=p_period),'[]'),
 'policies',coalesce((select jsonb_agg(to_jsonb(t)) from public.ops_reward_policies t where t.tenant_id=p.tenant_id and t.branch_id=p_branch),'[]'),
 'periods',coalesce((select jsonb_agg(to_jsonb(t)) from public.ops_periods t where t.tenant_id=p.tenant_id and t.branch_id=p_branch and t.period=p_period),'[]'),
 'audit',coalesce((select jsonb_agg(to_jsonb(a)) from (select a.id,a.entity_id,a.action,a.actor_id,a.created_at,a.reason,jsonb_build_object('note',a.after_data->>'note') as after_data from public.ops_audit a where a.tenant_id=p.tenant_id and ((a.branch_id=p_branch and public.ops_can(p_branch,'view')) or public.ops_todo_visible(a.entity_id)) order by created_at desc,a.id desc limit 100) a),'[]'));
 return output;
end $$;
revoke all on function public.ops_workspace(uuid,text) from public,anon;
grant execute on function public.ops_workspace(uuid,text) to authenticated;

-- Read-only keyset pagination; identical timestamps cannot hide an older row.
create function public.ops_history(p_branch uuid,p_period text,p_kind text default 'audit',p_cursor_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; start_at timestamptz; end_at timestamptz; items jsonb; tail jsonb; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is null then raise exception 'OPS_UNAUTHENTICATED' using errcode='42501'; end if;
 if not public.ops_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN' using errcode='42501'; end if;
 if coalesce(p_period,'') !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_kind not in ('audit','todos') or (p_cursor_at is null)<>(p_cursor_id is null) then raise exception 'OPS_INVALID_RANGE'; end if;
 start_at:=(p_period||'-01')::timestamp at time zone 'Asia/Ho_Chi_Minh';
 end_at:=((p_period||'-01')::date+interval '1 month') at time zone 'Asia/Ho_Chi_Minh';
 if p_kind='audit' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into items from (
   select a.id,a.action,a.created_at,a.reason,coalesce(a.after_data->>'title',a.before_data->>'title','') as title,
    coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz') as actor_name
   from public.ops_audit a left join public.profiles u on u.id=a.actor_id and u.tenant_id=p.tenant_id
   where a.tenant_id=p.tenant_id and a.branch_id=p_branch and a.created_at>=start_at and a.created_at<end_at
    and (p_cursor_at is null or (a.created_at,a.id)<(p_cursor_at,p_cursor_id)) order by a.created_at desc,a.id desc limit 51
  ) x;
 else
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into items from (
   select t.id,t.title,t.state as action,t.created_at,null::text as reason,
    coalesce(nullif(u.full_name,''),u.email,'Tài khoản OneBiz') as actor_name
   from public.ops_todos t left join public.profiles u on u.id=t.assignee_id and u.tenant_id=p.tenant_id
   where t.tenant_id=p.tenant_id and t.branch_id=p_branch and t.created_at>=start_at and t.created_at<end_at
    and (p_cursor_at is null or (t.created_at,t.id)<(p_cursor_at,p_cursor_id)) order by t.created_at desc,t.id desc limit 51
  ) x;
 end if;
 if jsonb_array_length(items)>50 then tail:=items->49; items:=items-50; end if;
 return jsonb_build_object('rows',items,'next',case when tail is not null then jsonb_build_object('at',tail->>'created_at','id',tail->>'id') else null end);
end $$;
revoke all on function public.ops_history(uuid,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.ops_history(uuid,text,text,timestamptz,uuid) to authenticated;
commit;
