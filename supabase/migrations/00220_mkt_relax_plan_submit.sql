-- ============================================================
-- 00220 — NỚI 1 (triết lý "Cho làm — Ghi lại — Nhắc"): Nộp kế hoạch dễ thở.
--
-- CEO 21/07: "đang thấy gò bó chặn khá nhiều gây khó dùng; cần thì log lại
-- để theo dõi thôi". Đội nhỏ, tin nhau → bớt rào cứng lúc LẬP kế hoạch.
--
-- Trước: mọi công đoạn BẮT BUỘC có "người làm" + "hạn" mới nộp được kế hoạch.
-- Nay: chỉ cần công đoạn CÓ TÊN. "Người làm" và "hạn" thành TUỲ CHỌN — điền
-- sau cũng được (giao người ở cột "Việc chưa giao", chỉnh hạn ở thẻ việc).
-- Vẫn giữ: ≥1 công đoạn có tên, người làm (NẾU điền) phải hợp lệ, chống phụ
-- thuộc vòng lặp.
--
-- Kèm: mkt_generate_tasks_from_plan_internal chịu được việc CHƯA GIAO —
-- assignee null thì tạo việc "chưa giao" (không nhồi ''::uuid) và KHÔNG bắn
-- thông báo cho người rỗng. Chép NGUYÊN VĂN 00199 (submit) + 00218 (generate),
-- chỉ bỏ 2 rào + để null an toàn.
-- ============================================================

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
    -- NỚI 1 (00220): "người làm" + "hạn" KHÔNG còn bắt buộc lúc nộp — điền sau
    -- được (giao ở cột "Việc chưa giao", chỉnh hạn ở thẻ việc). Bỏ 2 rào cũ
    -- ('chưa có người làm' / 'chưa có hạn').
    -- BỎ (00193): không ép gắn nội dung ở công đoạn duyệt/đăng nữa. Lúc lập kế
    -- hoạch nội dung thường chưa tồn tại; rào an toàn đã chuyển sang mkt_start_task
    -- (chỉ siết khi CÓ gắn nội dung).
    -- Người làm NẾU có điền thì vẫn phải hợp lệ (đúng tenant + đang hoạt động).
    if v_item.suggested_assignee_id is not null and not exists (select 1 from public.profiles p where p.id = v_item.suggested_assignee_id and p.tenant_id = v_plan.tenant_id and coalesce(p.is_active, true)) then
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

  -- 00196: snapshot có thêm chiến lược + KPI — Leader duyệt phiên bản nào là
  -- chốt trọn bức tranh phiên bản đó (chỉ THÊM key mới, không đổi key cũ).
  -- 00199: thêm 'stages' — chốt luôn các kế hoạch phụ theo phiên bản.
  v_snapshot := jsonb_build_object(
    'header', jsonb_build_object(
      'objective', v_plan.objective, 'keyMessage', v_plan.key_message,
      'mandatoryDeliverables', v_plan.mandatory_deliverables, 'riskNotes', v_plan.risk_notes, 'deadline', v_plan.deadline,
      'strategySummary', v_plan.strategy_summary, 'budgetPlanned', v_plan.budget_planned
    ),
    'kpis', coalesce((select jsonb_agg(to_jsonb(k) order by k.sort_order, k.created_at) from public.mkt_plan_kpis k where k.plan_id = p_plan_id and k.deleted_at is null), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order, s.created_at) from public.mkt_channel_plan_stages s where s.plan_id = p_plan_id), '[]'::jsonb),
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
  v_cmap jsonb := '{}'::jsonb;
  v_cid uuid;
  v_type text;
  v_wp_channel text;
  v_auto_content integer := 0;
  v_pillar uuid;  -- 00218: trụ mặc định cho bài tự sinh
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

  -- Lượt 1b (00217/00218): chuẩn bị BÀI cho từng công đoạn — gắn trụ mặc định.
  select channel_type into v_wp_channel from public.mkt_channel_work_packages where id = v_plan.work_package_id;
  select id into v_pillar from public.mkt_content_pillars
  where tenant_id = v_plan.tenant_id and is_active and deleted_at is null
  order by created_at asc limit 1;
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    if v_item_id is null then continue; end if;
    v_cid := nullif(v_it ->> 'content_item_id', '')::uuid;
    v_type := coalesce(nullif(v_it ->> 'task_type', ''), 'idea');
    -- Chỉ tự tạo bài khi có trụ để gắn (không có trụ → giữ việc thường).
    if v_cid is null and v_type in ('idea', 'shooting', 'editing') and v_pillar is not null then
      insert into public.mkt_content_items (tenant_id, campaign_id, work_package_id, title, channel_type, pillar_id)
      values (v_plan.tenant_id, v_plan.campaign_id, v_plan.work_package_id, v_it ->> 'title', v_wp_channel, v_pillar)
      returning id into v_cid;
      v_auto_content := v_auto_content + 1;
    end if;
    if v_cid is not null then
      v_cmap := jsonb_set(v_cmap, array[v_item_id], to_jsonb(v_cid::text), true);
    end if;
  end loop;

  -- Lượt 2: tạo việc — CHƯA nối phụ thuộc (nối ở lượt 3, xem đầu file)
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    v_task_id := (v_map ->> v_item_id)::uuid;
    v_dep_item := nullif(v_it ->> 'depends_on_item_id', '');
    v_dep_task := case when v_dep_item is not null then nullif(v_map ->> v_dep_item, '')::uuid else null end;
    v_type := coalesce(nullif(v_it ->> 'task_type', ''), 'idea');
    v_cid := coalesce(
      nullif(v_cmap ->> v_item_id, '')::uuid,
      case when v_type in ('publish', 'review') and v_dep_item is not null
        then nullif(v_cmap ->> v_dep_item, '')::uuid end
    );

    insert into public.mkt_tasks (
      id, tenant_id, campaign_id, work_package_id, content_item_id, title, description,
      source_type, source_id, task_type, assignee_id, reviewer_id, dependency_task_id,
      workload_points, acceptance_status, task_status, blocked_reason, due_at,
      channel_plan_id, channel_plan_version_id, channel_plan_item_id, created_by, updated_by
    ) values (
      v_task_id, v_plan.tenant_id, v_plan.campaign_id, v_plan.work_package_id,
      v_cid, v_it ->> 'title', nullif(v_it ->> 'description', ''),
      'campaign_channel_split', v_plan.work_package_id,
      coalesce(nullif(v_it ->> 'task_type', ''), 'idea'),
      -- NỚI 1 (00220): việc CHƯA GIAO → assignee null (nullif tránh ''::uuid nổ).
      nullif(v_it ->> 'suggested_assignee_id', '')::uuid, nullif(v_it ->> 'reviewer_id', '')::uuid,
      null,
      greatest(1, coalesce(nullif(v_it ->> 'workload_points', '')::integer, 1)),
      'pending',
      case when v_dep_task is null then 'todo' else 'blocked' end,
      case when v_dep_task is null then null else 'DEPENDENCY_BLOCKED' end,
      nullif(v_it ->> 'due_at', '')::timestamptz,
      v_plan.id, v_version_id, v_item_id::uuid, p_actor, p_actor
    );

    -- NỚI 1 (00220): chưa giao thì KHÔNG bắn thông báo cho người rỗng (báo khi
    -- được "Giao người" ở cột Việc chưa giao — mkt_reassign_task tự báo).
    if nullif(v_it ->> 'suggested_assignee_id', '') is not null then
      perform public.mkt_enqueue_notification(
        v_plan.tenant_id, (v_it ->> 'suggested_assignee_id')::uuid, 'mkt_task_assigned',
        'Task MKT mới', v_it ->> 'title', 'mkt_task', v_task_id,
        '/mkt/tasks?task=' || v_task_id::text, '{}'::jsonb, 'mkt_task_assigned:' || v_task_id::text
      );
    end if;
    v_count := v_count + 1;
  end loop;

  -- Lượt 3: nối phụ thuộc — giờ mọi việc đã tồn tại nên khoá ngoại luôn thoả.
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
  perform public.mkt_record_audit(v_plan.tenant_id, p_actor, 'mkt_tasks_generated_from_plan', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('task_count', v_count, 'version_id', v_version_id, 'auto_content_count', v_auto_content));
  return v_count;
end;
$$;
revoke all on function public.mkt_generate_tasks_from_plan_internal(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
