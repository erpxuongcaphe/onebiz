-- ============================================================
-- 00180: Bottom-Up Channel Planning — nền dữ liệu (Đợt 0)
--
-- Thêm lớp "Lập kế hoạch kênh" giữa Work Package và sinh Task:
-- Leader giao gói việc cho Channel Owner (owner_id) → Owner tự soạn Plan Item
-- → nộp → Leader duyệt kế hoạch → APPROVED mới sinh task thật.
--
-- Đợt 0 CHỈ dựng nền, KHÔNG đổi hành vi luồng "Chia Task Ngay" hiện tại:
--   - 4 bảng: mkt_channel_plans / _items / _versions / _reviews
--   - 3 cột truy vết nullable trên mkt_tasks (task sinh từ plan set 3 cột này;
--     task direct-split để null). Task vẫn dùng source_type='campaign_channel_split'
--     nên KHÔNG đụng CHECK source_type lẫn trigger mkt_assert_tenant_links.
--   - Thêm giá trị status 'planning' cho mkt_channel_work_packages (ALTER additive).
--   - RLS chỉ SELECT (ghi qua RPC SECURITY DEFINER ở đợt sau).
--   - Hàm phụ mkt_assert_plan_tenant_links (toàn vẹn tenant cho bảng plan + 3 cột
--     mới) — tách riêng để KHÔNG phải định nghĩa lại hàm hardening 145 dòng.
--
-- Convention: gen_random_uuid() (pg_catalog, không phụ thuộc extension).
-- ============================================================

-- ── Bảng ────────────────────────────────────────────────────────
create table if not exists public.mkt_channel_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_package_id uuid not null unique references public.mkt_channel_work_packages(id) on delete cascade,
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  objective text,
  key_message text,
  mandatory_deliverables text,
  risk_notes text,
  deadline date,
  status text not null default 'planning'
    check (status in ('planning', 'submitted', 'revision_required', 'approved', 'in_execution', 'superseded', 'canceled')),
  version_number integer not null default 1 check (version_number > 0),
  current_version_id uuid,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  revision_count integer not null default 0 check (revision_count >= 0),
  generated_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.mkt_channel_plan_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.mkt_channel_plans(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'revision_required', 'rejected', 'superseded')),
  change_summary text,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_action text check (review_action in ('approve', 'request_revision', 'reject')),
  review_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, version_number)
);

create table if not exists public.mkt_channel_plan_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.mkt_channel_plans(id) on delete cascade,
  title text not null,
  task_type text not null default 'idea'
    check (task_type in ('idea', 'shooting', 'editing', 'review', 'publish', 'report', 'ops', 'finance', 'other')),
  description text,
  content_angle text,
  deliverable text,
  suggested_assignee_id uuid references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  content_item_id uuid references public.mkt_content_items(id) on delete set null,
  workload_points integer not null default 1 check (workload_points > 0),
  due_at timestamptz,
  sequence integer not null default 0,
  is_mandatory boolean not null default false,
  depends_on_item_id uuid references public.mkt_channel_plan_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mkt_channel_plan_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.mkt_channel_plans(id) on delete cascade,
  plan_version_id uuid references public.mkt_channel_plan_versions(id) on delete set null,
  reviewer_id uuid not null references public.profiles(id),
  action text not null check (action in ('approve', 'request_revision', 'reject')),
  comment text,
  created_at timestamptz not null default now()
);

-- ── Index ───────────────────────────────────────────────────────
create index if not exists idx_mkt_channel_plans_wp on public.mkt_channel_plans(tenant_id, work_package_id) where deleted_at is null;
create index if not exists idx_mkt_channel_plans_status on public.mkt_channel_plans(tenant_id, status) where deleted_at is null;
create index if not exists idx_mkt_plan_items_plan on public.mkt_channel_plan_items(plan_id, sequence);
create index if not exists idx_mkt_plan_versions_plan on public.mkt_channel_plan_versions(plan_id, version_number desc);
create index if not exists idx_mkt_plan_reviews_plan on public.mkt_channel_plan_reviews(plan_id, created_at desc);

-- ── Cột truy vết trên mkt_tasks (nullable; direct-split để null) ──
alter table public.mkt_tasks add column if not exists channel_plan_id uuid references public.mkt_channel_plans(id) on delete set null;
alter table public.mkt_tasks add column if not exists channel_plan_version_id uuid references public.mkt_channel_plan_versions(id) on delete set null;
alter table public.mkt_tasks add column if not exists channel_plan_item_id uuid references public.mkt_channel_plan_items(id) on delete set null;
create index if not exists idx_mkt_tasks_channel_plan on public.mkt_tasks(channel_plan_id) where channel_plan_id is not null;

-- ── Thêm trạng thái 'planning' cho Work Package (phân luồng 2 nhánh) ──
alter table public.mkt_channel_work_packages drop constraint if exists mkt_channel_work_packages_status_check;
alter table public.mkt_channel_work_packages add constraint mkt_channel_work_packages_status_check
  check (status in ('draft', 'needs_split', 'planning', 'split_completed', 'in_progress', 'completed', 'canceled'));

-- ── Trigger updated_at ───────────────────────────────────────────
drop trigger if exists trg_mkt_channel_plans_updated_at on public.mkt_channel_plans;
create trigger trg_mkt_channel_plans_updated_at before update on public.mkt_channel_plans for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_channel_plan_items_updated_at on public.mkt_channel_plan_items;
create trigger trg_mkt_channel_plan_items_updated_at before update on public.mkt_channel_plan_items for each row execute function public.mkt_set_updated_at();
drop trigger if exists trg_mkt_channel_plan_versions_updated_at on public.mkt_channel_plan_versions;
create trigger trg_mkt_channel_plan_versions_updated_at before update on public.mkt_channel_plan_versions for each row execute function public.mkt_set_updated_at();

-- ── RLS (chỉ SELECT; ghi đi qua RPC SECURITY DEFINER) ────────────
alter table public.mkt_channel_plans enable row level security;
alter table public.mkt_channel_plan_versions enable row level security;
alter table public.mkt_channel_plan_items enable row level security;
alter table public.mkt_channel_plan_reviews enable row level security;

-- Helper: ai được đọc plan? Leader toàn cảnh; hoặc Owner/Reviewer của gói việc.
-- SECURITY DEFINER + stable, gọi (select ...) trong policy như mkt_is_lead.
create or replace function public.mkt_can_read_plan(p_plan_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.mkt_is_lead())
    or exists (
      select 1 from public.mkt_channel_plans pl
      where pl.id = p_plan_id and pl.tenant_id = public.get_user_tenant_id()
        and (
          pl.owner_id = auth.uid() or pl.reviewer_id = auth.uid()
          or exists (
            select 1 from public.mkt_channel_work_packages wp
            where wp.id = pl.work_package_id
              and (wp.owner_id = auth.uid() or wp.reviewer_id = auth.uid())
          )
        )
    );
$$;
revoke all on function public.mkt_can_read_plan(uuid) from public;
grant execute on function public.mkt_can_read_plan(uuid) to authenticated;

drop policy if exists "mkt_channel_plans_select" on public.mkt_channel_plans;
create policy "mkt_channel_plans_select" on public.mkt_channel_plans for select using (
  tenant_id = public.get_user_tenant_id() and (select public.mkt_can_read_plan(id))
);
drop policy if exists "mkt_plan_items_select" on public.mkt_channel_plan_items;
create policy "mkt_plan_items_select" on public.mkt_channel_plan_items for select using (
  tenant_id = public.get_user_tenant_id() and (select public.mkt_can_read_plan(plan_id))
);
drop policy if exists "mkt_plan_versions_select" on public.mkt_channel_plan_versions;
create policy "mkt_plan_versions_select" on public.mkt_channel_plan_versions for select using (
  tenant_id = public.get_user_tenant_id() and (select public.mkt_can_read_plan(plan_id))
);
drop policy if exists "mkt_plan_reviews_select" on public.mkt_channel_plan_reviews;
create policy "mkt_plan_reviews_select" on public.mkt_channel_plan_reviews for select using (
  tenant_id = public.get_user_tenant_id() and (select public.mkt_can_read_plan(plan_id))
);

grant select on public.mkt_channel_plans to authenticated;
grant select on public.mkt_channel_plan_versions to authenticated;
grant select on public.mkt_channel_plan_items to authenticated;
grant select on public.mkt_channel_plan_reviews to authenticated;

-- ── Toàn vẹn tenant cho bảng plan + 3 cột mới trên mkt_tasks ──────
-- Hàm phụ riêng (KHÔNG đụng mkt_assert_tenant_links để tránh chép lại 145 dòng
-- hàm hardening). Gắn thêm 1 trigger BEFORE cho 4 bảng plan + mkt_tasks.
create or replace function public.mkt_assert_plan_tenant_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    raise exception 'CROSS_TENANT_REFERENCE: missing tenant' using errcode = 'P0001';
  end if;

  if tg_table_name = 'mkt_channel_plans' then
    if not exists (select 1 from public.mkt_channel_work_packages wp where wp.id = new.work_package_id and wp.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: work package' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.mkt_campaigns c where c.id = new.campaign_id and c.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: campaign' using errcode = 'P0001'; end if;
    if new.owner_id is not null and not exists (select 1 from public.profiles p where p.id = new.owner_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: owner' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_channel_plan_items' then
    if not exists (select 1 from public.mkt_channel_plans pl where pl.id = new.plan_id and pl.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: plan' using errcode = 'P0001'; end if;
    if new.suggested_assignee_id is not null and not exists (select 1 from public.profiles p where p.id = new.suggested_assignee_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: assignee' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;
    if new.content_item_id is not null and not exists (select 1 from public.mkt_content_items ci where ci.id = new.content_item_id and ci.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: content' using errcode = 'P0001'; end if;
    if new.depends_on_item_id is not null and not exists (select 1 from public.mkt_channel_plan_items d where d.id = new.depends_on_item_id and d.tenant_id = new.tenant_id and d.plan_id = new.plan_id) then
      raise exception 'CROSS_TENANT_REFERENCE: dependency' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_channel_plan_versions' then
    if not exists (select 1 from public.mkt_channel_plans pl where pl.id = new.plan_id and pl.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: plan' using errcode = 'P0001'; end if;
    if new.submitted_by is not null and not exists (select 1 from public.profiles p where p.id = new.submitted_by and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: submitter' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_channel_plan_reviews' then
    if not exists (select 1 from public.mkt_channel_plans pl where pl.id = new.plan_id and pl.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: plan' using errcode = 'P0001'; end if;
    if new.plan_version_id is not null and not exists (select 1 from public.mkt_channel_plan_versions v where v.id = new.plan_version_id and v.plan_id = new.plan_id and v.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: version' using errcode = 'P0001'; end if;
    if new.reviewer_id is not null and not exists (select 1 from public.profiles p where p.id = new.reviewer_id and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: reviewer' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_tasks' then
    if new.channel_plan_id is not null and not exists (select 1 from public.mkt_channel_plans pl where pl.id = new.channel_plan_id and pl.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: channel plan' using errcode = 'P0001'; end if;
    if new.channel_plan_version_id is not null and not exists (select 1 from public.mkt_channel_plan_versions v where v.id = new.channel_plan_version_id and v.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: plan version' using errcode = 'P0001'; end if;
    if new.channel_plan_item_id is not null and not exists (select 1 from public.mkt_channel_plan_items i where i.id = new.channel_plan_item_id and i.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: plan item' using errcode = 'P0001'; end if;
  end if;

  return new;
end;
$$;
revoke all on function public.mkt_assert_plan_tenant_links() from public, anon, authenticated;

do $ptrig$
declare
  v_table text;
begin
  foreach v_table in array array[
    'mkt_channel_plans', 'mkt_channel_plan_items', 'mkt_channel_plan_versions', 'mkt_channel_plan_reviews', 'mkt_tasks'
  ] loop
    execute format('drop trigger if exists trg_%I_plan_tenant_links on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_%I_plan_tenant_links before insert or update on public.%I for each row execute function public.mkt_assert_plan_tenant_links()',
      v_table, v_table
    );
  end loop;
end
$ptrig$;

notify pgrst, 'reload schema';
