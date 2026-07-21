-- ============================================================
-- 00218: Bài TỰ SINH (00217) phải gắn Trụ nội dung — nếu không, trigger
--        mkt_require_content_pillar_on_insert (00189) đá MISSING_PILLAR và
--        DUYỆT KẾ HOẠCH CHẾT.
--
-- UAT 00217 (21/07): duyệt kế hoạch mới → INVALID_STATE: MISSING_PILLAR. Vì
-- Hub bắt "Bài mới phải phân loại theo một Trụ đang hoạt động" (00189), mà
-- 00217 tạo Bài không trụ. (00217 chạy sạch trên prod vì backfill chỉ đụng
-- việc CHƯA xong — không tenant nào có việc dở nên chưa insert bài nào.)
--
-- Cách vá đúng tinh thần Hub: Bài tự sinh mang TRỤ MẶC ĐỊNH = trụ đang hoạt
-- động đầu tiên của tenant (đội đổi lại sau — trigger cho phép UPDATE trụ,
-- như "bài cũ sửa dần"). Tenant CHƯA có trụ nào → BỎ QUA tạo bài cho công
-- đoạn đó (giữ việc thường, không chặn duyệt) — degrade êm.
--
-- Chép NGUYÊN VĂN 00217, chỉ THÊM: tra trụ mặc định + điều kiện v_pillar +
-- cột pillar_id khi insert (generate + backfill). Cùng chữ ký → replace.
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

-- ── Backfill lại (00218): việc chưa kết thúc thiếu bài + có trụ → tạo bài có trụ ──
do $$
declare
  r record;
  v_cid uuid;
  v_pillar uuid;
  v_made integer := 0;
  v_inherited integer := 0;
begin
  for r in
    select t.id, t.tenant_id, t.campaign_id, t.work_package_id, t.title
    from public.mkt_tasks t
    where t.deleted_at is null
      and t.content_item_id is null
      and t.task_type in ('idea', 'shooting', 'editing')
      and t.task_status not in ('done', 'canceled')
  loop
    select id into v_pillar from public.mkt_content_pillars
    where tenant_id = r.tenant_id and is_active and deleted_at is null
    order by created_at asc limit 1;
    if v_pillar is null then continue; end if; -- không có trụ → bỏ qua, không chặn
    insert into public.mkt_content_items (tenant_id, campaign_id, work_package_id, title, pillar_id)
    values (r.tenant_id, r.campaign_id, r.work_package_id, r.title, v_pillar)
    returning id into v_cid;
    update public.mkt_tasks set content_item_id = v_cid where id = r.id;
    v_made := v_made + 1;
  end loop;

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

  raise notice '00218 backfill: tạo % bài (có trụ) cho việc sản xuất, % việc đăng/duyệt thừa hưởng.', v_made, v_inherited;
end $$;

notify pgrst, 'reload schema';
