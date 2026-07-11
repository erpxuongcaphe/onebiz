-- ============================================================
-- 00171: MKT Media — nguồn ngoài (Google Drive / YouTube / TikTok)
-- CEO 11/07: KHÔNG lưu file nặng trên Supabase (Free 1GB / 5GB egress).
-- Web chỉ giữ metadata + link; file thật ở Drive/YouTube, xem trực tiếp
-- qua iframe preview. Upload trực tiếp chỉ dành cho asset nhỏ.
-- ============================================================

alter table public.mkt_media_assets alter column storage_path drop not null;
alter table public.mkt_media_assets add column if not exists source_type text not null default 'upload';
alter table public.mkt_media_assets add column if not exists external_url text;
alter table public.mkt_media_assets add column if not exists external_id text;

do $$ begin
  alter table public.mkt_media_assets
    add constraint mkt_media_source_type_check
    check (source_type in ('upload', 'drive', 'youtube', 'tiktok', 'other'));
exception when duplicate_object then null; end $$;

-- upload phải có storage_path; nguồn ngoài phải có external_url
do $$ begin
  alter table public.mkt_media_assets
    add constraint mkt_media_source_fields_check
    check (
      (source_type = 'upload' and storage_path is not null)
      or (source_type <> 'upload' and external_url is not null)
    );
exception when duplicate_object then null; end $$;

-- RPC đăng ký media: thay chữ ký cũ (chỉ upload) bằng bản hỗ trợ nguồn ngoài.
drop function if exists public.mkt_media_register(text, text, text, bigint, text, uuid, uuid);

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
  p_content_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_source text;
  v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_file_name, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  v_source := coalesce(nullif(p_source_type, ''), 'upload');
  if v_source not in ('upload', 'drive', 'youtube', 'tiktok', 'other') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if v_source = 'upload' and nullif(trim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if v_source <> 'upload' and nullif(trim(coalesce(p_external_url, '')), '') is null then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  v_tenant := public.get_user_tenant_id();

  insert into public.mkt_media_assets (
    tenant_id, campaign_id, content_item_id, storage_path, file_name, mime_type,
    size_bytes, kind, status, uploaded_by, source_type, external_url, external_id
  ) values (
    v_tenant, p_campaign_id, p_content_item_id, nullif(p_storage_path, ''), p_file_name,
    nullif(p_mime_type, ''), p_size_bytes, coalesce(nullif(p_kind, ''), 'image'),
    'available', v_actor, v_source, nullif(p_external_url, ''), nullif(p_external_id, '')
  )
  returning id into v_id;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_media_registered', 'mkt_media_asset', v_id, null, jsonb_build_object('file', p_file_name, 'source', v_source));
  return jsonb_build_object('success', true, 'mediaId', v_id);
end;
$$;

revoke all on function public.mkt_media_register(text, text, text, text, text, text, bigint, text, uuid, uuid) from public, anon;
grant execute on function public.mkt_media_register(text, text, text, text, text, text, bigint, text, uuid, uuid) to authenticated;

-- Xoá mềm media (dọn thư viện)
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
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_media_assets set deleted_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_media_removed', 'mkt_media_asset', p_id, null, null);
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.mkt_media_remove(uuid) from public, anon;
grant execute on function public.mkt_media_remove(uuid) to authenticated;

notify pgrst, 'reload schema';
