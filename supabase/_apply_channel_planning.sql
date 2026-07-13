-- ============================================================
-- GỘP CHẠY MỘT LẦN — Bottom-Up Channel Planning (00180 → 00184)
-- Dán TOÀN BỘ file này vào Supabase SQL Editor và Run.
-- (Nếu popup hỏi RLS: chọn "Run without RLS" — script tự set RLS riêng.)
-- Các lệnh additive, an toàn chạy lại; KHÔNG đụng dữ liệu/luồng hiện có.
-- ============================================================



-- ========== 00180_mkt_channel_planning.sql ==========
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


-- ========== 00181_mkt_channel_planning_dot1.sql ==========
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


-- ========== 00182_mkt_channel_planning_dot2.sql ==========
-- ============================================================
-- 00182: Bottom-Up Channel Planning — RPC Đợt 2 (Nộp + Duyệt + Sinh task)
--
-- mkt_submit_plan: Owner nộp — validate + tạo version snapshot bất biến +
--   optimistic lock; notify Leader (người đã giao).
-- mkt_review_plan: Leader duyệt/yêu cầu sửa/từ chối; APPROVE tự sinh task.
-- mkt_generate_tasks_from_plan_internal: sinh task từ snapshot đã duyệt
--   (sao logic 2-pass của mkt_split_work_package), giữ traceability.
-- ============================================================

-- ── Sinh task (internal — chỉ RPC nội bộ gọi) ────────────────────
create or replace function public.mkt_generate_tasks_from_plan_internal(p_plan_id uuid, p_actor uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_plan record;
  v_version_id uuid;
  v_items jsonb;
  v_it jsonb;
  v_item_id text;
  v_task_id uuid;
  v_map jsonb := '{}'::jsonb;
  v_dep_item text;
  v_dep_task uuid;
  v_count integer := 0;
begin
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_plan.status <> 'approved' then raise exception 'ALREADY_PROCESSED' using errcode = 'P0001'; end if;
  v_version_id := v_plan.current_version_id;

  select snapshot -> 'items' into v_items from public.mkt_channel_plan_versions where id = v_version_id;
  if v_items is null or jsonb_typeof(v_items) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- Pass 1: map plan_item_id → task uuid (để nối dependency trong cùng lô)
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    if v_item_id is not null then
      v_map := jsonb_set(v_map, array[v_item_id], to_jsonb(gen_random_uuid()::text), true);
    end if;
  end loop;

  -- Pass 2: sinh task thật
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_item_id := v_it ->> 'id';
    v_task_id := (v_map ->> v_item_id)::uuid;
    v_dep_item := nullif(v_it ->> 'depends_on_item_id', '');
    v_dep_task := case when v_dep_item is not null then nullif(v_map ->> v_dep_item, '')::uuid else null end;

    insert into public.mkt_tasks (
      id, tenant_id, campaign_id, work_package_id, content_item_id, title, description,
      source_type, source_id, task_type, assignee_id, reviewer_id, dependency_task_id,
      workload_points, acceptance_status, task_status, blocked_reason, due_at,
      channel_plan_id, channel_plan_version_id, channel_plan_item_id, created_by, updated_by
    ) values (
      v_task_id, v_plan.tenant_id, v_plan.campaign_id, v_plan.work_package_id,
      nullif(v_it ->> 'content_item_id', '')::uuid, v_it ->> 'title', nullif(v_it ->> 'description', ''),
      'campaign_channel_split', v_plan.work_package_id,
      coalesce(nullif(v_it ->> 'task_type', ''), 'idea'),
      (v_it ->> 'suggested_assignee_id')::uuid, nullif(v_it ->> 'reviewer_id', '')::uuid, v_dep_task,
      coalesce(nullif(v_it ->> 'workload_points', '')::integer, 1),
      'pending',
      case when v_dep_task is null then 'todo' else 'blocked' end,
      case when v_dep_task is null then null else 'DEPENDENCY_BLOCKED' end,
      nullif(v_it ->> 'due_at', '')::timestamptz,
      v_plan.id, v_version_id, v_item_id::uuid, p_actor, p_actor
    );

    perform public.mkt_enqueue_notification(
      v_plan.tenant_id, (v_it ->> 'suggested_assignee_id')::uuid, 'mkt_task_assigned',
      'Task MKT mới', v_it ->> 'title', 'mkt_task', v_task_id,
      '/mkt/tasks?task=' || v_task_id::text, '{}'::jsonb, 'mkt_task_assigned:' || v_task_id::text
    );
    v_count := v_count + 1;
  end loop;

  update public.mkt_channel_work_packages set status = 'split_completed', updated_by = p_actor where id = v_plan.work_package_id;
  update public.mkt_channel_plans set status = 'in_execution', generated_at = now(), updated_by = p_actor where id = p_plan_id;
  perform public.mkt_record_audit(v_plan.tenant_id, p_actor, 'mkt_tasks_generated_from_plan', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('task_count', v_count, 'version_id', v_version_id));
  return v_count;
end;
$$;
revoke all on function public.mkt_generate_tasks_from_plan_internal(uuid, uuid) from public, anon, authenticated;

-- ── Nộp kế hoạch (Owner) ─────────────────────────────────────────
create or replace function public.mkt_submit_plan(p_plan_id uuid, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_item record;
  v_count integer := 0;
  v_cur uuid;
  v_steps integer;
  v_snapshot jsonb;
  v_version_id uuid;
  v_wp_title text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status not in ('planning', 'revision_required') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_expected_version is not null and p_expected_version <> v_plan.version_number then raise exception 'PLAN_VERSION_CONFLICT' using errcode = 'P0001'; end if;

  select count(*) into v_count from public.mkt_channel_plan_items where plan_id = p_plan_id;
  if v_count = 0 then raise exception 'PLAN_VALIDATION_FAILED: cần ít nhất 1 công đoạn' using errcode = 'P0001'; end if;

  for v_item in select * from public.mkt_channel_plan_items where plan_id = p_plan_id loop
    if nullif(trim(coalesce(v_item.title, '')), '') is null then raise exception 'PLAN_VALIDATION_FAILED: có công đoạn chưa đặt tên' using errcode = 'P0001'; end if;
    if v_item.suggested_assignee_id is null then raise exception 'PLAN_VALIDATION_FAILED: công đoạn "%" chưa có người làm', v_item.title using errcode = 'P0001'; end if;
    if v_item.due_at is null then raise exception 'PLAN_VALIDATION_FAILED: công đoạn "%" chưa có hạn', v_item.title using errcode = 'P0001'; end if;
    if v_item.task_type in ('review', 'publish') and v_item.content_item_id is null then
      raise exception 'PLAN_VALIDATION_FAILED: công đoạn "%" (duyệt/đăng) cần gắn nội dung', v_item.title using errcode = 'P0001'; end if;
    if not exists (select 1 from public.profiles p where p.id = v_item.suggested_assignee_id and p.tenant_id = v_plan.tenant_id and coalesce(p.is_active, true)) then
      raise exception 'PLAN_VALIDATION_FAILED: người làm của công đoạn "%" không hợp lệ', v_item.title using errcode = 'P0001'; end if;
    -- Chống phụ thuộc vòng lặp / tự phụ thuộc
    if v_item.depends_on_item_id is not null then
      v_cur := v_item.depends_on_item_id;
      v_steps := 0;
      while v_cur is not null loop
        if v_cur = v_item.id then raise exception 'PLAN_VALIDATION_FAILED: phụ thuộc vòng lặp ở "%"', v_item.title using errcode = 'P0001'; end if;
        v_steps := v_steps + 1;
        if v_steps > v_count then raise exception 'PLAN_VALIDATION_FAILED: phụ thuộc vòng lặp' using errcode = 'P0001'; end if;
        select depends_on_item_id into v_cur from public.mkt_channel_plan_items where id = v_cur and plan_id = p_plan_id;
      end loop;
    end if;
  end loop;

  v_snapshot := jsonb_build_object(
    'header', jsonb_build_object(
      'objective', v_plan.objective, 'keyMessage', v_plan.key_message,
      'mandatoryDeliverables', v_plan.mandatory_deliverables, 'riskNotes', v_plan.risk_notes, 'deadline', v_plan.deadline
    ),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sequence, i.created_at) from public.mkt_channel_plan_items i where i.plan_id = p_plan_id), '[]'::jsonb)
  );

  insert into public.mkt_channel_plan_versions (tenant_id, plan_id, version_number, snapshot, status, submitted_by, submitted_at)
  values (v_plan.tenant_id, p_plan_id, v_plan.version_number, v_snapshot, 'submitted', v_actor, now())
  on conflict (plan_id, version_number) do update set snapshot = excluded.snapshot, status = 'submitted', submitted_by = v_actor, submitted_at = now()
  returning id into v_version_id;

  update public.mkt_channel_plans set status = 'submitted', submitted_at = now(), submitted_by = v_actor, current_version_id = v_version_id, updated_by = v_actor where id = p_plan_id;

  select title into v_wp_title from public.mkt_channel_work_packages where id = v_plan.work_package_id;
  if v_plan.created_by is not null then
    perform public.mkt_enqueue_notification(
      v_plan.tenant_id, v_plan.created_by, 'mkt_plan_submitted', 'Kế hoạch kênh chờ bạn duyệt', coalesce(v_wp_title, 'Gói việc'),
      'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb, 'mkt_plan_submitted:' || v_version_id::text
    );
  end if;
  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_submitted', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('version_id', v_version_id, 'item_count', v_count));
  return jsonb_build_object('success', true, 'versionId', v_version_id, 'versionNumber', v_plan.version_number);
end;
$$;
revoke all on function public.mkt_submit_plan(uuid, integer) from public, anon;
grant execute on function public.mkt_submit_plan(uuid, integer) to authenticated;

-- ── Duyệt kế hoạch (Leader) ──────────────────────────────────────
create or replace function public.mkt_review_plan(p_plan_id uuid, p_version_id uuid, p_action text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_task_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_action not in ('approve', 'request_revision', 'reject') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_action in ('request_revision', 'reject') and nullif(trim(coalesce(p_comment, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;

  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_plan.status <> 'submitted' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if v_plan.current_version_id is distinct from p_version_id then raise exception 'PLAN_VERSION_CONFLICT' using errcode = 'P0001'; end if;

  insert into public.mkt_channel_plan_reviews (tenant_id, plan_id, plan_version_id, reviewer_id, action, comment)
  values (v_plan.tenant_id, p_plan_id, p_version_id, v_actor, p_action, nullif(trim(coalesce(p_comment, '')), ''));

  update public.mkt_channel_plan_versions
  set status = case p_action when 'approve' then 'approved' when 'request_revision' then 'revision_required' else 'rejected' end,
      reviewed_by = v_actor, reviewed_at = now(), review_action = p_action, review_comment = nullif(trim(coalesce(p_comment, '')), '')
  where id = p_version_id;

  if p_action = 'approve' then
    update public.mkt_channel_plans set status = 'approved', approved_by = v_actor, approved_at = now(), updated_by = v_actor where id = p_plan_id;
    v_task_count := public.mkt_generate_tasks_from_plan_internal(p_plan_id, v_actor);
    perform public.mkt_enqueue_notification(v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_approved', 'Kế hoạch được duyệt — đã sinh việc', 'Kế hoạch kênh', 'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb, 'mkt_plan_approved:' || p_version_id::text);
  elsif p_action = 'request_revision' then
    update public.mkt_channel_plans set status = 'revision_required', version_number = v_plan.version_number + 1, revision_count = v_plan.revision_count + 1, updated_by = v_actor where id = p_plan_id;
    perform public.mkt_enqueue_notification(v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_revision', 'Kế hoạch cần sửa', p_comment, 'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb, 'mkt_plan_revision:' || p_version_id::text);
  else
    -- reject: huỷ + mở lại gói việc để Leader chọn hướng khác
    update public.mkt_channel_plans set status = 'canceled', deleted_at = now(), updated_by = v_actor where id = p_plan_id;
    update public.mkt_channel_work_packages set status = 'needs_split', updated_by = v_actor where id = v_plan.work_package_id;
    perform public.mkt_enqueue_notification(v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_rejected', 'Kế hoạch bị từ chối', p_comment, 'mkt_channel_plan', p_plan_id, '/mkt/planning', '{}'::jsonb, 'mkt_plan_rejected:' || p_version_id::text);
  end if;

  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_' || p_action, 'mkt_channel_plan', p_plan_id, to_jsonb(v_plan), jsonb_build_object('action', p_action, 'comment', p_comment, 'task_count', v_task_count));
  return jsonb_build_object('success', true, 'action', p_action, 'taskCount', v_task_count);
end;
$$;
revoke all on function public.mkt_review_plan(uuid, uuid, text, text) from public, anon;
grant execute on function public.mkt_review_plan(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';


-- ========== 00183_mkt_channel_planning_dot3.sql ==========
-- ============================================================
-- 00183: Bottom-Up Channel Planning — Đợt 3 (Đổi kế hoạch cơ bản)
--
-- mkt_open_plan_change_request: mở lại kế hoạch đã duyệt để chỉnh sửa —
--   CHỈ khi MỌI task sinh ra còn 'pending' (chưa ai nhận, chưa chạy).
--   Huỷ mềm các task pending → supersede version → plan về 'planning' →
--   Owner sửa lại → nộp → duyệt → sinh lại task.
--   Nếu có task đã nhận/đang chạy → PLAN_TASKS_IN_PROGRESS (để Đợt 4 xử lý
--   reconcile giữ/huỷ/đổi người/thay thế từng task).
-- ============================================================

create or replace function public.mkt_open_plan_change_request(p_plan_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_blocking integer;
  v_canceled integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;

  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status <> 'in_execution' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- Chỉ cho đổi "êm" khi mọi task còn pending + chưa bắt đầu (todo/blocked).
  select count(*) into v_blocking from public.mkt_tasks
  where channel_plan_id = p_plan_id and deleted_at is null
    and not (acceptance_status = 'pending' and task_status in ('todo', 'blocked'));
  if v_blocking > 0 then raise exception 'PLAN_TASKS_IN_PROGRESS' using errcode = 'P0001'; end if;

  -- Huỷ mềm task pending (sẽ sinh lại sau khi duyệt bản mới)
  update public.mkt_tasks set task_status = 'canceled', deleted_at = now(), updated_by = v_actor
  where channel_plan_id = p_plan_id and deleted_at is null;
  get diagnostics v_canceled = row_count;

  update public.mkt_channel_plan_versions set status = 'superseded' where id = v_plan.current_version_id;
  update public.mkt_channel_plans
  set status = 'planning', version_number = v_plan.version_number + 1, revision_count = v_plan.revision_count + 1, updated_by = v_actor
  where id = p_plan_id;
  update public.mkt_channel_work_packages set status = 'planning', updated_by = v_actor where id = v_plan.work_package_id;

  perform public.mkt_enqueue_notification(
    v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_change_requested', 'Kế hoạch mở lại để chỉnh sửa', p_reason,
    'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb,
    'mkt_plan_change:' || p_plan_id::text || ':' || (v_plan.version_number + 1)::text
  );
  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_change_requested', 'mkt_channel_plan', p_plan_id, to_jsonb(v_plan), jsonb_build_object('reason', p_reason, 'canceled_tasks', v_canceled));
  return jsonb_build_object('success', true, 'canceledTasks', v_canceled, 'versionNumber', v_plan.version_number + 1);
end;
$$;
revoke all on function public.mkt_open_plan_change_request(uuid, text) from public, anon;
grant execute on function public.mkt_open_plan_change_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';


-- ========== 00184_mkt_channel_planning_dot4.sql ==========
-- ============================================================
-- 00184: Bottom-Up Channel Planning — Đợt 4 (Điều chỉnh việc đã chạy)
--
-- Khi kế hoạch đã sinh việc và có việc đã nhận/đang chạy, Change Request "êm"
-- (00183) bị chặn. Đợt 4 cho Leader điều chỉnh TỪNG việc theo quyết định:
--   keep      — giữ nguyên
--   cancel    — huỷ việc (không huỷ việc đã Done)
--   reassign  — đổi người (việc quay về Chờ nhận việc cho người mới)
-- ("Thay thế" = huỷ + tạo việc tay bằng chức năng tạo task thủ công sẵn có.)
-- Áp dụng cho task sinh từ plan (channel_plan_id không null). Ghi audit từng thao tác.
-- ============================================================

create or replace function public.mkt_reconcile_plan_task(
  p_task_id uuid,
  p_decision text,
  p_new_assignee_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_dep_status text;
  v_next_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_decision not in ('keep', 'cancel', 'reassign') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.channel_plan_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  if p_decision = 'keep' then
    null; -- giữ nguyên

  elsif p_decision = 'cancel' then
    if v_task.task_status = 'done' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    update public.mkt_tasks set task_status = 'canceled', deleted_at = now(), updated_by = v_actor where id = p_task_id;

  elsif p_decision = 'reassign' then
    if p_new_assignee_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    if v_task.task_status = 'done' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.profiles p where p.id = p_new_assignee_id and p.tenant_id = v_task.tenant_id and coalesce(p.is_active, true)) then
      raise exception 'INVALID_STATE' using errcode = 'P0001';
    end if;
    -- Xác định trạng thái: còn phụ thuộc chưa xong → blocked, else todo
    v_next_status := 'todo';
    if v_task.dependency_task_id is not null then
      select task_status into v_dep_status from public.mkt_tasks where id = v_task.dependency_task_id and tenant_id = v_task.tenant_id;
      if v_dep_status is distinct from 'done' then v_next_status := 'blocked'; end if;
    end if;
    update public.mkt_tasks set
      assignee_id = p_new_assignee_id, acceptance_status = 'pending', task_status = v_next_status,
      blocked_reason = case when v_next_status = 'blocked' then 'DEPENDENCY_BLOCKED' else null end,
      started_at = null, reject_reason = null, discussion_reason = null, requires_leader_action = false, updated_by = v_actor
    where id = p_task_id;
    perform public.mkt_enqueue_notification(
      v_task.tenant_id, p_new_assignee_id, 'mkt_task_assigned', 'Task MKT mới (được giao lại)', v_task.title,
      'mkt_task', p_task_id, '/mkt/tasks?task=' || p_task_id::text, '{}'::jsonb,
      'mkt_task_reassigned:' || p_task_id::text || ':' || p_new_assignee_id::text
    );
  end if;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_plan_task_' || p_decision, 'mkt_task', p_task_id, to_jsonb(v_task), jsonb_build_object('decision', p_decision, 'new_assignee_id', p_new_assignee_id));
  return jsonb_build_object('success', true, 'decision', p_decision);
end;
$$;
revoke all on function public.mkt_reconcile_plan_task(uuid, text, uuid) from public, anon;
grant execute on function public.mkt_reconcile_plan_task(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
