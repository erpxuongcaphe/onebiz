-- ============================================================
-- 00219: Người làm THU HỒI bản đã nộp để sửa link/nội dung — không phải chờ
--        người duyệt bấm "Yêu cầu sửa".
--
-- CEO 21/07: "Dương không vào cập nhật nội dung/link SAU khi bấm Nộp duyệt".
-- Đúng: mkt_submit_task_review đòi task_status='doing' + chặn khi đã có bản
-- 'pending' → nộp xong là khoá, lỡ dán nhầm link thì kẹt. Nay cho người làm
-- tự rút bản đang chờ về "cần sửa" → sửa → nộp lại (nút "Nộp lại bản sửa").
--
-- Chỉ được thu hồi khi bài CÒN đang chờ duyệt (chưa ai duyệt/từ chối) và
-- chính mình là người làm. Chuyển bản 'pending' → 'revision_required' để mở
-- đường nộp bản mới; bài → 'revision_required'; việc → 'doing'.
-- ============================================================

create or replace function public.mkt_recall_task_review(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_content record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;

  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.task_status <> 'reviewing' or v_task.content_item_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- Bài phải CÒN đang chờ duyệt — đã duyệt/từ chối rồi thì không thu hồi (tránh
  -- lật ngược quyết định của người duyệt).
  select * into v_content from public.mkt_content_items where id = v_task.content_item_id and deleted_at is null for update;
  if not found or v_content.content_status <> 'pending_review' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- Bản đang chờ → "cần sửa" (bỏ chặn 'pending' cho lần nộp sau).
  update public.mkt_content_versions
  set status = 'revision_required'
  where content_item_id = v_task.content_item_id and status = 'pending';

  update public.mkt_content_items
  set content_status = 'revision_required', updated_by = v_actor
  where id = v_task.content_item_id;

  update public.mkt_tasks
  set task_status = 'doing', updated_by = v_actor
  where id = p_task_id;

  perform public.mkt_record_audit(
    v_task.tenant_id, v_actor, 'mkt_content_recalled', 'mkt_content_item', v_task.content_item_id,
    jsonb_build_object('task_status', 'reviewing'), jsonb_build_object('task_status', 'doing')
  );
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.mkt_recall_task_review(uuid) from public, anon;
grant execute on function public.mkt_recall_task_review(uuid) to authenticated;

notify pgrst, 'reload schema';
