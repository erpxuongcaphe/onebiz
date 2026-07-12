-- ============================================================
-- 00178: MKT Media — thumbnail lưu sẵn + nguồn ảnh/video trực tiếp
--
-- Hai cải tiến sau UAT (CEO 12/07):
-- 1. TikTok: lấy ảnh đại diện qua oEmbed lúc thêm link, lưu vào thumbnail_url
--    (TikTok không có URL thumbnail suy ra được từ ID như YouTube).
-- 2. Link ảnh/video trực tiếp (.jpg/.png/.mp4…): thêm 2 source_type 'image'
--    và 'video' để hiện xem trước ngay trong lưới + phát/mở trong popup.
--
-- Đổi chữ ký hàm mkt_media_register (thêm p_thumbnail_url) → phải DROP trước
-- rồi CREATE + cấp lại quyền (bài học 42P13).
-- ============================================================

alter table public.mkt_media_assets add column if not exists thumbnail_url text;

-- Mở rộng nguồn hợp lệ: thêm ảnh/video trực tiếp
alter table public.mkt_media_assets drop constraint if exists mkt_media_source_type_check;
alter table public.mkt_media_assets add constraint mkt_media_source_type_check
  check (source_type in ('upload', 'drive', 'onedrive', 'youtube', 'tiktok', 'image', 'video', 'other'));

drop function if exists public.mkt_media_register(text, text, text, text, text, text, bigint, text, uuid, uuid);

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
  v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_file_name, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  v_source := coalesce(nullif(p_source_type, ''), 'upload');
  if v_source not in ('upload', 'drive', 'onedrive', 'youtube', 'tiktok', 'image', 'video', 'other') then
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
    size_bytes, kind, status, uploaded_by, source_type, external_url, external_id, thumbnail_url
  ) values (
    v_tenant, p_campaign_id, p_content_item_id, nullif(p_storage_path, ''), p_file_name,
    nullif(p_mime_type, ''), p_size_bytes, coalesce(nullif(p_kind, ''), 'image'),
    'available', v_actor, v_source, nullif(p_external_url, ''), nullif(p_external_id, ''),
    nullif(p_thumbnail_url, '')
  )
  returning id into v_id;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_media_registered', 'mkt_media_asset', v_id, null, jsonb_build_object('file', p_file_name, 'source', v_source));
  return jsonb_build_object('success', true, 'mediaId', v_id);
end;
$$;

revoke all on function public.mkt_media_register(text, text, text, text, text, text, bigint, text, uuid, uuid, text) from public, anon;
grant execute on function public.mkt_media_register(text, text, text, text, text, text, bigint, text, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
