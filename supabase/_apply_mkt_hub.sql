-- ============================================================
-- ÁP MKT HUB LÊN SUPABASE (project nppumpxtjoirwhwgbvoo)
-- Gộp 00168_mkt_hub_core + 00170_mkt_hub_crud_pillars_media.
-- Cách dùng: Supabase Dashboard > SQL Editor > New query >
--   paste TOÀN BỘ file này > Run. An toàn chạy lại (idempotent).
-- LƯU Ý: backup DB trước (Dashboard > Database > Backups).
-- ============================================================

-- ========== PHẦN 1/2: 00168_mkt_hub_core ==========
-- ============================================================
-- 00168: MKT Hub foundation for OneBiz
-- Source: Working/XCP_MKT_Hub_Developer_Handover_Package_v1.0.3
-- ============================================================

create extension if not exists pgcrypto;

with mkt_permissions(permission_code) as (
  values
    ('mkt.view'),
    ('mkt.manage_campaigns'),
    ('mkt.split_work_packages'),
    ('mkt.review_content'),
    ('mkt.override_campaign'),
    ('mkt.manage_team'),
    ('mkt.view_audit'),
    ('mkt.telegram_manage')
), target_roles as (
  select distinct r.id as role_id
  from public.roles r
  left join public.profiles p on p.role_id = r.id
  where p.role in ('owner', 'admin', 'manager')
     or exists (
       select 1 from public.role_permissions rp
       where rp.role_id = r.id
         and rp.permission_code in ('system.manage_roles', 'system.manage_users')
     )
)
insert into public.role_permissions (role_id, permission_code)
select tr.role_id, mp.permission_code
from target_roles tr
cross join mkt_permissions mp
on conflict (role_id, permission_code) do nothing;

create table if not exists public.mkt_campaigns (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  name text not null,
  objective text,
  timeframe_start date,
  timeframe_end date,
  budget_amount numeric(18,2) not null default 0,
  status text not null default 'planning' check (status in ('planning', 'running', 'paused', 'completed', 'canceled')),
  readiness_score integer not null default 0 check (readiness_score between 0 and 100),
  owner_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (timeframe_start is null or timeframe_end is null or timeframe_end >= timeframe_start)
);

create table if not exists public.mkt_campaign_readiness_items (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  title text not null,
  required_role text,
  required_branch_id uuid references public.branches(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'waived')),
  due_at timestamptz,
  reminder_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.mkt_workflow_templates (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  steps jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.mkt_channel_work_packages (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  channel_type text not null check (channel_type in ('tiktok', 'facebook', 'google_maps', 'zalo', 'seo', 'website', 'offline', 'other')),
  title text not null,
  target_output text,
  owner_id uuid references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'needs_split' check (status in ('draft', 'needs_split', 'split_completed', 'in_progress', 'completed', 'canceled')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.mkt_content_items (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.mkt_campaigns(id) on delete cascade,
  work_package_id uuid references public.mkt_channel_work_packages(id) on delete set null,
  title text not null,
  channel_type text,
  content_status text not null default 'draft' check (content_status in ('draft', 'pending_review', 'revision_required', 'approved', 'rejected', 'published')),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high', 'critical')),
  required_approver_role text,
  current_version integer not null default 0 check (current_version >= 0),
  revision_count integer not null default 0 check (revision_count >= 0),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.mkt_tasks (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.mkt_campaigns(id) on delete cascade,
  work_package_id uuid references public.mkt_channel_work_packages(id) on delete set null,
  content_item_id uuid references public.mkt_content_items(id) on delete set null,
  title text not null,
  description text,
  source_type text not null check (source_type in ('manual', 'campaign_channel_split', 'content_item', 'google_maps', 'cx_issue', 'claim')),
  source_id uuid not null,
  task_type text not null default 'idea' check (task_type in ('idea', 'shooting', 'editing', 'review', 'publish', 'report', 'ops', 'finance', 'other')),
  assignee_id uuid references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  dependency_task_id uuid references public.mkt_tasks(id) on delete set null,
  workload_points integer not null default 1 check (workload_points > 0),
  acceptance_status text not null default 'pending' check (acceptance_status in ('pending', 'accepted', 'need_discussion', 'rejected')),
  task_status text not null default 'todo' check (task_status in ('blocked', 'todo', 'doing', 'reviewing', 'done', 'canceled')),
  requires_leader_action boolean not null default false,
  blocked_reason text,
  reject_reason text,
  discussion_reason text,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (task_type not in ('review', 'publish') or content_item_id is not null)
);

create table if not exists public.mkt_content_versions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_item_id uuid not null references public.mkt_content_items(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content_url text,
  caption text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revision_required', 'rejected')),
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (content_item_id, version_number)
);

create table if not exists public.mkt_content_reviews (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_item_id uuid not null references public.mkt_content_items(id) on delete cascade,
  content_version_id uuid references public.mkt_content_versions(id) on delete set null,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('approve', 'revision', 'reject')),
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.mkt_telegram_accounts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  telegram_user_id text not null,
  chat_id text not null,
  username text,
  status text not null default 'linked' check (status in ('pending', 'linked', 'disabled')),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, telegram_user_id)
);

create table if not exists public.mkt_telegram_link_tokens (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mkt_outbox_events (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  reference_type text,
  reference_id uuid,
  title text not null,
  message text,
  deep_link_path text,
  channels text[] not null default array['in_app', 'telegram'],
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  dedupe_key text,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mkt_campaigns_tenant_status on public.mkt_campaigns(tenant_id, status, created_at desc) where deleted_at is null;
create index if not exists idx_mkt_campaigns_branch on public.mkt_campaigns(tenant_id, branch_id) where deleted_at is null;
create index if not exists idx_mkt_readiness_campaign on public.mkt_campaign_readiness_items(tenant_id, campaign_id, status) where deleted_at is null;
create index if not exists idx_mkt_work_packages_campaign on public.mkt_channel_work_packages(tenant_id, campaign_id, status) where deleted_at is null;
create index if not exists idx_mkt_content_campaign on public.mkt_content_items(tenant_id, campaign_id, content_status) where deleted_at is null;
create index if not exists idx_mkt_tasks_assignee on public.mkt_tasks(tenant_id, assignee_id, acceptance_status, task_status) where deleted_at is null;
create index if not exists idx_mkt_tasks_work_package on public.mkt_tasks(tenant_id, work_package_id, task_status) where deleted_at is null;
create index if not exists idx_mkt_tasks_dependency on public.mkt_tasks(tenant_id, dependency_task_id) where deleted_at is null;
-- Hỗ trợ EXISTS trong RLS visibility (executor thấy campaign/package/content của việc mình)
create index if not exists idx_mkt_tasks_reviewer on public.mkt_tasks(tenant_id, reviewer_id) where deleted_at is null;
create index if not exists idx_mkt_tasks_content_item on public.mkt_tasks(tenant_id, content_item_id) where deleted_at is null;
create index if not exists idx_mkt_tasks_campaign_assignee on public.mkt_tasks(campaign_id, assignee_id) where deleted_at is null;
create index if not exists idx_mkt_outbox_pending on public.mkt_outbox_events(status, next_attempt_at, created_at) where status = 'pending';
create unique index if not exists idx_mkt_outbox_dedupe on public.mkt_outbox_events(dedupe_key) where dedupe_key is not null;

create or replace function public.mkt_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mkt_campaigns_updated_at on public.mkt_campaigns;
create trigger trg_mkt_campaigns_updated_at before update on public.mkt_campaigns for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_campaign_readiness_items_updated_at on public.mkt_campaign_readiness_items;
create trigger trg_mkt_campaign_readiness_items_updated_at before update on public.mkt_campaign_readiness_items for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_workflow_templates_updated_at on public.mkt_workflow_templates;
create trigger trg_mkt_workflow_templates_updated_at before update on public.mkt_workflow_templates for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_channel_work_packages_updated_at on public.mkt_channel_work_packages;
create trigger trg_mkt_channel_work_packages_updated_at before update on public.mkt_channel_work_packages for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_content_items_updated_at on public.mkt_content_items;
create trigger trg_mkt_content_items_updated_at before update on public.mkt_content_items for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_tasks_updated_at on public.mkt_tasks;
create trigger trg_mkt_tasks_updated_at before update on public.mkt_tasks for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_telegram_accounts_updated_at on public.mkt_telegram_accounts;
create trigger trg_mkt_telegram_accounts_updated_at before update on public.mkt_telegram_accounts for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_outbox_events_updated_at on public.mkt_outbox_events;
create trigger trg_mkt_outbox_events_updated_at before update on public.mkt_outbox_events for each row execute function public.mkt_set_updated_at();

alter table public.mkt_campaigns enable row level security;
alter table public.mkt_campaign_readiness_items enable row level security;
alter table public.mkt_workflow_templates enable row level security;
alter table public.mkt_channel_work_packages enable row level security;
alter table public.mkt_content_items enable row level security;
alter table public.mkt_tasks enable row level security;
alter table public.mkt_content_versions enable row level security;
alter table public.mkt_content_reviews enable row level security;
alter table public.mkt_telegram_accounts enable row level security;
alter table public.mkt_telegram_link_tokens enable row level security;
alter table public.mkt_outbox_events enable row level security;

-- ────────────────────────────────────────────────────────────────
-- RLS visibility helpers (theo Developer Handover v1.0.3):
--   - "Toàn cảnh" (Lead/CEO) = mkt.manage_campaigns HOẶC mkt.manage_team
--   - Executor CHỈ thấy việc mình được giao (assignee/reviewer) + nội dung liên quan
-- Dùng SECURITY DEFINER + stable để gọi (select public.mkt_is_lead())
-- trong policy → Postgres cache 1 lần/câu lệnh (InitPlan), không chạy per-row.
-- ────────────────────────────────────────────────────────────────
create or replace function public.mkt_is_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_has_permission(auth.uid(), 'mkt.manage_campaigns')
      or public.user_has_permission(auth.uid(), 'mkt.manage_team');
$$;

create or replace function public.mkt_can_review()
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_has_permission(auth.uid(), 'mkt.manage_campaigns')
      or public.user_has_permission(auth.uid(), 'mkt.manage_team')
      or public.user_has_permission(auth.uid(), 'mkt.review_content');
$$;

-- Người được giao xác nhận readiness (Ops/Finance/CEO/Kho/Store) thấy đúng item của mình.
-- Cùng logic role-match với mkt_confirm_readiness_item để tránh lệch quyền.
create or replace function public.mkt_matches_readiness_role(p_required_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_required_role is not null and (
    lower(coalesce((select p.role from public.profiles p where p.id = auth.uid()), '')) = lower(p_required_role)
    or (p_required_role = 'finance' and public.user_has_permission(auth.uid(), 'finance.view_cash_book'))
    or (p_required_role in ('ops', 'warehouse') and public.user_has_permission(auth.uid(), 'inventory.view'))
  );
$$;

revoke all on function public.mkt_is_lead() from public;
revoke all on function public.mkt_can_review() from public;
revoke all on function public.mkt_matches_readiness_role(text) from public;
grant execute on function public.mkt_is_lead() to authenticated;
grant execute on function public.mkt_can_review() to authenticated;
grant execute on function public.mkt_matches_readiness_role(text) to authenticated;

-- Campaign: Lead toàn cảnh · owner · người có task trong campaign
drop policy if exists "mkt_campaigns_select" on public.mkt_campaigns;
create policy "mkt_campaigns_select" on public.mkt_campaigns for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    (select public.mkt_is_lead())
    or owner_id = auth.uid()
    or exists (
      select 1 from public.mkt_tasks t
      where t.campaign_id = mkt_campaigns.id
        and t.deleted_at is null
        and (t.assignee_id = auth.uid() or t.reviewer_id = auth.uid())
    )
  )
);

-- Readiness: Lead/override toàn cảnh · người được giao xác nhận (role-match)
drop policy if exists "mkt_readiness_select" on public.mkt_campaign_readiness_items;
create policy "mkt_readiness_select" on public.mkt_campaign_readiness_items for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    (select public.mkt_is_lead())
    or (select public.user_has_permission(auth.uid(), 'mkt.override_campaign'))
    or public.mkt_matches_readiness_role(required_role)
  )
);

-- Workflow template: cấu hình không nhạy cảm, cần cho dialog split → mkt.view
drop policy if exists "mkt_templates_select" on public.mkt_workflow_templates;
create policy "mkt_templates_select" on public.mkt_workflow_templates for select using (
  tenant_id = public.get_user_tenant_id()
  and (select public.user_has_permission(auth.uid(), 'mkt.view'))
);

-- Work package: Lead/split toàn cảnh · owner/reviewer · người có task trong package
drop policy if exists "mkt_work_packages_select" on public.mkt_channel_work_packages;
create policy "mkt_work_packages_select" on public.mkt_channel_work_packages for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    (select public.mkt_is_lead())
    or (select public.user_has_permission(auth.uid(), 'mkt.split_work_packages'))
    or owner_id = auth.uid()
    or reviewer_id = auth.uid()
    or exists (
      select 1 from public.mkt_tasks t
      where t.work_package_id = mkt_channel_work_packages.id
        and t.deleted_at is null
        and (t.assignee_id = auth.uid() or t.reviewer_id = auth.uid())
    )
  )
);

-- Task: assignee · reviewer · Lead toàn cảnh (No accept-on-behalf → executor chỉ thấy việc mình)
drop policy if exists "mkt_tasks_select" on public.mkt_tasks;
create policy "mkt_tasks_select" on public.mkt_tasks for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    assignee_id = auth.uid()
    or reviewer_id = auth.uid()
    or (select public.mkt_is_lead())
  )
);

-- Content item: Lead/reviewer toàn cảnh · người tạo · người có task trên content
drop policy if exists "mkt_content_items_select" on public.mkt_content_items;
create policy "mkt_content_items_select" on public.mkt_content_items for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    (select public.mkt_can_review())
    or created_by = auth.uid()
    or exists (
      select 1 from public.mkt_tasks t
      where t.content_item_id = mkt_content_items.id
        and t.deleted_at is null
        and (t.assignee_id = auth.uid() or t.reviewer_id = auth.uid())
    )
  )
);

drop policy if exists "mkt_content_versions_select" on public.mkt_content_versions;
create policy "mkt_content_versions_select" on public.mkt_content_versions for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    submitted_by = auth.uid()
    or (select public.mkt_can_review())
    or exists (
      select 1 from public.mkt_tasks t
      where t.content_item_id = mkt_content_versions.content_item_id
        and t.deleted_at is null
        and (t.assignee_id = auth.uid() or t.reviewer_id = auth.uid())
    )
  )
);

drop policy if exists "mkt_content_reviews_select" on public.mkt_content_reviews;
create policy "mkt_content_reviews_select" on public.mkt_content_reviews for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    reviewer_id = auth.uid()
    or (select public.mkt_can_review())
    or exists (
      select 1 from public.mkt_tasks t
      where t.content_item_id = mkt_content_reviews.content_item_id
        and t.deleted_at is null
        and (t.assignee_id = auth.uid() or t.reviewer_id = auth.uid())
    )
  )
);

drop policy if exists "mkt_telegram_accounts_select_own" on public.mkt_telegram_accounts;
create policy "mkt_telegram_accounts_select_own" on public.mkt_telegram_accounts for select using (tenant_id = public.get_user_tenant_id() and user_id = auth.uid());
drop policy if exists "mkt_telegram_link_tokens_select_own" on public.mkt_telegram_link_tokens;
create policy "mkt_telegram_link_tokens_select_own" on public.mkt_telegram_link_tokens for select using (tenant_id = public.get_user_tenant_id() and user_id = auth.uid());
drop policy if exists "mkt_outbox_events_select_recipient" on public.mkt_outbox_events;
create policy "mkt_outbox_events_select_recipient" on public.mkt_outbox_events for select using (tenant_id = public.get_user_tenant_id() and recipient_user_id = auth.uid());


create or replace function public.get_mkt_campaign_readiness_score(p_campaign_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_total integer;
  v_confirmed integer;
begin
  select tenant_id into v_tenant_id
  from public.mkt_campaigns
  where id = p_campaign_id and deleted_at is null;

  if v_tenant_id is null then
    return 0;
  end if;

  -- User đã đăng nhập chỉ đọc được score trong tenant của mình (chống dò cross-tenant).
  -- Anon bị chặn ở tầng REST bằng `revoke execute ... from anon, public` (cuối file);
  -- internal call (service_role / RPC definer, auth.uid() null) tính bình thường để
  -- seed + recalc score chạy đúng.
  if auth.uid() is not null
     and public.get_user_tenant_id() is distinct from v_tenant_id then
    return 0;
  end if;

  select count(*), count(*) filter (where status in ('confirmed', 'waived'))
    into v_total, v_confirmed
  from public.mkt_campaign_readiness_items
  where campaign_id = p_campaign_id
    and tenant_id = v_tenant_id
    and deleted_at is null;

  if coalesce(v_total, 0) = 0 then
    return 0;
  end if;

  return floor((v_confirmed::numeric / v_total::numeric) * 100)::integer;
end;
$$;

create or replace function public.mkt_record_audit(
  p_tenant_id uuid,
  p_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_old_data jsonb default null,
  p_new_data jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    p_tenant_id, p_user_id, p_action, p_entity_type, p_entity_id, p_old_data, p_new_data
  );
end;
$$;

create or replace function public.mkt_enqueue_notification(
  p_tenant_id uuid,
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_deep_link_path text default null,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (
    tenant_id, user_id, type, title, description, reference_type, reference_id
  ) values (
    p_tenant_id, p_user_id, p_type, p_title, p_message, p_reference_type, p_reference_id
  );

  insert into public.mkt_outbox_events (
    tenant_id, event_type, recipient_user_id, reference_type, reference_id,
    title, message, deep_link_path, payload, dedupe_key
  ) values (
    p_tenant_id, p_type, p_user_id, p_reference_type, p_reference_id,
    p_title, p_message, p_deep_link_path, p_payload, p_dedupe_key
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

create or replace function public.mkt_split_work_package(
  p_work_package_id uuid,
  p_tasks jsonb,
  p_template_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_package record;
  v_task jsonb;
  v_task_id uuid;
  v_key text;
  v_dep_key text;
  v_dependency_id uuid;
  v_generated_ids jsonb := '{}'::jsonb;
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.split_work_packages') or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  select * into v_package
  from public.mkt_channel_work_packages
  where id = p_work_package_id and deleted_at is null
  for update;
  if not found or v_package.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_package.status <> 'needs_split' then raise exception 'ALREADY_PROCESSED' using errcode = 'P0001'; end if;

  for v_task in select * from jsonb_array_elements(p_tasks) loop
    v_key := nullif(v_task->>'key', '');
    if v_key is not null then
      v_task_id := uuid_generate_v4();
      v_generated_ids := jsonb_set(v_generated_ids, array[v_key], to_jsonb(v_task_id::text), true);
    end if;
  end loop;

  for v_task in select * from jsonb_array_elements(p_tasks) loop
    v_key := nullif(v_task->>'key', '');
    v_dep_key := nullif(v_task->>'dependencyKey', '');
    v_task_id := coalesce(nullif(v_generated_ids->>coalesce(v_key, ''), '')::uuid, uuid_generate_v4());
    v_dependency_id := coalesce(nullif(v_task->>'dependencyTaskId', '')::uuid, nullif(v_generated_ids->>coalesce(v_dep_key, ''), '')::uuid);

    if nullif(v_task->>'title', '') is null or nullif(v_task->>'assigneeId', '') is null then
      raise exception 'INVALID_STATE' using errcode = 'P0001';
    end if;

    insert into public.mkt_tasks (
      id, tenant_id, campaign_id, work_package_id, content_item_id, title, description,
      source_type, source_id, task_type, assignee_id, reviewer_id, dependency_task_id,
      workload_points, acceptance_status, task_status, blocked_reason, due_at, created_by, updated_by
    ) values (
      v_task_id, v_package.tenant_id, v_package.campaign_id, v_package.id,
      nullif(v_task->>'contentItemId', '')::uuid,
      v_task->>'title', nullif(v_task->>'description', ''),
      'campaign_channel_split', v_package.id,
      coalesce(nullif(v_task->>'taskType', ''), 'idea'),
      (v_task->>'assigneeId')::uuid,
      nullif(v_task->>'reviewerId', '')::uuid,
      v_dependency_id,
      coalesce(nullif(v_task->>'workloadPoints', '')::integer, 1),
      'pending',
      case when v_dependency_id is null then 'todo' else 'blocked' end,
      case when v_dependency_id is null then null else 'DEPENDENCY_BLOCKED' end,
      nullif(v_task->>'dueAt', '')::timestamptz,
      v_actor, v_actor
    );
    v_count := v_count + 1;

    -- Báo cho người được giao biết có task mới (Assignee accountability — phải nhận việc).
    perform public.mkt_enqueue_notification(
      v_package.tenant_id, (v_task->>'assigneeId')::uuid,
      'mkt_task_assigned', 'Task MKT mới', v_task->>'title',
      'mkt_task', v_task_id, '/mkt/tasks?task=' || v_task_id::text,
      '{}'::jsonb, 'mkt_task_assigned:' || v_task_id::text
    );
  end loop;

  update public.mkt_channel_work_packages
  set status = 'split_completed', updated_by = v_actor
  where id = v_package.id;

  perform public.mkt_record_audit(v_package.tenant_id, v_actor, 'mkt_work_package_split', 'mkt_work_package', v_package.id, to_jsonb(v_package), jsonb_build_object('task_count', v_count, 'template_code', p_template_code));
  return jsonb_build_object('success', true, 'workPackageId', v_package.id, 'taskCount', v_count);
end;
$$;

create or replace function public.mkt_accept_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_dep_status text;
  v_next_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status = 'accepted' then raise exception 'ALREADY_PROCESSED' using errcode = 'P0001'; end if;
  if v_task.task_status = 'canceled' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  if v_task.dependency_task_id is null then
    v_next_status := 'todo';
  else
    select task_status into v_dep_status from public.mkt_tasks where id = v_task.dependency_task_id;
    v_next_status := case when v_dep_status = 'done' then 'todo' else 'blocked' end;
  end if;

  update public.mkt_tasks
  set acceptance_status = 'accepted', task_status = v_next_status,
      blocked_reason = case when v_next_status = 'blocked' then 'DEPENDENCY_BLOCKED' else null end,
      requires_leader_action = false, updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_accepted', 'mkt_task', v_task.id, null, to_jsonb(v_task));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_reject_task(p_task_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_owner uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;

  update public.mkt_tasks
  set acceptance_status = 'rejected', requires_leader_action = true, reject_reason = p_reason, updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  select owner_id into v_owner from public.mkt_channel_work_packages where id = v_task.work_package_id;
  if v_owner is not null then
    perform public.mkt_enqueue_notification(v_task.tenant_id, v_owner, 'mkt_task_rejected', 'Task MKT bị từ chối', v_task.title, 'mkt_task', v_task.id, '/mkt/leader-queue');
  end if;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_rejected', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_need_discussion_task(p_task_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_owner uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;

  update public.mkt_tasks
  set acceptance_status = 'need_discussion', requires_leader_action = true, discussion_reason = p_reason, updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  select owner_id into v_owner from public.mkt_channel_work_packages where id = v_task.work_package_id;
  if v_owner is not null then
    perform public.mkt_enqueue_notification(v_task.tenant_id, v_owner, 'mkt_task_need_discussion', 'Task MKT cần trao đổi', v_task.title, 'mkt_task', v_task.id, '/mkt/leader-queue');
  end if;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_need_discussion', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_start_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_content_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'accepted' or v_task.task_status <> 'todo' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  if v_task.task_type = 'publish' then
    if v_task.content_item_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    select content_status into v_content_status from public.mkt_content_items where id = v_task.content_item_id and deleted_at is null;
    if v_content_status <> 'approved' then raise exception 'CONTENT_NOT_APPROVED' using errcode = 'P0001'; end if;
  end if;

  update public.mkt_tasks
  set task_status = 'doing', started_at = coalesce(started_at, now()), updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_started', 'mkt_task', v_task.id, null, to_jsonb(v_task));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_mark_task_done(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_content_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.task_status = 'canceled' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if v_task.task_type = 'review' and v_task.content_item_id is not null then raise exception 'REVIEW_TASK_REQUIRES_REVIEW_API' using errcode = 'P0001'; end if;

  if v_task.task_type = 'publish' then
    select content_status into v_content_status from public.mkt_content_items where id = v_task.content_item_id and deleted_at is null;
    if v_content_status <> 'approved' then raise exception 'CONTENT_NOT_APPROVED' using errcode = 'P0001'; end if;
  end if;

  update public.mkt_tasks
  set task_status = 'done', completed_at = coalesce(completed_at, now()), requires_leader_action = false, updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  update public.mkt_tasks
  set task_status = case when acceptance_status = 'accepted' then 'todo' else task_status end,
      blocked_reason = null
  where dependency_task_id = p_task_id
    and tenant_id = v_task.tenant_id
    and deleted_at is null
    and task_status = 'blocked';

  if v_task.work_package_id is not null and not exists (
    select 1 from public.mkt_tasks
    where work_package_id = v_task.work_package_id
      and tenant_id = v_task.tenant_id
      and deleted_at is null
      and task_status not in ('done', 'canceled')
  ) then
    update public.mkt_channel_work_packages set status = 'completed', updated_by = v_actor where id = v_task.work_package_id;
  end if;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_done', 'mkt_task', v_task.id, null, to_jsonb(v_task));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;


create or replace function public.mkt_force_task_done(p_task_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.override_campaign') or public.user_has_permission(v_actor, 'mkt.manage_team')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.task_status = 'canceled' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  update public.mkt_tasks
  set task_status = 'done', completed_at = coalesce(completed_at, now()), requires_leader_action = false, updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_force_done', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason, 'is_exception', true, 'severity', 'medium'));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_reassign_task(p_task_id uuid, p_new_assignee_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_dep_status text;
  v_next_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_team') or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  if v_task.dependency_task_id is null then
    v_next_status := 'todo';
  else
    select task_status into v_dep_status from public.mkt_tasks where id = v_task.dependency_task_id;
    v_next_status := case when v_dep_status = 'done' then 'todo' else 'blocked' end;
  end if;

  update public.mkt_tasks
  set assignee_id = p_new_assignee_id,
      acceptance_status = 'pending', task_status = v_next_status,
      blocked_reason = case when v_next_status = 'blocked' then 'DEPENDENCY_BLOCKED' else null end,
      requires_leader_action = false, updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  perform public.mkt_enqueue_notification(v_task.tenant_id, p_new_assignee_id, 'mkt_task_assigned', 'Task MKT mới', v_task.title, 'mkt_task', v_task.id, '/mkt/tasks?task=' || v_task.id::text);
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_reassigned', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason, 'new_assignee_id', p_new_assignee_id));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_cancel_task(p_task_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_team') or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  update public.mkt_tasks
  set task_status = 'canceled', requires_leader_action = false, updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_canceled', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_submit_task_review(
  p_task_id uuid,
  p_content_item_id uuid,
  p_content_url text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_content record;
  v_version record;
  v_next_version integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.task_status <> 'doing' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_content from public.mkt_content_items where id = p_content_item_id and deleted_at is null for update;
  if not found or v_content.tenant_id <> v_task.tenant_id then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  v_next_version := coalesce(v_content.current_version, 0) + 1;
  insert into public.mkt_content_versions (tenant_id, content_item_id, version_number, content_url, note, status, submitted_by)
  values (v_task.tenant_id, p_content_item_id, v_next_version, p_content_url, p_note, 'pending', v_actor)
  returning * into v_version;

  update public.mkt_content_items
  set current_version = v_next_version, content_status = 'pending_review', updated_by = v_actor
  where id = p_content_item_id;

  update public.mkt_tasks
  set task_status = 'reviewing', content_item_id = p_content_item_id, updated_by = v_actor
  where id = p_task_id;

  if v_task.reviewer_id is not null then
    perform public.mkt_enqueue_notification(v_task.tenant_id, v_task.reviewer_id, 'mkt_content_pending_review', 'Nội dung chờ duyệt', v_content.title, 'mkt_content_item', p_content_item_id, '/mkt/approvals?content=' || p_content_item_id::text);
  end if;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_content_submitted_review', 'mkt_content_item', p_content_item_id, null, to_jsonb(v_version));
  return jsonb_build_object('success', true, 'contentVersion', to_jsonb(v_version));
end;
$$;

create or replace function public.mkt_review_content(
  p_content_id uuid,
  p_content_version_id uuid default null,
  p_action text default 'approve',
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_content record;
  v_version record;
  v_review record;
  v_revision_count integer;
  v_required_role text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.review_content') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_action not in ('approve', 'revision', 'reject') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_content from public.mkt_content_items where id = p_content_id and deleted_at is null for update;
  if not found or v_content.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- Duyệt theo mức rủi ro (Handover: Lead duyệt Low/Medium, CEO duyệt High/Critical).
  -- required_approver_role suy từ content; 'ceo' đòi thêm quyền override_campaign
  -- (quyền "vượt rào" cao nhất trong bộ mkt.*) — owner bypass sẵn qua user_has_permission.
  v_required_role := coalesce(
    nullif(v_content.required_approver_role, ''),
    case when v_content.risk_level in ('high', 'critical') then 'ceo' else 'mkt_lead' end
  );
  if v_required_role = 'ceo'
     and not public.user_has_permission(v_actor, 'mkt.override_campaign') then
    raise exception 'INSUFFICIENT_ROLE: Noi dung rui ro cao, can cap duyet CEO' using errcode = 'P0001';
  end if;

  if p_content_version_id is null then
    select * into v_version
    from public.mkt_content_versions
    where content_item_id = p_content_id and version_number = v_content.current_version
    order by version_number desc limit 1;
  else
    select * into v_version from public.mkt_content_versions where id = p_content_version_id and content_item_id = p_content_id;
  end if;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  insert into public.mkt_content_reviews (tenant_id, content_item_id, content_version_id, reviewer_id, action, comment)
  values (v_content.tenant_id, p_content_id, v_version.id, v_actor, p_action, p_comment)
  returning * into v_review;

  if p_action = 'approve' then
    update public.mkt_content_versions set status = 'approved' where id = v_version.id;
    update public.mkt_content_items
    set content_status = 'approved', approved_by = v_actor, approved_at = now(), updated_by = v_actor
    where id = p_content_id
    returning * into v_content;

    update public.mkt_tasks
    set task_status = 'done', completed_at = coalesce(completed_at, now()), requires_leader_action = false, updated_by = v_actor
    where tenant_id = v_content.tenant_id
      and content_item_id = p_content_id
      and task_type = 'review'
      and task_status not in ('done', 'canceled');
  else
    update public.mkt_content_versions set status = case when p_action = 'revision' then 'revision_required' else 'rejected' end where id = v_version.id;
    update public.mkt_content_items
    set content_status = case when p_action = 'revision' then 'revision_required' else 'rejected' end,
        revision_count = revision_count + 1,
        updated_by = v_actor
    where id = p_content_id
    returning revision_count into v_revision_count;

    if v_revision_count >= 3 then
      update public.mkt_tasks
      set requires_leader_action = true, updated_by = v_actor
      where tenant_id = v_content.tenant_id
        and content_item_id = p_content_id
        and deleted_at is null;
    end if;
  end if;

  if v_version.submitted_by is not null then
    perform public.mkt_enqueue_notification(v_content.tenant_id, v_version.submitted_by, 'mkt_content_reviewed', 'Nội dung đã được phản hồi', v_content.title, 'mkt_content_item', p_content_id, '/mkt/approvals?content=' || p_content_id::text);
  end if;

  perform public.mkt_record_audit(v_content.tenant_id, v_actor, 'mkt_content_reviewed', 'mkt_content_item', p_content_id, null, jsonb_build_object('action', p_action, 'comment', p_comment, 'review_id', v_review.id));
  return jsonb_build_object('success', true, 'review', to_jsonb(v_review));
end;
$$;

create or replace function public.mkt_confirm_readiness_item(
  p_campaign_id uuid,
  p_item_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_item record;
  v_score integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_profile from public.profiles where id = v_actor;
  select * into v_item
  from public.mkt_campaign_readiness_items
  where id = p_item_id and campaign_id = p_campaign_id and deleted_at is null
  for update;
  if not found or v_item.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  if v_item.required_role is not null and not (
    lower(coalesce(v_profile.role, '')) = lower(v_item.required_role)
    or public.user_has_permission(v_actor, 'mkt.manage_campaigns')
    or public.user_has_permission(v_actor, 'mkt.override_campaign')
    or (v_item.required_role = 'finance' and public.user_has_permission(v_actor, 'finance.view_cash_book'))
    or (v_item.required_role in ('ops', 'warehouse') and public.user_has_permission(v_actor, 'inventory.view'))
  ) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  update public.mkt_campaign_readiness_items
  set status = 'confirmed', confirmed_by = v_actor, confirmed_at = now(), note = p_note
  where id = p_item_id
  returning * into v_item;

  v_score := public.get_mkt_campaign_readiness_score(p_campaign_id);
  update public.mkt_campaigns set readiness_score = v_score, updated_by = v_actor where id = p_campaign_id;

  perform public.mkt_record_audit(v_item.tenant_id, v_actor, 'mkt_readiness_confirmed', 'mkt_readiness_item', p_item_id, null, jsonb_build_object('campaign_id', p_campaign_id, 'score', v_score, 'note', p_note));
  return jsonb_build_object('success', true, 'readinessScore', v_score, 'item', to_jsonb(v_item));
end;
$$;

create or replace function public.mkt_change_campaign_status(
  p_campaign_id uuid,
  p_status text,
  p_override_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign record;
  v_score integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if p_status not in ('planning', 'running', 'paused', 'completed', 'canceled') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;

  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null for update;
  if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  if p_status = 'running' then
    v_score := public.get_mkt_campaign_readiness_score(p_campaign_id);
    if v_score < 100 then
      if nullif(trim(coalesce(p_override_reason, '')), '') is null then
        raise exception 'READINESS_NOT_READY' using errcode = 'P0001';
      end if;
      if not public.user_has_permission(v_actor, 'mkt.override_campaign') then
        raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
      end if;
      perform public.mkt_record_audit(v_campaign.tenant_id, v_actor, 'mkt_campaign_override', 'mkt_campaign', p_campaign_id, null, jsonb_build_object('readiness_score', v_score, 'override_reason', p_override_reason, 'is_exception', true, 'severity', 'high'));
    end if;
  end if;

  update public.mkt_campaigns
  set status = p_status, readiness_score = public.get_mkt_campaign_readiness_score(p_campaign_id), updated_by = v_actor
  where id = p_campaign_id
  returning * into v_campaign;

  perform public.mkt_record_audit(v_campaign.tenant_id, v_actor, 'mkt_campaign_status_changed', 'mkt_campaign', p_campaign_id, null, jsonb_build_object('status', p_status));
  return jsonb_build_object('success', true, 'campaign', to_jsonb(v_campaign));
end;
$$;

create or replace view public.mkt_leader_queue_view
with (security_invoker = true)
as
-- Task bị từ chối
select t.tenant_id, c.branch_id, c.id as campaign_id, c.name as campaign_name,
       t.id as task_id, t.title as task_title, t.assignee_id, t.work_package_id,
       t.content_item_id, 'TASK_REJECTED'::text as issue_type, t.reject_reason as issue_note, t.created_at
from public.mkt_tasks t
left join public.mkt_campaigns c on c.id = t.campaign_id
where t.deleted_at is null and t.acceptance_status = 'rejected'
union all
-- Task cần trao đổi
select t.tenant_id, c.branch_id, c.id, c.name, t.id, t.title, t.assignee_id, t.work_package_id,
       t.content_item_id, 'NEED_DISCUSSION'::text, t.discussion_reason, t.created_at
from public.mkt_tasks t
left join public.mkt_campaigns c on c.id = t.campaign_id
where t.deleted_at is null and t.acceptance_status = 'need_discussion'
union all
-- Task kẹt phụ thuộc QUÁ 2 NGÀY (Handover mục 8) — không đưa task vừa split vào queue
select t.tenant_id, c.branch_id, c.id, c.name, t.id, t.title, t.assignee_id, t.work_package_id,
       t.content_item_id, 'BLOCKED_DEPENDENCY'::text, t.blocked_reason, t.created_at
from public.mkt_tasks t
left join public.mkt_campaigns c on c.id = t.campaign_id
where t.deleted_at is null and t.task_status = 'blocked' and t.dependency_task_id is not null
  and t.created_at < (now() - interval '2 days')
union all
-- Cờ cần leader xử lý (vd revision >=3 gắn vào task) — loại trùng với 2 nguồn trên
select t.tenant_id, c.branch_id, c.id, c.name, t.id, t.title, t.assignee_id, t.work_package_id,
       t.content_item_id, 'LEADER_ACTION'::text, t.blocked_reason, t.created_at
from public.mkt_tasks t
left join public.mkt_campaigns c on c.id = t.campaign_id
where t.deleted_at is null and t.requires_leader_action = true
  and t.acceptance_status not in ('rejected', 'need_discussion')
union all
-- Content vượt ngưỡng sửa (>=3 lần)
select ci.tenant_id, c.branch_id, c.id, c.name, null::uuid, ci.title, null::uuid, ci.work_package_id,
       ci.id, 'REVISION_OVER_LIMIT'::text, ('revision_count=' || ci.revision_count::text), ci.created_at
from public.mkt_content_items ci
left join public.mkt_campaigns c on c.id = ci.campaign_id
where ci.deleted_at is null and ci.revision_count >= 3;

create or replace function public.mkt_get_leader_queue(
  p_branch_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns setof public.mkt_leader_queue_view
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_team') or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  return query
  select *
  from public.mkt_leader_queue_view q
  where q.tenant_id = public.get_user_tenant_id()
    and (p_branch_id is null or q.branch_id = p_branch_id)
  order by q.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Bảng: grant SELECT cho authenticated; RLS ở trên quyết định thấy dòng nào.
grant select on public.mkt_campaigns to authenticated;
grant select on public.mkt_campaign_readiness_items to authenticated;
grant select on public.mkt_workflow_templates to authenticated;
grant select on public.mkt_channel_work_packages to authenticated;
grant select on public.mkt_content_items to authenticated;
grant select on public.mkt_tasks to authenticated;
grant select on public.mkt_content_versions to authenticated;
grant select on public.mkt_content_reviews to authenticated;
grant select on public.mkt_telegram_accounts to authenticated;
grant select on public.mkt_telegram_link_tokens to authenticated;
grant select on public.mkt_outbox_events to authenticated;

-- Leader queue view: KHÔNG mở SELECT trực tiếp — chỉ qua RPC mkt_get_leader_queue (đã gate quyền).
revoke all on public.mkt_leader_queue_view from public;
revoke select on public.mkt_leader_queue_view from anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- Khóa quyền EXECUTE: Postgres mặc định grant EXECUTE cho PUBLIC khi
-- CREATE FUNCTION → phải REVOKE để anon không gọi được RPC qua PostgREST.
-- RPC nghiệp vụ: chỉ authenticated. 2 helper (audit/notification): chỉ
-- gọi nội bộ từ definer RPC → thu hồi khỏi cả authenticated.
-- ────────────────────────────────────────────────────────────────
revoke all on function public.mkt_record_audit(uuid, uuid, text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.mkt_enqueue_notification(uuid, uuid, text, text, text, text, uuid, text, jsonb, text) from public, anon, authenticated;

revoke all on function public.get_mkt_campaign_readiness_score(uuid) from public, anon;
revoke all on function public.mkt_split_work_package(uuid, jsonb, text) from public, anon;
revoke all on function public.mkt_accept_task(uuid) from public, anon;
revoke all on function public.mkt_reject_task(uuid, text) from public, anon;
revoke all on function public.mkt_need_discussion_task(uuid, text) from public, anon;
revoke all on function public.mkt_start_task(uuid) from public, anon;
revoke all on function public.mkt_mark_task_done(uuid) from public, anon;
revoke all on function public.mkt_force_task_done(uuid, text) from public, anon;
revoke all on function public.mkt_reassign_task(uuid, uuid, text) from public, anon;
revoke all on function public.mkt_cancel_task(uuid, text) from public, anon;
revoke all on function public.mkt_submit_task_review(uuid, uuid, text, text) from public, anon;
revoke all on function public.mkt_review_content(uuid, uuid, text, text) from public, anon;
revoke all on function public.mkt_confirm_readiness_item(uuid, uuid, text) from public, anon;
revoke all on function public.mkt_change_campaign_status(uuid, text, text) from public, anon;
revoke all on function public.mkt_get_leader_queue(uuid, integer, integer) from public, anon;

grant execute on function public.get_mkt_campaign_readiness_score(uuid) to authenticated;
grant execute on function public.mkt_split_work_package(uuid, jsonb, text) to authenticated;
grant execute on function public.mkt_accept_task(uuid) to authenticated;
grant execute on function public.mkt_reject_task(uuid, text) to authenticated;
grant execute on function public.mkt_need_discussion_task(uuid, text) to authenticated;
grant execute on function public.mkt_start_task(uuid) to authenticated;
grant execute on function public.mkt_mark_task_done(uuid) to authenticated;
grant execute on function public.mkt_force_task_done(uuid, text) to authenticated;
grant execute on function public.mkt_reassign_task(uuid, uuid, text) to authenticated;
grant execute on function public.mkt_cancel_task(uuid, text) to authenticated;
grant execute on function public.mkt_submit_task_review(uuid, uuid, text, text) to authenticated;
grant execute on function public.mkt_review_content(uuid, uuid, text, text) to authenticated;
grant execute on function public.mkt_confirm_readiness_item(uuid, uuid, text) to authenticated;
grant execute on function public.mkt_change_campaign_status(uuid, text, text) to authenticated;
grant execute on function public.mkt_get_leader_queue(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';

-- ========== PHẦN 2/2: 00170_mkt_hub_crud_pillars_media ==========
-- ============================================================
-- 00170: MKT Hub — CRUD (Sprint 1 Foundation) + Content Pillars + Media
-- Bổ sung lên 00168_mkt_hub_core (00169 là order_code_split, độc lập).
-- Mọi RPC: actor từ auth.uid(), tenant từ
-- get_user_tenant_id(), check quyền qua user_has_permission, ghi audit,
-- revoke public/anon + grant authenticated.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CONTENT PILLARS (P1..P4) — phân loại nội dung xuyên Kanban/lịch/settings
-- ------------------------------------------------------------
create table if not exists public.mkt_content_pillars (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  color text not null default '#708090',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

alter table public.mkt_content_items
  add column if not exists pillar_id uuid references public.mkt_content_pillars(id) on delete set null;
alter table public.mkt_tasks
  add column if not exists pillar_id uuid references public.mkt_content_pillars(id) on delete set null;

create index if not exists idx_mkt_pillars_tenant on public.mkt_content_pillars(tenant_id, sort_order) where deleted_at is null;

-- ------------------------------------------------------------
-- 2. MEDIA ASSETS — thư viện ảnh/video, lưu Supabase Storage (bucket private)
-- ------------------------------------------------------------
create table if not exists public.mkt_media_assets (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.mkt_campaigns(id) on delete set null,
  content_item_id uuid references public.mkt_content_items(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  kind text not null default 'image' check (kind in ('image', 'video', 'other')),
  status text not null default 'available' check (status in ('available', 'used')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_mkt_media_tenant on public.mkt_media_assets(tenant_id, status, created_at desc) where deleted_at is null;
create index if not exists idx_mkt_media_campaign on public.mkt_media_assets(tenant_id, campaign_id) where deleted_at is null;

-- Bucket private: truy cập qua signed URL do server (service role) cấp — client
-- không đọc/ghi trực tiếp nên không cần storage policy cho authenticated.
insert into storage.buckets (id, name, public)
values ('mkt-media', 'mkt-media', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3. Triggers updated_at (tái dùng public.mkt_set_updated_at từ 00168)
-- ------------------------------------------------------------
drop trigger if exists trg_mkt_content_pillars_updated_at on public.mkt_content_pillars;
create trigger trg_mkt_content_pillars_updated_at before update on public.mkt_content_pillars for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_media_assets_updated_at on public.mkt_media_assets;
create trigger trg_mkt_media_assets_updated_at before update on public.mkt_media_assets for each row execute function public.mkt_set_updated_at();

-- ------------------------------------------------------------
-- 4. RLS: pillars + media hiển thị cho ai có mkt.view (cấu hình không nhạy cảm)
-- ------------------------------------------------------------
alter table public.mkt_content_pillars enable row level security;
alter table public.mkt_media_assets enable row level security;

drop policy if exists "mkt_pillars_select" on public.mkt_content_pillars;
create policy "mkt_pillars_select" on public.mkt_content_pillars for select using (
  tenant_id = public.get_user_tenant_id()
  and (select public.user_has_permission(auth.uid(), 'mkt.view'))
);

drop policy if exists "mkt_media_select" on public.mkt_media_assets;
create policy "mkt_media_select" on public.mkt_media_assets for select using (
  tenant_id = public.get_user_tenant_id()
  and (select public.user_has_permission(auth.uid(), 'mkt.view'))
);

grant select on public.mkt_content_pillars to authenticated;
grant select on public.mkt_media_assets to authenticated;

-- ------------------------------------------------------------
-- 5. RPC — Context vai trò (đọc 1 lần cho read-model, hết cảnh gọi bừa leader-queue)
-- ------------------------------------------------------------
create or replace function public.mkt_get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return jsonb_build_object('canView', false);
  end if;
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
    'canTelegram', public.user_has_permission(v_actor, 'mkt.telegram_manage')
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. RPC — Tạo/sửa Campaign (+ checklist readiness ban đầu)
-- ------------------------------------------------------------
create or replace function public.mkt_create_campaign(
  p_name text,
  p_objective text default null,
  p_timeframe_start date default null,
  p_timeframe_end date default null,
  p_budget numeric default 0,
  p_branch_id uuid default null,
  p_owner_id uuid default null,
  p_readiness_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_campaign_id uuid;
  v_item jsonb;
  v_score integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  insert into public.mkt_campaigns (
    tenant_id, branch_id, name, objective, timeframe_start, timeframe_end,
    budget_amount, status, readiness_score, owner_id, created_by, updated_by
  ) values (
    v_tenant, p_branch_id, p_name, nullif(p_objective, ''), p_timeframe_start, p_timeframe_end,
    coalesce(p_budget, 0), 'planning', 0, coalesce(p_owner_id, v_actor), v_actor, v_actor
  )
  returning id into v_campaign_id;

  if jsonb_typeof(p_readiness_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_readiness_items) loop
      if nullif(v_item->>'title', '') is not null then
        insert into public.mkt_campaign_readiness_items (
          tenant_id, campaign_id, title, required_role, required_branch_id, due_at
        ) values (
          v_tenant, v_campaign_id, v_item->>'title',
          nullif(v_item->>'requiredRole', ''),
          nullif(v_item->>'requiredBranchId', '')::uuid,
          nullif(v_item->>'dueAt', '')::timestamptz
        );
      end if;
    end loop;
  end if;

  v_score := public.get_mkt_campaign_readiness_score(v_campaign_id);
  update public.mkt_campaigns set readiness_score = v_score where id = v_campaign_id;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_campaign_created', 'mkt_campaign', v_campaign_id, null, jsonb_build_object('name', p_name));
  return jsonb_build_object('success', true, 'campaignId', v_campaign_id, 'readinessScore', v_score);
end;
$$;

create or replace function public.mkt_update_campaign(
  p_campaign_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;

  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null for update;
  if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  update public.mkt_campaigns set
    name = coalesce(nullif(p_patch->>'name', ''), name),
    objective = coalesce(p_patch->>'objective', objective),
    timeframe_start = coalesce(nullif(p_patch->>'timeframeStart', '')::date, timeframe_start),
    timeframe_end = coalesce(nullif(p_patch->>'timeframeEnd', '')::date, timeframe_end),
    budget_amount = coalesce(nullif(p_patch->>'budget', '')::numeric, budget_amount),
    branch_id = coalesce(nullif(p_patch->>'branchId', '')::uuid, branch_id),
    owner_id = coalesce(nullif(p_patch->>'ownerId', '')::uuid, owner_id),
    updated_by = v_actor
  where id = p_campaign_id
  returning * into v_campaign;

  perform public.mkt_record_audit(v_campaign.tenant_id, v_actor, 'mkt_campaign_updated', 'mkt_campaign', p_campaign_id, null, p_patch);
  return jsonb_build_object('success', true, 'campaign', to_jsonb(v_campaign));
end;
$$;

-- ------------------------------------------------------------
-- 7. RPC — Work package + Content item + Manual task
-- ------------------------------------------------------------
create or replace function public.mkt_create_work_package(
  p_campaign_id uuid,
  p_channel_type text,
  p_title text,
  p_target_output text default null,
  p_owner_id uuid default null,
  p_reviewer_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign record;
  v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_campaigns') or public.user_has_permission(v_actor, 'mkt.split_work_packages')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null;
  if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  insert into public.mkt_channel_work_packages (
    tenant_id, campaign_id, channel_type, title, target_output, owner_id, reviewer_id,
    status, created_by, updated_by
  ) values (
    v_campaign.tenant_id, p_campaign_id, p_channel_type, p_title, nullif(p_target_output, ''),
    p_owner_id, p_reviewer_id, 'needs_split', v_actor, v_actor
  )
  returning id into v_id;

  perform public.mkt_record_audit(v_campaign.tenant_id, v_actor, 'mkt_work_package_created', 'mkt_work_package', v_id, null, jsonb_build_object('title', p_title, 'channel', p_channel_type));
  return jsonb_build_object('success', true, 'workPackageId', v_id);
end;
$$;

create or replace function public.mkt_create_content_item(
  p_campaign_id uuid,
  p_work_package_id uuid,
  p_title text,
  p_channel_type text default null,
  p_risk_level text default 'low',
  p_pillar_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign record;
  v_id uuid;
  v_risk text;
  v_required text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_campaigns') or public.user_has_permission(v_actor, 'mkt.split_work_packages')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null;
  if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  v_risk := coalesce(nullif(p_risk_level, ''), 'low');
  if v_risk not in ('low', 'medium', 'high', 'critical') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  -- Cấp duyệt suy TỪ risk ở server — client không tự hạ cấp để lách CEO.
  v_required := case when v_risk in ('high', 'critical') then 'ceo' else 'mkt_lead' end;

  insert into public.mkt_content_items (
    tenant_id, campaign_id, work_package_id, title, channel_type, content_status,
    risk_level, required_approver_role, pillar_id, current_version, revision_count,
    created_by, updated_by
  ) values (
    v_campaign.tenant_id, p_campaign_id, nullif(p_work_package_id::text, '')::uuid, p_title,
    nullif(p_channel_type, ''), 'draft', v_risk, v_required, p_pillar_id, 0, 0,
    v_actor, v_actor
  )
  returning id into v_id;

  perform public.mkt_record_audit(v_campaign.tenant_id, v_actor, 'mkt_content_created', 'mkt_content_item', v_id, null, jsonb_build_object('title', p_title, 'risk', v_risk));
  return jsonb_build_object('success', true, 'contentItemId', v_id, 'requiredApproverRole', v_required);
end;
$$;

create or replace function public.mkt_create_manual_task(
  p_title text,
  p_description text default null,
  p_campaign_id uuid default null,
  p_work_package_id uuid default null,
  p_assignee_id uuid default null,
  p_reviewer_id uuid default null,
  p_task_type text default 'other',
  p_due_at timestamptz default null,
  p_workload_points integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_source uuid;
  v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_team') or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  v_tenant := public.get_user_tenant_id();
  -- No floating tasks: task thủ công vẫn phải neo vào work package hoặc campaign.
  v_source := coalesce(p_work_package_id, p_campaign_id);
  if v_source is null then raise exception 'MISSING_SOURCE_ID' using errcode = 'P0001'; end if;

  insert into public.mkt_tasks (
    tenant_id, campaign_id, work_package_id, title, description, source_type, source_id,
    task_type, assignee_id, reviewer_id, workload_points, acceptance_status, task_status,
    due_at, created_by, updated_by
  ) values (
    v_tenant, p_campaign_id, p_work_package_id, p_title, nullif(p_description, ''),
    'manual', v_source, coalesce(nullif(p_task_type, ''), 'other'),
    p_assignee_id, p_reviewer_id, greatest(coalesce(p_workload_points, 1), 1),
    'pending', 'todo', p_due_at, v_actor, v_actor
  )
  returning id into v_id;

  if p_assignee_id is not null then
    perform public.mkt_enqueue_notification(
      v_tenant, p_assignee_id, 'mkt_task_assigned', 'Task MKT mới', p_title,
      'mkt_task', v_id, '/mkt/tasks?task=' || v_id::text,
      '{}'::jsonb, 'mkt_task_assigned:' || v_id::text
    );
  end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_manual_task_created', 'mkt_task', v_id, null, jsonb_build_object('title', p_title));
  return jsonb_build_object('success', true, 'taskId', v_id);
end;
$$;

-- ------------------------------------------------------------
-- 8. RPC — Readiness: thêm / miễn (waive) / nhắc
-- ------------------------------------------------------------
create or replace function public.mkt_add_readiness_item(
  p_campaign_id uuid,
  p_title text,
  p_required_role text default null,
  p_required_branch_id uuid default null,
  p_due_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign record;
  v_id uuid;
  v_score integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null;
  if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  insert into public.mkt_campaign_readiness_items (
    tenant_id, campaign_id, title, required_role, required_branch_id, due_at
  ) values (
    v_campaign.tenant_id, p_campaign_id, p_title, nullif(p_required_role, ''), p_required_branch_id, p_due_at
  )
  returning id into v_id;

  v_score := public.get_mkt_campaign_readiness_score(p_campaign_id);
  update public.mkt_campaigns set readiness_score = v_score, updated_by = v_actor where id = p_campaign_id;

  perform public.mkt_record_audit(v_campaign.tenant_id, v_actor, 'mkt_readiness_added', 'mkt_readiness_item', v_id, null, jsonb_build_object('title', p_title, 'campaign_id', p_campaign_id));
  return jsonb_build_object('success', true, 'itemId', v_id, 'readinessScore', v_score);
end;
$$;

create or replace function public.mkt_waive_readiness_item(
  p_campaign_id uuid,
  p_item_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_item record;
  v_score integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;

  select * into v_item from public.mkt_campaign_readiness_items
  where id = p_item_id and campaign_id = p_campaign_id and deleted_at is null for update;
  if not found or v_item.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  update public.mkt_campaign_readiness_items
  set status = 'waived', confirmed_by = v_actor, confirmed_at = now(), note = p_reason
  where id = p_item_id;

  v_score := public.get_mkt_campaign_readiness_score(p_campaign_id);
  update public.mkt_campaigns set readiness_score = v_score, updated_by = v_actor where id = p_campaign_id;

  perform public.mkt_record_audit(v_item.tenant_id, v_actor, 'mkt_readiness_waived', 'mkt_readiness_item', p_item_id, null, jsonb_build_object('reason', p_reason, 'campaign_id', p_campaign_id, 'is_exception', true, 'severity', 'low'));
  return jsonb_build_object('success', true, 'readinessScore', v_score);
end;
$$;

create or replace function public.mkt_remind_readiness_item(
  p_campaign_id uuid,
  p_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_item record;
  v_campaign record;
  v_recipient record;
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;

  select * into v_item from public.mkt_campaign_readiness_items
  where id = p_item_id and campaign_id = p_campaign_id and deleted_at is null;
  if not found or v_item.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id;

  -- Nhắc đúng nhóm người được giao xác nhận (theo role của item), dedupe theo ngày.
  for v_recipient in
    select p.id from public.profiles p
    where p.tenant_id = v_item.tenant_id
      and coalesce(p.is_active, true) = true
      and v_item.required_role is not null
      and lower(coalesce(p.role, '')) = lower(v_item.required_role)
  loop
    perform public.mkt_enqueue_notification(
      v_item.tenant_id, v_recipient.id, 'mkt_readiness_reminder',
      'Nhắc xác nhận sẵn sàng', v_item.title,
      'mkt_readiness_item', p_item_id, '/mkt/campaigns/' || p_campaign_id::text,
      '{}'::jsonb,
      'mkt_readiness_reminder:' || p_item_id::text || ':' || v_recipient.id::text || ':' || to_char(now(), 'YYYY-MM-DD')
    );
    v_count := v_count + 1;
  end loop;

  perform public.mkt_record_audit(v_item.tenant_id, v_actor, 'mkt_readiness_reminded', 'mkt_readiness_item', p_item_id, null, jsonb_build_object('recipients', v_count));
  return jsonb_build_object('success', true, 'reminded', v_count);
end;
$$;

-- ------------------------------------------------------------
-- 9. RPC — Content Pillars (Lead cấu hình)
-- ------------------------------------------------------------
create or replace function public.mkt_pillar_upsert(
  p_id uuid,
  p_code text,
  p_name text,
  p_color text default '#708090',
  p_sort_order integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_code, '')), '') is null or nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();

  if p_id is null then
    insert into public.mkt_content_pillars (tenant_id, code, name, color, sort_order)
    values (v_tenant, p_code, p_name, coalesce(nullif(p_color, ''), '#708090'), coalesce(p_sort_order, 0))
    on conflict (tenant_id, code) do update set
      name = excluded.name, color = excluded.color, sort_order = excluded.sort_order,
      is_active = true, deleted_at = null, updated_at = now()
    returning id into v_id;
  else
    update public.mkt_content_pillars set
      code = p_code, name = p_name, color = coalesce(nullif(p_color, ''), color),
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_pillar_upserted', 'mkt_content_pillar', v_id, null, jsonb_build_object('code', p_code, 'name', p_name));
  return jsonb_build_object('success', true, 'pillarId', v_id);
end;
$$;

create or replace function public.mkt_pillar_deactivate(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_content_pillars set is_active = false, deleted_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_pillar_deactivated', 'mkt_content_pillar', p_id, null, null);
  return jsonb_build_object('success', true);
end;
$$;

-- ------------------------------------------------------------
-- 10. RPC — Media: ghi record sau upload / đổi trạng thái
-- ------------------------------------------------------------
create or replace function public.mkt_media_register(
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_kind text default 'image',
  p_campaign_id uuid default null,
  p_content_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_storage_path, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  insert into public.mkt_media_assets (
    tenant_id, campaign_id, content_item_id, storage_path, file_name, mime_type,
    size_bytes, kind, status, uploaded_by
  ) values (
    v_tenant, p_campaign_id, p_content_item_id, p_storage_path, p_file_name, nullif(p_mime_type, ''),
    p_size_bytes, coalesce(nullif(p_kind, ''), 'image'), 'available', v_actor
  )
  returning id into v_id;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_media_registered', 'mkt_media_asset', v_id, null, jsonb_build_object('file', p_file_name));
  return jsonb_build_object('success', true, 'mediaId', v_id);
end;
$$;

create or replace function public.mkt_media_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_status not in ('available', 'used') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_media_assets set status = p_status
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ------------------------------------------------------------
-- 11. RPC — Exception Log (đọc audit_log ngoại lệ; cần mkt.view_audit)
-- ------------------------------------------------------------
create or replace function public.mkt_get_exception_log(
  p_campaign_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view_audit') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into v_result
  from (
    select a.id, a.action, a.entity_type, a.entity_id, a.user_id,
           a.new_data, a.created_at
    from public.audit_log a
    where a.tenant_id = v_tenant
      and a.entity_type like 'mkt_%'
      and coalesce((a.new_data->>'is_exception')::boolean, false) = true
      and (p_campaign_id is null
           or a.entity_id = p_campaign_id
           or (a.new_data->>'campaign_id') = p_campaign_id::text)
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x;

  return jsonb_build_object('success', true, 'entries', v_result);
end;
$$;

-- ------------------------------------------------------------
-- 12. Khóa quyền EXECUTE (revoke public/anon; grant authenticated)
-- ------------------------------------------------------------
revoke all on function public.mkt_get_my_context() from public, anon;
revoke all on function public.mkt_create_campaign(text, text, date, date, numeric, uuid, uuid, jsonb) from public, anon;
revoke all on function public.mkt_update_campaign(uuid, jsonb) from public, anon;
revoke all on function public.mkt_create_work_package(uuid, text, text, text, uuid, uuid) from public, anon;
revoke all on function public.mkt_create_content_item(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.mkt_create_manual_task(text, text, uuid, uuid, uuid, uuid, text, timestamptz, integer) from public, anon;
revoke all on function public.mkt_add_readiness_item(uuid, text, text, uuid, timestamptz) from public, anon;
revoke all on function public.mkt_waive_readiness_item(uuid, uuid, text) from public, anon;
revoke all on function public.mkt_remind_readiness_item(uuid, uuid) from public, anon;
revoke all on function public.mkt_pillar_upsert(uuid, text, text, text, integer) from public, anon;
revoke all on function public.mkt_pillar_deactivate(uuid) from public, anon;
revoke all on function public.mkt_media_register(text, text, text, bigint, text, uuid, uuid) from public, anon;
revoke all on function public.mkt_media_set_status(uuid, text) from public, anon;
revoke all on function public.mkt_get_exception_log(uuid, integer) from public, anon;

grant execute on function public.mkt_get_my_context() to authenticated;
grant execute on function public.mkt_create_campaign(text, text, date, date, numeric, uuid, uuid, jsonb) to authenticated;
grant execute on function public.mkt_update_campaign(uuid, jsonb) to authenticated;
grant execute on function public.mkt_create_work_package(uuid, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.mkt_create_content_item(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.mkt_create_manual_task(text, text, uuid, uuid, uuid, uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.mkt_add_readiness_item(uuid, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.mkt_waive_readiness_item(uuid, uuid, text) to authenticated;
grant execute on function public.mkt_remind_readiness_item(uuid, uuid) to authenticated;
grant execute on function public.mkt_pillar_upsert(uuid, text, text, text, integer) to authenticated;
grant execute on function public.mkt_pillar_deactivate(uuid) to authenticated;
grant execute on function public.mkt_media_register(text, text, text, bigint, text, uuid, uuid) to authenticated;
grant execute on function public.mkt_media_set_status(uuid, text) to authenticated;
grant execute on function public.mkt_get_exception_log(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
