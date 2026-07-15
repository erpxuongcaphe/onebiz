-- ============================================================
-- 00193: Bỏ ép gắn nội dung khi lập kế hoạch — chỉ siết KHI CÓ gắn
--
-- CEO 15/07: "ô nội dung sổ xuống không có gì để chọn, liệu mình ép buộc như
-- vậy có phù hợp không". Đúng — ép SAI CHỖ:
--   Lập kế hoạch là việc TƯƠNG LAI. Chính kế hoạch mới đẻ ra nội dung
--   (VD: công đoạn "Hoàn thành nội dung" → rồi mới "Đăng bài"). Bắt chọn nội
--   dung ngay lúc lập kế hoạch = bắt chọn thứ CHƯA TỒN TẠI → danh sách rỗng
--   → bế tắc.
--
-- Vì sao trước đây phải ép: mkt_start_task chặn cứng task 'publish' có
-- content_item_id null (INVALID_STATE) → nếu cho nộp thiếu nội dung sẽ đẻ ra
-- task không bao giờ bấm "Bắt đầu" được. Nên mkt_submit_plan phải chặn từ đầu.
--
-- SỬA GỐC — đảo luật lại cho đúng bản chất:
--   • CÓ gắn nội dung  → giữ nguyên rào an toàn: nội dung phải được DUYỆT rồi
--     mới đăng được (bảo vệ quy trình chặt, không đăng bài chưa duyệt).
--   • KHÔNG gắn nội dung → "Đăng"/"Duyệt" chỉ là một đầu việc bình thường,
--     làm xong bấm hoàn tất. Không rào, không kẹt.
-- ⇒ Ai cần quy trình chặt vẫn có; ai làm nhanh không bị ép khai báo thừa.
-- Nhờ vậy bỏ được ràng buộc ở mkt_submit_plan.
--
-- Bản mới nhất của 2 hàm task đang ở 00174; mkt_submit_plan ở 00182.
-- Chép nguyên văn + sửa đúng chỗ (create or replace giữ nguyên grant cũ).
-- ============================================================

-- ── 1. Bắt đầu việc: chỉ soi nội dung KHI có gắn ──
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
  -- ĐỔI: chỉ chặn khi CÓ gắn nội dung. Không gắn → việc thường, cho bắt đầu.
  if v_task.task_type = 'publish' and v_task.content_item_id is not null then
    select content_status into v_content_status from public.mkt_content_items where id = v_task.content_item_id and tenant_id = v_task.tenant_id and deleted_at is null;
    if v_content_status <> 'approved' then raise exception 'CONTENT_NOT_APPROVED' using errcode = 'P0001'; end if;
  end if;
  update public.mkt_tasks set task_status = 'doing', started_at = coalesce(started_at, now()), updated_by = v_actor
  where id = p_task_id returning * into v_task;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_started', 'mkt_task', v_task.id, null, to_jsonb(v_task));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

-- ── 2. Hoàn tất việc: cũng chỉ soi nội dung KHI có gắn ──
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
  -- ĐỔI: chỉ chặn khi CÓ gắn nội dung.
  if v_task.task_type = 'publish' and v_task.content_item_id is not null then
    select content_status into v_content_status from public.mkt_content_items where id = v_task.content_item_id and tenant_id = v_task.tenant_id and deleted_at is null;
    if v_content_status <> 'approved' then raise exception 'CONTENT_NOT_APPROVED' using errcode = 'P0001'; end if;
  end if;
  v_task := public.mkt_complete_task_internal(p_task_id, v_actor, 'mkt_task_done', '{}'::jsonb);
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

-- ── 3. Nộp kế hoạch: BỎ ràng buộc "duyệt/đăng cần gắn nội dung" ──
-- (Chép nguyên văn 00182, chỉ bỏ đúng khối kiểm tra content_item_id.)
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
    -- BỎ (00193): không ép gắn nội dung ở công đoạn duyệt/đăng nữa. Lúc lập kế
    -- hoạch nội dung thường chưa tồn tại; rào an toàn đã chuyển sang mkt_start_task
    -- (chỉ siết khi CÓ gắn nội dung).
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

revoke all on function public.mkt_start_task(uuid) from public, anon;
revoke all on function public.mkt_mark_task_done(uuid) from public, anon;
revoke all on function public.mkt_submit_plan(uuid, integer) from public, anon;
grant execute on function public.mkt_start_task(uuid) to authenticated;
grant execute on function public.mkt_mark_task_done(uuid) to authenticated;
grant execute on function public.mkt_submit_plan(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
