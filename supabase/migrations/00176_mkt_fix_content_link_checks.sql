-- ============================================================
-- 00176: Vá kiểm tra liên kết nội dung quá chặt (phát hiện qua UAT 11/07)
--
-- 00174 yêu cầu content.work_package_id PHẢI BẰNG task.work_package_id khi
-- task thuộc gói việc → chặn oan nội dung cấp CHIẾN DỊCH (không gắn gói —
-- trường hợp phổ biến: 1 nội dung dùng chung, hoặc tạo nhanh trong dialog
-- chia việc). Ngữ nghĩa đúng: chỉ chặn khi CẢ HAI cùng có gói mà LỆCH nhau.
-- Sửa 2 chỗ cùng logic: trigger mkt_assert_tenant_links + mkt_submit_task_review.
-- ============================================================

create or replace function public.mkt_assert_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_parent_campaign uuid;
begin
  if new.tenant_id is null then
    raise exception 'CROSS_TENANT_REFERENCE: missing tenant' using errcode = 'P0001';
  end if;

  if tg_table_name = 'mkt_campaigns' then
    if new.branch_id is not null and not exists (
      select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: branch' using errcode = 'P0001'; end if;
    if new.owner_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.owner_id and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: owner' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_campaign_readiness_items' then
    if not exists (select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001';
    end if;
    if new.required_branch_id is not null and not exists (
      select 1 from public.branches b where b.id = new.required_branch_id and b.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: branch' using errcode = 'P0001'; end if;
    if new.confirmed_by is not null and not exists (
      select 1 from public.profiles p where p.id = new.confirmed_by and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: confirmer' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_channel_work_packages' then
    if not exists (select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001';
    end if;
    if new.owner_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.owner_id and p.tenant_id = new.tenant_id and coalesce(p.is_active, true)
    ) then raise exception 'CROSS_TENANT_REFERENCE: owner' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id and coalesce(p.is_active, true)
    ) then raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_content_items' then
    if new.campaign_id is not null and not exists (
      select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001'; end if;
    if new.work_package_id is not null then
      select wp.tenant_id, wp.campaign_id into v_tenant, v_parent_campaign
      from public.mkt_channel_work_packages wp where wp.id = new.work_package_id;
      if v_tenant is distinct from new.tenant_id or (new.campaign_id is not null and v_parent_campaign is distinct from new.campaign_id) then
        raise exception 'CROSS_TENANT_REFERENCE: work package' using errcode = 'P0001';
      end if;
    end if;
    if new.pillar_id is not null and not exists (
      select 1 from public.mkt_content_pillars p where p.id = new.pillar_id and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: pillar' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_tasks' then
    if new.campaign_id is not null and not exists (
      select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001'; end if;
    if new.work_package_id is not null then
      select wp.tenant_id, wp.campaign_id into v_tenant, v_parent_campaign
      from public.mkt_channel_work_packages wp where wp.id = new.work_package_id;
      if v_tenant is distinct from new.tenant_id or (new.campaign_id is not null and v_parent_campaign is distinct from new.campaign_id) then
        raise exception 'CROSS_TENANT_REFERENCE: work package' using errcode = 'P0001';
      end if;
    end if;
    -- 00176: nội dung cấp campaign (work_package_id NULL) hợp lệ cho task
    -- trong gói — chỉ chặn khi CẢ HAI cùng có gói mà lệch nhau.
    if new.content_item_id is not null and not exists (
      select 1 from public.mkt_content_items ci
      where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id
        and (new.campaign_id is null or ci.campaign_id = new.campaign_id)
        and (ci.work_package_id is null or new.work_package_id is null or ci.work_package_id = new.work_package_id)
    ) then raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001'; end if;
    if new.assignee_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.assignee_id and p.tenant_id = new.tenant_id and coalesce(p.is_active, true)
    ) then raise exception 'CROSS_TENANT_REFERENCE: assignee' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id and coalesce(p.is_active, true)
    ) then raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;
    if new.dependency_task_id is not null and not exists (
      select 1 from public.mkt_tasks d
      where d.id = new.dependency_task_id and d.tenant_id = new.tenant_id
        and (new.campaign_id is null or d.campaign_id = new.campaign_id)
    ) then raise exception 'CROSS_TENANT_REFERENCE: dependency' using errcode = 'P0001'; end if;
    if new.pillar_id is not null and not exists (
      select 1 from public.mkt_content_pillars p where p.id = new.pillar_id and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: pillar' using errcode = 'P0001'; end if;
    if new.source_id is null then raise exception 'MISSING_SOURCE_ID' using errcode = 'P0001'; end if;
    if new.source_type = 'campaign_channel_split' and new.source_id is distinct from new.work_package_id then
      raise exception 'INVALID_SOURCE_REFERENCE' using errcode = 'P0001';
    end if;
    if new.source_type = 'content_item' and new.source_id is distinct from new.content_item_id then
      raise exception 'INVALID_SOURCE_REFERENCE' using errcode = 'P0001';
    end if;
    if new.source_type = 'manual' and new.source_id is distinct from coalesce(new.work_package_id, new.campaign_id) then
      raise exception 'INVALID_SOURCE_REFERENCE' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'mkt_content_versions' then
    if not exists (select 1 from public.mkt_content_items ci where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001';
    end if;
    if new.submitted_by is not null and not exists (
      select 1 from public.profiles p where p.id = new.submitted_by and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: submitter' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_content_reviews' then
    if not exists (select 1 from public.mkt_content_items ci where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001';
    end if;
    if new.content_version_id is not null and not exists (
      select 1 from public.mkt_content_versions cv
      where cv.id = new.content_version_id and cv.content_item_id = new.content_item_id and cv.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: version' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;

  elsif tg_table_name in ('mkt_telegram_accounts', 'mkt_telegram_link_tokens') then
    if not exists (select 1 from public.profiles p where p.id = new.user_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: user' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'mkt_outbox_events' then
    if not exists (select 1 from public.profiles p where p.id = new.recipient_user_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: recipient' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'mkt_media_assets' then
    if new.campaign_id is not null and not exists (
      select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001'; end if;
    if new.content_item_id is not null and not exists (
      select 1 from public.mkt_content_items ci where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id
    ) then raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001'; end if;
  end if;

  return new;
end;
$$;

revoke all on function public.mkt_assert_tenant_links() from public, anon, authenticated;

-- Cùng logic trong nộp duyệt: content cấp campaign (không gắn gói) hợp lệ.
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
  if v_task.acceptance_status <> 'accepted' or v_task.task_status <> 'doing' or v_task.task_type in ('review', 'publish') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select * into v_content from public.mkt_content_items where id = p_content_item_id and deleted_at is null for update;
  if not found or v_content.tenant_id <> v_task.tenant_id
    or v_content.campaign_id is distinct from v_task.campaign_id
    or (v_task.work_package_id is not null and v_content.work_package_id is not null
        and v_content.work_package_id is distinct from v_task.work_package_id)
  then raise exception 'INVALID_CONTENT_LINK' using errcode = 'P0001'; end if;
  if exists (select 1 from public.mkt_content_versions cv where cv.content_item_id = p_content_item_id and cv.status = 'pending') then raise exception 'ALREADY_PROCESSED' using errcode = 'P0001'; end if;
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

notify pgrst, 'reload schema';
