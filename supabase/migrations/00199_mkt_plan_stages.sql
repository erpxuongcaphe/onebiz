-- ============================================================
-- 00199: Cây kế hoạch — tầng "KẾ HOẠCH PHỤ" trong kế hoạch nhỏ (CEO 18/07)
--
-- CEO: "1 kế hoạch lớn có nhiều kế hoạch nhỏ, từng kế hoạch nhỏ có những kế
-- hoạch phụ". Kế hoạch lớn = Chiến dịch (đã có) · Kế hoạch nhỏ = Kế hoạch
-- kênh/mảng (đã có) · KẾ HOẠCH PHỤ = tầng mới này: nhóm công đoạn có tên +
-- mục tiêu phụ + hạn riêng. Không lồng vô hạn — cây 3 tầng cố định đúng
-- chuẩn ngành (Portfolio → Project → Section), đúng quy mô đội.
--
-- LƯU Ý ĐÁNH SỐ: nhảy qua 00198 vì luồng Báo cáo (ChatGPT) đã dùng
-- 00196/00197/00198 trùng số — từ nay số mới bắt đầu 00199.
--
-- KHOÁ AN TOÀN (theo sổ bẫy đã duyệt):
--   • mkt_save_plan_items ĐỔI CHỮ KÝ (thêm p_stages) → phải DROP hàm cũ rồi
--     tạo lại + cấp quyền lại (bài học 42P13). Thân hàm chép NGUYÊN VĂN 00181,
--     chỉ thêm phần kế hoạch phụ.
--   • mkt_submit_plan + mkt_submit_plan_progress chép NGUYÊN VĂN bản 00196
--     (bản mới nhất), chỉ thêm snapshot stages / rollup theo kế hoạch phụ.
--     TUYỆT ĐỐI không dựng lại các luật đã gỡ (00193/00194).
--   • Kế hoạch phụ KHÔNG có vòng duyệt riêng — Leader duyệt kế hoạch nhỏ một
--     lần là duyệt trọn các kế hoạch phụ bên trong.
--   • Kế hoạch cũ (không có kế hoạch phụ) chạy y nguyên: stage_id nullable,
--     mọi validate chỉ siết KHI CÓ dữ liệu (triết lý rào có điều kiện).
--   • RLS 3 tầng đọc theo mkt_can_read_plan — không rộng hơn tầm nhìn kế hoạch.
-- ============================================================

-- ── 1. Bảng KẾ HOẠCH PHỤ ────────────────────────────────────────
create table if not exists public.mkt_channel_plan_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.mkt_channel_plans(id) on delete cascade,
  title text not null,
  goal text,
  due_date date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mkt_plan_stages_plan
  on public.mkt_channel_plan_stages(tenant_id, plan_id, sort_order);

drop trigger if exists trg_mkt_plan_stages_updated_at on public.mkt_channel_plan_stages;
create trigger trg_mkt_plan_stages_updated_at
  before update on public.mkt_channel_plan_stages
  for each row execute function public.mkt_set_updated_at();

-- Công đoạn thuộc kế hoạch phụ nào (null = chưa xếp — kế hoạch phẳng kiểu cũ).
alter table public.mkt_channel_plan_items
  add column if not exists stage_id uuid references public.mkt_channel_plan_stages(id) on delete set null;

-- ── 2. RLS: thừa kế đúng tầm nhìn kế hoạch ──────────────────────
alter table public.mkt_channel_plan_stages enable row level security;
drop policy if exists "mkt_plan_stages_select" on public.mkt_channel_plan_stages;
create policy "mkt_plan_stages_select" on public.mkt_channel_plan_stages for select using (
  tenant_id = public.get_user_tenant_id() and (select public.mkt_can_read_plan(plan_id))
);
grant select on public.mkt_channel_plan_stages to authenticated;

-- ── 3. Toàn vẹn tenant + chống gắn chéo kế hoạch ────────────────
-- Chép NGUYÊN VĂN helper 00196, chỉ THÊM nhánh mkt_channel_plan_stages.
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

  elsif tg_table_name = 'mkt_channel_plan_stages' then
    if not exists (select 1 from public.mkt_channel_plans pl where pl.id = new.plan_id and pl.tenant_id = new.tenant_id) then
      raise exception 'CROSS_TENANT_REFERENCE: plan' using errcode = 'P0001'; end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mkt_plan_stages_tenant on public.mkt_channel_plan_stages;
create trigger trg_mkt_plan_stages_tenant
  before insert or update on public.mkt_channel_plan_stages
  for each row execute function public.mkt_assert_plan_metric_tenant_links();

-- Công đoạn gắn kế hoạch phụ: phải thuộc ĐÚNG kế hoạch của công đoạn đó.
create or replace function public.mkt_assert_item_stage_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage_id is not null and not exists (
    select 1 from public.mkt_channel_plan_stages s
    where s.id = new.stage_id and s.plan_id = new.plan_id and s.tenant_id = new.tenant_id
  ) then
    raise exception 'CROSS_TENANT_REFERENCE: stage' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mkt_plan_items_stage on public.mkt_channel_plan_items;
create trigger trg_mkt_plan_items_stage
  before insert or update on public.mkt_channel_plan_items
  for each row execute function public.mkt_assert_item_stage_link();

-- ── 4. Lưu kế hoạch — ĐỔI CHỮ KÝ (thêm p_stages) → DROP + tạo lại ─
-- Thân hàm chép NGUYÊN VĂN 00181; phần thêm được đánh dấu "00199:".
drop function if exists public.mkt_save_plan_items(uuid, jsonb, jsonb, integer);

create or replace function public.mkt_save_plan_items(
  p_plan_id uuid,
  p_items jsonb,
  p_header jsonb default null,
  p_expected_version integer default null,
  p_stages jsonb default '[]'::jsonb
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
  v_stage jsonb;
  v_stage_ids uuid[] := '{}';
  v_stage_id uuid;
  v_stage_sort integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status not in ('planning', 'revision_required') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_expected_version is not null and p_expected_version <> v_plan.version_number then raise exception 'PLAN_VERSION_CONFLICT' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_stages) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- 00199: validate kế hoạch phụ TRƯỚC bằng tiếng Việt.
  for v_stage in select value from jsonb_array_elements(p_stages) loop
    if nullif(trim(coalesce(v_stage->>'title', '')), '') is null then
      raise exception 'PLAN_VALIDATION_FAILED: có kế hoạch phụ chưa đặt tên' using errcode = 'P0001';
    end if;
  end loop;

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

  -- 00199: replace kế hoạch phụ (xoá SAU items để khỏi update set-null thừa,
  -- tạo TRƯỚC khi chèn items để items gắn được stage_id).
  delete from public.mkt_channel_plan_stages where plan_id = p_plan_id;
  for v_stage in select value from jsonb_array_elements(p_stages) loop
    insert into public.mkt_channel_plan_stages (id, tenant_id, plan_id, title, goal, due_date, sort_order)
    values (
      coalesce(nullif(v_stage->>'id', '')::uuid, gen_random_uuid()),
      v_plan.tenant_id, p_plan_id,
      trim(v_stage->>'title'),
      nullif(trim(coalesce(v_stage->>'goal', '')), ''),
      nullif(v_stage->>'dueDate', '')::date,
      v_stage_sort
    ) returning id into v_stage_id;
    v_stage_ids := array_append(v_stage_ids, v_stage_id);
    v_stage_sort := v_stage_sort + 1;
  end loop;

  -- Pass 1: insert (depends_on để null)
  for v_item in select * from jsonb_array_elements(p_items) loop
    if nullif(trim(coalesce(v_item->>'title', '')), '') is null then continue; end if;
    -- 00199: chỉ nhận stage_id có trong lô kế hoạch phụ vừa lưu (không thì để
    -- "chưa xếp" — cùng tinh thần pass-2 depends_on).
    v_stage_id := nullif(v_item->>'stageId', '')::uuid;
    if v_stage_id is not null and not (v_stage_id = any(v_stage_ids)) then
      v_stage_id := null;
    end if;
    insert into public.mkt_channel_plan_items (
      id, tenant_id, plan_id, title, task_type, description, content_angle, deliverable,
      suggested_assignee_id, reviewer_id, content_item_id, workload_points, due_at, sequence, is_mandatory,
      stage_id
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
      coalesce((v_item->>'isMandatory')::boolean, false),
      v_stage_id
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

  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_saved', 'mkt_channel_plan', p_plan_id, null, jsonb_build_object('item_count', v_count, 'stage_count', coalesce(array_length(v_stage_ids, 1), 0)));
  return jsonb_build_object('success', true, 'itemCount', v_count, 'stageCount', coalesce(array_length(v_stage_ids, 1), 0), 'versionNumber', v_plan.version_number);
end;
$$;

-- ── 5. Nộp kế hoạch — CHÉP NGUYÊN VĂN 00196, chỉ thêm stages vào snapshot ─
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
  -- 00199: thêm 'stages' — chốt luôn các kế hoạch phụ theo phiên bản.
  v_snapshot := jsonb_build_object(
    'header', jsonb_build_object(
      'objective', v_plan.objective, 'keyMessage', v_plan.key_message,
      'mandatoryDeliverables', v_plan.mandatory_deliverables, 'riskNotes', v_plan.risk_notes, 'deadline', v_plan.deadline,
      'strategySummary', v_plan.strategy_summary, 'budgetPlanned', v_plan.budget_planned
    ),
    'kpis', coalesce((select jsonb_agg(to_jsonb(k) order by k.sort_order, k.created_at) from public.mkt_plan_kpis k where k.plan_id = p_plan_id and k.deleted_at is null), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order, s.created_at) from public.mkt_channel_plan_stages s where s.plan_id = p_plan_id), '[]'::jsonb),
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

-- ── 6. Báo cáo tiến độ — CHÉP NGUYÊN VĂN 00196, thêm rollup theo kế hoạch phụ ─
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
  v_by_stage jsonb;
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

  -- 00199: rollup theo KẾ HOẠCH PHỤ (nối task → công đoạn → kế hoạch phụ).
  v_by_stage := coalesce((
    select jsonb_agg(x.obj order by x.sort_order)
    from (
      select s.sort_order, jsonb_build_object(
        'stageId', s.id, 'title', s.title,
        'tasksTotal', count(t.id),
        'tasksDone', count(t.id) filter (where t.task_status = 'done')
      ) as obj
      from public.mkt_channel_plan_stages s
      left join public.mkt_channel_plan_items i on i.stage_id = s.id and i.plan_id = p_plan_id
      left join public.mkt_tasks t on t.channel_plan_item_id = i.id
        and t.deleted_at is null and t.task_status <> 'canceled'
      where s.plan_id = p_plan_id
      group by s.id, s.title, s.sort_order
    ) x
  ), '[]'::jsonb);

  v_stats := jsonb_build_object(
    'tasksTotal', v_total, 'tasksDone', v_done,
    'pointsTotal', v_points_total, 'pointsDone', v_points_done,
    'overdue', v_overdue,
    'byStage', v_by_stage
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

-- ── 7. Quyền gọi hàm (save đổi chữ ký → cấp lại; 2 hàm kia restate cho chắc) ─
revoke all on function public.mkt_assert_item_stage_link() from public, anon, authenticated;
revoke all on function public.mkt_save_plan_items(uuid, jsonb, jsonb, integer, jsonb) from public, anon;
revoke all on function public.mkt_submit_plan(uuid, integer) from public, anon;
revoke all on function public.mkt_submit_plan_progress(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.mkt_save_plan_items(uuid, jsonb, jsonb, integer, jsonb) to authenticated;
grant execute on function public.mkt_submit_plan(uuid, integer) to authenticated;
grant execute on function public.mkt_submit_plan_progress(uuid, text, text, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
