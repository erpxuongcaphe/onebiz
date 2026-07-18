-- ============================================================
-- 00202: Xoá chiến dịch phải xoá mềm CẢ nút cây kế hoạch (mkt_campaign_plans)
--
-- Lộ ra khi UAT 00201 (18/07): mkt_delete_campaign viết ở 00192 — TRƯỚC khi
-- bảng mkt_campaign_plans ra đời (00200) — nên xoá chiến dịch quét đủ task/
-- nội dung/gói việc/sẵn sàng nhưng BỎ SÓT các nút Kế hoạch cấp 2/3. Nút mồ
-- côi không hiện lên UI (đọc theo chiến dịch) nhưng là rác dữ liệu.
--
-- Việc trong file này:
--   1. mkt_delete_campaign: chép NGUYÊN VĂN 00192, chỉ THÊM một khối xoá mềm
--      mkt_campaign_plans (cùng chữ ký → create or replace, không cần DROP).
--   2. Dọn rác đang có: xoá mềm nút kế hoạch mà chiến dịch cha đã xoá mềm.
-- ============================================================

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

  -- 00202: nút cây Kế hoạch cấp 2/3 (00200/00201) cũng xoá mềm theo chiến dịch.
  update public.mkt_campaign_plans set deleted_at = now(), updated_at = now(), updated_by = v_actor
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

-- Dọn rác đang có: nút kế hoạch mồ côi của chiến dịch đã xoá mềm (VD "ZZ Tháng 7"
-- sinh ra trong UAT 18/07 trước khi có bản vá này).
update public.mkt_campaign_plans cp
set deleted_at = now(), updated_at = now()
from public.mkt_campaigns c
where cp.campaign_id = c.id
  and c.deleted_at is not null
  and cp.deleted_at is null;

notify pgrst, 'reload schema';
