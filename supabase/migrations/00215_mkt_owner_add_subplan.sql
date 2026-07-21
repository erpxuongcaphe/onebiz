-- ============================================================
-- 00215: Người được GIAO MẢNG (Phụ trách nút cấp 2/3) tự thêm Kế hoạch phụ
--        và có plan để soạn NGAY — không cần Leader giao lại từng cái.
--
-- CEO 19/07: "giao việc thì người được giao phải thấy". Trước đây gán Phụ
-- trách cho một nút cấp 2/3 (mảng Website, Fanpage…) chỉ là nhãn — không tạo
-- việc, người được giao không làm được gì. Nay:
--
--   Nút cấp 2/3 có owner = Dương  ⇒ Dương thấy mảng trong màn Lập kế hoạch
--   Dương bấm "Thêm Kế hoạch phụ" ⇒ hàm này tạo work package + channel_plan
--   (owner = chính Dương, status 'planning') ⇒ Dương soạn được luôn.
--
-- Chép ĐÚNG cách tạo plan của mkt_assign_channel_planning (00181): cùng cột,
-- version 1, status 'planning'. Khác 2 điểm: (a) quyền = owner của nút HOẶC
-- Leader (không đòi manage_campaigns cho người được giao); (b) không tự báo
-- cho chính mình (owner = người bấm).
-- ============================================================

create or replace function public.mkt_owner_add_subplan(
  p_campaign_plan_id uuid,
  p_title text,
  p_channel_type text default 'other'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_node record;
  v_wp_id uuid;
  v_plan_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'PLAN_VALIDATION_FAILED: Kế hoạch phụ chưa đặt tên' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();

  -- Nút cấp 2/3 phải cùng tenant, còn sống.
  select * into v_node from public.mkt_campaign_plans
  where id = p_campaign_plan_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- Quyền: người ĐƯỢC GIAO mảng này (owner của nút) HOẶC Leader/người chia việc.
  if not (
    v_node.owner_id = v_actor
    or public.user_has_permission(v_actor, 'mkt.manage_campaigns')
    or public.user_has_permission(v_actor, 'mkt.split_work_packages')
  ) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  -- 1) Kế hoạch phụ (work package) — thuộc đúng nút, owner = người bấm, vào thẳng 'planning'.
  insert into public.mkt_channel_work_packages (
    tenant_id, campaign_id, channel_type, title, owner_id,
    status, campaign_plan_id, created_by, updated_by
  ) values (
    v_tenant, v_node.campaign_id, coalesce(nullif(p_channel_type, ''), 'other'), trim(p_title), v_actor,
    'planning', v_node.id, v_actor, v_actor
  ) returning id into v_wp_id;

  -- 2) Channel plan trống (owner = người bấm) — soạn được ngay. Chép khuôn 00181.
  insert into public.mkt_channel_plans (
    tenant_id, work_package_id, campaign_id, owner_id, reviewer_id,
    status, version_number, created_by, updated_by
  ) values (
    v_tenant, v_wp_id, v_node.campaign_id, v_actor, null,
    'planning', 1, v_actor, v_actor
  ) returning id into v_plan_id;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_owner_subplan_added', 'mkt_channel_plan', v_plan_id,
    null, jsonb_build_object('campaign_plan_id', v_node.id, 'title', trim(p_title))
  );
  return jsonb_build_object('success', true, 'workPackageId', v_wp_id, 'planId', v_plan_id);
end;
$$;

revoke all on function public.mkt_owner_add_subplan(uuid, text, text) from public, anon;
grant execute on function public.mkt_owner_add_subplan(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
