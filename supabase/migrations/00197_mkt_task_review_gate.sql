-- ============================================================
-- 00197: Việc CÓ người duyệt phải đi qua cột "Chờ duyệt" (CEO 16/07)
--
-- BUG CEO BÁO (kèm ảnh Kanban): việc nhảy thẳng "Đang sản xuất" → "Đã đăng",
-- không qua "Chờ duyệt". Truy DB: cả 3 việc ĐỀU có reviewer_id (kế hoạch đã
-- chỉ định người duyệt) nhưng người làm tự bấm "Hoàn tất" là xong — việc
-- "Đăng bài" từ bắt đầu tới xong chỉ 7 giây.
--
-- GỐC (lỗ hổng thiết kế lộ ra sau 00193, không phải hồi quy):
--   • Cột "Chờ duyệt" (task_status='reviewing') trước giờ chỉ có MỘT cửa vào:
--     mkt_submit_task_review — bắt buộc nộp NỘI DUNG (link). Việc không gắn
--     nội dung KHÔNG có đường nào vào duyệt.
--   • mkt_mark_task_done không hề nhìn reviewer_id ⇒ dù kế hoạch chỉ định
--     người duyệt, người làm vẫn tự hoàn tất — "4 mắt" bị vô hiệu.
--
-- SỬA (đúng triết lý rào CÓ ĐIỀU KIỆN — chỉ siết khi dữ liệu có mặt):
--   • CÓ người duyệt (khác người làm) + KHÔNG gắn nội dung:
--       người làm  : "Nộp duyệt"  → mkt_submit_task_for_approval → reviewing
--       người duyệt: "Duyệt xong" → mkt_approve_task_review      → done
--                    "Trả lại"    → mkt_return_task_review       → doing (kèm lý do)
--       mkt_mark_task_done chặn với thông điệp tiếng Việt chỉ đường.
--   • KHÔNG có người duyệt (hoặc tự duyệt chính mình): Hoàn tất thẳng như cũ
--     — đội nhỏ không bị ép hình thức.
--   • CÓ gắn nội dung: giữ nguyên luồng duyệt NỘI DUNG hiện hành (không đổi).
--   • Leader kẹt vẫn có lối thoát sẵn: mkt_force_task_done (exception, audit).
--
-- KHOÁ AN TOÀN (theo sổ bẫy):
--   • mkt_mark_task_done CHÉP NGUYÊN VĂN bản 00193 (bản mới nhất), chỉ THÊM
--     guard reviewer — tuyệt đối không dựng lại luật ép gắn nội dung đã gỡ.
--   • Không đổi chữ ký hàm nào → không dính 42P13.
--   • Duyệt/Trả lại chỉ áp cho reviewing KHÔNG nội dung — task gắn nội dung
--     phải đi màn Duyệt nội dung (REVIEW_TASK_REQUIRES_REVIEW_API).
--   • Thông báo dedupe theo task + mốc thời gian (nộp lại sau khi bị trả là
--     sự kiện mới, phải báo lại).
-- ============================================================

-- ── 1. Người làm nộp việc (không nội dung) cho người duyệt ───────
create or replace function public.mkt_submit_task_for_approval(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'accepted' or v_task.task_status <> 'doing' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  -- Việc gắn nội dung đi đường nộp NỘI DUNG (giữ version + màn duyệt nội dung).
  if v_task.content_item_id is not null then raise exception 'REVIEW_TASK_REQUIRES_REVIEW_API' using errcode = 'P0001'; end if;
  if v_task.reviewer_id is null or v_task.reviewer_id = v_actor then
    raise exception 'TASK_REVIEW_VALIDATION: việc này không có người duyệt riêng — bấm "Hoàn tất" là xong' using errcode = 'P0001';
  end if;

  update public.mkt_tasks
  set task_status = 'reviewing', requires_leader_action = false, updated_by = v_actor
  where id = p_task_id;

  perform public.mkt_enqueue_notification(
    v_task.tenant_id, v_task.reviewer_id, 'mkt_task_pending_review',
    'Việc chờ bạn duyệt', v_task.title,
    'mkt_task', p_task_id, '/mkt/tasks?task=' || p_task_id::text,
    '{}'::jsonb, 'mkt_task_pending_review:' || p_task_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS')
  );
  perform public.mkt_record_audit(
    v_task.tenant_id, v_actor, 'mkt_task_submitted_for_approval', 'mkt_task', p_task_id,
    jsonb_build_object('task_status', v_task.task_status), jsonb_build_object('task_status', 'reviewing')
  );
  return jsonb_build_object('success', true);
end;
$$;

-- ── 2. Người duyệt chốt: Duyệt xong → done ───────────────────────
create or replace function public.mkt_approve_task_review(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_task.reviewer_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if v_task.task_status <> 'reviewing' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  -- Reviewing GẮN nội dung: chốt ở màn Duyệt nội dung, không chốt tay ở đây.
  if v_task.content_item_id is not null then raise exception 'REVIEW_TASK_REQUIRES_REVIEW_API' using errcode = 'P0001'; end if;

  v_task := public.mkt_complete_task_internal(p_task_id, v_actor, 'mkt_task_review_approved', '{}'::jsonb);

  if v_task.assignee_id is not null then
    perform public.mkt_enqueue_notification(
      v_task.tenant_id, v_task.assignee_id, 'mkt_task_review_approved',
      'Việc đã được duyệt xong', v_task.title,
      'mkt_task', p_task_id, '/mkt/tasks?task=' || p_task_id::text,
      '{}'::jsonb, 'mkt_task_review_approved:' || p_task_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS')
    );
  end if;
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

-- ── 3. Người duyệt trả lại: reviewing → doing (bắt buộc lý do) ───
create or replace function public.mkt_return_task_review(p_task_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_reason text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_task.reviewer_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if v_task.task_status <> 'reviewing' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if v_task.content_item_id is not null then raise exception 'REVIEW_TASK_REQUIRES_REVIEW_API' using errcode = 'P0001'; end if;

  update public.mkt_tasks
  set task_status = 'doing', updated_by = v_actor
  where id = p_task_id;

  if v_task.assignee_id is not null then
    perform public.mkt_enqueue_notification(
      v_task.tenant_id, v_task.assignee_id, 'mkt_task_review_returned',
      'Việc bị trả lại — cần sửa', v_task.title || ' — ' || v_reason,
      'mkt_task', p_task_id, '/mkt/tasks?task=' || p_task_id::text,
      '{}'::jsonb, 'mkt_task_review_returned:' || p_task_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS')
    );
  end if;
  perform public.mkt_record_audit(
    v_task.tenant_id, v_actor, 'mkt_task_review_returned', 'mkt_task', p_task_id,
    jsonb_build_object('task_status', 'reviewing'), jsonb_build_object('task_status', 'doing', 'reason', v_reason)
  );
  return jsonb_build_object('success', true);
end;
$$;

-- ── 4. Hoàn tất — CHÉP NGUYÊN VĂN 00193, chỉ THÊM guard người duyệt ─
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
  -- 00197: việc CÓ người duyệt (khác người làm) và KHÔNG gắn nội dung thì
  -- không tự Hoàn tất — phải qua cột Chờ duyệt để đúng "4 mắt" kế hoạch đã định.
  if v_task.reviewer_id is not null and v_task.reviewer_id <> v_actor and v_task.content_item_id is null then
    raise exception 'TASK_REQUIRES_REVIEW: việc này có người duyệt — hãy bấm "Nộp duyệt" để chuyển sang chờ duyệt' using errcode = 'P0001';
  end if;
  v_task := public.mkt_complete_task_internal(p_task_id, v_actor, 'mkt_task_done', '{}'::jsonb);
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

-- ── 5. Quyền gọi hàm ────────────────────────────────────────────
revoke all on function public.mkt_submit_task_for_approval(uuid) from public, anon;
revoke all on function public.mkt_approve_task_review(uuid) from public, anon;
revoke all on function public.mkt_return_task_review(uuid, text) from public, anon;
revoke all on function public.mkt_mark_task_done(uuid) from public, anon;
grant execute on function public.mkt_submit_task_for_approval(uuid) to authenticated;
grant execute on function public.mkt_approve_task_review(uuid) to authenticated;
grant execute on function public.mkt_return_task_review(uuid, text) to authenticated;
grant execute on function public.mkt_mark_task_done(uuid) to authenticated;

notify pgrst, 'reload schema';
