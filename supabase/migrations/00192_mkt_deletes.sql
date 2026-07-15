-- ============================================================
-- 00192: MKT — bổ sung xoá Chiến dịch / Gói việc / Công việc / Mục sẵn sàng
--
-- CEO 15/07: trong MKT Hub không có nút xoá chiến dịch, xoá bớt task, và các
-- xoá khác. Trước đó chỉ Nội dung (00190), Media (00171), Tài liệu (00185),
-- Trụ/Góc (00170/00186) là xoá được.
--
-- Nguyên tắc (theo khuôn 00190_mkt_delete_content_item):
--   • XOÁ MỀM (deleted_at) — không mất lịch sử, khôi phục được.
--   • Ghi audit đầy đủ (ai xoá, lúc nào, bản ghi cũ).
--   • Xoá cha → xoá mềm luôn con (không để lại rác mồ côi).
--   • Chặn xoá chiến dịch ĐANG CHẠY (phải tạm dừng/hoàn thành/huỷ trước).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Xoá CÔNG VIỆC (task) — nối lại chuỗi phụ thuộc cho việc đứng sau
-- ------------------------------------------------------------
create or replace function public.mkt_delete_task(
  p_task_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_task record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not (
    public.user_has_permission(v_actor, 'mkt.manage_campaigns')
    or public.user_has_permission(v_actor, 'mkt.manage_team')
  ) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();

  select * into v_task
  from public.mkt_tasks
  where id = p_task_id and tenant_id = v_tenant and deleted_at is null
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- Việc đứng sau đang phụ thuộc việc bị xoá → trỏ sang tiền nhiệm của nó
  -- (nối liền chuỗi). Nếu không còn tiền nhiệm (hoặc tiền nhiệm đã xong) mà
  -- đang 'blocked' thì mở khoá thành 'todo' — tránh kẹt vĩnh viễn.
  update public.mkt_tasks t
  set dependency_task_id = v_task.dependency_task_id,
      task_status = case
        when t.task_status = 'blocked'
             and (
               v_task.dependency_task_id is null
               or exists (
                 select 1 from public.mkt_tasks d
                 where d.id = v_task.dependency_task_id and d.task_status = 'done'
               )
             )
        then 'todo'
        else t.task_status
      end,
      updated_at = now(),
      updated_by = v_actor
  where t.dependency_task_id = p_task_id
    and t.tenant_id = v_tenant
    and t.deleted_at is null;

  update public.mkt_tasks
  set deleted_at = now(), updated_at = now(), updated_by = v_actor
  where id = p_task_id;

  -- Gói việc có thể đổi trạng thái khi bớt task (VD còn lại xong hết → completed)
  if v_task.work_package_id is not null then
    perform public.mkt_sync_work_package_status(v_task.work_package_id, v_actor);
  end if;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_task_deleted', 'mkt_task', p_task_id,
    to_jsonb(v_task),
    jsonb_build_object('soft_deleted', true, 'reason', nullif(p_reason, ''))
  );
  return jsonb_build_object('success', true, 'taskId', p_task_id);
end;
$$;

-- ------------------------------------------------------------
-- 2. Xoá GÓI VIỆC (kênh triển khai) — xoá mềm luôn task + kế hoạch bên trong
-- ------------------------------------------------------------
create or replace function public.mkt_delete_work_package(
  p_work_package_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_wp record;
  v_tasks integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();

  select * into v_wp
  from public.mkt_channel_work_packages
  where id = p_work_package_id and tenant_id = v_tenant and deleted_at is null
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  with removed as (
    update public.mkt_tasks
    set deleted_at = now(), updated_at = now(), updated_by = v_actor
    where work_package_id = p_work_package_id and tenant_id = v_tenant and deleted_at is null
    returning 1
  )
  select count(*) into v_tasks from removed;

  update public.mkt_channel_plans
  set deleted_at = now(), updated_at = now()
  where work_package_id = p_work_package_id and tenant_id = v_tenant and deleted_at is null;

  update public.mkt_channel_work_packages
  set deleted_at = now(), updated_at = now(), updated_by = v_actor
  where id = p_work_package_id;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_work_package_deleted', 'mkt_work_package', p_work_package_id,
    to_jsonb(v_wp),
    jsonb_build_object('soft_deleted', true, 'tasks_removed', v_tasks, 'reason', nullif(p_reason, ''))
  );
  return jsonb_build_object('success', true, 'workPackageId', p_work_package_id, 'tasksRemoved', v_tasks);
end;
$$;

-- ------------------------------------------------------------
-- 3. Xoá MỤC SẴN SÀNG (readiness) — tính lại % sẵn sàng của chiến dịch
-- ------------------------------------------------------------
create or replace function public.mkt_delete_readiness_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_item record;
  v_score integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();

  select * into v_item
  from public.mkt_campaign_readiness_items
  where id = p_item_id and tenant_id = v_tenant and deleted_at is null
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  update public.mkt_campaign_readiness_items
  set deleted_at = now(), updated_at = now()
  where id = p_item_id;

  v_score := public.get_mkt_campaign_readiness_score(v_item.campaign_id);
  update public.mkt_campaigns
  set readiness_score = v_score, updated_by = v_actor
  where id = v_item.campaign_id;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_readiness_deleted', 'mkt_readiness_item', p_item_id,
    to_jsonb(v_item), jsonb_build_object('soft_deleted', true)
  );
  return jsonb_build_object('success', true, 'readinessScore', v_score);
end;
$$;

-- ------------------------------------------------------------
-- 4. Xoá CHIẾN DỊCH — xoá mềm toàn bộ cây con (gói việc/nội dung/task/
--    sẵn sàng/kế hoạch). Chặn khi đang chạy.
-- ------------------------------------------------------------
create or replace function public.mkt_delete_campaign(
  p_campaign_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_campaign record;
  v_tasks integer := 0;
  v_wps integer := 0;
  v_contents integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();

  select * into v_campaign
  from public.mkt_campaigns
  where id = p_campaign_id and tenant_id = v_tenant and deleted_at is null
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- An toàn: không xoá thẳng chiến dịch đang chạy — phải tạm dừng/hoàn thành/huỷ trước.
  if v_campaign.status = 'running' then
    raise exception 'CAMPAIGN_RUNNING' using errcode = 'P0001';
  end if;

  with removed as (
    update public.mkt_tasks set deleted_at = now(), updated_at = now(), updated_by = v_actor
    where campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null
    returning 1
  ) select count(*) into v_tasks from removed;

  with removed as (
    update public.mkt_content_items set deleted_at = now(), updated_at = now(), updated_by = v_actor
    where campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null
    returning 1
  ) select count(*) into v_contents from removed;

  update public.mkt_channel_plans set deleted_at = now(), updated_at = now()
  where campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null;

  with removed as (
    update public.mkt_channel_work_packages set deleted_at = now(), updated_at = now(), updated_by = v_actor
    where campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null
    returning 1
  ) select count(*) into v_wps from removed;

  update public.mkt_campaign_readiness_items set deleted_at = now(), updated_at = now()
  where campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null;

  update public.mkt_campaigns
  set deleted_at = now(), updated_at = now(), updated_by = v_actor
  where id = p_campaign_id;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_campaign_deleted', 'mkt_campaign', p_campaign_id,
    to_jsonb(v_campaign),
    jsonb_build_object(
      'soft_deleted', true, 'reason', nullif(p_reason, ''),
      'work_packages_removed', v_wps, 'contents_removed', v_contents, 'tasks_removed', v_tasks
    )
  );
  return jsonb_build_object(
    'success', true, 'campaignId', p_campaign_id,
    'workPackagesRemoved', v_wps, 'contentsRemoved', v_contents, 'tasksRemoved', v_tasks
  );
end;
$$;

-- ------------------------------------------------------------
-- 5. Khoá quyền EXECUTE
-- ------------------------------------------------------------
revoke all on function public.mkt_delete_task(uuid, text) from public, anon;
revoke all on function public.mkt_delete_work_package(uuid, text) from public, anon;
revoke all on function public.mkt_delete_readiness_item(uuid) from public, anon;
revoke all on function public.mkt_delete_campaign(uuid, text) from public, anon;

grant execute on function public.mkt_delete_task(uuid, text) to authenticated;
grant execute on function public.mkt_delete_work_package(uuid, text) to authenticated;
grant execute on function public.mkt_delete_readiness_item(uuid) to authenticated;
grant execute on function public.mkt_delete_campaign(uuid, text) to authenticated;

notify pgrst, 'reload schema';
