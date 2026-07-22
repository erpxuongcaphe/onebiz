-- ============================================================
-- 00222 — NỚI 3 ("Cho làm — Ghi lại — Nhắc"): Sửa kế hoạch CẢ KHI ĐANG CHẠY.
--
-- CEO 21/07: "gò bó chặn nhiều gây khó; cần thì log lại để theo dõi thôi".
--
-- Trước: mkt_open_plan_change_request KHOÁ (PLAN_TASKS_IN_PROGRESS) nếu có bất
-- kỳ việc nào đã nhận/đang chạy → không mở lại kế hoạch để sửa được; mà mở lại
-- thì HUỶ SẠCH mọi việc pending.
--
-- Nay: cho mở lại kế hoạch đang chạy BẤT CỨ LÚC NÀO, KHÔNG huỷ việc ở bước mở.
-- Khi duyệt bản mới, generate ĐỐI SOÁT theo "khoá công đoạn" (channel_plan_
-- item_key — bản sao KHÔNG khoá ngoại của channel_plan_item_id, nên KHÔNG bị
-- set-null khi lưu lại kế hoạch xoá+chèn công đoạn):
--   • Công đoạn CÒN     → GIỮ việc cũ, cập nhật (đổi người/điểm chỉ khi việc
--                          CHƯA bắt đầu; đang chạy thì giữ nguyên người).
--   • Công đoạn MỚI     → TẠO việc mới.
--   • Công đoạn BỊ BỎ   → việc CHƯA bắt đầu thì HUỶ mềm; đang chạy/đã xong GIỮ.
-- Mọi thứ ghi mkt_record_audit (created/updated/canceled) → "Nhật ký thay đổi".
--
-- Đối soát lần ĐẦU (kế hoạch chưa từng có việc) = y hệt trước: mọi công đoạn là
-- "mới" → tạo hết. Nhánh TẠO giữ NGUYÊN hành vi 00220 (null-safe + auto-content).
-- ============================================================

-- ── Khoá công đoạn bền (không set-null khi lưu lại kế hoạch) ─────────
alter table public.mkt_tasks add column if not exists channel_plan_item_key uuid;
comment on column public.mkt_tasks.channel_plan_item_key is
  'Bản sao KHÔNG khoá ngoại của channel_plan_item_id — để đối soát việc khi sửa kế hoạch đang chạy (channel_plan_item_id bị set-null lúc lưu lại kế hoạch).';
-- Bơm sẵn cho việc cũ (dùng link hiện có).
update public.mkt_tasks set channel_plan_item_key = channel_plan_item_id
  where channel_plan_item_key is null and channel_plan_item_id is not null;
create index if not exists idx_mkt_tasks_plan_item_key
  on public.mkt_tasks (channel_plan_id, channel_plan_item_key) where deleted_at is null;

-- ── generate = ĐỐI SOÁT (giữ nhánh TẠO y hệt 00220) ─────────────────
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
  v_count integer := 0;          -- việc "hiện hành" sau đối soát (tạo + giữ)
  v_created integer := 0;
  v_updated integer := 0;
  v_canceled integer := 0;
  v_cmap jsonb := '{}'::jsonb;
  v_cid uuid;
  v_type text;
  v_wp_channel text;
  v_auto_content integer := 0;
  v_pillar uuid;                 -- trụ mặc định cho bài tự sinh (00218)
  v_existing record;             -- việc cũ khớp công đoạn
  v_item_ids uuid[] := '{}';     -- tập id công đoạn bản duyệt (để prune)
  v_can_reassign boolean;
  v_new_assignee uuid;
begin
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_plan.status <> 'approved' then raise exception 'ALREADY_PROCESSED' using errcode = 'P0001'; end if;
  v_version_id := v_plan.current_version_id;

  select snapshot -> 'items' into v_items from public.mkt_channel_plan_versions where id = v_version_id;
  if v_items is null or jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select channel_type into v_wp_channel from public.mkt_channel_work_packages where id = v_plan.work_package_id;
  select id into v_pillar from public.mkt_content_pillars
    where tenant_id = v_plan.tenant_id and is_active and deleted_at is null
    order by created_at asc limit 1;

  -- Lượt 1: map công đoạn → uuid việc. ĐỐI SOÁT: công đoạn đã có việc còn sống
  -- (khớp channel_plan_item_key) → DÙNG LẠI id việc đó (cập nhật); chưa có → cấp
  -- uuid mới (tạo). Đồng thời gom tập id công đoạn để prune công đoạn bị bỏ.
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    if v_item_id is null then continue; end if;
    v_item_ids := array_append(v_item_ids, v_item_id::uuid);
    select id into v_task_id from public.mkt_tasks
      where channel_plan_id = p_plan_id and channel_plan_item_key = v_item_id::uuid
        and deleted_at is null and task_status <> 'canceled'
      order by created_at asc limit 1;
    if v_task_id is null then v_task_id := gen_random_uuid(); end if;
    v_map := jsonb_set(v_map, array[v_item_id], to_jsonb(v_task_id::text), true);
  end loop;

  -- Lượt 1b: chuẩn bị BÀI cho công đoạn sản xuất. Việc cũ đã có bài → GIỮ bài
  -- cũ (không tạo đè). Việc mới/công đoạn sản xuất chưa bài + có trụ → tạo bài.
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    if v_item_id is null then continue; end if;
    v_cid := nullif(v_it ->> 'content_item_id', '')::uuid;
    if v_cid is null then
      -- việc đối soát (nếu có) đã gắn bài nào chưa?
      select content_item_id into v_cid from public.mkt_tasks where id = (v_map ->> v_item_id)::uuid;
    end if;
    v_type := coalesce(nullif(v_it ->> 'task_type', ''), 'idea');
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

  -- Lượt 2: TẠO (mới) hoặc CẬP NHẬT (đối soát). Phụ thuộc nối ở Lượt 3.
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    if v_item_id is null then continue; end if;
    v_task_id := (v_map ->> v_item_id)::uuid;
    v_dep_item := nullif(v_it ->> 'depends_on_item_id', '');
    v_dep_task := case when v_dep_item is not null then nullif(v_map ->> v_dep_item, '')::uuid else null end;
    v_type := coalesce(nullif(v_it ->> 'task_type', ''), 'idea');
    v_cid := coalesce(
      nullif(v_cmap ->> v_item_id, '')::uuid,
      case when v_type in ('publish', 'review') and v_dep_item is not null
        then nullif(v_cmap ->> v_dep_item, '')::uuid end
    );
    v_new_assignee := nullif(v_it ->> 'suggested_assignee_id', '')::uuid;

    select * into v_existing from public.mkt_tasks where id = v_task_id and deleted_at is null;
    if found then
      -- CẬP NHẬT: không nuốt việc đang chạy. Đổi người/điểm chỉ khi việc CHƯA
      -- bắt đầu (chờ nhận + todo/blocked); đang làm thì giữ người cũ.
      v_can_reassign := (v_existing.acceptance_status = 'pending' and v_existing.task_status in ('todo', 'blocked'));
      update public.mkt_tasks set
        title = v_it ->> 'title',
        description = nullif(v_it ->> 'description', ''),
        due_at = nullif(v_it ->> 'due_at', '')::timestamptz,
        reviewer_id = nullif(v_it ->> 'reviewer_id', '')::uuid,
        content_item_id = coalesce(v_cid, content_item_id),
        assignee_id = case when v_can_reassign then v_new_assignee else assignee_id end,
        workload_points = case when v_can_reassign
          then greatest(1, coalesce(nullif(v_it ->> 'workload_points', '')::integer, 1))
          else workload_points end,
        channel_plan_version_id = v_version_id,
        channel_plan_item_id = v_item_id::uuid,
        channel_plan_item_key = v_item_id::uuid,
        updated_by = p_actor
      where id = v_task_id;
      -- Việc chưa bắt đầu mà đổi sang người MỚI (khác người cũ) → báo người mới.
      if v_can_reassign and v_new_assignee is not null and v_new_assignee is distinct from v_existing.assignee_id then
        perform public.mkt_enqueue_notification(
          v_plan.tenant_id, v_new_assignee, 'mkt_task_assigned', 'Task MKT cập nhật', v_it ->> 'title',
          'mkt_task', v_task_id, '/mkt/tasks?task=' || v_task_id::text, '{}'::jsonb,
          'mkt_task_reassigned:' || v_task_id::text || ':' || v_new_assignee::text
        );
      end if;
      v_updated := v_updated + 1;
    else
      -- TẠO MỚI — GIỮ NGUYÊN hành vi 00220 (null-safe assignee + auto-content).
      insert into public.mkt_tasks (
        id, tenant_id, campaign_id, work_package_id, content_item_id, title, description,
        source_type, source_id, task_type, assignee_id, reviewer_id, dependency_task_id,
        workload_points, acceptance_status, task_status, blocked_reason, due_at,
        channel_plan_id, channel_plan_version_id, channel_plan_item_id, channel_plan_item_key, created_by, updated_by
      ) values (
        v_task_id, v_plan.tenant_id, v_plan.campaign_id, v_plan.work_package_id,
        v_cid, v_it ->> 'title', nullif(v_it ->> 'description', ''),
        'campaign_channel_split', v_plan.work_package_id,
        coalesce(nullif(v_it ->> 'task_type', ''), 'idea'),
        v_new_assignee, nullif(v_it ->> 'reviewer_id', '')::uuid,
        null,
        greatest(1, coalesce(nullif(v_it ->> 'workload_points', '')::integer, 1)),
        'pending',
        case when v_dep_task is null then 'todo' else 'blocked' end,
        case when v_dep_task is null then null else 'DEPENDENCY_BLOCKED' end,
        nullif(v_it ->> 'due_at', '')::timestamptz,
        v_plan.id, v_version_id, v_item_id::uuid, v_item_id::uuid, p_actor, p_actor
      );
      if v_new_assignee is not null then
        perform public.mkt_enqueue_notification(
          v_plan.tenant_id, v_new_assignee, 'mkt_task_assigned', 'Task MKT mới', v_it ->> 'title',
          'mkt_task', v_task_id, '/mkt/tasks?task=' || v_task_id::text, '{}'::jsonb,
          'mkt_task_assigned:' || v_task_id::text
        );
      end if;
      v_created := v_created + 1;
    end if;
    v_count := v_count + 1;
  end loop;

  -- Lượt 3: nối phụ thuộc — mọi việc đã tồn tại nên khoá ngoại thoả.
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_dep_item := nullif(v_it ->> 'depends_on_item_id', '');
    if v_dep_item is not null then
      v_dep_task := nullif(v_map ->> v_dep_item, '')::uuid;
      if v_dep_task is not null then
        update public.mkt_tasks set dependency_task_id = v_dep_task
        where id = (v_map ->> (v_it ->> 'id'))::uuid;
      end if;
    end if;
  end loop;

  -- Prune: công đoạn BỊ BỎ khỏi bản duyệt → việc còn sống mà CHƯA bắt đầu thì
  -- huỷ mềm; đang chạy/đã xong GIỮ (không nuốt việc đang làm). Chỉ đụng việc có
  -- khoá công đoạn xác định (bỏ qua việc tay/không khoá).
  update public.mkt_tasks set task_status = 'canceled', deleted_at = now(), updated_by = p_actor
  where channel_plan_id = p_plan_id and deleted_at is null and task_status <> 'canceled'
    and channel_plan_item_key is not null and not (channel_plan_item_key = any(v_item_ids))
    and acceptance_status = 'pending' and task_status in ('todo', 'blocked');
  get diagnostics v_canceled = row_count;

  update public.mkt_channel_work_packages set status = 'split_completed', updated_by = p_actor where id = v_plan.work_package_id;
  update public.mkt_channel_plans set status = 'in_execution', generated_at = now(), updated_by = p_actor where id = p_plan_id;
  perform public.mkt_record_audit(
    v_plan.tenant_id, p_actor, 'mkt_tasks_generated_from_plan', 'mkt_channel_plan', p_plan_id, null,
    jsonb_build_object('task_count', v_count, 'created', v_created, 'updated', v_updated,
      'canceled', v_canceled, 'version_id', v_version_id, 'auto_content_count', v_auto_content)
  );
  return v_count;
end;
$$;

revoke all on function public.mkt_generate_tasks_from_plan_internal(uuid, uuid) from public, anon, authenticated;

-- ── Mở lại kế hoạch đang chạy = KHÔNG khoá, KHÔNG huỷ việc (đối soát khi duyệt) ──
create or replace function public.mkt_open_plan_change_request(p_plan_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_active integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;

  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status <> 'in_execution' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- NỚI 3 (00222): BỎ khoá PLAN_TASKS_IN_PROGRESS. KHÔNG huỷ việc ở bước này —
  -- việc còn sống được GIỮ; khi duyệt bản mới generate đối soát (giữ/cập nhật/
  -- tạo/huỷ-chưa-bắt-đầu). Chỉ đếm + ghi log.
  select count(*) into v_active from public.mkt_tasks
    where channel_plan_id = p_plan_id and deleted_at is null and task_status not in ('done', 'canceled');

  update public.mkt_channel_plan_versions set status = 'superseded' where id = v_plan.current_version_id;
  update public.mkt_channel_plans
    set status = 'planning', version_number = v_plan.version_number + 1, revision_count = v_plan.revision_count + 1, updated_by = v_actor
    where id = p_plan_id;
  update public.mkt_channel_work_packages set status = 'planning', updated_by = v_actor where id = v_plan.work_package_id;

  perform public.mkt_enqueue_notification(
    v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_change_requested', 'Kế hoạch mở lại để chỉnh sửa', p_reason,
    'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb,
    'mkt_plan_change:' || p_plan_id::text || ':' || (v_plan.version_number + 1)::text
  );
  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_change_requested', 'mkt_channel_plan', p_plan_id, to_jsonb(v_plan), jsonb_build_object('reason', p_reason, 'active_tasks_kept', v_active));
  return jsonb_build_object('success', true, 'activeTasksKept', v_active, 'versionNumber', v_plan.version_number + 1);
end;
$$;

revoke all on function public.mkt_open_plan_change_request(uuid, text) from public, anon;
grant execute on function public.mkt_open_plan_change_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';
