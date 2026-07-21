-- ============================================================
-- 00216: Gán MẢNG (nút cấp 2/3) cho ai → BÁO người đó (Telegram + chuông)
--
-- CEO 21/07: luồng "Giao lập kế hoạch" từng Kế hoạch phụ đã báo Telegram
-- (00181 gọi mkt_enqueue_notification). Nhưng gán cả một mảng cấp 2/3 cho
-- người phụ trách (00201 mkt_campaign_plan_upsert) thì CHƯA báo. Nay thêm:
-- khi owner của nút được đặt/đổi sang MỘT NGƯỜI KHÁC người đang thao tác,
-- enqueue thông báo → đúng đường ống outbox → Telegram (bộ gửi không kén loại).
--
-- Chép NGUYÊN VĂN 00201 (cùng chữ ký 8 tham số → create or replace, không
-- 42P13). Chỉ thêm: bắt owner cũ trước khi sửa + enqueue khi owner đổi.
-- ============================================================

create or replace function public.mkt_campaign_plan_upsert(
  p_id uuid,
  p_campaign_id uuid,
  p_name text,
  p_objective text default null,
  p_owner_id uuid default null,
  p_timeframe_start date default null,
  p_timeframe_end date default null,
  p_parent_plan_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_campaign record;
  v_id uuid;
  v_sort integer;
  v_old_owner uuid;
  v_notify uuid := null; -- 00216: người CẦN báo (owner mới, khác actor)
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'PLAN_VALIDATION_FAILED: kế hoạch chưa đặt tên' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();
  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null;
  if not found or v_campaign.tenant_id <> v_tenant then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  if p_id is not null then
    -- 00216: bắt owner CŨ để chỉ báo khi thật sự ĐỔI người phụ trách.
    select owner_id into v_old_owner from public.mkt_campaign_plans
    where id = p_id and campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null;
    -- 00201: p_parent_plan_id là giá trị MỚI của cha (app luôn gửi kèm giá trị
    -- hiện tại khi sửa — null nghĩa là nút gốc cấp 2). Trigger soi luật lồng.
    update public.mkt_campaign_plans set
      name = trim(p_name),
      objective = nullif(trim(coalesce(p_objective, '')), ''),
      owner_id = p_owner_id,
      timeframe_start = p_timeframe_start,
      timeframe_end = p_timeframe_end,
      parent_plan_id = p_parent_plan_id,
      updated_by = v_actor
    where id = p_id and campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
    -- Báo khi owner mới có + khác actor + KHÁC owner cũ (đổi người thật sự).
    if p_owner_id is not null and p_owner_id <> v_actor and p_owner_id is distinct from v_old_owner then
      v_notify := p_owner_id;
    end if;
  else
    select coalesce(max(sort_order) + 1, 0) into v_sort
    from public.mkt_campaign_plans where campaign_id = p_campaign_id and deleted_at is null;
    insert into public.mkt_campaign_plans (
      tenant_id, campaign_id, name, objective, owner_id, timeframe_start, timeframe_end, sort_order, parent_plan_id, created_by, updated_by
    ) values (
      v_tenant, p_campaign_id, trim(p_name), nullif(trim(coalesce(p_objective, '')), ''),
      p_owner_id, p_timeframe_start, p_timeframe_end, v_sort, p_parent_plan_id, v_actor, v_actor
    ) returning id into v_id;
    -- Tạo mới có gán owner (khác actor) → báo luôn.
    if p_owner_id is not null and p_owner_id <> v_actor then
      v_notify := p_owner_id;
    end if;
  end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_campaign_plan_upsert', 'mkt_campaign_plan', v_id, null, jsonb_build_object('name', trim(p_name), 'parent', p_parent_plan_id));

  -- 00216: báo người được giao mảng — đi outbox → Telegram + chuông.
  if v_notify is not null then
    perform public.mkt_enqueue_notification(
      v_tenant, v_notify, 'mkt_branch_assigned',
      'Được giao lập kế hoạch một mảng',
      'Mảng "' || trim(p_name) || '" đã giao cho bạn — vào Lập kế hoạch để bắt đầu.',
      'mkt_campaign_plan', v_id, '/mkt/planning', '{}'::jsonb,
      'mkt_branch_assigned:' || v_id::text || ':' || v_notify::text
    );
  end if;

  return jsonb_build_object('success', true, 'campaignPlanId', v_id);
end;
$$;

notify pgrst, 'reload schema';
