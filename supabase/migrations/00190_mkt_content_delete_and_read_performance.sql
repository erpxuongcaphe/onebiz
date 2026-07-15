-- ============================================================
-- 00190: MKT content soft delete
--
-- Keep workflow history intact: only removable content is soft-deleted,
-- and content that is under review, approved, published, or tied to an
-- active task is protected.
-- ============================================================

create or replace function public.mkt_delete_content_item(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_content record;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if not (
    public.user_has_permission(v_actor, 'mkt.manage_campaigns')
    or public.user_has_permission(v_actor, 'mkt.split_work_packages')
  ) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();

  select id, tenant_id, campaign_id, title, content_status, current_version, revision_count
  into v_content
  from public.mkt_content_items
  where id = p_content_id
    and tenant_id = v_tenant
    and deleted_at is null
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_content.content_status in ('pending_review', 'approved', 'published') then
    raise exception 'CONTENT_DELETE_LOCKED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.mkt_tasks t
    where t.content_item_id = p_content_id
      and t.tenant_id = v_tenant
      and t.deleted_at is null
      and t.task_status <> 'canceled'
  ) then
    raise exception 'CONTENT_HAS_ACTIVE_TASKS' using errcode = 'P0001';
  end if;

  update public.mkt_content_items
  set deleted_at = now(), updated_at = now(), updated_by = v_actor
  where id = p_content_id;

  perform public.mkt_record_audit(
    v_tenant,
    v_actor,
    'mkt_content_deleted',
    'mkt_content_item',
    p_content_id,
    to_jsonb(v_content),
    jsonb_build_object('soft_deleted', true)
  );

  return jsonb_build_object('success', true, 'contentItemId', p_content_id);
end;
$$;

revoke all on function public.mkt_delete_content_item(uuid) from public, anon;
grant execute on function public.mkt_delete_content_item(uuid) to authenticated;

notify pgrst, 'reload schema';
