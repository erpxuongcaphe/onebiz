-- ============================================================
-- 00189: MKT Hub QC hardening
--
-- - Align server authorization with OneBiz effective permissions:
--   (role permissions + per-user grants) - per-user revokes.
-- - Make readiness authorization permission/branch based, never title based.
-- - Restrict asset mutations and validate tenant-owned storage paths.
-- - Keep task/package state consistent when work is canceled.
-- - Allow a new plan after a rejected plan was soft-deleted.
-- - Require a content pillar for newly-created content.
-- ============================================================

-- -----------------------------------------------------------------------------
-- 1. Effective permissions are the single authorization source for server RPCs.
--    Owner keeps the existing OneBiz bypass; inactive profiles have no access.
-- -----------------------------------------------------------------------------
create or replace function public.user_has_permission(
  p_user_id uuid,
  p_permission_code text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and coalesce(p.is_active, true)
      and (
        p.role = 'owner'
        or (
          not exists (
            select 1
            from public.user_permission_overrides o
            where o.tenant_id = p.tenant_id
              and o.user_id = p.id
              and o.permission_code = p_permission_code
              and o.override_type = 'revoke'
          )
          and (
            exists (
              select 1
              from public.role_permissions rp
              where rp.role_id = p.role_id
                and rp.permission_code = p_permission_code
            )
            or exists (
              select 1
              from public.user_permission_overrides o
              where o.tenant_id = p.tenant_id
                and o.user_id = p.id
                and o.permission_code = p_permission_code
                and o.override_type = 'grant'
            )
          )
        )
      )
  );
$$;

revoke all on function public.user_has_permission(uuid, text) from public, anon;
grant execute on function public.user_has_permission(uuid, text) to authenticated;

comment on function public.user_has_permission is
  'Effective OneBiz authorization: owner bypass OR (role/grant) minus revoke. Inactive profiles are denied.';

-- Existing campaign managers retain asset-management ability after this
-- permission is split out. This is capability-based, not profile-title based.
insert into public.role_permissions (role_id, permission_code)
select distinct rp.role_id, 'mkt.manage_assets'
from public.role_permissions rp
where rp.permission_code = 'mkt.manage_campaigns'
on conflict (role_id, permission_code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Readiness responsibilities: explicit permissions + branch scope.
--    Legacy values owner/manager remain readable as aliases for existing rows.
-- -----------------------------------------------------------------------------
create or replace function public.mkt_readiness_permission(p_required_role text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(trim(coalesce(p_required_role, '')))
    when 'finance' then 'mkt.readiness.finance'
    when 'ops' then 'mkt.readiness.ops'
    when 'warehouse' then 'mkt.readiness.warehouse'
    when 'store' then 'mkt.readiness.store'
    when 'store_manager' then 'mkt.readiness.store'
    when 'manager' then 'mkt.readiness.store'
    when 'ceo' then 'mkt.readiness.ceo'
    when 'owner' then 'mkt.readiness.ceo'
    else null
  end;
$$;

create or replace function public.mkt_can_confirm_readiness(
  p_user_id uuid,
  p_required_role text,
  p_required_branch_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and coalesce(p.is_active, true)
      and (
        public.user_has_permission(p.id, 'mkt.override_campaign')
        or (
          public.mkt_readiness_permission(p_required_role) is not null
          and public.user_has_permission(
            p.id,
            public.mkt_readiness_permission(p_required_role)
          )
          and (
            p_required_branch_id is null
            or p.branch_id = p_required_branch_id
          )
        )
      )
  );
$$;

create or replace function public.mkt_matches_readiness_role(p_required_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mkt_can_confirm_readiness(auth.uid(), p_required_role, null);
$$;

create or replace function public.mkt_matches_readiness_role(
  p_required_role text,
  p_required_branch_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mkt_can_confirm_readiness(
    auth.uid(),
    p_required_role,
    p_required_branch_id
  );
$$;

revoke all on function public.mkt_readiness_permission(text) from public, anon, authenticated;
revoke all on function public.mkt_can_confirm_readiness(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.mkt_matches_readiness_role(text) from public, anon;
revoke all on function public.mkt_matches_readiness_role(text, uuid) from public, anon;
grant execute on function public.mkt_matches_readiness_role(text) to authenticated;
grant execute on function public.mkt_matches_readiness_role(text, uuid) to authenticated;

drop policy if exists "mkt_campaigns_select" on public.mkt_campaigns;
create policy "mkt_campaigns_select" on public.mkt_campaigns for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    (select public.mkt_is_lead())
    or owner_id = auth.uid()
    or exists (
      select 1
      from public.mkt_tasks t
      where t.campaign_id = mkt_campaigns.id
        and t.deleted_at is null
        and (t.assignee_id = auth.uid() or t.reviewer_id = auth.uid())
    )
    or exists (
      select 1
      from public.mkt_campaign_readiness_items ri
      where ri.campaign_id = mkt_campaigns.id
        and ri.tenant_id = mkt_campaigns.tenant_id
        and ri.deleted_at is null
        and public.mkt_matches_readiness_role(
          ri.required_role,
          ri.required_branch_id
        )
    )
  )
);

drop policy if exists "mkt_readiness_select" on public.mkt_campaign_readiness_items;
create policy "mkt_readiness_select" on public.mkt_campaign_readiness_items for select using (
  tenant_id = public.get_user_tenant_id()
  and (
    (select public.mkt_is_lead())
    or (select public.user_has_permission(auth.uid(), 'mkt.override_campaign'))
    or public.mkt_matches_readiness_role(required_role, required_branch_id)
  )
);

create or replace function public.mkt_confirm_readiness_item(
  p_campaign_id uuid,
  p_item_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_item record;
  v_score integer;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.mkt_campaign_readiness_items
  where id = p_item_id
    and campaign_id = p_campaign_id
    and deleted_at is null
  for update;

  if not found or v_item.tenant_id <> public.get_user_tenant_id() then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'ALREADY_PROCESSED' using errcode = 'P0001';
  end if;
  if not public.mkt_can_confirm_readiness(
    v_actor,
    v_item.required_role,
    v_item.required_branch_id
  ) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  update public.mkt_campaign_readiness_items
  set status = 'confirmed',
      confirmed_by = v_actor,
      confirmed_at = now(),
      note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_item_id
  returning * into v_item;

  v_score := public.get_mkt_campaign_readiness_score(p_campaign_id);
  update public.mkt_campaigns
  set readiness_score = v_score, updated_by = v_actor
  where id = p_campaign_id;

  perform public.mkt_record_audit(
    v_item.tenant_id,
    v_actor,
    'mkt_readiness_confirmed',
    'mkt_readiness_item',
    p_item_id,
    null,
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'score', v_score,
      'note', p_note,
      'required_role', v_item.required_role,
      'required_branch_id', v_item.required_branch_id
    )
  );

  return jsonb_build_object(
    'success', true,
    'readinessScore', v_score,
    'item', to_jsonb(v_item)
  );
end;
$$;

create or replace function public.mkt_remind_readiness_item(
  p_campaign_id uuid,
  p_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_item record;
  v_recipient record;
  v_permission text;
  v_count integer := 0;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.mkt_campaign_readiness_items
  where id = p_item_id
    and campaign_id = p_campaign_id
    and deleted_at is null;

  if not found or v_item.tenant_id <> public.get_user_tenant_id() then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'ALREADY_PROCESSED' using errcode = 'P0001';
  end if;

  v_permission := public.mkt_readiness_permission(v_item.required_role);
  if v_permission is null then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  for v_recipient in
    select p.id
    from public.profiles p
    where p.tenant_id = v_item.tenant_id
      and coalesce(p.is_active, true)
      and (
        public.user_has_permission(p.id, 'mkt.override_campaign')
        or (
          public.user_has_permission(p.id, v_permission)
          and (
            v_item.required_branch_id is null
            or p.branch_id = v_item.required_branch_id
          )
        )
      )
  loop
    perform public.mkt_enqueue_notification(
      v_item.tenant_id,
      v_recipient.id,
      'mkt_readiness_reminder',
      'Nhac xac nhan san sang',
      v_item.title,
      'mkt_readiness_item',
      p_item_id,
      '/mkt/campaigns/' || p_campaign_id::text || '?tab=readiness',
      '{}'::jsonb,
      'mkt_readiness_reminder:' || p_item_id::text || ':' ||
        v_recipient.id::text || ':' || to_char(now(), 'YYYY-MM-DD')
    );
    v_count := v_count + 1;
  end loop;

  perform public.mkt_record_audit(
    v_item.tenant_id,
    v_actor,
    'mkt_readiness_reminded',
    'mkt_readiness_item',
    p_item_id,
    null,
    jsonb_build_object(
      'recipients', v_count,
      'permission', v_permission,
      'required_branch_id', v_item.required_branch_id
    )
  );

  return jsonb_build_object('success', true, 'reminded', v_count);
end;
$$;

create or replace function public.mkt_get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
begin
  if v_actor is null then
    return jsonb_build_object('canView', false);
  end if;

  select id, tenant_id, branch_id into v_profile
  from public.profiles
  where id = v_actor and coalesce(is_active, true);

  if not found then
    return jsonb_build_object('canView', false);
  end if;

  return jsonb_build_object(
    'canView', public.user_has_permission(v_actor, 'mkt.view'),
    'isLead', public.user_has_permission(v_actor, 'mkt.manage_campaigns')
              or public.user_has_permission(v_actor, 'mkt.manage_team'),
    'canManageCampaigns', public.user_has_permission(v_actor, 'mkt.manage_campaigns'),
    'canSplit', public.user_has_permission(v_actor, 'mkt.split_work_packages')
                or public.user_has_permission(v_actor, 'mkt.manage_campaigns'),
    'canReview', public.user_has_permission(v_actor, 'mkt.review_content'),
    'canManageTeam', public.user_has_permission(v_actor, 'mkt.manage_team'),
    'canOverride', public.user_has_permission(v_actor, 'mkt.override_campaign'),
    'canViewAudit', public.user_has_permission(v_actor, 'mkt.view_audit'),
    'canTelegram', public.user_has_permission(v_actor, 'mkt.telegram_manage'),
    'canManageAssets', public.user_has_permission(v_actor, 'mkt.manage_assets'),
    'tenantId', v_profile.tenant_id,
    'branchId', v_profile.branch_id,
    'readinessRoles', to_jsonb(array(
      select x.role_code
      from (values
        ('finance', 'mkt.readiness.finance'),
        ('ops', 'mkt.readiness.ops'),
        ('warehouse', 'mkt.readiness.warehouse'),
        ('store_manager', 'mkt.readiness.store'),
        ('ceo', 'mkt.readiness.ceo')
      ) as x(role_code, permission_code)
      where public.user_has_permission(v_actor, x.permission_code)
    ))
  );
end;
$$;

create or replace function public.mkt_require_readiness_responsibility_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.mkt_readiness_permission(new.required_role) is null then
    raise exception 'INVALID_READINESS_RESPONSIBILITY' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.mkt_require_readiness_responsibility_on_insert()
  from public, anon, authenticated;
drop trigger if exists trg_mkt_readiness_requires_responsibility
  on public.mkt_campaign_readiness_items;
create trigger trg_mkt_readiness_requires_responsibility
before insert on public.mkt_campaign_readiness_items
for each row
execute function public.mkt_require_readiness_responsibility_on_insert();
-- -----------------------------------------------------------------------------
-- 3. Media and document mutations require mkt.manage_assets.
-- -----------------------------------------------------------------------------
-- Remove legacy overloads that only required mkt.view. The current API has used
-- the 11-argument signature since migration 00178.
drop function if exists public.mkt_media_register(text, text, text, bigint, text, uuid, uuid);
drop function if exists public.mkt_media_register(
  text, text, text, text, text, text, bigint, text, uuid, uuid
);

create or replace function public.mkt_media_register(
  p_file_name text,
  p_source_type text default 'upload',
  p_storage_path text default null,
  p_external_url text default null,
  p_external_id text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_kind text default 'image',
  p_campaign_id uuid default null,
  p_content_item_id uuid default null,
  p_thumbnail_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_source text;
  v_kind text;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_assets') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_file_name, '')), '') is null
     or length(trim(p_file_name)) > 255 then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_campaign_id is not null and not exists (
    select 1
    from public.mkt_campaigns c
    where c.id = p_campaign_id
      and c.tenant_id = v_tenant
      and c.deleted_at is null
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_content_item_id is not null and not exists (
    select 1
    from public.mkt_content_items c
    where c.id = p_content_item_id
      and c.tenant_id = v_tenant
      and c.deleted_at is null
      and (p_campaign_id is null or c.campaign_id = p_campaign_id)
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_source := lower(coalesce(nullif(trim(p_source_type), ''), 'upload'));
  v_kind := lower(coalesce(nullif(trim(p_kind), ''), 'image'));
  if v_source not in ('upload', 'drive', 'onedrive', 'youtube', 'tiktok', 'image', 'video', 'other')
     or v_kind not in ('image', 'video', 'other') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  if v_source = 'upload' then
    if nullif(trim(coalesce(p_storage_path, '')), '') is null
       or p_storage_path not like v_tenant::text || '/%'
       or coalesce(p_size_bytes, 0) < 1
       or p_size_bytes > 26214400
       or lower(coalesce(p_mime_type, '')) not in (
         'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
         'video/mp4', 'video/webm', 'video/quicktime'
       ) then
      raise exception 'INVALID_MEDIA_UPLOAD' using errcode = 'P0001';
    end if;
  elsif nullif(trim(coalesce(p_external_url, '')), '') is null
        or trim(p_external_url) !~* '^https?://' then
    raise exception 'INVALID_EXTERNAL_URL' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_thumbnail_url, '')), '') is not null
     and trim(p_thumbnail_url) !~* '^https?://' then
    raise exception 'INVALID_EXTERNAL_URL' using errcode = 'P0001';
  end if;

  insert into public.mkt_media_assets (
    tenant_id, campaign_id, content_item_id, storage_path, file_name, mime_type,
    size_bytes, kind, status, uploaded_by, source_type, external_url, external_id,
    thumbnail_url
  ) values (
    v_tenant,
    p_campaign_id,
    p_content_item_id,
    case when v_source = 'upload' then trim(p_storage_path) else null end,
    trim(p_file_name),
    nullif(trim(coalesce(p_mime_type, '')), ''),
    case when v_source = 'upload' then p_size_bytes else null end,
    v_kind,
    'available',
    v_actor,
    v_source,
    case when v_source = 'upload' then null else trim(p_external_url) end,
    nullif(trim(coalesce(p_external_id, '')), ''),
    nullif(trim(coalesce(p_thumbnail_url, '')), '')
  ) returning id into v_id;

  perform public.mkt_record_audit(
    v_tenant,
    v_actor,
    'mkt_media_registered',
    'mkt_media_asset',
    v_id,
    null,
    jsonb_build_object('file', trim(p_file_name), 'source', v_source)
  );

  return jsonb_build_object('success', true, 'mediaId', v_id);
end;
$$;

create or replace function public.mkt_media_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_assets') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if p_status not in ('available', 'used') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();
  update public.mkt_media_assets
  set status = p_status, updated_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_media_status_changed', 'mkt_media_asset', p_id,
    null, jsonb_build_object('status', p_status)
  );
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.mkt_media_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_assets') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_media_assets
  set deleted_at = now(), updated_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_media_removed', 'mkt_media_asset', p_id, null, null
  );
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.mkt_document_register(
  p_title text,
  p_source_type text default 'drive',
  p_external_url text default null,
  p_external_id text default null,
  p_category text default 'other',
  p_description text default null,
  p_mime_type text default null,
  p_thumbnail_url text default null,
  p_storage_path text default null,
  p_size_bytes bigint default null,
  p_campaign_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_source text;
  v_category text;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_assets') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null
     or length(trim(p_title)) > 255 then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_campaign_id is not null and not exists (
    select 1
    from public.mkt_campaigns c
    where c.id = p_campaign_id
      and c.tenant_id = v_tenant
      and c.deleted_at is null
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_source := lower(coalesce(nullif(trim(p_source_type), ''), 'drive'));
  if v_source not in ('drive', 'gdoc', 'gsheet', 'gslide', 'onedrive', 'pdf', 'office_link', 'upload', 'other') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  if v_source = 'upload' then
    if nullif(trim(coalesce(p_storage_path, '')), '') is null
       or p_storage_path not like v_tenant::text || '/%'
       or coalesce(p_size_bytes, 0) < 1
       or p_size_bytes > 26214400 then
      raise exception 'INVALID_DOCUMENT_UPLOAD' using errcode = 'P0001';
    end if;
  elsif nullif(trim(coalesce(p_external_url, '')), '') is null
        or trim(p_external_url) !~* '^https?://' then
    raise exception 'INVALID_EXTERNAL_URL' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_thumbnail_url, '')), '') is not null
     and trim(p_thumbnail_url) !~* '^https?://' then
    raise exception 'INVALID_EXTERNAL_URL' using errcode = 'P0001';
  end if;

  v_category := lower(coalesce(nullif(trim(p_category), ''), 'other'));
  if v_category not in ('brief', 'brand', 'price', 'contract', 'report', 'other') then
    v_category := 'other';
  end if;

  insert into public.mkt_documents (
    tenant_id, campaign_id, title, description, category, source_type,
    external_url, external_id, thumbnail_url, mime_type, storage_path, size_bytes,
    status, uploaded_by
  ) values (
    v_tenant,
    p_campaign_id,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    v_category,
    v_source,
    case when v_source = 'upload' then null else trim(p_external_url) end,
    nullif(trim(coalesce(p_external_id, '')), ''),
    nullif(trim(coalesce(p_thumbnail_url, '')), ''),
    nullif(trim(coalesce(p_mime_type, '')), ''),
    case when v_source = 'upload' then trim(p_storage_path) else null end,
    case when v_source = 'upload' then p_size_bytes else null end,
    'available',
    v_actor
  ) returning id into v_id;

  perform public.mkt_record_audit(
    v_tenant,
    v_actor,
    'mkt_document_registered',
    'mkt_document',
    v_id,
    null,
    jsonb_build_object(
      'title', trim(p_title),
      'source', v_source,
      'category', v_category
    )
  );
  return jsonb_build_object('success', true, 'documentId', v_id);
end;
$$;

create or replace function public.mkt_document_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_assets') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if p_status not in ('available', 'archived') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_documents
  set status = p_status, updated_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_document_status_changed', 'mkt_document', p_id,
    null, jsonb_build_object('status', p_status)
  );
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.mkt_document_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_assets') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_documents
  set deleted_at = now(), updated_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  perform public.mkt_record_audit(
    v_tenant, v_actor, 'mkt_document_removed', 'mkt_document', p_id, null, null
  );
  return jsonb_build_object('success', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Workflow integrity when tasks or plan tasks are canceled.
-- -----------------------------------------------------------------------------
create or replace function public.mkt_sync_work_package_status(
  p_work_package_id uuid,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_active integer;
  v_done integer;
  v_progress integer;
  v_status text;
begin
  if p_work_package_id is null then
    return;
  end if;

  select
    count(*),
    count(*) filter (where task_status not in ('done', 'canceled')),
    count(*) filter (where task_status = 'done'),
    count(*) filter (where task_status in ('doing', 'reviewing'))
  into v_total, v_active, v_done, v_progress
  from public.mkt_tasks
  where work_package_id = p_work_package_id
    and deleted_at is null;

  if v_total = 0 then
    return;
  end if;

  v_status := case
    when v_active = 0 and v_done = 0 then 'canceled'
    when v_active = 0 then 'completed'
    when v_progress > 0 then 'in_progress'
    else 'split_completed'
  end;

  update public.mkt_channel_work_packages
  set status = v_status, updated_by = p_actor
  where id = p_work_package_id
    and deleted_at is null
    and status is distinct from v_status;
end;
$$;

revoke all on function public.mkt_sync_work_package_status(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.mkt_cancel_task(p_task_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_dependent record;
  v_dependents integer := 0;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MISSING_REASON' using errcode = 'P0001';
  end if;
  if not (
    public.user_has_permission(v_actor, 'mkt.manage_team')
    or public.user_has_permission(v_actor, 'mkt.manage_campaigns')
  ) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  select * into v_task
  from public.mkt_tasks
  where id = p_task_id and deleted_at is null
  for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_task.task_status in ('done', 'canceled') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  update public.mkt_tasks
  set task_status = 'canceled',
      requires_leader_action = false,
      blocked_reason = null,
      completed_at = null,
      updated_by = v_actor
  where id = p_task_id
  returning * into v_task;

  for v_dependent in
    update public.mkt_tasks
    set task_status = 'blocked',
        blocked_reason = 'DEPENDENCY_CANCELED',
        requires_leader_action = true,
        updated_by = v_actor
    where dependency_task_id = p_task_id
      and tenant_id = v_task.tenant_id
      and deleted_at is null
      and task_status not in ('done', 'canceled')
    returning *
  loop
    v_dependents := v_dependents + 1;
    if v_dependent.assignee_id is not null then
      perform public.mkt_enqueue_notification(
        v_task.tenant_id,
        v_dependent.assignee_id,
        'mkt_task_dependency_canceled',
        'Cong viec dang bi chan',
        v_dependent.title,
        'mkt_task',
        v_dependent.id,
        '/mkt/tasks?task=' || v_dependent.id::text,
        jsonb_build_object('dependencyTaskId', p_task_id),
        'mkt_dependency_canceled:' || v_dependent.id::text || ':' || p_task_id::text
      );
    end if;
  end loop;

  perform public.mkt_sync_work_package_status(v_task.work_package_id, v_actor);
  perform public.mkt_record_audit(
    v_task.tenant_id,
    v_actor,
    'mkt_task_canceled',
    'mkt_task',
    v_task.id,
    null,
    jsonb_build_object(
      'reason', trim(p_reason),
      'blocked_dependents', v_dependents
    )
  );

  return jsonb_build_object(
    'success', true,
    'task', to_jsonb(v_task),
    'blockedDependents', v_dependents
  );
end;
$$;

-- A soft-deleted rejected plan must not block assigning a replacement plan.
alter table public.mkt_channel_plans
  drop constraint if exists mkt_channel_plans_work_package_id_key;
create unique index if not exists uq_mkt_channel_plans_active_work_package
  on public.mkt_channel_plans(work_package_id)
  where deleted_at is null;

drop function if exists public.mkt_reconcile_plan_task(uuid, text, uuid);

create or replace function public.mkt_reconcile_plan_task(
  p_plan_id uuid,
  p_task_id uuid,
  p_decision text,
  p_new_assignee_id uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_task record;
  v_dep_status text;
  v_next_status text;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if p_decision not in ('keep', 'cancel', 'reassign') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if p_decision in ('cancel', 'reassign')
     and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MISSING_REASON' using errcode = 'P0001';
  end if;

  select * into v_plan
  from public.mkt_channel_plans
  where id = p_plan_id and deleted_at is null
  for update;
  if not found
     or v_plan.tenant_id <> public.get_user_tenant_id()
     or v_plan.status <> 'in_execution' then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_task
  from public.mkt_tasks
  where id = p_task_id
    and channel_plan_id = p_plan_id
    and deleted_at is null
  for update;
  if not found or v_task.tenant_id <> v_plan.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_decision = 'cancel' then
    if v_task.task_status = 'done' then
      raise exception 'INVALID_STATE' using errcode = 'P0001';
    end if;
    perform public.mkt_cancel_task(p_task_id, p_reason);

  elsif p_decision = 'reassign' then
    if p_new_assignee_id is null or v_task.task_status in ('done', 'canceled') then
      raise exception 'INVALID_STATE' using errcode = 'P0001';
    end if;
    if not exists (
      select 1
      from public.profiles p
      where p.id = p_new_assignee_id
        and p.tenant_id = v_task.tenant_id
        and coalesce(p.is_active, true)
    ) then
      raise exception 'INVALID_STATE' using errcode = 'P0001';
    end if;

    v_next_status := 'todo';
    if v_task.dependency_task_id is not null then
      select task_status into v_dep_status
      from public.mkt_tasks
      where id = v_task.dependency_task_id
        and tenant_id = v_task.tenant_id
        and deleted_at is null;
      if v_dep_status is distinct from 'done' then
        v_next_status := 'blocked';
      end if;
    end if;

    update public.mkt_tasks
    set assignee_id = p_new_assignee_id,
        acceptance_status = 'pending',
        task_status = v_next_status,
        blocked_reason = case
          when v_next_status = 'blocked' then 'DEPENDENCY_BLOCKED'
          else null
        end,
        started_at = null,
        reject_reason = null,
        discussion_reason = null,
        requires_leader_action = false,
        updated_by = v_actor
    where id = p_task_id;

    perform public.mkt_enqueue_notification(
      v_task.tenant_id,
      p_new_assignee_id,
      'mkt_task_assigned',
      'Task MKT duoc giao lai',
      v_task.title,
      'mkt_task',
      p_task_id,
      '/mkt/tasks?task=' || p_task_id::text,
      '{}'::jsonb,
      'mkt_task_reassigned:' || p_task_id::text || ':' || p_new_assignee_id::text
    );
    perform public.mkt_sync_work_package_status(v_task.work_package_id, v_actor);
  end if;

  perform public.mkt_record_audit(
    v_task.tenant_id,
    v_actor,
    'mkt_plan_task_' || p_decision,
    'mkt_task',
    p_task_id,
    to_jsonb(v_task),
    jsonb_build_object(
      'plan_id', p_plan_id,
      'decision', p_decision,
      'new_assignee_id', p_new_assignee_id,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )
  );

  return jsonb_build_object('success', true, 'decision', p_decision);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. New content must be classified under an active pillar. Existing legacy
--    rows with a null pillar remain updateable and can be repaired gradually.
-- -----------------------------------------------------------------------------
create or replace function public.mkt_require_content_pillar_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pillar_id is null then
    raise exception 'MISSING_PILLAR' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.mkt_content_pillars p
    where p.id = new.pillar_id
      and p.tenant_id = new.tenant_id
      and p.deleted_at is null
      and p.is_active
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.mkt_require_content_pillar_on_insert()
  from public, anon, authenticated;
drop trigger if exists trg_mkt_content_requires_pillar on public.mkt_content_items;
create trigger trg_mkt_content_requires_pillar
before insert on public.mkt_content_items
for each row execute function public.mkt_require_content_pillar_on_insert();

-- -----------------------------------------------------------------------------
-- 6. Function privileges.
-- -----------------------------------------------------------------------------
revoke all on function public.mkt_confirm_readiness_item(uuid, uuid, text) from public, anon;
revoke all on function public.mkt_remind_readiness_item(uuid, uuid) from public, anon;
revoke all on function public.mkt_get_my_context() from public, anon;
revoke all on function public.mkt_media_register(text, text, text, text, text, text, bigint, text, uuid, uuid, text) from public, anon;
revoke all on function public.mkt_media_set_status(uuid, text) from public, anon;
revoke all on function public.mkt_media_remove(uuid) from public, anon;
revoke all on function public.mkt_document_register(text, text, text, text, text, text, text, text, text, bigint, uuid) from public, anon;
revoke all on function public.mkt_document_set_status(uuid, text) from public, anon;
revoke all on function public.mkt_document_remove(uuid) from public, anon;
revoke all on function public.mkt_cancel_task(uuid, text) from public, anon;
revoke all on function public.mkt_reconcile_plan_task(uuid, uuid, text, uuid, text) from public, anon;

grant execute on function public.mkt_confirm_readiness_item(uuid, uuid, text) to authenticated;
grant execute on function public.mkt_remind_readiness_item(uuid, uuid) to authenticated;
grant execute on function public.mkt_get_my_context() to authenticated;
grant execute on function public.mkt_media_register(text, text, text, text, text, text, bigint, text, uuid, uuid, text) to authenticated;
grant execute on function public.mkt_media_set_status(uuid, text) to authenticated;
grant execute on function public.mkt_media_remove(uuid) to authenticated;
grant execute on function public.mkt_document_register(text, text, text, text, text, text, text, text, text, bigint, uuid) to authenticated;
grant execute on function public.mkt_document_set_status(uuid, text) to authenticated;
grant execute on function public.mkt_document_remove(uuid) to authenticated;
grant execute on function public.mkt_cancel_task(uuid, text) to authenticated;
grant execute on function public.mkt_reconcile_plan_task(uuid, uuid, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
