-- ============================================================
-- 00175: Vá lỗi chia việc — "function uuid_generate_v4() does not exist"
-- Phát hiện qua UAT Chrome 11/07 (lần chia việc THẬT đầu tiên trên prod).
--
-- Nguyên nhân: trên Supabase, extension uuid-ossp nằm ở schema `extensions`.
-- Hàm SECURITY DEFINER với `set search_path = public` không nhìn thấy
-- uuid_generate_v4() lúc CHẠY (khác với DEFAULT cột — đã resolve sẵn lúc DDL).
-- Fix: dùng gen_random_uuid() — hàm built-in pg_catalog, luôn resolve được.
-- ============================================================

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
      v_task_id := gen_random_uuid();
      v_generated_ids := jsonb_set(v_generated_ids, array[v_key], to_jsonb(v_task_id::text), true);
    end if;
  end loop;

  for v_task in select * from jsonb_array_elements(p_tasks) loop
    v_key := nullif(v_task->>'key', '');
    v_dep_key := nullif(v_task->>'dependencyKey', '');
    v_task_id := coalesce(nullif(v_generated_ids->>coalesce(v_key, ''), '')::uuid, gen_random_uuid());
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

revoke all on function public.mkt_split_work_package(uuid, jsonb, text) from public, anon;
grant execute on function public.mkt_split_work_package(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
