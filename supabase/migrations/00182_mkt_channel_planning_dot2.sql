-- ============================================================
-- 00182: Bottom-Up Channel Planning — RPC Đợt 2 (Nộp + Duyệt + Sinh task)
--
-- mkt_submit_plan: Owner nộp — validate + tạo version snapshot bất biến +
--   optimistic lock; notify Leader (người đã giao).
-- mkt_review_plan: Leader duyệt/yêu cầu sửa/từ chối; APPROVE tự sinh task.
-- mkt_generate_tasks_from_plan_internal: sinh task từ snapshot đã duyệt
--   (sao logic 2-pass của mkt_split_work_package), giữ traceability.
-- ============================================================

-- ── Sinh task (internal — chỉ RPC nội bộ gọi) ────────────────────
create or replace function public.mkt_generate_tasks_from_plan_internal(p_plan_id uuid, p_actor uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_plan record;
  v_version_id uuid;
  v_items jsonb;
  v_it jsonb;
  v_item_id text;
  v_task_id uuid;
  v_map jsonb := '{}'::jsonb;
  v_dep_item text;
  v_dep_task uuid;
  v_count integer := 0;
begin
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_plan.status <> 'approved' then raise exception 'ALREADY_PROCESSED' using errcode = 'P0001'; end if;
  v_version_id := v_plan.current_version_id;

  select snapshot -> 'items' into v_items from public.mkt_channel_plan_versions where id = v_version_id;
  if v_items is null or jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- Pass 1: map plan_item_id → task uuid (để nối dependency trong cùng lô)
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    if v_item_id is not null then
      v_map := jsonb_set(v_map, array[v_item_id], to_jsonb(gen_random_uuid()::text), true);
    end if;
  end loop;

  -- Pass 2: sinh task thật
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    v_task_id := (v_map ->> v_item_id)::uuid;
    v_dep_item := nullif(v_it ->> 'depends_on_item_id', '');
    v_dep_task := case when v_dep_item is not null then nullif(v_map ->> v_dep_item, '')::uuid else null end;

    insert into public.mkt_tasks (
      id, tenant_id, campaign_id, work_package_id, content_item_id, title, description,
      source_type, source_id, task_type, assignee_id, reviewer_id, dependency_task_id,
      workload_points, acceptance_status, task_status, blocked_reason, due_at,
      channel_plan_id, channel_plan_version_id, channel_plan_item_id, created_by, updated_by
    ) values (
      v_task_id, v_plan.tenant_id, v_plan.campaign_id, v_plan.work_package_id,
      nullif(v_it ->> 'content_item_id', '')::uuid, v_it ->> 'title', nullif(v_it ->> 'description', ''),
      'campaign_channel_split', v_plan.work_package_id,
      coalesce(nullif(v_it ->> 'task_type', ''), 'idea'),
      (v_it ->> 'suggested_assignee_id')::uuid, nullif(v_it ->> 'reviewer_id', '')::uuid, v_dep_task,
      coalesce(nullif(v_it ->> 'workload_points', '')::integer, 1),
      'pending',
      case when v_dep_task is null then 'todo' else 'blocked' end,
      case when v_dep_task is null then null else 'DEPENDENCY_BLOCKED' end,
      nullif(v_it ->> 'due_at', '')::timestamptz,
      v_plan.id, v_version_id, v_item_id::uuid, p_actor, p_actor
    );

    perform public.mkt_enqueue_notification(
      v_plan.tenant_id, (v_it ->> 'suggested_assignee_id')::uuid, 'mkt_task_assigned',
      'Task MKT mới', v_it ->> 'title', 'mkt_task', v_task_id,
      '/mkt/tasks?task=' || v_task_id::text, '{}'::jsonb, 'mkt_task_assigned:' || v_task_id::text
    );
    v_count := v_count + 1;
  end loop;

  update public.mkt_channel_work_packages set status = 'split_completed', updated_by = p_actor where id = v_plan.work_package_id;
  update public.mkt_channel_plans set status = 'in_execution', generated_at = now(), updated_by = p_actor where id = p_plan_id;
  perform public.mkt_record_audit(v_plan.tenant_id, p_actor, 'mkt_tasks_generated_from_plan', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('task_count', v_count, 'version_id', v_version_id));
  return v_count;
end;
$$;
revoke all on function public.mkt_generate_tasks_from_plan_internal(uuid, uuid) from public, anon, authenticated;

-- ── Nộp kế hoạch (Owner) ─────────────────────────────────────────
create or replace function public.mkt_submit_plan(p_plan_id uuid, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_item record;
  v_count integer := 0;
  v_cur uuid;
  v_steps integer;
  v_snapshot jsonb;
  v_version_id uuid;
  v_wp_title text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status not in ('planning', 'revision_required') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_expected_version is not null and p_expected_version <> v_plan.version_number then raise exception 'PLAN_VERSION_CONFLICT' using errcode = 'P0001'; end if;

  select count(*) into v_count from public.mkt_channel_plan_items where plan_id = p_plan_id;
  if v_count = 0 then raise exception 'PLAN_VALIDATION_FAILED: cần ít nhất 1 công đoạn' using errcode = 'P0001'; end if;

  for v_item in select * from public.mkt_channel_plan_items where plan_id = p_plan_id loop
    if nullif(trim(coalesce(v_item.title, '')), '') is null then raise exception 'PLAN_VALIDATION_FAILED: có công đoạn chưa đặt tên' using errcode = 'P0001'; end if;
    if v_item.suggested_assignee_id is null then raise exception 'PLAN_VALIDATION_FAILED: công đoạn "%" chưa có người làm', v_item.title using errcode = 'P0001'; end if;
    if v_item.due_at is null then raise exception 'PLAN_VALIDATION_FAILED: công đoạn "%" chưa có hạn', v_item.title using errcode = 'P0001'; end if;
    if v_item.task_type in ('review', 'publish') and v_item.content_item_id is null then
      raise exception 'PLAN_VALIDATION_FAILED: công đoạn "%" (duyệt/đăng) cần gắn nội dung', v_item.title using errcode = 'P0001'; end if;
    if not exists (select 1 from public.profiles p where p.id = v_item.suggested_assignee_id and p.tenant_id = v_plan.tenant_id and coalesce(p.is_active, true)) then
      raise exception 'PLAN_VALIDATION_FAILED: người làm của công đoạn "%" không hợp lệ', v_item.title using errcode = 'P0001'; end if;
    -- Chống phụ thuộc vòng lặp / tự phụ thuộc
    if v_item.depends_on_item_id is not null then
      v_cur := v_item.depends_on_item_id;
      v_steps := 0;
      while v_cur is not null loop
        if v_cur = v_item.id then raise exception 'PLAN_VALIDATION_FAILED: phụ thuộc vòng lặp ở "%"', v_item.title using errcode = 'P0001'; end if;
        v_steps := v_steps + 1;
        if v_steps > v_count then raise exception 'PLAN_VALIDATION_FAILED: phụ thuộc vòng lặp' using errcode = 'P0001'; end if;
        select depends_on_item_id into v_cur from public.mkt_channel_plan_items where id = v_cur and plan_id = p_plan_id;
      end loop;
    end if;
  end loop;

  v_snapshot := jsonb_build_object(
    'header', jsonb_build_object(
      'objective', v_plan.objective, 'keyMessage', v_plan.key_message,
      'mandatoryDeliverables', v_plan.mandatory_deliverables, 'riskNotes', v_plan.risk_notes, 'deadline', v_plan.deadline
    ),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sequence, i.created_at) from public.mkt_channel_plan_items i where i.plan_id = p_plan_id), '[]'::jsonb)
  );

  insert into public.mkt_channel_plan_versions (tenant_id, plan_id, version_number, snapshot, status, submitted_by, submitted_at)
  values (v_plan.tenant_id, p_plan_id, v_plan.version_number, v_snapshot, 'submitted', v_actor, now())
  on conflict (plan_id, version_number) do update set snapshot = excluded.snapshot, status = 'submitted', submitted_by = v_actor, submitted_at = now()
  returning id into v_version_id;

  update public.mkt_channel_plans set status = 'submitted', submitted_at = now(), submitted_by = v_actor, current_version_id = v_version_id, updated_by = v_actor where id = p_plan_id;

  select title into v_wp_title from public.mkt_channel_work_packages where id = v_plan.work_package_id;
  if v_plan.created_by is not null then
    perform public.mkt_enqueue_notification(
      v_plan.tenant_id, v_plan.created_by, 'mkt_plan_submitted', 'Kế hoạch kênh chờ bạn duyệt', coalesce(v_wp_title, 'Gói việc'),
      'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb, 'mkt_plan_submitted:' || v_version_id::text
    );
  end if;
  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_submitted', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('version_id', v_version_id, 'item_count', v_count));
  return jsonb_build_object('success', true, 'versionId', v_version_id, 'versionNumber', v_plan.version_number);
end;
$$;
revoke all on function public.mkt_submit_plan(uuid, integer) from public, anon;
grant execute on function public.mkt_submit_plan(uuid, integer) to authenticated;

-- ── Duyệt kế hoạch (Leader) ──────────────────────────────────────
create or replace function public.mkt_review_plan(p_plan_id uuid, p_version_id uuid, p_action text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_task_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_action not in ('approve', 'request_revision', 'reject') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_action in ('request_revision', 'reject') and nullif(trim(coalesce(p_comment, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;

  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_plan.status <> 'submitted' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if v_plan.current_version_id is distinct from p_version_id then raise exception 'PLAN_VERSION_CONFLICT' using errcode = 'P0001'; end if;

  insert into public.mkt_channel_plan_reviews (tenant_id, plan_id, plan_version_id, reviewer_id, action, comment)
  values (v_plan.tenant_id, p_plan_id, p_version_id, v_actor, p_action, nullif(trim(coalesce(p_comment, '')), ''));

  update public.mkt_channel_plan_versions
  set status = case p_action when 'approve' then 'approved' when 'request_revision' then 'revision_required' else 'rejected' end,
      reviewed_by = v_actor, reviewed_at = now(), review_action = p_action, review_comment = nullif(trim(coalesce(p_comment, '')), '')
  where id = p_version_id;

  if p_action = 'approve' then
    update public.mkt_channel_plans set status = 'approved', approved_by = v_actor, approved_at = now(), updated_by = v_actor where id = p_plan_id;
    v_task_count := public.mkt_generate_tasks_from_plan_internal(p_plan_id, v_actor);
    perform public.mkt_enqueue_notification(v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_approved', 'Kế hoạch được duyệt — đã sinh việc', 'Kế hoạch kênh', 'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb, 'mkt_plan_approved:' || p_version_id::text);
  elsif p_action = 'request_revision' then
    update public.mkt_channel_plans set status = 'revision_required', version_number = v_plan.version_number + 1, revision_count = v_plan.revision_count + 1, updated_by = v_actor where id = p_plan_id;
    perform public.mkt_enqueue_notification(v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_revision', 'Kế hoạch cần sửa', p_comment, 'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb, 'mkt_plan_revision:' || p_version_id::text);
  else
    -- reject: huỷ + mở lại gói việc để Leader chọn hướng khác
    update public.mkt_channel_plans set status = 'canceled', deleted_at = now(), updated_by = v_actor where id = p_plan_id;
    update public.mkt_channel_work_packages set status = 'needs_split', updated_by = v_actor where id = v_plan.work_package_id;
    perform public.mkt_enqueue_notification(v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_rejected', 'Kế hoạch bị từ chối', p_comment, 'mkt_channel_plan', p_plan_id, '/mkt/planning', '{}'::jsonb, 'mkt_plan_rejected:' || p_version_id::text);
  end if;

  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_' || p_action, 'mkt_channel_plan', p_plan_id, to_jsonb(v_plan), jsonb_build_object('action', p_action, 'comment', p_comment, 'task_count', v_task_count));
  return jsonb_build_object('success', true, 'action', p_action, 'taskCount', v_task_count);
end;
$$;
revoke all on function public.mkt_review_plan(uuid, uuid, text, text) from public, anon;
grant execute on function public.mkt_review_plan(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
