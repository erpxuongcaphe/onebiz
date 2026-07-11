-- ============================================================
-- 00177: Vá 2 tiêu đề thông báo thiếu dấu tiếng Việt (sót từ 00174)
-- 'Task MKT bi tu choi'   -> 'Task MKT bị từ chối'
-- 'Task MKT can trao doi' -> 'Task MKT cần trao đổi'
-- Phát hiện khi rà lại sau UAT Chrome 11-12/07.
-- Chữ ký hàm KHÔNG đổi -> create or replace an toàn, quyền execute giữ nguyên.
-- ============================================================

create or replace function public.mkt_reject_task(p_task_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record; v_owner uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'pending' or v_task.task_status not in ('todo', 'blocked') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.mkt_tasks set acceptance_status = 'rejected', requires_leader_action = true,
    reject_reason = p_reason, updated_by = v_actor where id = p_task_id returning * into v_task;
  select owner_id into v_owner from public.mkt_channel_work_packages where id = v_task.work_package_id and tenant_id = v_task.tenant_id;
  if v_owner is not null then perform public.mkt_enqueue_notification(v_task.tenant_id, v_owner, 'mkt_task_rejected', 'Task MKT bị từ chối', v_task.title, 'mkt_task', v_task.id, '/mkt/leader-queue'); end if;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_rejected', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

create or replace function public.mkt_need_discussion_task(p_task_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_task record; v_owner uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;
  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.assignee_id <> v_actor then raise exception 'NOT_ASSIGNEE' using errcode = 'P0001'; end if;
  if v_task.acceptance_status <> 'pending' or v_task.task_status not in ('todo', 'blocked') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.mkt_tasks set acceptance_status = 'need_discussion', requires_leader_action = true,
    discussion_reason = p_reason, updated_by = v_actor where id = p_task_id returning * into v_task;
  select owner_id into v_owner from public.mkt_channel_work_packages where id = v_task.work_package_id and tenant_id = v_task.tenant_id;
  if v_owner is not null then perform public.mkt_enqueue_notification(v_task.tenant_id, v_owner, 'mkt_task_need_discussion', 'Task MKT cần trao đổi', v_task.title, 'mkt_task', v_task.id, '/mkt/leader-queue'); end if;
  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_task_need_discussion', 'mkt_task', v_task.id, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('success', true, 'task', to_jsonb(v_task));
end;
$$;

notify pgrst, 'reload schema';
