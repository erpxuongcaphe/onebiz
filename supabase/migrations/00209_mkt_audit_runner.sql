-- 00209: MKT Audit Runner with a physically shared but logically isolated sandbox.
-- This migration never creates, moves, or updates business rows in a real tenant.

-- Permission is capability based. Owners keep the standard OneBiz bypass.
insert into public.role_permissions (role_id, permission_code)
select distinct rp.role_id, 'mkt.audit_runner'
from public.role_permissions rp
where rp.permission_code = 'mkt.view_audit'
  and exists (
    select 1 from public.role_permissions x
    where x.role_id = rp.role_id and x.permission_code = 'mkt.override_campaign'
  )
on conflict (role_id, permission_code) do nothing;

create table if not exists public.mkt_audit_sandboxes (
  id uuid primary key default uuid_generate_v4(),
  owner_tenant_id uuid not null references public.tenants(id) on delete cascade,
  sandbox_tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_tenant_id),
  unique (sandbox_tenant_id),
  check (owner_tenant_id <> sandbox_tenant_id)
);

create table if not exists public.mkt_audit_actors (
  id uuid primary key default uuid_generate_v4(),
  sandbox_id uuid not null references public.mkt_audit_sandboxes(id) on delete cascade,
  actor_key text not null check (actor_key in ('ceo', 'leader', 'executive', 'reviewer', 'unauthorized')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (sandbox_id, actor_key),
  unique (sandbox_id, user_id)
);

create table if not exists public.mkt_audit_runs (
  id uuid primary key default uuid_generate_v4(),
  owner_tenant_id uuid not null references public.tenants(id) on delete cascade,
  sandbox_id uuid not null references public.mkt_audit_sandboxes(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  total_count integer not null default 0,
  passed_count integer not null default 0,
  failed_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.mkt_audit_results (
  id uuid primary key default uuid_generate_v4(),
  run_id uuid not null references public.mkt_audit_runs(id) on delete cascade,
  scenario_key text not null,
  expected text not null,
  actual text not null,
  error_code text,
  audit_recorded boolean not null default false,
  result text not null check (result in ('PASS', 'FAIL', 'ERROR')),
  duration_ms integer not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id, scenario_key)
);

create table if not exists public.mkt_security_events (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid references public.mkt_audit_runs(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  reason_code text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_mkt_audit_runs_owner
  on public.mkt_audit_runs(owner_tenant_id, started_at desc);
create index if not exists idx_mkt_audit_results_run
  on public.mkt_audit_results(run_id, scenario_key);
create index if not exists idx_mkt_security_events_tenant
  on public.mkt_security_events(tenant_id, created_at desc);

alter table public.mkt_audit_sandboxes enable row level security;
alter table public.mkt_audit_actors enable row level security;
alter table public.mkt_audit_runs enable row level security;
alter table public.mkt_audit_results enable row level security;
alter table public.mkt_security_events enable row level security;

drop policy if exists mkt_audit_sandboxes_select on public.mkt_audit_sandboxes;
create policy mkt_audit_sandboxes_select on public.mkt_audit_sandboxes
for select to authenticated using (
  owner_tenant_id = public.get_user_tenant_id()
  and public.user_has_permission(auth.uid(), 'mkt.audit_runner')
);

drop policy if exists mkt_audit_actors_select on public.mkt_audit_actors;
create policy mkt_audit_actors_select on public.mkt_audit_actors
for select to authenticated using (
  exists (
    select 1 from public.mkt_audit_sandboxes s
    where s.id = sandbox_id
      and s.owner_tenant_id = public.get_user_tenant_id()
      and public.user_has_permission(auth.uid(), 'mkt.audit_runner')
  )
);

drop policy if exists mkt_audit_runs_select on public.mkt_audit_runs;
create policy mkt_audit_runs_select on public.mkt_audit_runs
for select to authenticated using (
  owner_tenant_id = public.get_user_tenant_id()
  and public.user_has_permission(auth.uid(), 'mkt.audit_runner')
);

drop policy if exists mkt_audit_results_select on public.mkt_audit_results;
create policy mkt_audit_results_select on public.mkt_audit_results
for select to authenticated using (
  exists (
    select 1 from public.mkt_audit_runs r
    where r.id = run_id
      and r.owner_tenant_id = public.get_user_tenant_id()
      and public.user_has_permission(auth.uid(), 'mkt.audit_runner')
  )
);

drop policy if exists mkt_security_events_select on public.mkt_security_events;
create policy mkt_security_events_select on public.mkt_security_events
for select to authenticated using (
  exists (
    select 1 from public.mkt_audit_sandboxes s
    where s.sandbox_tenant_id = tenant_id
      and s.owner_tenant_id = public.get_user_tenant_id()
      and public.user_has_permission(auth.uid(), 'mkt.audit_runner')
  )
);
grant select on public.mkt_audit_sandboxes to authenticated;
grant select on public.mkt_audit_actors to authenticated;
grant select on public.mkt_audit_runs to authenticated;
grant select on public.mkt_audit_results to authenticated;
grant select on public.mkt_security_events to authenticated;



-- Audit sandboxes must never send real notifications or outbox messages.
create or replace function public.mkt_drop_audit_sandbox_delivery()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.tenants t
    where t.id = new.tenant_id
      and lower(coalesce(t.settings->>'is_audit_sandbox', 'false')) = 'true'
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notifications_drop_mkt_audit on public.notifications;
create trigger trg_notifications_drop_mkt_audit
before insert on public.notifications
for each row execute function public.mkt_drop_audit_sandbox_delivery();

drop trigger if exists trg_outbox_drop_mkt_audit on public.mkt_outbox_events;
create trigger trg_outbox_drop_mkt_audit
before insert on public.mkt_outbox_events
for each row execute function public.mkt_drop_audit_sandbox_delivery();

-- Explicit blocked-state mutation used by TEST-07 and the normal task API.
alter table public.mkt_tasks
  add column if not exists blocked_external_input text,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_by uuid references public.profiles(id) on delete set null;

create or replace function public.mkt_block_task(
  p_task_id uuid,
  p_reason text,
  p_external_input text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MISSING_REASON' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_external_input, '')), '') is null then
    raise exception 'EXTERNAL_INPUT_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_task
  from public.mkt_tasks
  where id = p_task_id and deleted_at is null
  for update;

  if not found or v_task.tenant_id <> public.get_user_tenant_id() then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_task.assignee_id <> v_actor then
    raise exception 'NOT_ASSIGNEE' using errcode = 'P0001';
  end if;
  if v_task.acceptance_status <> 'accepted' or v_task.task_status not in ('todo', 'doing') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  update public.mkt_tasks
  set task_status = 'blocked',
      blocked_reason = trim(p_reason),
      blocked_external_input = trim(p_external_input),
      blocked_at = now(),
      blocked_by = v_actor,
      requires_leader_action = true,
      updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  perform public.mkt_record_audit(
    v_task.tenant_id, v_actor, 'mkt_task_blocked', 'mkt_task', v_task.id, null,
    jsonb_build_object('reason', trim(p_reason), 'external_input', trim(p_external_input))
  );
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

revoke all on function public.mkt_block_task(uuid, text, text) from public, anon;
grant execute on function public.mkt_block_task(uuid, text, text) to authenticated;

-- Keep the current MKT context contract and expose the dedicated permission.
create or replace function public.mkt_get_my_context()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
begin
  if v_actor is null then return jsonb_build_object('canView', false); end if;

  select id, tenant_id, branch_id into v_profile
  from public.profiles
  where id = v_actor and coalesce(is_active, true);

  if not found then return jsonb_build_object('canView', false); end if;

  return jsonb_build_object(
    'canView', public.user_has_permission(v_actor, 'mkt.view'),
    'isLead', public.user_has_permission(v_actor, 'mkt.manage_campaigns')
              or public.user_has_permission(v_actor, 'mkt.manage_team'),
    'canManageCampaigns', public.user_has_permission(v_actor, 'mkt.manage_campaigns'),
    'canSplit', public.user_has_permission(v_actor, 'mkt.split_work_packages')
                or public.user_has_permission(v_actor, 'mkt.manage_campaigns'),
    'canReview', public.user_has_permission(v_actor, 'mkt.review_content'),
    'canManageTeam', public.user_has_permission(v_actor, 'mkt.manage_team'),
    'canOverride', public.user_has_permission(v_actor, 'mkt.override_campaign'),
    'canViewAudit', public.user_has_permission(v_actor, 'mkt.view_audit'),
    'canAuditRunner', public.user_has_permission(v_actor, 'mkt.audit_runner'),
    'canTelegram', public.user_has_permission(v_actor, 'mkt.telegram_manage'),
    'canManageAssets', public.user_has_permission(v_actor, 'mkt.manage_assets'),
    'tenantId', v_profile.tenant_id,
    'branchId', v_profile.branch_id,
    'readinessRoles', to_jsonb(array(
      select x.role_code
      from (values
        ('finance', 'mkt.readiness.finance'),
        ('ops', 'mkt.readiness.ops'),
        ('warehouse', 'mkt.readiness.warehouse'),
        ('store_manager', 'mkt.readiness.store'),
        ('ceo', 'mkt.readiness.ceo')
      ) as x(role_code, permission_code)
      where public.user_has_permission(v_actor, x.permission_code)
    ))
  );
end;
$$;

-- Only the service role can orchestrate scenarios. Every fixture is checked
-- against the sandbox mapping and tenant flag before a business RPC is called.
create or replace function public.mkt_audit_execute_scenario(
  p_run_id uuid,
  p_scenario_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run record;
  v_sandbox record;
  v_sandbox_tenant_id uuid;
  v_exec uuid;
  v_leader uuid;
  v_reviewer uuid;
  v_unauthorized uuid;
  v_actor uuid;
  v_campaign uuid := uuid_generate_v4();
  v_wp uuid := uuid_generate_v4();
  v_task uuid := uuid_generate_v4();
  v_dep uuid := uuid_generate_v4();
  v_content uuid := uuid_generate_v4();
  v_version uuid := uuid_generate_v4();
  v_pillar uuid := uuid_generate_v4();
  v_expected_code text;
  v_expected text;
  v_actual text := 'Allowed';
  v_error_code text;
  v_result text := 'FAIL';
  v_audit boolean := false;
  v_started timestamptz := clock_timestamp();
  v_old_claims text := current_setting('request.jwt.claims', true);
  v_old_sub text := current_setting('request.jwt.claim.sub', true);
  v_http integer := 200;
begin
  select * into v_run from public.mkt_audit_runs where id = p_run_id and status = 'running';
  if not found then raise exception 'AUDIT_RUN_NOT_FOUND' using errcode = 'P0001'; end if;

  select s.*, t.settings into v_sandbox
  from public.mkt_audit_sandboxes s
  join public.tenants t on t.id = s.sandbox_tenant_id
  where s.id = v_run.sandbox_id
    and s.owner_tenant_id = v_run.owner_tenant_id
    and s.is_enabled
    and lower(coalesce(t.settings->>'is_audit_sandbox', 'false')) = 'true';

  if not found then
    raise exception 'AUDIT_TARGET_FORBIDDEN' using errcode = 'P0001';
  end if;
  v_sandbox_tenant_id := v_sandbox.sandbox_tenant_id;
  if v_sandbox_tenant_id = v_run.owner_tenant_id then
    raise exception 'AUDIT_TARGET_FORBIDDEN' using errcode = 'P0001';
  end if;

  select user_id into v_exec from public.mkt_audit_actors
  where sandbox_id = v_sandbox.id and actor_key = 'executive';
  select user_id into v_leader from public.mkt_audit_actors
  where sandbox_id = v_sandbox.id and actor_key = 'leader';
  select user_id into v_reviewer from public.mkt_audit_actors
  where sandbox_id = v_sandbox.id and actor_key = 'reviewer';
  select user_id into v_unauthorized from public.mkt_audit_actors
  where sandbox_id = v_sandbox.id and actor_key = 'unauthorized';

  if v_exec is null or v_leader is null or v_reviewer is null or v_unauthorized is null then
    raise exception 'AUDIT_SANDBOX_INCOMPLETE' using errcode = 'P0001';
  end if;

  v_expected_code := case p_scenario_key
    when 'TEST-01' then 'INVALID_STATE'
    when 'TEST-02' then 'DEPENDENCY_BLOCKED'
    when 'TEST-03' then 'INVALID_STATE'
    when 'TEST-04' then 'CONTENT_NOT_APPROVED'
    when 'TEST-05' then 'MISSING_REASON'
    when 'TEST-06' then 'INSUFFICIENT_ROLE'
    when 'TEST-07' then 'EXTERNAL_INPUT_REQUIRED'
    when 'TEST-08' then null
    when 'TEST-09' then 'READINESS_NOT_READY'
    when 'TEST-10' then 'MISSING_REASON'
    else 'UNKNOWN_SCENARIO'
  end;
  if v_expected_code = 'UNKNOWN_SCENARIO' then
    raise exception 'UNKNOWN_SCENARIO' using errcode = 'P0001';
  end if;

  v_expected := case when v_expected_code is null
    then 'Allowed and audit log created'
    else 'Blocked with ' || v_expected_code
  end;

  insert into public.mkt_campaigns
    (id, tenant_id, name, status, created_by, updated_by)
  values
    (v_campaign, v_sandbox_tenant_id, '[AUDIT] ' || p_scenario_key, 'planning', v_leader, v_leader);

  insert into public.mkt_channel_work_packages
    (id, tenant_id, campaign_id, channel_type, title, owner_id, reviewer_id, status, created_by, updated_by)
  values
    (v_wp, v_sandbox_tenant_id, v_campaign, 'other', '[AUDIT] Package', v_leader, v_reviewer, 'needs_split', v_leader, v_leader);

  insert into public.mkt_content_pillars
    (id, tenant_id, code, name, is_active)
  values
    (v_pillar, v_sandbox_tenant_id, 'AUDIT-' || substr(v_campaign::text, 1, 8), '[AUDIT] Pillar', true);

  if p_scenario_key = 'TEST-02' then
    insert into public.mkt_tasks
      (id, tenant_id, campaign_id, work_package_id, title, source_type, source_id, task_type,
       assignee_id, acceptance_status, task_status, created_by, updated_by)
    values
      (v_dep, v_sandbox_tenant_id, v_campaign, v_wp, '[AUDIT] Dependency',
       'campaign_channel_split', v_wp, 'other', v_exec, 'accepted', 'doing', v_leader, v_leader);
  end if;

  if p_scenario_key in ('TEST-03', 'TEST-04', 'TEST-10') then
    insert into public.mkt_content_items
      (id, tenant_id, campaign_id, work_package_id, title, channel_type, content_status,
       risk_level, pillar_id, current_version, created_by, updated_by)
    values
      (v_content, v_sandbox_tenant_id, v_campaign, v_wp, '[AUDIT] Content', 'other',
       case when p_scenario_key = 'TEST-10' then 'pending_review' else 'draft' end,
       'low', v_pillar, case when p_scenario_key = 'TEST-10' then 1 else 0 end, v_exec, v_exec);
  end if;

  if p_scenario_key = 'TEST-10' then
    insert into public.mkt_content_versions
      (id, tenant_id, content_item_id, version_number, content_url, status, submitted_by)
    values
      (v_version, v_sandbox_tenant_id, v_content, 1, 'https://audit.invalid/content', 'pending', v_exec);
  end if;

  if p_scenario_key not in ('TEST-06', 'TEST-09', 'TEST-10') then
    insert into public.mkt_tasks
      (id, tenant_id, campaign_id, work_package_id, content_item_id, title, source_type, source_id,
       task_type, assignee_id, reviewer_id, dependency_task_id, acceptance_status, task_status,
       created_by, updated_by)
    values
      (v_task, v_sandbox_tenant_id, v_campaign, v_wp,
       case when p_scenario_key in ('TEST-03', 'TEST-04') then v_content else null end,
       '[AUDIT] Task', 'campaign_channel_split', v_wp,
       case when p_scenario_key = 'TEST-04' then 'publish' else 'other' end,
       v_exec, v_reviewer, case when p_scenario_key = 'TEST-02' then v_dep else null end,
       case when p_scenario_key = 'TEST-01' then 'pending' else 'accepted' end,
       case when p_scenario_key in ('TEST-03', 'TEST-05', 'TEST-07') then 'doing' else 'todo' end,
       v_leader, v_leader);
  end if;

  v_actor := case
    when p_scenario_key in ('TEST-05', 'TEST-08', 'TEST-09') then v_leader
    when p_scenario_key = 'TEST-06' then v_unauthorized
    when p_scenario_key = 'TEST-10' then v_reviewer
    else v_exec
  end;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  begin
    case p_scenario_key
      when 'TEST-01' then perform public.mkt_start_task(v_task);
      when 'TEST-02' then perform public.mkt_start_task(v_task);
      when 'TEST-03' then perform public.mkt_submit_task_review(v_task, v_content, '', null);
      when 'TEST-04' then perform public.mkt_start_task(v_task);
      when 'TEST-05' then perform public.mkt_force_task_done(v_task, null);
      when 'TEST-06' then perform public.mkt_assign_channel_planning(v_wp, v_exec, v_reviewer, '{}'::jsonb);
      when 'TEST-07' then perform public.mkt_block_task(v_task, 'Waiting for source material', null);
      when 'TEST-08' then perform public.mkt_reassign_task(v_task, v_reviewer, 'Audit reassignment');
      when 'TEST-09' then perform public.mkt_change_campaign_status(v_campaign, 'running', null);
      when 'TEST-10' then perform public.mkt_review_content(v_content, v_version, 'revision', '');
    end case;
  exception when others then
    v_error_code := split_part(SQLERRM, ':', 1);
    v_http := case
      when v_error_code in ('INSUFFICIENT_ROLE', 'NOT_ASSIGNEE', 'READINESS_NOT_READY') then 403
      when v_error_code = 'NOT_FOUND' then 404
      else 400
    end;
    v_actual := 'Blocked (HTTP ' || v_http || ', ' || SQLERRM || ')';

    insert into public.mkt_security_events
      (tenant_id, run_id, actor_id, event_type, entity_type, entity_id, reason_code, details)
    values
      (v_sandbox_tenant_id, p_run_id, v_actor, 'mkt_mutation_denied',
       case when p_scenario_key in ('TEST-09') then 'mkt_campaign'
            when p_scenario_key in ('TEST-03', 'TEST-04', 'TEST-10') then 'mkt_content_item'
            else 'mkt_task' end,
       case when p_scenario_key = 'TEST-09' then v_campaign
            when p_scenario_key in ('TEST-03', 'TEST-04', 'TEST-10') then v_content
            else v_task end,
       v_error_code, jsonb_build_object('scenario', p_scenario_key, 'message', SQLERRM));
    v_audit := true;
  end;

  if p_scenario_key = 'TEST-08' and v_error_code is null then
    select exists (
      select 1 from public.audit_log
      where tenant_id = v_sandbox_tenant_id
        and action = 'mkt_task_reassigned'
        and entity_id = v_task
    ) into v_audit;
    v_actual := case when v_audit then 'Allowed; audit log created' else 'Allowed; audit log missing' end;
    v_result := case when v_audit then 'PASS' else 'FAIL' end;
  elsif v_error_code is not null then
    v_result := case when v_error_code = v_expected_code and v_audit then 'PASS' else 'FAIL' end;
  else
    v_result := 'FAIL';
  end if;

  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_old_claims, '{}'), true);

  -- Cascades remove only this scenario's fake campaign graph. Audit evidence stays.
  delete from public.mkt_campaigns
  where id = v_campaign and tenant_id = v_sandbox_tenant_id;
  delete from public.mkt_content_pillars
  where id = v_pillar and tenant_id = v_sandbox_tenant_id;

  insert into public.mkt_audit_results
    (run_id, scenario_key, expected, actual, error_code, audit_recorded, result, duration_ms)
  values
    (p_run_id, p_scenario_key, v_expected, v_actual, v_error_code, v_audit, v_result,
     greatest(0, floor(extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer))
  on conflict (run_id, scenario_key) do update set
    expected = excluded.expected,
    actual = excluded.actual,
    error_code = excluded.error_code,
    audit_recorded = excluded.audit_recorded,
    result = excluded.result,
    duration_ms = excluded.duration_ms,
    created_at = now();

  return jsonb_build_object(
    'scenarioKey', p_scenario_key,
    'expected', v_expected,
    'actual', v_actual,
    'errorCode', v_error_code,
    'auditRecorded', v_audit,
    'result', v_result
  );
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_old_claims, '{}'), true);
  delete from public.mkt_campaigns
  where id = v_campaign and tenant_id = v_sandbox_tenant_id;
  delete from public.mkt_content_pillars
  where id = v_pillar and tenant_id = v_sandbox_tenant_id;

  insert into public.mkt_audit_results
    (run_id, scenario_key, expected, actual, error_code, audit_recorded, result, duration_ms)
  values
    (p_run_id, p_scenario_key, coalesce(v_expected, 'Scenario execution'),
     'Runner error: ' || SQLERRM, split_part(SQLERRM, ':', 1), false, 'ERROR',
     greatest(0, floor(extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer))
  on conflict (run_id, scenario_key) do update set
    actual = excluded.actual,
    error_code = excluded.error_code,
    audit_recorded = false,
    result = 'ERROR',
    duration_ms = excluded.duration_ms,
    created_at = now();

  return jsonb_build_object(
    'scenarioKey', p_scenario_key,
    'expected', coalesce(v_expected, 'Scenario execution'),
    'actual', 'Runner error: ' || SQLERRM,
    'errorCode', split_part(SQLERRM, ':', 1),
    'auditRecorded', false,
    'result', 'ERROR'
  );
end;
$$;

revoke all on function public.mkt_audit_execute_scenario(uuid, text) from public, anon, authenticated;
grant execute on function public.mkt_audit_execute_scenario(uuid, text) to service_role;

notify pgrst, 'reload schema';
