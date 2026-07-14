-- ============================================================
-- 00185: MKT Hub — Thư viện Tài liệu (Document Library)
--
-- Nhu cầu (CEO 14/07): thêm chỗ lưu tài liệu (xlsx/docx/pdf…) giống thư viện
-- media, để team lưu/xem brief, brand guideline, bảng giá, hợp đồng, báo cáo
-- ngay trong web.
--
-- Hướng: LINK-FIRST như media (CEO đã chốt 11/07 "không lưu file nặng").
-- - Google Drive / Docs / Sheets / Slides: nhúng iframe /preview → xem trực
--   tiếp MỌI định dạng (pdf/xlsx/docx/ppt) mà không tốn kho.
-- - PDF trực tiếp: trình duyệt tự render trong iframe.
-- - File Office công khai (.xlsx/.docx/.pptx): bọc Office Online viewer.
-- Cột storage_path + size_bytes để NGỎ sẵn cho việc mở upload sau (không dùng
-- ở đợt này) — khỏi phải thêm migration khi CEO muốn bật.
--
-- Khuôn theo mkt_media_assets (00170/00171/00178). Bảng RIÊNG, KHÔNG đụng
-- thư viện media đang chạy. Toàn vẹn tenant qua hàm phụ riêng (không sửa hàm
-- hardening mkt_assert_tenant_links 145 dòng).
-- ============================================================

create table if not exists public.mkt_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.mkt_campaigns(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'other'
    check (category in ('brief', 'brand', 'price', 'contract', 'report', 'other')),
  source_type text not null default 'drive'
    check (source_type in ('drive', 'gdoc', 'gsheet', 'gslide', 'onedrive', 'pdf', 'office_link', 'upload', 'other')),
  external_url text,
  external_id text,
  thumbnail_url text,
  mime_type text,
  storage_path text,          -- để ngỏ cho upload sau (đợt này luôn null)
  size_bytes bigint,
  status text not null default 'available' check (status in ('available', 'archived')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- upload phải có storage_path; nguồn ngoài (link) phải có external_url
do $$ begin
  alter table public.mkt_documents
    add constraint mkt_documents_source_fields_check
    check (
      (source_type = 'upload' and storage_path is not null)
      or (source_type <> 'upload' and external_url is not null)
    );
exception when duplicate_object then null; end $$;

create index if not exists idx_mkt_documents_tenant on public.mkt_documents(tenant_id, category, created_at desc) where deleted_at is null;
create index if not exists idx_mkt_documents_campaign on public.mkt_documents(tenant_id, campaign_id) where deleted_at is null;

-- updated_at (tái dùng public.mkt_set_updated_at từ 00168)
drop trigger if exists trg_mkt_documents_updated_at on public.mkt_documents;
create trigger trg_mkt_documents_updated_at before update on public.mkt_documents for each row execute function public.mkt_set_updated_at();

-- ── RLS: hiện cho ai có mkt.view (cấu hình không nhạy cảm); ghi qua RPC ──
alter table public.mkt_documents enable row level security;

drop policy if exists "mkt_documents_select" on public.mkt_documents;
create policy "mkt_documents_select" on public.mkt_documents for select using (
  tenant_id = public.get_user_tenant_id()
  and (select public.user_has_permission(auth.uid(), 'mkt.view'))
);

grant select on public.mkt_documents to authenticated;

-- ── Toàn vẹn tenant: hàm phụ RIÊNG (không đụng mkt_assert_tenant_links) ──
create or replace function public.mkt_assert_document_tenant_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    raise exception 'CROSS_TENANT_REFERENCE: missing tenant' using errcode = 'P0001';
  end if;
  if new.campaign_id is not null and not exists (
    select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.mkt_assert_document_tenant_links() from public, anon, authenticated;

drop trigger if exists trg_mkt_documents_tenant_links on public.mkt_documents;
create trigger trg_mkt_documents_tenant_links before insert or update on public.mkt_documents for each row execute function public.mkt_assert_document_tenant_links();

-- ── RPC — đăng ký tài liệu từ link (hoặc upload sau) ──
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
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  v_source := coalesce(nullif(p_source_type, ''), 'drive');
  if v_source not in ('drive', 'gdoc', 'gsheet', 'gslide', 'onedrive', 'pdf', 'office_link', 'upload', 'other') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if v_source = 'upload' and nullif(trim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if v_source <> 'upload' and nullif(trim(coalesce(p_external_url, '')), '') is null then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  v_category := coalesce(nullif(p_category, ''), 'other');
  if v_category not in ('brief', 'brand', 'price', 'contract', 'report', 'other') then
    v_category := 'other';
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  insert into public.mkt_documents (
    tenant_id, campaign_id, title, description, category, source_type,
    external_url, external_id, thumbnail_url, mime_type, storage_path, size_bytes,
    status, uploaded_by
  ) values (
    v_tenant, p_campaign_id, p_title, nullif(p_description, ''), v_category, v_source,
    nullif(p_external_url, ''), nullif(p_external_id, ''), nullif(p_thumbnail_url, ''),
    nullif(p_mime_type, ''), nullif(p_storage_path, ''), p_size_bytes,
    'available', v_actor
  )
  returning id into v_id;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_document_registered', 'mkt_document', v_id, null, jsonb_build_object('title', p_title, 'source', v_source, 'category', v_category));
  return jsonb_build_object('success', true, 'documentId', v_id);
end;
$$;

-- ── RPC — đổi trạng thái (available ↔ archived) ──
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
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_status not in ('available', 'archived') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_documents set status = p_status
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_document_status_changed', 'mkt_document', p_id, null, jsonb_build_object('status', p_status));
  return jsonb_build_object('success', true);
end;
$$;

-- ── RPC — xoá mềm (dọn thư viện) ──
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
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.view') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_documents set deleted_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_document_removed', 'mkt_document', p_id, null, null);
  return jsonb_build_object('success', true);
end;
$$;

-- ── Khóa quyền EXECUTE ──
revoke all on function public.mkt_document_register(text, text, text, text, text, text, text, text, text, bigint, uuid) from public, anon;
revoke all on function public.mkt_document_set_status(uuid, text) from public, anon;
revoke all on function public.mkt_document_remove(uuid) from public, anon;

grant execute on function public.mkt_document_register(text, text, text, text, text, text, text, text, text, bigint, uuid) to authenticated;
grant execute on function public.mkt_document_set_status(uuid, text) to authenticated;
grant execute on function public.mkt_document_remove(uuid) to authenticated;

notify pgrst, 'reload schema';
