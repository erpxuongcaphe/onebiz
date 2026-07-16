-- ============================================================
-- 00196: Kế hoạch kênh — thêm 2 lớp chiến lược (CEO 16/07)
--
--   Lớp 1 "Đề xuất chiến lược" (lúc NỘP): cách đánh + ngân sách dự kiến +
--     bảng KPI định lượng. Đi theo phiên bản kế hoạch (snapshot lúc nộp).
--   Lớp 2 "Báo cáo tiến độ tổng thể" (khi ĐANG CHẠY): Owner báo sức khỏe +
--     lời kể + số KPI thực tế; máy TỰ CHỤP số từ task tại thời điểm báo cáo
--     (chống báo cáo màu hồng). Bất biến, xếp dòng thời gian.
--
-- CÁC KHOÁ AN TOÀN (đối chiếu sổ bẫy 27 điểm đã duyệt):
--   #1  mkt_submit_plan chép NGUYÊN VĂN từ 00193 (bản mới nhất — KHÔNG phải
--       00182), chỉ mở rộng snapshot. Tuyệt đối không dựng lại luật
--       "duyệt/đăng phải gắn nội dung" đã gỡ ở 00193/00194.
--   #3  Quyền xem 3 bảng mới = mkt_can_read_plan (đúng tầm nhìn kế hoạch:
--       Owner/Reviewer/Lead) — KHÔNG dùng mkt.view (sẽ lộ chiến lược).
--   #4  Trigger chống ghép chéo tenant: hàm phụ riêng, KHÔNG đụng hàm
--       hardening mkt_assert_tenant_links.
--   #5  KHÔNG unique tên KPI (tránh bẫy xoá mềm + trùng tên như modifier).
--   #6  Mục tiêu KPI > 0: RPC chặn TRƯỚC bằng tiếng Việt; CHECK DB chỉ là
--       lưới cuối.
--   #7  Số thực tế cho phép = 0 ("0 đơn" là báo cáo trung thực), cấm âm.
--   #8  Số thực tế phải gắn KPI THUỘC ĐÚNG kế hoạch — RPC đối chiếu + trigger
--       DB đối chiếu lần hai.
--   #9  Ghi qua RPC definer; bảng KHÔNG có policy ghi.
--   #10 Số máy trong báo cáo dùng NGUYÊN VĂN luật trang Báo cáo:
--       loại task đã xoá + task 'canceled'; "trễ" = chưa done + có hạn + quá hạn.
--   #12 Báo cáo bất biến: không RPC sửa; chỉ xoá mềm (Owner/Lead) + audit.
--   Không đổi chữ ký hàm nào → không dính 42P13.
-- ============================================================

-- ── 1. Cột chiến lược trên kế hoạch ──────────────────────────────
alter table public.mkt_channel_plans
  add column if not exists strategy_summary text,
  add column if not exists budget_planned numeric(14, 0);

-- ── 2. Bảng KPI của kế hoạch ─────────────────────────────────────
-- Xoá mềm: KPI có thể đã có số thực tế từ các báo cáo trước (sau "Đổi kế
-- hoạch" quay về planning) — xoá cứng sẽ giật sập lịch sử.
create table if not exists public.mkt_plan_kpis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.mkt_channel_plans(id) on delete cascade,
  name text not null,
  unit text,
  target_value numeric(14, 2) not null check (target_value > 0),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_mkt_plan_kpis_plan
  on public.mkt_plan_kpis(tenant_id, plan_id, sort_order) where deleted_at is null;

drop trigger if exists trg_mkt_plan_kpis_updated_at on public.mkt_plan_kpis;
create trigger trg_mkt_plan_kpis_updated_at
  before update on public.mkt_plan_kpis
  for each row execute function public.mkt_set_updated_at();

-- ── 3. Bảng báo cáo tiến độ (bất biến — chỉ thêm và xoá mềm) ────
create table if not exists public.mkt_plan_progress_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.mkt_channel_plans(id) on delete cascade,
  health text not null check (health in ('on_track', 'at_risk', 'off_track')),
  summary text not null,
  issues text,
  next_steps text,
  -- Máy tự chụp tại thời điểm báo cáo: tasksTotal/tasksDone/pointsTotal/
  -- pointsDone/overdue — lưu cứng để đọc lại lịch sử đúng bối cảnh lúc đó.
  stats jsonb not null default '{}'::jsonb,
  plan_version_number integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_mkt_plan_progress_plan
  on public.mkt_plan_progress_reports(tenant_id, plan_id, created_at desc) where deleted_at is null;

-- ── 4. Số thực tế từng KPI trong một báo cáo ─────────────────────
-- Denorm plan_id để RLS soi thẳng mkt_can_read_plan không phải join 2 tầng.
create table if not exists public.mkt_plan_kpi_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  report_id uuid not null references public.mkt_plan_progress_reports(id) on delete cascade,
  kpi_id uuid not null references public.mkt_plan_kpis(id) on delete cascade,
  plan_id uuid not null references public.mkt_channel_plans(id) on delete cascade,
  actual_value numeric(14, 2) not null check (actual_value >= 0),
  created_at timestamptz not null default now(),
  unique (report_id, kpi_id)
);

create index if not exists idx_mkt_plan_kpi_entries_report on public.mkt_plan_kpi_entries(report_id);
create index if not exists idx_mkt_plan_kpi_entries_kpi on public.mkt_plan_kpi_entries(kpi_id);

-- ── 5. RLS: thừa kế ĐÚNG tầm nhìn kế hoạch, không rộng hơn ──────
alter table public.mkt_plan_kpis enable row level security;
alter table public.mkt_plan_progress_reports enable row level security;
alter table public.mkt_plan_kpi_entries enable row level security;

drop policy if exists "mkt_plan_kpis_select" on public.mkt_plan_kpis;
create policy "mkt_plan_kpis_select" on public.mkt_plan_kpis for select using (
  tenant_id = public.get_user_tenant_id() and (select public.mkt_can_read_plan(plan_id))
);
drop policy if exists "mkt_plan_progress_reports_select" on public.mkt_plan_progress_reports;
create policy "mkt_plan_progress_reports_select" on public.mkt_plan_progress_reports for select using (
  tenant_id = public.get_user_tenant_id() and (select public.mkt_can_read_plan(plan_id))
);
drop policy if exists "mkt_plan_kpi_entries_select" on public.mkt_plan_kpi_entries;
create policy "mkt_plan_kpi_entries_select" on public.mkt_plan_kpi_entries for select using (
  tenant_id = public.get_user_tenant_id() and (select public.mkt_can_read_plan(plan_id))
);

grant select on public.mkt_plan_kpis to authenticated;
grant select on public.mkt_plan_progress_reports to authenticated;
grant select on public.mkt_plan_kpi_entries to authenticated;

-- ── 6. Toàn vẹn tenant + chống tiêm chéo kế hoạch (tầng DB) ─────
create or replace function public.mkt_assert_plan_metric_tenant_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    raise exception 'CROSS_TENANT_REFERENCE: missing tenant' using errcode = 'P0001';
  end if;

  if tg_table_name = 'mkt_plan_kpis' then
    if not exists (select 1 from public.mkt_channel_plans pl where pl.id = new.plan_id and pl.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: plan' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_plan_progress_reports' then
    if not exists (select 1 from public.mkt_channel_plans pl where pl.id = new.plan_id and pl.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: plan' using errcode = 'P0001'; end if;
    if new.created_by is not null and not exists (select 1 from public.profiles p where p.id = new.created_by and p.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: author' using errcode = 'P0001'; end if;

  elsif tg_table_name = 'mkt_plan_kpi_entries' then
    -- Báo cáo và KPI đều phải thuộc ĐÚNG kế hoạch ghi trên dòng số liệu.
    if not exists (select 1 from public.mkt_plan_progress_reports r where r.id = new.report_id and r.tenant_id = new.tenant_id and r.plan_id = new.plan_id) then
      raise exception 'CROSS_TENANT_REFERENCE: report' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.mkt_plan_kpis k where k.id = new.kpi_id and k.tenant_id = new.tenant_id and k.plan_id = new.plan_id) then
      raise exception 'CROSS_TENANT_REFERENCE: kpi' using errcode = 'P0001'; end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mkt_plan_kpis_tenant on public.mkt_plan_kpis;
create trigger trg_mkt_plan_kpis_tenant
  before insert or update on public.mkt_plan_kpis
  for each row execute function public.mkt_assert_plan_metric_tenant_links();
drop trigger if exists trg_mkt_plan_progress_reports_tenant on public.mkt_plan_progress_reports;
create trigger trg_mkt_plan_progress_reports_tenant
  before insert or update on public.mkt_plan_progress_reports
  for each row execute function public.mkt_assert_plan_metric_tenant_links();
drop trigger if exists trg_mkt_plan_kpi_entries_tenant on public.mkt_plan_kpi_entries;
create trigger trg_mkt_plan_kpi_entries_tenant
  before insert or update on public.mkt_plan_kpi_entries
  for each row execute function public.mkt_assert_plan_metric_tenant_links();

-- ── 7. Lưu chiến lược (Owner soạn — cùng khoá với lưu công đoạn) ─
-- Guard y hệt mkt_save_plan_items: chỉ khi planning/revision_required
-- ⇒ sau khi NỘP là khoá, cái Leader duyệt đúng là cái được chốt.
create or replace function public.mkt_save_plan_strategy(
  p_plan_id uuid,
  p_strategy_summary text default null,
  p_budget_planned numeric default null,
  p_kpis jsonb default '[]'::jsonb,
  p_expected_version integer default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_kpi jsonb;
  v_kpi_id uuid;
  v_name text;
  v_target text;
  v_kept uuid[] := '{}';
  v_sort integer := 0;
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status not in ('planning', 'revision_required') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_expected_version is not null and p_expected_version <> v_plan.version_number then raise exception 'PLAN_VERSION_CONFLICT' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_kpis) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_budget_planned is not null and p_budget_planned < 0 then
    raise exception 'KPI_VALIDATION_FAILED: ngân sách dự kiến không được âm' using errcode = 'P0001';
  end if;

  -- Validate TRƯỚC bằng tiếng Việt — không để CHECK của bảng nổ lỗi tiếng Anh.
  for v_kpi in select value from jsonb_array_elements(p_kpis) loop
    v_name := nullif(trim(coalesce(v_kpi->>'name', '')), '');
    if v_name is null then
      raise exception 'KPI_VALIDATION_FAILED: có chỉ số chưa đặt tên' using errcode = 'P0001';
    end if;
    v_target := nullif(trim(coalesce(v_kpi->>'targetValue', '')), '');
    if v_target is null or v_target !~ '^\d+(\.\d+)?$' or v_target::numeric <= 0 then
      raise exception 'KPI_VALIDATION_FAILED: mục tiêu của "%" phải là số lớn hơn 0', v_name using errcode = 'P0001';
    end if;
  end loop;

  update public.mkt_channel_plans set
    strategy_summary = nullif(trim(coalesce(p_strategy_summary, '')), ''),
    budget_planned = p_budget_planned,
    updated_by = v_actor
  where id = p_plan_id;

  for v_kpi in select value from jsonb_array_elements(p_kpis) loop
    v_name := trim(v_kpi->>'name');
    v_kpi_id := nullif(v_kpi->>'id', '')::uuid;
    if v_kpi_id is not null then
      update public.mkt_plan_kpis
      set name = v_name,
          unit = nullif(trim(coalesce(v_kpi->>'unit', '')), ''),
          target_value = (v_kpi->>'targetValue')::numeric,
          sort_order = v_sort,
          updated_by = v_actor,
          deleted_at = null
      where id = v_kpi_id and plan_id = p_plan_id and tenant_id = v_plan.tenant_id;
      if not found then
        raise exception 'KPI_VALIDATION_FAILED: chỉ số "%" không thuộc kế hoạch này', v_name using errcode = 'P0001';
      end if;
    else
      insert into public.mkt_plan_kpis (tenant_id, plan_id, name, unit, target_value, sort_order, created_by, updated_by)
      values (
        v_plan.tenant_id, p_plan_id, v_name,
        nullif(trim(coalesce(v_kpi->>'unit', '')), ''),
        (v_kpi->>'targetValue')::numeric, v_sort, v_actor, v_actor
      )
      returning id into v_kpi_id;
    end if;
    v_kept := array_append(v_kept, v_kpi_id);
    v_sort := v_sort + 1;
    v_count := v_count + 1;
  end loop;

  -- KPI bị gỡ khỏi danh sách → xoá mềm (giữ lịch sử số thực tế đã báo).
  update public.mkt_plan_kpis
  set deleted_at = now(), updated_by = v_actor
  where plan_id = p_plan_id and deleted_at is null and not (id = any(v_kept));

  perform public.mkt_record_audit(
    v_plan.tenant_id, v_actor, 'mkt_plan_strategy_saved', 'mkt_channel_plan', p_plan_id,
    null, jsonb_build_object('kpi_count', v_count, 'budget_planned', p_budget_planned)
  );
  return jsonb_build_object('success', true, 'kpiCount', v_count);
end;
$$;

-- ── 8. Nộp kế hoạch — CHÉP NGUYÊN VĂN 00193, chỉ mở rộng snapshot ─
-- (giữ đủ các validate tên/người làm/hạn/vòng lặp; TUYỆT ĐỐI không dựng lại
-- luật ép gắn nội dung đã gỡ)
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
    -- BỎ (00193): không ép gắn nội dung ở công đoạn duyệt/đăng nữa. Lúc lập kế
    -- hoạch nội dung thường chưa tồn tại; rào an toàn đã chuyển sang mkt_start_task
    -- (chỉ siết khi CÓ gắn nội dung).
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

  -- 00196: snapshot có thêm chiến lược + KPI — Leader duyệt phiên bản nào là
  -- chốt trọn bức tranh phiên bản đó (chỉ THÊM key mới, không đổi key cũ).
  v_snapshot := jsonb_build_object(
    'header', jsonb_build_object(
      'objective', v_plan.objective, 'keyMessage', v_plan.key_message,
      'mandatoryDeliverables', v_plan.mandatory_deliverables, 'riskNotes', v_plan.risk_notes, 'deadline', v_plan.deadline,
      'strategySummary', v_plan.strategy_summary, 'budgetPlanned', v_plan.budget_planned
    ),
    'kpis', coalesce((select jsonb_agg(to_jsonb(k) order by k.sort_order, k.created_at) from public.mkt_plan_kpis k where k.plan_id = p_plan_id and k.deleted_at is null), '[]'::jsonb),
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

-- ── 9. Gửi báo cáo tiến độ tổng thể ─────────────────────────────
create or replace function public.mkt_submit_plan_progress(
  p_plan_id uuid,
  p_health text,
  p_summary text,
  p_issues text default null,
  p_next_steps text default null,
  p_kpi_actuals jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_summary text;
  v_entry jsonb;
  v_kpi record;
  v_actual text;
  v_report_id uuid;
  v_stats jsonb;
  v_total integer; v_done integer; v_points_total integer; v_points_done integer; v_overdue integer;
  v_wp_title text;
  v_health_vn text;
  v_entry_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status <> 'in_execution' then
    raise exception 'PROGRESS_VALIDATION_FAILED: kế hoạch chưa ở trạng thái đang thực thi' using errcode = 'P0001';
  end if;
  if p_health is null or p_health not in ('on_track', 'at_risk', 'off_track') then
    raise exception 'PROGRESS_VALIDATION_FAILED: mức sức khỏe không hợp lệ' using errcode = 'P0001';
  end if;
  v_summary := nullif(trim(coalesce(p_summary, '')), '');
  if v_summary is null then
    raise exception 'PROGRESS_VALIDATION_FAILED: chưa ghi nội dung báo cáo' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_kpi_actuals) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- Số máy tự chụp — NGUYÊN VĂN luật trang Báo cáo (loại task xoá/huỷ;
  -- "trễ" = chưa done + có hạn + quá hạn) để mọi màn cùng một con số.
  select
    count(*),
    count(*) filter (where task_status = 'done'),
    coalesce(sum(workload_points), 0),
    coalesce(sum(workload_points) filter (where task_status = 'done'), 0),
    count(*) filter (where task_status <> 'done' and due_at is not null and due_at < now())
  into v_total, v_done, v_points_total, v_points_done, v_overdue
  from public.mkt_tasks
  where channel_plan_id = p_plan_id and deleted_at is null and task_status <> 'canceled';

  v_stats := jsonb_build_object(
    'tasksTotal', v_total, 'tasksDone', v_done,
    'pointsTotal', v_points_total, 'pointsDone', v_points_done,
    'overdue', v_overdue
  );

  insert into public.mkt_plan_progress_reports (
    tenant_id, plan_id, health, summary, issues, next_steps, stats, plan_version_number, created_by
  ) values (
    v_plan.tenant_id, p_plan_id, p_health, v_summary,
    nullif(trim(coalesce(p_issues, '')), ''), nullif(trim(coalesce(p_next_steps, '')), ''),
    v_stats, v_plan.version_number, v_actor
  ) returning id into v_report_id;

  for v_entry in select value from jsonb_array_elements(p_kpi_actuals) loop
    -- Bỏ qua dòng để trống (không báo số kỳ này) — trống KHÁC số 0.
    v_actual := nullif(trim(coalesce(v_entry->>'actualValue', '')), '');
    if v_actual is null then continue; end if;
    if v_actual !~ '^\d+(\.\d+)?$' then
      raise exception 'PROGRESS_VALIDATION_FAILED: số thực tế phải là số không âm' using errcode = 'P0001';
    end if;
    if nullif(v_entry->>'kpiId', '') is null then
      raise exception 'PROGRESS_VALIDATION_FAILED: thiếu mã chỉ số' using errcode = 'P0001';
    end if;
    -- KPI phải THUỘC ĐÚNG kế hoạch này (trigger DB đối chiếu lần hai).
    select * into v_kpi from public.mkt_plan_kpis
    where id = (v_entry->>'kpiId')::uuid and plan_id = p_plan_id and tenant_id = v_plan.tenant_id;
    if not found then
      raise exception 'PROGRESS_VALIDATION_FAILED: chỉ số không thuộc kế hoạch này' using errcode = 'P0001';
    end if;
    insert into public.mkt_plan_kpi_entries (tenant_id, report_id, kpi_id, plan_id, actual_value)
    values (v_plan.tenant_id, v_report_id, v_kpi.id, p_plan_id, v_actual::numeric);
    v_entry_count := v_entry_count + 1;
  end loop;

  v_health_vn := case p_health
    when 'on_track' then 'Đúng nhịp'
    when 'at_risk' then 'Có rủi ro'
    else 'Lệch nhịp'
  end;
  select title into v_wp_title from public.mkt_channel_work_packages where id = v_plan.work_package_id;
  if v_plan.created_by is not null then
    perform public.mkt_enqueue_notification(
      v_plan.tenant_id, v_plan.created_by, 'mkt_plan_progress',
      'Báo cáo tiến độ kế hoạch', coalesce(v_wp_title, 'Gói việc') || ' — ' || v_health_vn,
      'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text,
      '{}'::jsonb, 'mkt_plan_progress:' || v_report_id::text
    );
  end if;

  perform public.mkt_record_audit(
    v_plan.tenant_id, v_actor, 'mkt_plan_progress_submitted', 'mkt_channel_plan', p_plan_id,
    null, jsonb_build_object('report_id', v_report_id, 'health', p_health, 'stats', v_stats, 'kpi_entries', v_entry_count)
  );
  return jsonb_build_object('success', true, 'reportId', v_report_id, 'stats', v_stats);
end;
$$;

-- ── 10. Xoá mềm một báo cáo (gửi nhầm) — Owner hoặc Lead ─────────
create or replace function public.mkt_delete_plan_progress_report(p_report_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_report record;
  v_plan record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_report from public.mkt_plan_progress_reports
  where id = p_report_id and tenant_id = public.get_user_tenant_id() and deleted_at is null
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_plan from public.mkt_channel_plans where id = v_report.plan_id;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;

  update public.mkt_plan_progress_reports set deleted_at = now() where id = p_report_id;

  perform public.mkt_record_audit(
    v_report.tenant_id, v_actor, 'mkt_plan_progress_deleted', 'mkt_channel_plan', v_report.plan_id,
    to_jsonb(v_report), jsonb_build_object('reason', p_reason)
  );
  return jsonb_build_object('success', true);
end;
$$;

-- ── 11. Quyền gọi hàm ────────────────────────────────────────────
revoke all on function public.mkt_assert_plan_metric_tenant_links() from public, anon, authenticated;
revoke all on function public.mkt_save_plan_strategy(uuid, text, numeric, jsonb, integer) from public, anon;
revoke all on function public.mkt_submit_plan(uuid, integer) from public, anon;
revoke all on function public.mkt_submit_plan_progress(uuid, text, text, text, text, jsonb) from public, anon;
revoke all on function public.mkt_delete_plan_progress_report(uuid, text) from public, anon;
grant execute on function public.mkt_save_plan_strategy(uuid, text, numeric, jsonb, integer) to authenticated;
grant execute on function public.mkt_submit_plan(uuid, integer) to authenticated;
grant execute on function public.mkt_submit_plan_progress(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.mkt_delete_plan_progress_report(uuid, text) to authenticated;

notify pgrst, 'reload schema';
