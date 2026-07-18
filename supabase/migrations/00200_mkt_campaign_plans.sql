-- ============================================================
-- 00200: Cây kế hoạch 4 CẤP — chèn tầng "KẾ HOẠCH" (cấp 2) gom kênh
--
-- CEO 18/07 (chốt Hướng A): "1 chiến dịch → nhiều kế hoạch → mỗi kế hoạch
-- nhiều kênh → mỗi kênh nhiều kế hoạch phụ". Đánh số Cấp 1/2/3/4.
--
--   Cấp 1 · Chiến dịch  = mkt_campaigns (có sẵn)
--   Cấp 2 · Kế hoạch    = mkt_campaign_plans (BẢNG NÀY — gom nhiều kênh)
--   Cấp 3 · Kênh        = mkt_channel_work_packages (thêm campaign_plan_id)
--   Cấp 4 · Kế hoạch phụ = mkt_channel_plan_stages (00199)
--   Công đoạn → Việc     = mkt_channel_plan_items → mkt_tasks
--
-- QUYẾT ĐỊNH THIẾT KẾ (đã trình CEO): Cấp 2 là tầng TỔ CHỨC (như thư mục gom
-- kênh) — KHÔNG có vòng nộp/duyệt/sinh việc riêng. Vòng quy trình vẫn ở Cấp 3
-- (Kênh) như đang chạy. Giữ nguyên toàn bộ luồng đã ổn định (rủi ro thấp);
-- đội nhỏ không cần 4 tầng duyệt. Cấp 2 chỉ có tên + mục tiêu + người phụ
-- trách + khung thời gian; số liệu TỰ TỔNG HỢP từ các kênh con (đọc phía app).
--
-- KHOÁ AN TOÀN (theo sổ bẫy):
--   • Kênh gắn cấp 2: cột nullable + on delete set null → xoá Kế hoạch KHÔNG
--     mất kênh (kênh về "chưa xếp"). Kế hoạch cũ chạy y nguyên.
--   • mkt_create_work_package ĐỔI CHỮ KÝ (thêm p_campaign_plan_id) → DROP +
--     tạo lại + grant lại (42P13). Thân chép nguyên văn 00170, chỉ thêm cột.
--   • RLS đọc theo mkt.view (cùng chuẩn campaign/work_package — cấp 2 là tầng
--     tổ chức của chiến dịch, KHÔNG phải dữ liệu kế hoạch nhạy cảm cấp kênh).
--   • Trigger chống ghép chéo tenant (hàm phụ riêng, không đụng hàm hardening).
--   • Số migration: 00200 (00199 vừa xong; 00196–00198 luồng Báo cáo).
-- ============================================================

-- ── 1. Bảng CẤP 2 · KẾ HOẠCH ────────────────────────────────────
create table if not exists public.mkt_campaign_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  name text not null,
  objective text,
  owner_id uuid references public.profiles(id) on delete set null,
  timeframe_start date,
  timeframe_end date,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (timeframe_start is null or timeframe_end is null or timeframe_end >= timeframe_start)
);

create index if not exists idx_mkt_campaign_plans_campaign
  on public.mkt_campaign_plans(tenant_id, campaign_id, sort_order) where deleted_at is null;

drop trigger if exists trg_mkt_campaign_plans_updated_at on public.mkt_campaign_plans;
create trigger trg_mkt_campaign_plans_updated_at
  before update on public.mkt_campaign_plans
  for each row execute function public.mkt_set_updated_at();

-- Kênh thuộc "Kế hoạch" cấp 2 nào (null = chưa xếp).
alter table public.mkt_channel_work_packages
  add column if not exists campaign_plan_id uuid
    references public.mkt_campaign_plans(id) on delete set null;

create index if not exists idx_mkt_wp_campaign_plan
  on public.mkt_channel_work_packages(campaign_plan_id) where deleted_at is null;

-- ── 2. RLS ──────────────────────────────────────────────────────
alter table public.mkt_campaign_plans enable row level security;
drop policy if exists "mkt_campaign_plans_select" on public.mkt_campaign_plans;
create policy "mkt_campaign_plans_select" on public.mkt_campaign_plans for select using (
  tenant_id = public.get_user_tenant_id() and public.user_has_permission(auth.uid(), 'mkt.view')
);
grant select on public.mkt_campaign_plans to authenticated;

-- ── 3. Toàn vẹn tenant (hàm phụ riêng, KHÔNG đụng hàm hardening) ─
create or replace function public.mkt_assert_campaign_plan_tenant_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    raise exception 'CROSS_TENANT_REFERENCE: missing tenant' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id) then
    raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001';
  end if;
  if new.owner_id is not null and not exists (select 1 from public.profiles p where p.id = new.owner_id and p.tenant_id = new.tenant_id) then
    raise exception 'CROSS_TENANT_REFERENCE: owner' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mkt_campaign_plans_tenant on public.mkt_campaign_plans;
create trigger trg_mkt_campaign_plans_tenant
  before insert or update on public.mkt_campaign_plans
  for each row execute function public.mkt_assert_campaign_plan_tenant_links();

-- Kênh gắn cấp 2: phải thuộc ĐÚNG chiến dịch của kênh đó.
create or replace function public.mkt_assert_wp_campaign_plan_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.campaign_plan_id is not null and not exists (
    select 1 from public.mkt_campaign_plans cp
    where cp.id = new.campaign_plan_id
      and cp.campaign_id = new.campaign_id
      and cp.tenant_id = new.tenant_id
      and cp.deleted_at is null
  ) then
    raise exception 'CROSS_TENANT_REFERENCE: campaign_plan' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mkt_wp_campaign_plan on public.mkt_channel_work_packages;
create trigger trg_mkt_wp_campaign_plan
  before insert or update on public.mkt_channel_work_packages
  for each row execute function public.mkt_assert_wp_campaign_plan_link();

-- ── 4. RPC: tạo/sửa "Kế hoạch" cấp 2 ────────────────────────────
create or replace function public.mkt_campaign_plan_upsert(
  p_id uuid,
  p_campaign_id uuid,
  p_name text,
  p_objective text default null,
  p_owner_id uuid default null,
  p_timeframe_start date default null,
  p_timeframe_end date default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_campaign record;
  v_id uuid;
  v_sort integer;
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
    update public.mkt_campaign_plans set
      name = trim(p_name),
      objective = nullif(trim(coalesce(p_objective, '')), ''),
      owner_id = p_owner_id,
      timeframe_start = p_timeframe_start,
      timeframe_end = p_timeframe_end,
      updated_by = v_actor
    where id = p_id and campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  else
    select coalesce(max(sort_order) + 1, 0) into v_sort
    from public.mkt_campaign_plans where campaign_id = p_campaign_id and deleted_at is null;
    insert into public.mkt_campaign_plans (
      tenant_id, campaign_id, name, objective, owner_id, timeframe_start, timeframe_end, sort_order, created_by, updated_by
    ) values (
      v_tenant, p_campaign_id, trim(p_name), nullif(trim(coalesce(p_objective, '')), ''),
      p_owner_id, p_timeframe_start, p_timeframe_end, v_sort, v_actor, v_actor
    ) returning id into v_id;
  end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_campaign_plan_upsert', 'mkt_campaign_plan', v_id, null, jsonb_build_object('name', trim(p_name)));
  return jsonb_build_object('success', true, 'campaignPlanId', v_id);
end;
$$;

-- ── 5. RPC: xoá mềm "Kế hoạch" cấp 2 (kênh con về "chưa xếp") ───
create or replace function public.mkt_campaign_plan_delete(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_plan record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();
  select * into v_plan from public.mkt_campaign_plans where id = p_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- Kênh con về "chưa xếp" — KHÔNG xoá kênh (dữ liệu kế hoạch/việc còn nguyên).
  update public.mkt_channel_work_packages
  set campaign_plan_id = null, updated_by = v_actor
  where campaign_plan_id = p_id and tenant_id = v_tenant;

  update public.mkt_campaign_plans set deleted_at = now(), updated_by = v_actor where id = p_id;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_campaign_plan_deleted', 'mkt_campaign_plan', p_id, to_jsonb(v_plan), null);
  return jsonb_build_object('success', true);
end;
$$;

-- ── 6. Tạo Kênh — ĐỔI CHỮ KÝ (thêm p_campaign_plan_id) ──────────
-- Chép nguyên văn 00170; thêm cột campaign_plan_id + guard thuộc đúng chiến dịch.
drop function if exists public.mkt_create_work_package(uuid, text, text, text, uuid, uuid);

create or replace function public.mkt_create_work_package(
  p_campaign_id uuid,
  p_channel_type text,
  p_title text,
  p_target_output text default null,
  p_owner_id uuid default null,
  p_reviewer_id uuid default null,
  p_campaign_plan_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign record;
  v_id uuid;
  v_plan_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not (public.user_has_permission(v_actor, 'mkt.manage_campaigns') or public.user_has_permission(v_actor, 'mkt.split_work_packages')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null;
  if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- 00200: nhận Kế hoạch cấp 2 nếu thuộc ĐÚNG chiến dịch này (không thì để null).
  v_plan_id := p_campaign_plan_id;
  if v_plan_id is not null and not exists (
    select 1 from public.mkt_campaign_plans cp
    where cp.id = v_plan_id and cp.campaign_id = p_campaign_id and cp.tenant_id = v_campaign.tenant_id and cp.deleted_at is null
  ) then
    v_plan_id := null;
  end if;

  insert into public.mkt_channel_work_packages (
    tenant_id, campaign_id, channel_type, title, target_output, owner_id, reviewer_id,
    status, campaign_plan_id, created_by, updated_by
  ) values (
    v_campaign.tenant_id, p_campaign_id, p_channel_type, p_title, nullif(p_target_output, ''),
    p_owner_id, p_reviewer_id, 'needs_split', v_plan_id, v_actor, v_actor
  )
  returning id into v_id;

  perform public.mkt_record_audit(v_campaign.tenant_id, v_actor, 'mkt_work_package_created', 'mkt_work_package', v_id, null, jsonb_build_object('title', p_title, 'channel', p_channel_type));
  return jsonb_build_object('success', true, 'workPackageId', v_id);
end;
$$;

-- ── 7. Đổi kênh sang Kế hoạch cấp 2 khác (kéo-thả sau này) ──────
create or replace function public.mkt_work_package_set_campaign_plan(p_work_package_id uuid, p_campaign_plan_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_wp record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();
  select * into v_wp from public.mkt_channel_work_packages where id = p_work_package_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- null = bỏ khỏi mọi Kế hoạch (về "chưa xếp"); guard trigger soi thuộc đúng chiến dịch.
  update public.mkt_channel_work_packages
  set campaign_plan_id = p_campaign_plan_id, updated_by = v_actor
  where id = p_work_package_id;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_work_package_moved_plan', 'mkt_work_package', p_work_package_id,
    jsonb_build_object('from', v_wp.campaign_plan_id), jsonb_build_object('to', p_campaign_plan_id));
  return jsonb_build_object('success', true);
end;
$$;

-- ── 8. Quyền gọi hàm ────────────────────────────────────────────
revoke all on function public.mkt_assert_campaign_plan_tenant_links() from public, anon, authenticated;
revoke all on function public.mkt_assert_wp_campaign_plan_link() from public, anon, authenticated;
revoke all on function public.mkt_campaign_plan_upsert(uuid, uuid, text, text, uuid, date, date) from public, anon;
revoke all on function public.mkt_campaign_plan_delete(uuid) from public, anon;
revoke all on function public.mkt_create_work_package(uuid, text, text, text, uuid, uuid, uuid) from public, anon;
revoke all on function public.mkt_work_package_set_campaign_plan(uuid, uuid) from public, anon;
grant execute on function public.mkt_campaign_plan_upsert(uuid, uuid, text, text, uuid, date, date) to authenticated;
grant execute on function public.mkt_campaign_plan_delete(uuid) to authenticated;
grant execute on function public.mkt_create_work_package(uuid, text, text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.mkt_work_package_set_campaign_plan(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
