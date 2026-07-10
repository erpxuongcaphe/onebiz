-- ============================================================
-- MKT Hub staging seed
-- Source logic: Working/XCP_MKT_Hub_Developer_Handover_Package_v1.0.3
--
-- Run on staging only, after migration 00168_mkt_hub_core.sql.
-- This file is intentionally not a production migration.
-- ============================================================

do $seed_mkt$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_owner_id uuid;
  v_lead_id uuid;
  v_executor_id uuid;
  v_reviewer_id uuid;
  v_campaign_id uuid;
  v_package_id uuid;
  v_content_id uuid;
  v_version_id uuid;
  v_shooting_task_id uuid;
  v_review_task_id uuid;
begin
  if to_regclass('public.mkt_campaigns') is null then
    raise exception 'MKT Hub tables are missing. Apply migration 00168 first.';
  end if;

  select p.tenant_id
    into v_tenant_id
  from public.profiles p
  where p.tenant_id is not null
    and coalesce(p.is_active, true) = true
  order by
    case p.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end,
    p.created_at nulls last
  limit 1;

  if v_tenant_id is null then
    raise exception 'No tenant found. Create at least one OneBiz tenant/profile first.';
  end if;

  -- Content Pillars P1..P4 (idempotent) — dùng cho Kanban/lịch/báo cáo.
  insert into public.mkt_content_pillars (tenant_id, code, name, color, sort_order)
  values
    (v_tenant_id, 'P1', 'Cà phê tươi', '#8B5A2B', 1),
    (v_tenant_id, 'P2', 'Không gian & Vibe', '#2E8B57', 2),
    (v_tenant_id, 'P3', 'Trải nghiệm', '#D2691E', 3),
    (v_tenant_id, 'P4', 'Vận hành chỉn chu', '#708090', 4)
  on conflict (tenant_id, code) do nothing;

  select b.id
    into v_branch_id
  from public.branches b
  where b.tenant_id = v_tenant_id
    and coalesce(b.is_active, true) = true
  order by b.is_default desc nulls last, b.created_at nulls last
  limit 1;

  select p.id
    into v_owner_id
  from public.profiles p
  where p.tenant_id = v_tenant_id
    and coalesce(p.is_active, true) = true
  order by
    case p.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end,
    p.created_at nulls last
  limit 1;

  select p.id
    into v_lead_id
  from public.profiles p
  where p.tenant_id = v_tenant_id
    and coalesce(p.is_active, true) = true
  order by
    case p.role when 'manager' then 0 when 'owner' then 1 when 'admin' then 2 else 3 end,
    p.created_at nulls last
  limit 1;

  select p.id
    into v_executor_id
  from public.profiles p
  where p.tenant_id = v_tenant_id
    and coalesce(p.is_active, true) = true
  order by
    case when p.id <> coalesce(v_lead_id, v_owner_id) then 0 else 1 end,
    p.created_at nulls last
  limit 1;

  select p.id
    into v_reviewer_id
  from public.profiles p
  where p.tenant_id = v_tenant_id
    and coalesce(p.is_active, true) = true
  order by
    case when p.id not in (coalesce(v_lead_id, v_owner_id), coalesce(v_executor_id, v_owner_id)) then 0 else 1 end,
    p.created_at nulls last
  limit 1;

  v_lead_id := coalesce(v_lead_id, v_owner_id);
  v_executor_id := coalesce(v_executor_id, v_lead_id, v_owner_id);
  v_reviewer_id := coalesce(v_reviewer_id, v_lead_id, v_owner_id);

  if exists (
    select 1
    from public.mkt_campaigns
    where tenant_id = v_tenant_id
      and name = 'MKT Hub UAT T07/2026'
      and deleted_at is null
  ) then
    raise notice 'MKT Hub staging seed already exists for tenant %, skipped.', v_tenant_id;
  else
    insert into public.mkt_workflow_templates (
      tenant_id, code, name, description, steps
    ) values (
      v_tenant_id,
      'tiktok_basic',
      'TikTok basic launch flow',
      'Brief -> shooting -> editing -> review -> publish -> report',
      '[
        {"code":"brief","label":"Brief","task_type":"idea"},
        {"code":"shooting","label":"Shooting","task_type":"shooting"},
        {"code":"editing","label":"Editing","task_type":"editing"},
        {"code":"review","label":"Review","task_type":"review"},
        {"code":"publish","label":"Publish","task_type":"publish"},
        {"code":"report","label":"Report","task_type":"report"}
      ]'::jsonb
    )
    on conflict (tenant_id, code) do update set
      name = excluded.name,
      description = excluded.description,
      steps = excluded.steps,
      is_active = true,
      updated_at = now();

    insert into public.mkt_campaigns (
      tenant_id, branch_id, name, objective, timeframe_start, timeframe_end,
      budget_amount, status, readiness_score, owner_id, created_by, updated_by
    ) values (
      v_tenant_id,
      v_branch_id,
      'MKT Hub UAT T07/2026',
      'Validate campaign -> channel package -> task accept -> content review -> publish readiness.',
      current_date,
      current_date + 21,
      15000000,
      'planning',
      0,
      v_lead_id,
      v_owner_id,
      v_owner_id
    )
    returning id into v_campaign_id;

    insert into public.mkt_campaign_readiness_items (
      tenant_id, campaign_id, title, required_role, required_branch_id,
      status, due_at, confirmed_by, confirmed_at, note
    ) values
      (v_tenant_id, v_campaign_id, 'Ops confirm POSM and store rollout', 'ops', v_branch_id,
       'confirmed', now() + interval '2 days', v_lead_id, now(), 'Seed confirmed for UAT'),
      (v_tenant_id, v_campaign_id, 'Finance approve campaign budget', 'finance', null,
       'pending', now() + interval '3 days', null, null, null),
      (v_tenant_id, v_campaign_id, 'CEO approve core message', 'owner', null,
       'pending', now() + interval '1 day', null, null, null),
      (v_tenant_id, v_campaign_id, 'Store manager acknowledge launch kit', 'manager', v_branch_id,
       'confirmed', now() + interval '4 days', v_lead_id, now(), 'Seed confirmed for UAT');

    update public.mkt_campaigns
      set readiness_score = public.get_mkt_campaign_readiness_score(v_campaign_id)
    where id = v_campaign_id;

    insert into public.mkt_channel_work_packages (
      tenant_id, campaign_id, channel_type, title, target_output,
      owner_id, reviewer_id, status, created_by, updated_by
    ) values (
      v_tenant_id,
      v_campaign_id,
      'tiktok',
      'TikTok Oolong Launch',
      '3 short videos, 2 cutdowns, 1 publish checklist',
      v_lead_id,
      v_reviewer_id,
      'in_progress',
      v_owner_id,
      v_owner_id
    )
    returning id into v_package_id;

    insert into public.mkt_content_items (
      tenant_id, campaign_id, work_package_id, title, channel_type,
      content_status, risk_level, required_approver_role, current_version,
      revision_count, created_by, updated_by
    ) values (
      v_tenant_id,
      v_campaign_id,
      v_package_id,
      'Video T07 - Oolong Spark',
      'tiktok',
      'pending_review',
      'high',
      'owner',
      1,
      0,
      v_executor_id,
      v_executor_id
    )
    returning id into v_content_id;

    insert into public.mkt_content_versions (
      tenant_id, content_item_id, version_number, content_url, caption, note, status, submitted_by
    ) values (
      v_tenant_id,
      v_content_id,
      1,
      'https://example.com/staging/mkt/oolong-spark-v1.mp4',
      'Oolong Spark launch caption for UAT.',
      'Seed version waiting for reviewer decision.',
      'pending',
      v_executor_id
    )
    returning id into v_version_id;

    insert into public.mkt_tasks (
      tenant_id, campaign_id, work_package_id, title, description,
      source_type, source_id, task_type, assignee_id, reviewer_id,
      workload_points, acceptance_status, task_status, due_at,
      created_by, updated_by
    ) values (
      v_tenant_id,
      v_campaign_id,
      v_package_id,
      'Brief TikTok Oolong T07',
      'Clarify objective, hook, CTA, target branches, and approval owner.',
      'campaign_channel_split',
      v_package_id,
      'idea',
      v_executor_id,
      v_reviewer_id,
      2,
      'pending',
      'todo',
      now() + interval '1 day',
      v_lead_id,
      v_lead_id
    );

    insert into public.mkt_tasks (
      tenant_id, campaign_id, work_package_id, title, description,
      source_type, source_id, task_type, assignee_id, reviewer_id,
      workload_points, acceptance_status, task_status, due_at,
      created_by, updated_by
    ) values (
      v_tenant_id,
      v_campaign_id,
      v_package_id,
      'Shoot TikTok Oolong Spark',
      'Shoot hero product, prep, and store counter scenes.',
      'campaign_channel_split',
      v_package_id,
      'shooting',
      v_executor_id,
      v_reviewer_id,
      3,
      'accepted',
      'doing',
      now() + interval '2 days',
      v_lead_id,
      v_executor_id
    )
    returning id into v_shooting_task_id;

    insert into public.mkt_tasks (
      tenant_id, campaign_id, work_package_id, content_item_id, title, description,
      source_type, source_id, task_type, assignee_id, reviewer_id,
      dependency_task_id, workload_points, acceptance_status, task_status,
      due_at, created_by, updated_by
    ) values (
      v_tenant_id,
      v_campaign_id,
      v_package_id,
      v_content_id,
      'Review Video T07 - Oolong Spark',
      'Review content via Content Review API, not manual mark done.',
      'content_item',
      v_content_id,
      'review',
      v_reviewer_id,
      v_reviewer_id,
      null,
      1,
      'accepted',
      'reviewing',
      now() + interval '1 day',
      v_lead_id,
      v_reviewer_id
    )
    returning id into v_review_task_id;

    insert into public.mkt_tasks (
      tenant_id, campaign_id, work_package_id, content_item_id, title, description,
      source_type, source_id, task_type, assignee_id, reviewer_id,
      dependency_task_id, workload_points, acceptance_status, task_status,
      blocked_reason, due_at, created_by, updated_by
    ) values (
      v_tenant_id,
      v_campaign_id,
      v_package_id,
      v_content_id,
      'Publish approved TikTok content',
      'Publishing must wait until content approval is done.',
      'content_item',
      v_content_id,
      'publish',
      v_executor_id,
      v_reviewer_id,
      v_review_task_id,
      1,
      'pending',
      'blocked',
      'DEPENDENCY_BLOCKED',
      now() + interval '4 days',
      v_lead_id,
      v_lead_id
    );

    insert into public.mkt_outbox_events (
      tenant_id, event_type, recipient_user_id, reference_type, reference_id,
      title, message, deep_link_path, dedupe_key
    ) values
      (v_tenant_id, 'mkt_task_assigned', v_executor_id, 'mkt_task', v_shooting_task_id,
       'Task MKT mới', 'Shoot TikTok Oolong Spark', '/mkt/tasks?task=' || v_shooting_task_id::text,
       'seed:mkt_task_assigned:' || v_shooting_task_id::text),
      (v_tenant_id, 'mkt_content_pending_review', v_reviewer_id, 'mkt_content_item', v_content_id,
       'Nội dung chờ duyệt', 'Video T07 - Oolong Spark', '/mkt/approvals?content=' || v_content_id::text,
       'seed:mkt_content_pending_review:' || v_content_id::text)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;

    raise notice 'MKT Hub staging seed created. tenant=%, campaign=%, package=%, content=%, version=%',
      v_tenant_id, v_campaign_id, v_package_id, v_content_id, v_version_id;
  end if;
end
$seed_mkt$;

select
  c.id as campaign_id,
  c.name,
  c.status,
  c.readiness_score,
  (select count(*) from public.mkt_tasks t where t.campaign_id = c.id and t.deleted_at is null) as tasks,
  (select count(*) from public.mkt_content_items ci where ci.campaign_id = c.id and ci.deleted_at is null) as contents
from public.mkt_campaigns c
where c.name = 'MKT Hub UAT T07/2026'
order by c.created_at desc
limit 1;
