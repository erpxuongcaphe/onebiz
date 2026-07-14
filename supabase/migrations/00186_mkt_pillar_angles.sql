-- ============================================================
-- 00186: MKT Content Pillars — Angles chi tiết + mô tả pillar
--
-- Nhu cầu (CEO 14/07): đưa Content Pillars ra thành mục riêng (không nằm trong
-- Cài đặt), và cập nhật CHI TIẾT theo file "Content Pillar.xlsx": mỗi Pillar có
-- nhiều "Angle" (góc nội dung), mỗi Angle gồm: Mô tả & Mục đích, Giai đoạn phễu
-- (funnel), Guideline/Check-list, Kênh, Format phù hợp.
--
-- Mô hình: Pillar (mkt_content_pillars, thêm description) 1—N Angle
-- (mkt_content_pillar_angles). Angle là văn bản tự do (đúng cách CEO viết trong
-- Excel — mô tả/checklist nhiều dòng). Reuse permission mkt.manage_campaigns.
-- ============================================================

-- Pillar: thêm mô tả tổng quan (tuỳ chọn)
alter table public.mkt_content_pillars add column if not exists description text;

-- ── Bảng Angle ──
create table if not exists public.mkt_content_pillar_angles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pillar_id uuid not null references public.mkt_content_pillars(id) on delete cascade,
  title text not null,
  description text,   -- Mô tả & Mục đích
  funnel text,        -- Giai đoạn phễu (VD: Awareness → Interest)
  guideline text,     -- Guideline / Check-list (nhiều dòng)
  channels text,      -- Kênh (nhiều dòng)
  format text,        -- Format phù hợp (nhiều dòng)
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_mkt_pillar_angles_pillar on public.mkt_content_pillar_angles(tenant_id, pillar_id, sort_order) where deleted_at is null;

drop trigger if exists trg_mkt_pillar_angles_updated_at on public.mkt_content_pillar_angles;
create trigger trg_mkt_pillar_angles_updated_at before update on public.mkt_content_pillar_angles for each row execute function public.mkt_set_updated_at();

-- ── RLS: hiện cho ai có mkt.view; ghi qua RPC ──
alter table public.mkt_content_pillar_angles enable row level security;

drop policy if exists "mkt_pillar_angles_select" on public.mkt_content_pillar_angles;
create policy "mkt_pillar_angles_select" on public.mkt_content_pillar_angles for select using (
  tenant_id = public.get_user_tenant_id()
  and (select public.user_has_permission(auth.uid(), 'mkt.view'))
);

grant select on public.mkt_content_pillar_angles to authenticated;

-- ── Toàn vẹn tenant: angle.pillar_id phải cùng tenant ──
create or replace function public.mkt_assert_pillar_angle_tenant_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    raise exception 'CROSS_TENANT_REFERENCE: missing tenant' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.mkt_content_pillars p where p.id = new.pillar_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'CROSS_TENANT_REFERENCE: pillar' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.mkt_assert_pillar_angle_tenant_links() from public, anon, authenticated;

drop trigger if exists trg_mkt_pillar_angles_tenant_links on public.mkt_content_pillar_angles;
create trigger trg_mkt_pillar_angles_tenant_links before insert or update on public.mkt_content_pillar_angles for each row execute function public.mkt_assert_pillar_angle_tenant_links();

-- ── Mở rộng mkt_pillar_upsert: thêm p_description (đổi chữ ký → DROP trước) ──
drop function if exists public.mkt_pillar_upsert(uuid, text, text, text, integer);

create or replace function public.mkt_pillar_upsert(
  p_id uuid,
  p_code text,
  p_name text,
  p_color text default '#708090',
  p_sort_order integer default 0,
  p_description text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_code, '')), '') is null or nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();

  if p_id is null then
    insert into public.mkt_content_pillars (tenant_id, code, name, color, sort_order, description)
    values (v_tenant, p_code, p_name, coalesce(nullif(p_color, ''), '#708090'), coalesce(p_sort_order, 0), nullif(p_description, ''))
    on conflict (tenant_id, code) do update set
      name = excluded.name, color = excluded.color, sort_order = excluded.sort_order,
      description = excluded.description, is_active = true, deleted_at = null, updated_at = now()
    returning id into v_id;
  else
    update public.mkt_content_pillars set
      code = p_code, name = p_name, color = coalesce(nullif(p_color, ''), color),
      sort_order = coalesce(p_sort_order, sort_order), description = nullif(p_description, '')
    where id = p_id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_pillar_upserted', 'mkt_content_pillar', v_id, null, jsonb_build_object('code', p_code, 'name', p_name));
  return jsonb_build_object('success', true, 'pillarId', v_id);
end;
$$;

revoke all on function public.mkt_pillar_upsert(uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.mkt_pillar_upsert(uuid, text, text, text, integer, text) to authenticated;

-- ── RPC — Angle: thêm/sửa ──
create or replace function public.mkt_pillar_angle_upsert(
  p_id uuid,
  p_pillar_id uuid,
  p_title text,
  p_description text default null,
  p_funnel text default null,
  p_guideline text default null,
  p_channels text default null,
  p_format text default null,
  p_sort_order integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  -- Pillar phải thuộc tenant hiện tại
  if not exists (select 1 from public.mkt_content_pillars where id = p_pillar_id and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.mkt_content_pillar_angles (
      tenant_id, pillar_id, title, description, funnel, guideline, channels, format, sort_order
    ) values (
      v_tenant, p_pillar_id, p_title, nullif(p_description, ''), nullif(p_funnel, ''),
      nullif(p_guideline, ''), nullif(p_channels, ''), nullif(p_format, ''), coalesce(p_sort_order, 0)
    )
    returning id into v_id;
  else
    update public.mkt_content_pillar_angles set
      pillar_id = p_pillar_id, title = p_title, description = nullif(p_description, ''),
      funnel = nullif(p_funnel, ''), guideline = nullif(p_guideline, ''),
      channels = nullif(p_channels, ''), format = nullif(p_format, ''),
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_id and tenant_id = v_tenant and deleted_at is null
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_pillar_angle_upserted', 'mkt_pillar_angle', v_id, null, jsonb_build_object('title', p_title, 'pillar_id', p_pillar_id));
  return jsonb_build_object('success', true, 'angleId', v_id);
end;
$$;

-- ── RPC — Angle: xoá mềm ──
create or replace function public.mkt_pillar_angle_remove(p_id uuid)
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
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  v_tenant := public.get_user_tenant_id();

  update public.mkt_content_pillar_angles set deleted_at = now()
  where id = p_id and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_pillar_angle_removed', 'mkt_pillar_angle', p_id, null, null);
  return jsonb_build_object('success', true);
end;
$$;

-- ── Khóa quyền EXECUTE ──
revoke all on function public.mkt_pillar_angle_upsert(uuid, uuid, text, text, text, text, text, text, integer) from public, anon;
revoke all on function public.mkt_pillar_angle_remove(uuid) from public, anon;
grant execute on function public.mkt_pillar_angle_upsert(uuid, uuid, text, text, text, text, text, text, integer) to authenticated;
grant execute on function public.mkt_pillar_angle_remove(uuid) to authenticated;

notify pgrst, 'reload schema';
