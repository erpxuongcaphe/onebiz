-- ============================================================
-- 00221 — NỚI 2 ("Cho làm — Ghi lại — Nhắc"): Cập nhật bản nộp MỌI LÚC.
--
-- CEO 21/07: người làm lỡ dán nhầm link, hoặc muốn nộp bản tốt hơn, không nên
-- bị khoá cứng sau khi bấm "Nộp duyệt".
--
-- Trước: mkt_submit_task_review đòi task_status='doing' + CHẶN nếu đã có bản
-- 'pending' (raise ALREADY_PROCESSED) → nộp xong là kẹt, phải nhờ người duyệt
-- trả lại (hoặc nút "Thu hồi" 00219).
-- Nay: cho nộp lại cả khi việc đang 'reviewing'. Bản 'pending' cũ tự chuyển
-- 'revision_required' (bị thay), rồi tạo bản mới 'pending' và báo lại người
-- duyệt. Người làm chỉ bấm "Cập nhật bản nộp" — không cần thu hồi trước.
-- (Nút "Thu hồi để sửa" 00219 nghỉ hưu ở UI; RPC để nguyên, vô hại.)
--
-- Chép NGUYÊN VĂN 00176, chỉ đổi 2 chỗ: (1) cho phép 'doing' HOẶC 'reviewing';
-- (2) thay rào ALREADY_PROCESSED bằng "hạ bản pending cũ → revision_required".
-- ============================================================

create or replace function public.mkt_submit_task_review(
  p_task_id uuid,
  p_content_item_id uuid,
  p_content_url text,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_task record; v_content record; v_version record; v_next_version integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if p_content_item_id is null or nullif(trim(coalesce(p_content_url, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_content_url !~* '^https?://' then raise exception 'INVALID_CONTENT_URL' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  -- NỚI 2 (00221): cho nộp lại cả khi đang 'reviewing' (cập nhật bản nộp), không chỉ 'doing'.
  if v_task.acceptance_status <> 'accepted' or v_task.task_status not in ('doing', 'reviewing') or v_task.task_type in ('review', 'publish') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select * into v_content from public.mkt_content_items where id = p_content_item_id and deleted_at is null for update;
  if not found or v_content.tenant_id <> v_task.tenant_id
    or v_content.campaign_id is distinct from v_task.campaign_id
    or (v_task.work_package_id is not null and v_content.work_package_id is not null
        and v_content.work_package_id is distinct from v_task.work_package_id)
  then raise exception 'INVALID_CONTENT_LINK' using errcode = 'P0001'; end if;
  -- NỚI 2 (00221): thay vì CHẶN khi còn bản 'pending', HẠ bản pending cũ xuống
  -- 'revision_required' (bị thay) rồi tạo bản mới → người làm cập nhật link/bài
  -- bất cứ lúc nào trước khi người duyệt chốt. (Chỉ đụng bản đang 'pending' của
  -- CHÍNH bài này — bản đã duyệt/từ chối giữ nguyên.)
  update public.mkt_content_versions set status = 'revision_required'
  where content_item_id = p_content_item_id and status = 'pending';
  v_next_version := coalesce(v_content.current_version, 0) + 1;
  insert into public.mkt_content_versions (tenant_id, content_item_id, version_number, content_url, note, status, submitted_by)
  values (v_task.tenant_id, p_content_item_id, v_next_version, p_content_url, p_note, 'pending', v_actor) returning * into v_version;
  update public.mkt_content_items set current_version = v_next_version, content_status = 'pending_review', approved_by = null, approved_at = null, updated_by = v_actor where id = p_content_item_id;
  update public.mkt_tasks set task_status = 'reviewing', content_item_id = p_content_item_id, requires_leader_action = false, updated_by = v_actor where id = p_task_id;
  if v_task.reviewer_id is not null then perform public.mkt_enqueue_notification(v_task.tenant_id, v_task.reviewer_id, 'mkt_content_pending_review', 'Nội dung chờ duyệt', v_content.title, 'mkt_content_item', p_content_item_id, '/mkt/approvals?content=' || p_content_item_id::text, '{}'::jsonb, 'mkt_content_pending_review:' || v_version.id::text); end if;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_content_submitted_review', 'mkt_content_item', p_content_item_id, null, to_jsonb(v_version));
  return jsonb_build_object('success', true, 'contentVersion', to_jsonb(v_version));
end;
$$;
revoke all on function public.mkt_submit_task_review(uuid, uuid, text, text) from public, anon;
grant execute on function public.mkt_submit_task_review(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
