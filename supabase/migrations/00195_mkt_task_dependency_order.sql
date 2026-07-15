-- ============================================================
-- 00195: Nối phụ thuộc SAU khi đã tạo đủ việc (né lỗi khoá ngoại)
--
-- BỐI CẢNH — tìm ra khi rà lại toàn luồng sau 00194 (CEO: "hãy chắc chắn
-- không còn chỗ nào bug trong luồng").
--
-- LỖI: lệnh sinh việc chạy từ trên xuống theo thứ tự công đoạn và nối phụ
-- thuộc NGAY lúc tạo. Nếu công đoạn 1 phụ thuộc công đoạn 2 (chọn "Sau: <công
-- đoạn nằm dưới>" — giao diện CHO PHÉP chọn), thì lúc tạo việc 1, việc 2 chưa
-- tồn tại → khoá ngoại dependency_task_id đá ra:
--   insert or update on table "mkt_tasks" violates foreign key constraint
--   "mkt_tasks_dependency_task_id_fkey"
-- ⇒ bấm "Duyệt & sinh việc" chết, đúng kiểu lỗi tiếng Anh khó hiểu như
--   mkt_tasks_check ở 00194.
--
-- Vì sao rào cũ KHÔNG bắt được: mkt_submit_plan chỉ soi phụ thuộc VÒNG LẶP
-- (1→2→1). Ca này 1→2, 2→không — chuỗi kết thúc, không phải vòng lặp → nộp lọt,
-- chết ở bước duyệt.
--
-- CÁCH SỬA (tận gốc, không phải chặn ngọn): tách làm 2 lượt —
--   Lượt A: tạo TẤT CẢ việc với dependency_task_id = null
--            (task_status vẫn đặt 'blocked' đúng ngay từ đầu vì đã biết trước
--             công đoạn nào có phụ thuộc → người dùng không thấy khác gì)
--   Lượt B: mọi việc đã tồn tại → nối dependency_task_id, khoá ngoại luôn thoả.
-- Nhờ vậy thứ tự khai báo trên/dưới KHÔNG còn ảnh hưởng. Giao diện giữ nguyên
-- quyền chọn phụ thuộc tự do — vì giờ nó chạy đúng thật.
--
-- Kèm theo: chặn điểm khối lượng <= 0 (greatest(1, ...)). Ô nhập trên giao diện
-- không đặt giá trị nhỏ nhất → bấm mũi tên xuống về 0 là dính
-- "violates check constraint ..._workload_points_check". Giao diện đã đặt min=1;
-- đây là lớp chặn thứ hai cho ai gọi thẳng.
--
-- KHÔNG đổi: chữ ký hàm, quyền, luật nghiệp vụ, thông báo Telegram, audit.
-- ============================================================

-- ── Sinh việc từ kế hoạch đã duyệt ───────────────────────────────
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

  -- Lượt 1: map plan_item_id → task uuid (để nối phụ thuộc trong cùng lô)
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    if v_item_id is not null then
      v_map := jsonb_set(v_map, array[v_item_id], to_jsonb(gen_random_uuid()::text), true);
    end if;
  end loop;

  -- Lượt 2: tạo việc — CHƯA nối phụ thuộc (nối ở lượt 3, xem đầu file)
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
      (v_it ->> 'suggested_assignee_id')::uuid, nullif(v_it ->> 'reviewer_id', '')::uuid,
      null,
      greatest(1, coalesce(nullif(v_it ->> 'workload_points', '')::integer, 1)),
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

  -- Lượt 3: nối phụ thuộc — giờ mọi việc đã tồn tại nên khoá ngoại luôn thoả,
  -- bất kể công đoạn phụ thuộc nằm trên hay dưới trong danh sách.
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_dep_item := nullif(v_it ->> 'depends_on_item_id', '');
    if v_dep_item is not null then
      v_dep_task := nullif(v_map ->> v_dep_item, '')::uuid;
      if v_dep_task is not null then
        update public.mkt_tasks
        set dependency_task_id = v_dep_task
        where id = (v_map ->> (v_it ->> 'id'))::uuid;
      end if;
    end if;
  end loop;

  update public.mkt_channel_work_packages set status = 'split_completed', updated_by = p_actor where id = v_plan.work_package_id;
  update public.mkt_channel_plans set status = 'in_execution', generated_at = now(), updated_by = p_actor where id = p_plan_id;
  perform public.mkt_record_audit(v_plan.tenant_id, p_actor, 'mkt_tasks_generated_from_plan', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('task_count', v_count, 'version_id', v_version_id));
  return v_count;
end;
$$;
revoke all on function public.mkt_generate_tasks_from_plan_internal(uuid, uuid) from public, anon, authenticated;

-- ── Chia Task Ngay: cùng một cái gốc, vá cho khỏi tái phát ────────
-- Giao diện hiện CHƯA có ô phụ thuộc nên chưa nổ, nhưng hàm vẫn nhận
-- dependencyKey/dependencyTaskId → sửa luôn để mai này thêm ô là chạy đúng.
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
  v_link jsonb;
  v_task_id uuid;
  v_key text;
  v_dep_key text;
  v_dependency_id uuid;
  v_generated_ids jsonb := '{}'::jsonb;
  v_links jsonb := '[]'::jsonb;
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
      null,
      greatest(1, coalesce(nullif(v_task->>'workloadPoints', '')::integer, 1)),
      'pending',
      case when v_dependency_id is null then 'todo' else 'blocked' end,
      case when v_dependency_id is null then null else 'DEPENDENCY_BLOCKED' end,
      nullif(v_task->>'dueAt', '')::timestamptz,
      v_actor, v_actor
    );
    if v_dependency_id is not null then
      v_links := v_links || jsonb_build_object('task', v_task_id::text, 'dep', v_dependency_id::text);
    end if;
    v_count := v_count + 1;

    -- Báo cho người được giao biết có task mới (Assignee accountability — phải nhận việc).
    perform public.mkt_enqueue_notification(
      v_package.tenant_id, (v_task->>'assigneeId')::uuid,
      'mkt_task_assigned', 'Task MKT mới', v_task->>'title',
      'mkt_task', v_task_id, '/mkt/tasks?task=' || v_task_id::text,
      '{}'::jsonb, 'mkt_task_assigned:' || v_task_id::text
    );
  end loop;

  -- Nối phụ thuộc sau cùng — mọi việc trong lô đã tồn tại.
  for v_link in select value from jsonb_array_elements(v_links) loop
    update public.mkt_tasks
    set dependency_task_id = (v_link->>'dep')::uuid
    where id = (v_link->>'task')::uuid;
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
