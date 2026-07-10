-- ============================================================
-- 00169: MKT Hub — CRUD (Sprint 1 Foundation) + Content Pillars + Media
-- Bổ sung lên 00168_mkt_hub_core. Mọi RPC: actor từ auth.uid(), tenant từ
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
