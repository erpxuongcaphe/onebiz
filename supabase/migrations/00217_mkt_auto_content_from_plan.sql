-- ============================================================
-- 00217: Kế hoạch duyệt xong → công đoạn sản xuất TỰ SINH "Bài" (content item)
--        gắn vào việc — nối trọn luồng Nội dung của Hub.
--
-- CEO 21/07: Dương làm "Bài 1/2/3" nhưng không có chỗ nhập link bài; người
-- duyệt không xem được bài. Chẩn đoán: 00193/00194 đã gỡ (đúng) luật "phải
-- gắn bài TRƯỚC khi lập kế hoạch" nhưng chưa đóng vòng ở đầu kia — lúc duyệt
-- kế hoạch không ai TẠO bài, nên việc idea trần trụi, đứng ngoài đường ray
-- Nội dung sẵn có (nộp bản+link → duyệt → việc tự xong/quay về → gate đăng).
--
-- Nguyên lý: sinh việc từ kế hoạch (mkt_generate_tasks_from_plan_internal):
--   • idea/shooting/editing CHƯA gắn bài → tự tạo mkt_content_items (nháp,
--     tiêu đề = tên công đoạn, thuộc campaign + work package, trụ gắn sau).
--   • publish/review CHƯA gắn bài → THỪA HƯỞNG bài của công đoạn phụ thuộc
--     (đăng đúng bài mình chờ); không phụ thuộc → giữ là việc thường.
--   • Đã gắn tay qua picker → tôn trọng, không đụng.
--
-- Chép NGUYÊN VĂN 00195 (3 lượt + nối phụ thuộc lượt 3), cùng chữ ký →
-- create or replace, không 42P13. Diff chứng minh chỉ THÊM.
-- Cuối file: backfill việc CHƯA kết thúc đang thiếu bài (không dựng việc đã xong).
-- ============================================================

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
  -- 00217: map plan_item_id → content_item_id (gắn tay HOẶC tự sinh)
  v_cmap jsonb := '{}'::jsonb;
  v_cid uuid;
  v_type text;
  v_wp_channel text;
  v_auto_content integer := 0;
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

  -- Lượt 1b (00217): chuẩn bị BÀI cho từng công đoạn.
  --   • Gắn tay → ghi vào map (để publish/review thừa hưởng được).
  --   • idea/shooting/editing chưa gắn → TỰ TẠO bài nháp.
  select channel_type into v_wp_channel from public.mkt_channel_work_packages where id = v_plan.work_package_id;
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    if v_item_id is null then continue; end if;
    v_cid := nullif(v_it ->> 'content_item_id', '')::uuid;
    v_type := coalesce(nullif(v_it ->> 'task_type', ''), 'idea');
    if v_cid is null and v_type in ('idea', 'shooting', 'editing') then
      insert into public.mkt_content_items (tenant_id, campaign_id, work_package_id, title, channel_type)
      values (v_plan.tenant_id, v_plan.campaign_id, v_plan.work_package_id, v_it ->> 'title', v_wp_channel)
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
    -- 00217: bài của việc = gắn tay/tự sinh; publish/review thừa hưởng bài
    -- của công đoạn phụ thuộc khi chính nó chưa có.
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
  perform public.mkt_record_audit(v_plan.tenant_id, p_actor, 'mkt_tasks_generated_from_plan', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('task_count', v_count, 'version_id', v_version_id, 'auto_content_count', v_auto_content));
  return v_count;
end;
$$;

-- ── Backfill: việc CHƯA kết thúc đang thiếu bài (không dựng việc đã xong) ──
do $$
declare
  r record;
  v_cid uuid;
  v_made integer := 0;
  v_inherited integer := 0;
begin
  -- 1) idea/shooting/editing thiếu bài → tạo bài nháp cùng tên, gắn vào việc.
  for r in
    select t.id, t.tenant_id, t.campaign_id, t.work_package_id, t.title
    from public.mkt_tasks t
    where t.deleted_at is null
      and t.content_item_id is null
      and t.task_type in ('idea', 'shooting', 'editing')
      and t.task_status not in ('done', 'canceled')
  loop
    insert into public.mkt_content_items (tenant_id, campaign_id, work_package_id, title)
    values (r.tenant_id, r.campaign_id, r.work_package_id, r.title)
    returning id into v_cid;
    update public.mkt_tasks set content_item_id = v_cid where id = r.id;
    v_made := v_made + 1;
  end loop;

  -- 2) publish/review thiếu bài → thừa hưởng bài của việc nó phụ thuộc.
  with fixed as (
    update public.mkt_tasks p
    set content_item_id = d.content_item_id
    from public.mkt_tasks d
    where p.dependency_task_id = d.id
      and p.deleted_at is null
      and p.content_item_id is null
      and p.task_type in ('publish', 'review')
      and p.task_status not in ('done', 'canceled')
      and d.content_item_id is not null
    returning 1
  ) select count(*) into v_inherited from fixed;

  raise notice '00217 backfill: tạo % bài cho việc sản xuất, % việc đăng/duyệt thừa hưởng bài.', v_made, v_inherited;
end $$;

notify pgrst, 'reload schema';
