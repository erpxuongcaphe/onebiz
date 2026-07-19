-- 00211: Restricted external access links for the MKT Audit Runner.
-- Tokens can only claim predefined runs against an existing audit sandbox.
-- This migration does not read, update, or delete business data.

create table if not exists public.mkt_audit_access_tokens (
  id uuid primary key default extensions.uuid_generate_v4(),
  owner_tenant_id uuid not null references public.tenants(id) on delete cascade,
  sandbox_id uuid not null references public.mkt_audit_sandboxes(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  max_runs smallint not null default 3 check (max_runs between 1 and 5),
  used_runs smallint not null default 0 check (used_runs >= 0),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (token_hash ~ '^[0-9a-f]{64}$'),
  check (token_hash = lower(token_hash)),
  check (used_runs <= max_runs)
);

create index if not exists idx_mkt_audit_access_owner_created
  on public.mkt_audit_access_tokens(owner_tenant_id, created_at desc);
create index if not exists idx_mkt_audit_access_sandbox_active
  on public.mkt_audit_access_tokens(sandbox_id, expires_at)
  where revoked_at is null;

alter table public.mkt_audit_access_tokens enable row level security;
revoke all on table public.mkt_audit_access_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.mkt_audit_access_tokens to service_role;

alter table public.mkt_audit_runs
  add column if not exists access_token_id uuid
    references public.mkt_audit_access_tokens(id) on delete set null;

create index if not exists idx_mkt_audit_runs_access_token
  on public.mkt_audit_runs(access_token_id, started_at desc)
  where access_token_id is not null;

-- Close stale runs and duplicate running metadata without touching completed
-- audit history. The newest non-stale run for each sandbox remains active.
with running_ranked as (
  select
    id,
    started_at,
    row_number() over (
      partition by sandbox_id
      order by started_at desc, id desc
    ) as running_rank
  from public.mkt_audit_runs
  where status = 'running'
)
update public.mkt_audit_runs run
set status = 'failed', completed_at = coalesce(run.completed_at, now())
from running_ranked ranked
where run.id = ranked.id
  and (
    ranked.started_at <= now() - interval '5 minutes'
    or ranked.running_rank > 1
  );

create unique index if not exists idx_mkt_audit_one_running_per_sandbox
  on public.mkt_audit_runs(sandbox_id)
  where status = 'running';

create or replace function public.mkt_create_audit_access_token(
  p_owner_tenant_id uuid,
  p_sandbox_id uuid,
  p_created_by uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_max_runs integer default 3
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sandbox_tenant_id uuid;
  v_access_id uuid;
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash <> lower(p_token_hash) then
    raise exception 'AI_ACCESS_INVALID' using errcode = 'P0001';
  end if;
  if p_expires_at <= now() + interval '5 minutes'
     or p_expires_at > now() + interval '24 hours' then
    raise exception 'AI_ACCESS_EXPIRY_INVALID' using errcode = 'P0001';
  end if;
  if p_max_runs not between 1 and 5 then
    raise exception 'AI_ACCESS_LIMIT_INVALID' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_created_by
      and p.tenant_id = p_owner_tenant_id
      and coalesce(p.is_active, true)
  ) then
    raise exception 'AI_ACCESS_CREATOR_INVALID' using errcode = 'P0001';
  end if;

  select s.sandbox_tenant_id into v_sandbox_tenant_id
  from public.mkt_audit_sandboxes s
  join public.tenants t on t.id = s.sandbox_tenant_id
  where s.id = p_sandbox_id
    and s.owner_tenant_id = p_owner_tenant_id
    and s.is_enabled
    and s.sandbox_tenant_id <> s.owner_tenant_id
    and lower(coalesce(t.settings->>'is_audit_sandbox', 'false')) = 'true'
  for update of s;

  if not found then
    raise exception 'AUDIT_TARGET_FORBIDDEN' using errcode = 'P0001';
  end if;

  -- One active share link per tenant. Creating a new link revokes the old one.
  update public.mkt_audit_access_tokens
  set revoked_at = now(), revoked_by = p_created_by
  where owner_tenant_id = p_owner_tenant_id
    and revoked_at is null
    and expires_at > now()
    and used_runs < max_runs;

  insert into public.mkt_audit_access_tokens
    (owner_tenant_id, sandbox_id, created_by, token_hash, expires_at, max_runs)
  values
    (p_owner_tenant_id, p_sandbox_id, p_created_by, p_token_hash,
     p_expires_at, p_max_runs)
  returning id into v_access_id;

  insert into public.mkt_security_events
    (tenant_id, actor_id, event_type, entity_type, entity_id, details)
  values
    (v_sandbox_tenant_id, p_created_by, 'mkt_audit_access_created',
     'mkt_audit_access_token', v_access_id,
     jsonb_build_object('expires_at', p_expires_at, 'max_runs', p_max_runs));

  return jsonb_build_object('accessId', v_access_id);
end;
$$;

create or replace function public.mkt_read_audit_access_token(
  p_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_access record;
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash <> lower(p_token_hash) then
    raise exception 'AI_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select a.id, a.expires_at, a.max_runs, a.used_runs
  into v_access
  from public.mkt_audit_access_tokens a
  join public.mkt_audit_sandboxes s on s.id = a.sandbox_id
  join public.tenants t on t.id = s.sandbox_tenant_id
  where a.token_hash = p_token_hash
    and a.revoked_at is null
    and a.expires_at > now()
    and a.used_runs < a.max_runs
    and s.is_enabled
    and s.owner_tenant_id = a.owner_tenant_id
    and s.sandbox_tenant_id <> s.owner_tenant_id
    and lower(coalesce(t.settings->>'is_audit_sandbox', 'false')) = 'true';

  if not found then
    raise exception 'AI_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'accessId', v_access.id,
    'expiresAt', v_access.expires_at,
    'usedRuns', v_access.used_runs,
    'maxRuns', v_access.max_runs
  );
end;
$$;

create or replace function public.mkt_claim_audit_access_token(
  p_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_access record;
  v_requested_by uuid;
  v_run_id uuid;
  v_run_started_at timestamptz;
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash <> lower(p_token_hash) then
    raise exception 'AI_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select a.id, a.owner_tenant_id, a.sandbox_id, a.expires_at,
         a.max_runs, a.used_runs, s.sandbox_tenant_id
  into v_access
  from public.mkt_audit_access_tokens a
  join public.mkt_audit_sandboxes s on s.id = a.sandbox_id
  join public.tenants t on t.id = s.sandbox_tenant_id
  where a.token_hash = p_token_hash
    and a.revoked_at is null
    and a.expires_at > now()
    and a.used_runs < a.max_runs
    and s.is_enabled
    and s.owner_tenant_id = a.owner_tenant_id
    and s.sandbox_tenant_id <> s.owner_tenant_id
    and lower(coalesce(t.settings->>'is_audit_sandbox', 'false')) = 'true'
  for update of a;

  if not found then
    raise exception 'AI_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select actor.user_id into v_requested_by
  from public.mkt_audit_actors actor
  where actor.sandbox_id = v_access.sandbox_id
    and actor.actor_key = 'ceo';

  if v_requested_by is null then
    raise exception 'AUDIT_SANDBOX_INCOMPLETE' using errcode = 'P0001';
  end if;

  if (
    select count(*) <> 5
    from public.mkt_audit_actors actor
    where actor.sandbox_id = v_access.sandbox_id
  ) then
    raise exception 'AUDIT_SANDBOX_INCOMPLETE' using errcode = 'P0001';
  end if;

  update public.mkt_audit_runs
  set status = 'failed', completed_at = coalesce(completed_at, now())
  where sandbox_id = v_access.sandbox_id
    and status = 'running'
    and started_at <= now() - interval '5 minutes';

  if exists (
    select 1
    from public.mkt_audit_runs run
    where run.sandbox_id = v_access.sandbox_id
      and run.status = 'running'
  ) then
    raise exception 'AUDIT_ALREADY_RUNNING' using errcode = 'P0001';
  end if;

  begin
    insert into public.mkt_audit_runs
      (owner_tenant_id, sandbox_id, requested_by, access_token_id,
       status, total_count)
    values
      (v_access.owner_tenant_id, v_access.sandbox_id, v_requested_by,
       v_access.id, 'running', 10)
    returning id, started_at into v_run_id, v_run_started_at;
  exception
    when unique_violation then
      raise exception 'AUDIT_ALREADY_RUNNING' using errcode = 'P0001';
  end;

  update public.mkt_audit_access_tokens
  set used_runs = used_runs + 1,
      last_used_at = now()
  where id = v_access.id;

  insert into public.mkt_security_events
    (tenant_id, actor_id, event_type, entity_type, entity_id, details)
  values
    (v_access.sandbox_tenant_id, v_requested_by, 'mkt_audit_access_claimed',
     'mkt_audit_access_token', v_access.id,
     jsonb_build_object('used_runs', v_access.used_runs + 1,
                        'max_runs', v_access.max_runs));

  return jsonb_build_object(
    'accessId', v_access.id,
    'ownerTenantId', v_access.owner_tenant_id,
    'sandboxId', v_access.sandbox_id,
    'sandboxTenantId', v_access.sandbox_tenant_id,
    'requestedBy', v_requested_by,
    'runId', v_run_id,
    'runStartedAt', v_run_started_at,
    'expiresAt', v_access.expires_at,
    'usedRuns', v_access.used_runs + 1,
    'maxRuns', v_access.max_runs
  );
end;
$$;

create or replace function public.mkt_revoke_audit_access_token(
  p_owner_tenant_id uuid,
  p_access_id uuid,
  p_revoked_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_access record;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_revoked_by
      and p.tenant_id = p_owner_tenant_id
      and coalesce(p.is_active, true)
  ) then
    raise exception 'AI_ACCESS_CREATOR_INVALID' using errcode = 'P0001';
  end if;

  select a.id, s.sandbox_tenant_id into v_access
  from public.mkt_audit_access_tokens a
  join public.mkt_audit_sandboxes s on s.id = a.sandbox_id
  where a.id = p_access_id
    and a.owner_tenant_id = p_owner_tenant_id
    and a.revoked_at is null
  for update of a;

  if not found then
    raise exception 'AI_ACCESS_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.mkt_audit_access_tokens
  set revoked_at = now(), revoked_by = p_revoked_by
  where id = v_access.id;

  insert into public.mkt_security_events
    (tenant_id, actor_id, event_type, entity_type, entity_id, details)
  values
    (v_access.sandbox_tenant_id, p_revoked_by, 'mkt_audit_access_revoked',
     'mkt_audit_access_token', v_access.id, '{}'::jsonb);

  return jsonb_build_object('accessId', v_access.id, 'revoked', true);
end;
$$;
revoke all on function public.mkt_create_audit_access_token(
  uuid, uuid, uuid, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.mkt_create_audit_access_token(
  uuid, uuid, uuid, text, timestamptz, integer
) to service_role;

revoke all on function public.mkt_read_audit_access_token(text)
  from public, anon, authenticated;
grant execute on function public.mkt_read_audit_access_token(text)
  to service_role;

revoke all on function public.mkt_revoke_audit_access_token(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mkt_revoke_audit_access_token(uuid, uuid, uuid)
  to service_role;
revoke all on function public.mkt_claim_audit_access_token(text)
  from public, anon, authenticated;
grant execute on function public.mkt_claim_audit_access_token(text)
  to service_role;

notify pgrst, 'reload schema';

-- Read-only verification after applying:
-- select
--   to_regclass('public.mkt_audit_access_tokens') is not null as access_table_ok,
--   not has_table_privilege('authenticated', 'public.mkt_audit_access_tokens', 'SELECT') as token_table_private,
--   has_function_privilege('service_role', 'public.mkt_claim_audit_access_token(text)', 'EXECUTE') as claim_service_only,
--   not has_function_privilege('authenticated', 'public.mkt_claim_audit_access_token(text)', 'EXECUTE') as claim_client_blocked,
--   not has_function_privilege('authenticated', 'public.mkt_read_audit_access_token(text)', 'EXECUTE') as read_client_blocked,
--   to_regclass('public.idx_mkt_audit_one_running_per_sandbox') is not null as concurrent_run_guard_ok;