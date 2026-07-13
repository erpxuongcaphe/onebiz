-- ============================================================
-- 00181: Bottom-Up Channel Planning — RPC Đợt 1 (Owner lập kế hoạch)
--
-- mkt_assign_channel_planning: Leader giao gói việc cho Channel Owner →
--   WP chuyển 'planning' + tạo plan v1 (header brief). Guard 'needs_split'
--   → loại trừ lẫn nhau với "Chia Task Ngay".
-- mkt_save_plan_items: Owner (hoặc Leader) lưu nháp danh sách Plan Item —
--   KHÔNG sinh task, KHÔNG notify. Optimistic lock theo version_number.
-- ============================================================

create or replace function public.mkt_assign_channel_planning(
  p_work_package_id uuid,
  p_owner_id uuid,
  p_reviewer_id uuid default null,
  p_header jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_wp record;
  v_plan_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_owner_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_wp from public.mkt_channel_work_packages where id = p_work_package_id and deleted_at is null for update;
  if not found or v_wp.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_wp.status <> 'needs_split' then raise exception 'ALREADY_PROCESSED' using errcode = 'P0001'; end if;

  update public.mkt_channel_work_packages
  set owner_id = p_owner_id, reviewer_id = coalesce(p_reviewer_id, reviewer_id), status = 'planning', updated_by = v_actor
  where id = v_wp.id;

  insert into public.mkt_channel_plans (
    tenant_id, work_package_id, campaign_id, owner_id, reviewer_id,
    objective, key_message, mandatory_deliverables, risk_notes, deadline,
    status, version_number, created_by, updated_by
  ) values (
    v_wp.tenant_id, v_wp.id, v_wp.campaign_id, p_owner_id, coalesce(p_reviewer_id, v_wp.reviewer_id),
    nullif(p_header->>'objective', ''), nullif(p_header->>'keyMessage', ''),
    nullif(p_header->>'mandatoryDeliverables', ''), nullif(p_header->>'riskNotes', ''),
    nullif(p_header->>'deadline', '')::date,
    'planning', 1, v_actor, v_actor
  ) returning id into v_plan_id;

  perform public.mkt_enqueue_notification(
    v_wp.tenant_id, p_owner_id, 'mkt_plan_assigned', 'Được giao lập kế hoạch kênh', v_wp.title,
    'mkt_channel_plan', v_plan_id, '/mkt/planning?plan=' || v_plan_id::text, '{}'::jsonb,
    'mkt_plan_assigned:' || v_plan_id::text
  );
  perform public.mkt_record_audit(v_wp.tenant_id, v_actor, 'mkt_channel_plan_assigned', 'mkt_channel_plan', v_plan_id, to_jsonb(v_wp), jsonb_build_object('owner_id', p_owner_id));
  return jsonb_build_object('success', true, 'planId', v_plan_id);
end;
$$;
revoke all on function public.mkt_assign_channel_planning(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.mkt_assign_channel_planning(uuid, uuid, uuid, jsonb) to authenticated;

create or replace function public.mkt_save_plan_items(
  p_plan_id uuid,
  p_items jsonb,
  p_header jsonb default null,
  p_expected_version integer default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_new_id uuid;
  v_dep uuid;
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status not in ('planning', 'revision_required') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_expected_version is not null and p_expected_version <> v_plan.version_number then raise exception 'PLAN_VERSION_CONFLICT' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- Header (nếu gửi)
  if p_header is not null then
    update public.mkt_channel_plans set
      objective = coalesce(nullif(p_header->>'objective', ''), objective),
      key_message = coalesce(nullif(p_header->>'keyMessage', ''), key_message),
      mandatory_deliverables = coalesce(nullif(p_header->>'mandatoryDeliverables', ''), mandatory_deliverables),
      risk_notes = coalesce(nullif(p_header->>'riskNotes', ''), risk_notes),
      deadline = coalesce(nullif(p_header->>'deadline', '')::date, deadline),
      updated_by = v_actor
    where id = p_plan_id;
  end if;

  -- Replace item set — an toàn vì Plan Item chưa sinh task nào (chỉ là nháp)
  delete from public.mkt_channel_plan_items where plan_id = p_plan_id;

  -- Pass 1: insert (depends_on để null)
  for v_item in select * from jsonb_array_elements(p_items) loop
    if nullif(trim(coalesce(v_item->>'title', '')), '') is null then continue; end if;
    insert into public.mkt_channel_plan_items (
      id, tenant_id, plan_id, title, task_type, description, content_angle, deliverable,
      suggested_assignee_id, reviewer_id, content_item_id, workload_points, due_at, sequence, is_mandatory
    ) values (
      coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid()),
      v_plan.tenant_id, p_plan_id, v_item->>'title',
      coalesce(nullif(v_item->>'taskType', ''), 'idea'),
      nullif(v_item->>'description', ''), nullif(v_item->>'contentAngle', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'suggestedAssigneeId', '')::uuid, nullif(v_item->>'reviewerId', '')::uuid,
      nullif(v_item->>'contentItemId', '')::uuid,
      coalesce(nullif(v_item->>'workloadPoints', '')::integer, 1),
      nullif(v_item->>'dueAt', '')::timestamptz,
      coalesce(nullif(v_item->>'sequence', '')::integer, v_count),
      coalesce((v_item->>'isMandatory')::boolean, false)
    ) returning id into v_new_id;
    v_ids := array_append(v_ids, v_new_id);
    v_count := v_count + 1;
  end loop;

  -- Pass 2: nối depends_on nếu tham chiếu hợp lệ trong cùng lô
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_dep := nullif(v_item->>'dependsOnId', '')::uuid;
    if v_dep is not null and v_dep = any(v_ids) and nullif(v_item->>'id', '')::uuid = any(v_ids) then
      update public.mkt_channel_plan_items set depends_on_item_id = v_dep
      where id = (v_item->>'id')::uuid and plan_id = p_plan_id;
    end if;
  end loop;

  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_saved', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('item_count', v_count));
  return jsonb_build_object('success', true, 'itemCount', v_count, 'versionNumber', v_plan.version_number);
end;
$$;
revoke all on function public.mkt_save_plan_items(uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function public.mkt_save_plan_items(uuid, jsonb, jsonb, integer) to authenticated;

notify pgrst, 'reload schema';
