-- ============================================================
-- 00173: MKT Hub workflow, tenant isolation, and delivery hardening
-- Source: Working/XCP_MKT_Hub_Developer_Handover_Package_v1.0.3
-- ============================================================

-- This migration is intentionally additive. Do not edit applied migrations 00168-00172.

-- -----------------------------------------------------------------------------
-- 1. Enforce tenant consistency for every MKT foreign reference.
--    SECURITY DEFINER RPCs bypass RLS, so FK existence alone is not sufficient.
-- -----------------------------------------------------------------------------
create or replace function public.mkt_assert_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_parent_campaign uuid;
begin
  if new.tenant_id is null then
    raise exception 'CROSS_TENANT_REFERENCE: missing tenant' using errcode = 'P0001';
  end if;

  if tg_table_name = 'mkt_campaigns' then
    if new.branch_id is not null and not exists (
      select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: branch' using errcode = 'P0001'; end if;
    if new.owner_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.owner_id and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: owner' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_campaign_readiness_items' then
    if not exists (select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001';
    end if;
    if new.required_branch_id is not null and not exists (
      select 1 from public.branches b where b.id = new.required_branch_id and b.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: branch' using errcode = 'P0001'; end if;
    if new.confirmed_by is not null and not exists (
      select 1 from public.profiles p where p.id = new.confirmed_by and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: confirmer' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_channel_work_packages' then
    if not exists (select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001';
    end if;
    if new.owner_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.owner_id and p.tenant_id = new.tenant_id and coalesce(p.is_active, true)
    ) then raise exception 'CROSS_TENANT_REFERENCE: owner' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id and coalesce(p.is_active, true)
    ) then raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_content_items' then
    if new.campaign_id is not null and not exists (
      select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001'; end if;
    if new.work_package_id is not null then
      select wp.tenant_id, wp.campaign_id into v_tenant, v_parent_campaign
      from public.mkt_channel_work_packages wp where wp.id = new.work_package_id;
      if v_tenant is distinct from new.tenant_id or (new.campaign_id is not null and v_parent_campaign is distinct from new.campaign_id) then
        raise exception 'CROSS_TENANT_REFERENCE: work package' using errcode = 'P0001';
      end if;
    end if;
    if new.pillar_id is not null and not exists (
      select 1 from public.mkt_content_pillars p where p.id = new.pillar_id and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: pillar' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_tasks' then
    if new.campaign_id is not null and not exists (
      select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001'; end if;
    if new.work_package_id is not null then
      select wp.tenant_id, wp.campaign_id into v_tenant, v_parent_campaign
      from public.mkt_channel_work_packages wp where wp.id = new.work_package_id;
      if v_tenant is distinct from new.tenant_id or (new.campaign_id is not null and v_parent_campaign is distinct from new.campaign_id) then
        raise exception 'CROSS_TENANT_REFERENCE: work package' using errcode = 'P0001';
      end if;
    end if;
    if new.content_item_id is not null and not exists (
      select 1 from public.mkt_content_items ci
      where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id
        and (new.campaign_id is null or ci.campaign_id = new.campaign_id)
        and (new.work_package_id is null or ci.work_package_id = new.work_package_id)
    ) then raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001'; end if;
    if new.assignee_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.assignee_id and p.tenant_id = new.tenant_id and coalesce(p.is_active, true)
    ) then raise exception 'CROSS_TENANT_REFERENCE: assignee' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id and coalesce(p.is_active, true)
    ) then raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;
    if new.dependency_task_id is not null and not exists (
      select 1 from public.mkt_tasks d
      where d.id = new.dependency_task_id and d.tenant_id = new.tenant_id
        and (new.campaign_id is null or d.campaign_id = new.campaign_id)
    ) then raise exception 'CROSS_TENANT_REFERENCE: dependency' using errcode = 'P0001'; end if;
    if new.pillar_id is not null and not exists (
      select 1 from public.mkt_content_pillars p where p.id = new.pillar_id and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: pillar' using errcode = 'P0001'; end if;
    if new.source_id is null then raise exception 'MISSING_SOURCE_ID' using errcode = 'P0001'; end if;
    if new.source_type = 'campaign_channel_split' and new.source_id is distinct from new.work_package_id then
      raise exception 'INVALID_SOURCE_REFERENCE' using errcode = 'P0001';
    end if;
    if new.source_type = 'content_item' and new.source_id is distinct from new.content_item_id then
      raise exception 'INVALID_SOURCE_REFERENCE' using errcode = 'P0001';
    end if;
    if new.source_type = 'manual' and new.source_id is distinct from coalesce(new.work_package_id, new.campaign_id) then
      raise exception 'INVALID_SOURCE_REFERENCE' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'mkt_content_versions' then
    if not exists (select 1 from public.mkt_content_items ci where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001';
    end if;
    if new.submitted_by is not null and not exists (
      select 1 from public.profiles p where p.id = new.submitted_by and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: submitter' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_content_reviews' then
    if not exists (select 1 from public.mkt_content_items ci where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001';
    end if;
    if new.content_version_id is not null and not exists (
      select 1 from public.mkt_content_versions cv
      where cv.id = new.content_version_id and cv.content_item_id = new.content_item_id and cv.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: version' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;

  elsif tg_table_name in ('mkt_telegram_accounts', 'mkt_telegram_link_tokens') then
    if not exists (select 1 from public.profiles p where p.id = new.user_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: user' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'mkt_outbox_events' then
    if not exists (select 1 from public.profiles p where p.id = new.recipient_user_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: recipient' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'mkt_media_assets' then
    if new.campaign_id is not null and not exists (
      select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001'; end if;
    if new.content_item_id is not null and not exists (
      select 1 from public.mkt_content_items ci where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001'; end if;
  end if;

  return new;
end;
$$;

revoke all on function public.mkt_assert_tenant_links() from public, anon, authenticated;

do $triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'mkt_campaigns', 'mkt_campaign_readiness_items', 'mkt_channel_work_packages',
    'mkt_content_items', 'mkt_tasks', 'mkt_content_versions', 'mkt_content_reviews',
    'mkt_telegram_accounts', 'mkt_telegram_link_tokens', 'mkt_outbox_events', 'mkt_media_assets'
  ] loop
    execute format('drop trigger if exists trg_%I_tenant_links on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_%I_tenant_links before insert or update on public.%I for each row execute function public.mkt_assert_tenant_links()',
      v_table, v_table
    );
  end loop;
end
$triggers$;

-- -----------------------------------------------------------------------------
-- 2. One normal completion path: update the task, unblock dependents, complete
--    the package, and write audit. Force Done calls the same helper with an
--    exception action; review approval is still a normal completion.
-- -----------------------------------------------------------------------------
create or replace function public.mkt_complete_task_internal(
  p_task_id uuid,
  p_actor uuid,
  p_action text,
  p_new_data jsonb default '{}'::jsonb
) returns public.mkt_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.mkt_tasks%rowtype;
begin
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  update public.mkt_tasks
  set task_status = 'done', completed_at = coalesce(completed_at, now()),
      requires_leader_action = false, blocked_reason = null, updated_by = p_actor
  where id = p_task_id
  returning * into v_task;

  update public.mkt_tasks
  set task_status = case when acceptance_status = 'accepted' then 'todo' else task_status end,
      blocked_reason = case when acceptance_status = 'accepted' then null else blocked_reason end,
      updated_by = p_actor
  where dependency_task_id = p_task_id
    and tenant_id = v_task.tenant_id
    and deleted_at is null
    and task_status = 'blocked';

  if v_task.work_package_id is not null and not exists (
    select 1 from public.mkt_tasks t
    where t.work_package_id = v_task.work_package_id
      and t.tenant_id = v_task.tenant_id
      and t.deleted_at is null
      and t.task_status not in ('done', 'canceled')
  ) then
    update public.mkt_channel_work_packages
    set status = 'completed', updated_by = p_actor
    where id = v_task.work_package_id and tenant_id = v_task.tenant_id;
  end if;

  perform public.mkt_record_audit(
    v_task.tenant_id, p_actor, p_action, 'mkt_task', v_task.id, null,
    coalesce(p_new_data, '{}'::jsonb) || jsonb_build_object('task_status', 'done')
  );
  return v_task;
end;
$$;

revoke all on function public.mkt_complete_task_internal(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Strict task state machine.
-- -----------------------------------------------------------------------------
create or replace function public.mkt_accept_task(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  if v_task.acceptance_status <> 'pending' then
    raise exception 'ALREADY_PROCESSED' using errcode = 'P0001';
  end if;
  if v_task.task_status not in ('todo', 'blocked') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  if v_task.dependency_task_id is null then
    v_next_status := 'todo';
  else
    select task_status into v_dep_status from public.mkt_tasks
    where id = v_task.dependency_task_id and tenant_id = v_task.tenant_id;
    v_next_status := case when v_dep_status = 'done' then 'todo' else 'blocked' end;
  end if;

  update public.mkt_tasks
  set acceptance_status = 'accepted', task_status = v_next_status,
      blocked_reason = case when v_next_status = 'blocked' then 'DEPENDENCY_BLOCKED' else null end,
      requires_leader_action = false, reject_reason = null, discussion_reason = null, updated_by = v_actor
  where id = p_task_id returning * into v_task;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_accepted', 'mkt_task', v_task.id, null, to_jsonb(v_task));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_reject_task(p_task_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record; v_owner uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'pending' or v_task.task_status not in ('todo', 'blocked') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.mkt_tasks set acceptance_status = 'rejected', requires_leader_action = true,
    reject_reason = p_reason, updated_by = v_actor where id = p_task_id returning * into v_task;
  select owner_id into v_owner from public.mkt_channel_work_packages where id = v_task.work_package_id and tenant_id = v_task.tenant_id;
  if v_owner is not null then perform public.mkt_enqueue_notification(v_task.tenant_id, v_owner, 'mkt_task_rejected', 'Task MKT bi tu choi', v_task.title, 'mkt_task', v_task.id, '/mkt/leader-queue'); end if;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_rejected', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_need_discussion_task(p_task_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record; v_owner uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'pending' or v_task.task_status not in ('todo', 'blocked') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.mkt_tasks set acceptance_status = 'need_discussion', requires_leader_action = true,
    discussion_reason = p_reason, updated_by = v_actor where id = p_task_id returning * into v_task;
  select owner_id into v_owner from public.mkt_channel_work_packages where id = v_task.work_package_id and tenant_id = v_task.tenant_id;
  if v_owner is not null then perform public.mkt_enqueue_notification(v_task.tenant_id, v_owner, 'mkt_task_need_discussion', 'Task MKT can trao doi', v_task.title, 'mkt_task', v_task.id, '/mkt/leader-queue'); end if;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_need_discussion', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_start_task(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record; v_dep_status text; v_content_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'accepted' or v_task.task_status <> 'todo' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if v_task.dependency_task_id is not null then
    select task_status into v_dep_status from public.mkt_tasks where id = v_task.dependency_task_id and tenant_id = v_task.tenant_id;
    if v_dep_status is distinct from 'done' then raise exception 'DEPENDENCY_BLOCKED' using errcode = 'P0001'; end if;
  end if;
  if v_task.task_type = 'publish' then
    if v_task.content_item_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    select content_status into v_content_status from public.mkt_content_items where id = v_task.content_item_id and tenant_id = v_task.tenant_id and deleted_at is null;
    if v_content_status <> 'approved' then raise exception 'CONTENT_NOT_APPROVED' using errcode = 'P0001'; end if;
  end if;
  update public.mkt_tasks set task_status = 'doing', started_at = coalesce(started_at, now()), updated_by = v_actor
  where id = p_task_id returning * into v_task;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_started', 'mkt_task', v_task.id, null, to_jsonb(v_task));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_mark_task_done(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record; v_content_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'accepted' or v_task.task_status <> 'doing' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if v_task.task_type = 'review' and v_task.content_item_id is not null then raise exception 'REVIEW_TASK_REQUIRES_REVIEW_API' using errcode = 'P0001'; end if;
  if v_task.task_type = 'publish' then
    select content_status into v_content_status from public.mkt_content_items where id = v_task.content_item_id and tenant_id = v_task.tenant_id and deleted_at is null;
    if v_content_status <> 'approved' then raise exception 'CONTENT_NOT_APPROVED' using errcode = 'P0001'; end if;
  end if;
  v_task := public.mkt_complete_task_internal(p_task_id, v_actor, 'mkt_task_done', '{}'::jsonb);
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_force_task_done(p_task_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.override_campaign') or public.user_has_permission(v_actor, 'mkt.manage_team')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.task_status in ('done', 'canceled') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_task := public.mkt_complete_task_internal(p_task_id, v_actor, 'mkt_task_force_done', jsonb_build_object('reason', p_reason, 'is_exception', true, 'severity', 'medium'));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_reassign_task(p_task_id uuid, p_new_assignee_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record; v_dep_status text; v_next_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  if p_new_assignee_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_team') or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.task_status in ('done', 'canceled') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_new_assignee_id and p.tenant_id = v_task.tenant_id and coalesce(p.is_active, true)) then raise exception 'CROSS_TENANT_REFERENCE: assignee' using errcode = 'P0001'; end if;
  if v_task.dependency_task_id is null then v_next_status := 'todo'; else
    select task_status into v_dep_status from public.mkt_tasks where id = v_task.dependency_task_id and tenant_id = v_task.tenant_id;
    v_next_status := case when v_dep_status = 'done' then 'todo' else 'blocked' end;
  end if;
  update public.mkt_tasks set assignee_id = p_new_assignee_id, acceptance_status = 'pending', task_status = v_next_status,
    blocked_reason = case when v_next_status = 'blocked' then 'DEPENDENCY_BLOCKED' else null end,
    requires_leader_action = false, reject_reason = null, discussion_reason = null, updated_by = v_actor
  where id = p_task_id returning * into v_task;
  perform public.mkt_enqueue_notification(v_task.tenant_id, p_new_assignee_id, 'mkt_task_assigned', 'Task MKT mới', v_task.title, 'mkt_task', v_task.id, '/mkt/tasks?task=' || v_task.id::text, '{}'::jsonb, 'mkt_task_reassigned:' || v_task.id::text || ':' || p_new_assignee_id::text);
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_reassigned', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason, 'new_assignee_id', p_new_assignee_id));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_cancel_task(p_task_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_team') or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.task_status in ('done', 'canceled') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.mkt_tasks set task_status = 'canceled', requires_leader_action = false, updated_by = v_actor
  where id = p_task_id returning * into v_task;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_canceled', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Review workflow: explicit pending current version, recoverable revision,
--    normal completion, and dependency unblocking.
-- -----------------------------------------------------------------------------
create or replace function public.mkt_submit_task_review(
  p_task_id uuid,
  p_content_item_id uuid,
  p_content_url text,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_task record; v_content record; v_version record; v_next_version integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if p_content_item_id is null or nullif(trim(coalesce(p_content_url, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_content_url !~* '^https?://' then raise exception 'INVALID_CONTENT_URL' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'accepted' or v_task.task_status <> 'doing' or v_task.task_type in ('review', 'publish') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select * into v_content from public.mkt_content_items where id = p_content_item_id and deleted_at is null for update;
  if not found or v_content.tenant_id <> v_task.tenant_id
    or v_content.campaign_id is distinct from v_task.campaign_id
    or (v_task.work_package_id is not null and v_content.work_package_id is distinct from v_task.work_package_id)
  then raise exception 'INVALID_CONTENT_LINK' using errcode = 'P0001'; end if;
  if exists (select 1 from public.mkt_content_versions cv where cv.content_item_id = p_content_item_id and cv.status = 'pending') then raise exception 'ALREADY_PROCESSED' using errcode = 'P0001'; end if;
  v_next_version := coalesce(v_content.current_version, 0) + 1;
  insert into public.mkt_content_versions (tenant_id, content_item_id, version_number, content_url, note, status, submitted_by)
  values (v_task.tenant_id, p_content_item_id, v_next_version, p_content_url, p_note, 'pending', v_actor) returning * into v_version;
  update public.mkt_content_items set current_version = v_next_version, content_status = 'pending_review', approved_by = null, approved_at = null, updated_by = v_actor where id = p_content_item_id;
  update public.mkt_tasks set task_status = 'reviewing', content_item_id = p_content_item_id, requires_leader_action = false, updated_by = v_actor where id = p_task_id;
  if v_task.reviewer_id is not null then perform public.mkt_enqueue_notification(v_task.tenant_id, v_task.reviewer_id, 'mkt_content_pending_review', 'Nội dung chờ duyệt', v_content.title, 'mkt_content_item', p_content_item_id, '/mkt/approvals?content=' || p_content_item_id::text, '{}'::jsonb, 'mkt_content_pending_review:' || v_version.id::text); end if;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_content_submitted_review', 'mkt_content_item', p_content_item_id, null, to_jsonb(v_version));
  return jsonb_build_object('success', true, 'contentVersion', to_jsonb(v_version));
end;
$$;

-- Bản mới BỎ default của p_content_version_id + p_action (bắt buộc truyền rõ)
-- → Postgres không cho CREATE OR REPLACE bỏ default (42P13), phải DROP trước.
-- DROP làm mất quyền EXECUTE nên cấp lại ở khối grant cuối file.
drop function if exists public.mkt_review_content(uuid, uuid, text, text);

create function public.mkt_review_content(
  p_content_id uuid,
  p_content_version_id uuid,
  p_action text,
  p_comment text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_content record; v_version record; v_review record;
  v_revision_count integer; v_required_role text; v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.review_content') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_action not in ('approve', 'revision', 'reject') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_action in ('revision', 'reject') and nullif(trim(coalesce(p_comment, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  select * into v_content from public.mkt_content_items where id = p_content_id and deleted_at is null for update;
  if not found or v_content.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_content.content_status <> 'pending_review' or v_content.current_version <= 0 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_required_role := coalesce(nullif(v_content.required_approver_role, ''), case when v_content.risk_level in ('high', 'critical') then 'ceo' else 'mkt_lead' end);
  if (v_required_role in ('ceo', 'owner') or v_content.risk_level in ('high', 'critical'))
     and not public.user_has_permission(v_actor, 'mkt.override_campaign') then
    raise exception 'INSUFFICIENT_ROLE: Noi dung rui ro cao, can cap duyet CEO' using errcode = 'P0001';
  end if;
  if p_content_version_id is null then
    select * into v_version from public.mkt_content_versions
    where content_item_id = p_content_id and version_number = v_content.current_version and status = 'pending' for update;
  else
    select * into v_version from public.mkt_content_versions
    where id = p_content_version_id and content_item_id = p_content_id
      and version_number = v_content.current_version and status = 'pending' for update;
  end if;
  if not found then raise exception 'STALE_CONTENT_VERSION' using errcode = 'P0001'; end if;
  insert into public.mkt_content_reviews (tenant_id, content_item_id, content_version_id, reviewer_id, action, comment)
  values (v_content.tenant_id, p_content_id, v_version.id, v_actor, p_action, p_comment) returning * into v_review;

  if p_action = 'approve' then
    update public.mkt_content_versions set status = 'approved' where id = v_version.id;
    update public.mkt_content_items set content_status = 'approved', approved_by = v_actor, approved_at = now(), updated_by = v_actor where id = p_content_id returning * into v_content;
    for v_task in select * from public.mkt_tasks t
      where t.tenant_id = v_content.tenant_id and t.content_item_id = p_content_id
        and t.deleted_at is null and t.task_status not in ('done', 'canceled')
        and (t.task_status = 'reviewing' or t.task_type = 'review')
      for update
    loop
      perform public.mkt_complete_task_internal(v_task.id, v_actor,
        case when v_task.task_type = 'review' then 'mkt_review_task_auto_completed' else 'mkt_content_task_approved' end,
        jsonb_build_object('content_id', p_content_id, 'review_id', v_review.id));
    end loop;
  else
    update public.mkt_content_versions set status = case when p_action = 'revision' then 'revision_required' else 'rejected' end where id = v_version.id;
    update public.mkt_content_items
    set content_status = case when p_action = 'revision' then 'revision_required' else 'rejected' end,
        revision_count = revision_count + 1, updated_by = v_actor
    where id = p_content_id returning revision_count into v_revision_count;
    update public.mkt_tasks
    set task_status = 'doing',
        requires_leader_action = (p_action = 'reject' or v_revision_count >= 3),
        updated_by = v_actor
    where tenant_id = v_content.tenant_id and content_item_id = p_content_id
      and deleted_at is null and task_status = 'reviewing' and task_type <> 'review';
    if p_action = 'reject' or v_revision_count >= 3 then
      update public.mkt_tasks set requires_leader_action = true, updated_by = v_actor
      where tenant_id = v_content.tenant_id and content_item_id = p_content_id and deleted_at is null;
    end if;
  end if;
  if v_version.submitted_by is not null then perform public.mkt_enqueue_notification(v_content.tenant_id, v_version.submitted_by, 'mkt_content_reviewed', 'Nội dung đã được phản hồi', v_content.title, 'mkt_content_item', p_content_id, '/mkt/approvals?content=' || p_content_id::text, jsonb_build_object('action', p_action), 'mkt_content_reviewed:' || v_review.id::text); end if;
  perform public.mkt_record_audit(v_content.tenant_id, v_actor, 'mkt_content_reviewed', 'mkt_content_item', p_content_id, null, jsonb_build_object('action', p_action, 'comment', p_comment, 'review_id', v_review.id, 'version_id', v_version.id));
  return jsonb_build_object('success', true, 'review', to_jsonb(v_review));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Atomic Telegram update/link consumption and atomic outbox claiming.
-- -----------------------------------------------------------------------------
create table if not exists public.mkt_telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text not null default 'received'
);
alter table public.mkt_telegram_updates enable row level security;
revoke all on public.mkt_telegram_updates from public, anon, authenticated;

alter table public.mkt_outbox_events drop constraint if exists mkt_outbox_events_status_check;
alter table public.mkt_outbox_events add constraint mkt_outbox_events_status_check
  check (status in ('pending', 'processing', 'sent', 'failed'));
alter table public.mkt_outbox_events add column if not exists locked_at timestamptz;
alter table public.mkt_outbox_events add column if not exists locked_by uuid;

create or replace function public.mkt_create_telegram_link_token(p_token_hash text, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_token_hash, '')), '') is null or p_expires_at <= now() then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();
  update public.mkt_telegram_link_tokens set used_at = now()
  where tenant_id = v_tenant and user_id = v_actor and used_at is null;
  insert into public.mkt_telegram_link_tokens (tenant_id, user_id, token_hash, expires_at)
  values (v_tenant, v_actor, p_token_hash, p_expires_at) returning id into v_id;
  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_telegram_link_token_created', 'mkt_telegram_account', v_actor, null, jsonb_build_object('token_id', v_id));
  return jsonb_build_object('success', true, 'tokenId', v_id);
end;
$$;

create or replace function public.mkt_consume_telegram_link_token(
  p_update_id bigint, p_token_hash text, p_telegram_user_id text, p_chat_id text, p_username text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token record;
begin
  if p_update_id is null or nullif(p_token_hash, '') is null or nullif(p_telegram_user_id, '') is null or nullif(p_chat_id, '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  insert into public.mkt_telegram_updates(update_id) values (p_update_id)
  on conflict (update_id) do nothing;
  if not found then return jsonb_build_object('success', true, 'duplicate', true, 'linked', false); end if;
  select * into v_token from public.mkt_telegram_link_tokens
  where token_hash = p_token_hash and used_at is null and expires_at > now() for update;
  if not found then
    update public.mkt_telegram_updates set processed_at = now(), result = 'invalid_token' where update_id = p_update_id;
    return jsonb_build_object('success', true, 'linked', false);
  end if;
  update public.mkt_telegram_link_tokens set used_at = now() where id = v_token.id and used_at is null;
  if not found then
    update public.mkt_telegram_updates set processed_at = now(), result = 'token_already_used' where update_id = p_update_id;
    return jsonb_build_object('success', true, 'linked', false);
  end if;
  insert into public.mkt_telegram_accounts(tenant_id, user_id, telegram_user_id, chat_id, username, status, linked_at)
  values(v_token.tenant_id, v_token.user_id, p_telegram_user_id, p_chat_id, p_username, 'linked', now())
  on conflict (tenant_id, user_id) do update set telegram_user_id = excluded.telegram_user_id,
    chat_id = excluded.chat_id, username = excluded.username, status = 'linked', linked_at = now();
  update public.mkt_telegram_updates set processed_at = now(), result = 'linked' where update_id = p_update_id;
  perform public.mkt_record_audit(v_token.tenant_id, v_token.user_id, 'mkt_telegram_linked', 'mkt_telegram_account', v_token.user_id, null, jsonb_build_object('update_id', p_update_id));
  return jsonb_build_object('success', true, 'linked', true, 'userId', v_token.user_id, 'tenantId', v_token.tenant_id);
end;
$$;

create or replace function public.mkt_unlink_telegram()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_tenant uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();
  update public.mkt_telegram_accounts set status = 'disabled', updated_at = now()
  where tenant_id = v_tenant and user_id = v_actor and status <> 'disabled';
  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_telegram_unlinked', 'mkt_telegram_account', v_actor, null, null);
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.mkt_claim_outbox_events(p_limit integer, p_worker_id uuid)
returns setof public.mkt_outbox_events
language sql security definer set search_path = public as $$
  with candidates as (
    select e.id from public.mkt_outbox_events e
    where (
      (e.status = 'pending' and e.next_attempt_at <= now())
      or (e.status = 'processing' and e.locked_at < now() - interval '15 minutes')
    )
      and e.channels @> array['telegram']::text[]
    order by e.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  )
  update public.mkt_outbox_events e
  set status = 'processing', locked_at = now(), locked_by = p_worker_id
  from candidates c where e.id = c.id
  returning e.*;
$$;

-- -----------------------------------------------------------------------------
-- 6. Audited team ping and media status.
-- -----------------------------------------------------------------------------
create or replace function public.mkt_ping_team_member(p_user_id uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_message text; v_key text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_team') or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.tenant_id = v_tenant and coalesce(p.is_active, true)) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  v_message := coalesce(nullif(trim(p_message), ''), 'Leader nhắc bạn cập nhật tiến độ công việc MKT.');
  v_key := 'mkt_team_ping:' || p_user_id::text || ':' || to_char(now(), 'YYYY-MM-DD');
  if not exists (select 1 from public.mkt_outbox_events where dedupe_key = v_key) then
    perform public.mkt_enqueue_notification(v_tenant, p_user_id, 'mkt_team_ping', 'Nhắc việc từ Leader', v_message, 'mkt_task', null, '/mkt/tasks', '{}'::jsonb, v_key);
  end if;
  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_team_pinged', 'mkt_team_member', p_user_id, null, jsonb_build_object('message', v_message));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.mkt_media_set_status(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_tenant uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_status not in ('available', 'used') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();
  update public.mkt_media_assets set status = p_status, updated_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_media_status_changed', 'mkt_media_asset', p_id, null, jsonb_build_object('status', p_status));
  return jsonb_build_object('success', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Grants. Internal helpers and service-role RPCs are not callable by users.
-- -----------------------------------------------------------------------------
revoke all on function public.mkt_create_telegram_link_token(text, timestamptz) from public, anon;
revoke all on function public.mkt_unlink_telegram() from public, anon;
revoke all on function public.mkt_ping_team_member(uuid, text) from public, anon;
grant execute on function public.mkt_create_telegram_link_token(text, timestamptz) to authenticated;
grant execute on function public.mkt_unlink_telegram() to authenticated;
grant execute on function public.mkt_ping_team_member(uuid, text) to authenticated;

revoke all on function public.mkt_consume_telegram_link_token(bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mkt_claim_outbox_events(integer, uuid) from public, anon, authenticated;
grant execute on function public.mkt_consume_telegram_link_token(bigint, text, text, text, text) to service_role;
grant execute on function public.mkt_claim_outbox_events(integer, uuid) to service_role;

-- mkt_review_content bị DROP + CREATE lại ở trên → cấp lại quyền như 00168
revoke all on function public.mkt_review_content(uuid, uuid, text, text) from public, anon;
grant execute on function public.mkt_review_content(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
