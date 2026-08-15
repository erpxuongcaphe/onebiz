-- ============================================================================
-- 00323 — RPC CẤU HÌNH BÀN & SƠ ĐỒ BÀN (F1a)
--
-- Đóng 14 đường ghi trực tiếp từ trình duyệt vào restaurant_tables /
-- floor_plan_zones / floor_plan_decorations (khảo sát 15/08, plan
-- docs/PLAN-F1-RPC-CAU-HINH-BAN-2026-08-15.md, preflight đã chạy).
--
-- PHẠM VI: CHỈ tạo 4 hàm mới + quyền gọi. KHÔNG sửa bảng/cột/policy/index,
-- KHÔNG đổi một dòng dữ liệu nào, KHÔNG thu hồi grant cũ (đó là F1b, chạy
-- sau 24–48h theo dõi). An toàn cho MỌI tenant, không giả định dữ liệu rỗng.
--
-- Phân quyền (CEO chốt 15/08):
--   • Cấu hình bàn/khu quản lý  : system.manage_branches
--   • Sơ đồ bàn                 : floor_plan.edit_global (mọi chi nhánh trong
--     tenant) HOẶC floor_plan.edit_branch (phải user_has_branch_access)
--   • pos_fnb.manage_tables KHÔNG dùng ở đây (Phục vụ đang giữ mã đó).
--
-- Rollback: 00323_rollback_fnb_table_config_rpcs.sql
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. fnb_table_config_atomic — bàn + khu (cột TEXT zone) của màn Bàn & Khu vực
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.fnb_table_config_atomic(
  p_action    text,
  p_branch_id uuid,
  p_payload   jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_tenant   uuid;
  v_row      public.restaurant_tables%rowtype;
  v_old      jsonb;
  v_num      int;
  v_count    int;
  v_zone     text;
  v_new_zone text;
  v_ids      uuid[];
begin
  -- ── Danh tính + quyền: chốt hoàn toàn phía máy chủ ──
  if v_actor is null then
    raise exception 'Bạn cần đăng nhập để thực hiện thao tác này.';
  end if;
  select p.tenant_id into v_tenant
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant is null then
    raise exception 'Tài khoản không hợp lệ hoặc đã bị khoá.';
  end if;
  if not public.user_has_permission(v_actor, 'system.manage_branches') then
    raise exception 'Bạn không có quyền quản lý bàn và khu vực.';
  end if;
  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.tenant_id = v_tenant
  ) then
    raise exception 'Chi nhánh không thuộc doanh nghiệp của bạn.';
  end if;

  -- ── create: tạo 1 bàn; cho phép kèm luôn sơ đồ (khu/hình/vị trí) 1 giao dịch ──
  if p_action = 'create' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('table_number','name','zone','capacity',
                      'zone_id','shape','position_x','position_y');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    v_num := (p_payload->>'table_number')::int;
    if v_num is null or v_num < 1 or v_num > 9999 then
      raise exception 'Số bàn phải từ 1 đến 9999.';
    end if;
    if coalesce(nullif(trim(p_payload->>'name'), ''), '') = '' then
      raise exception 'Tên bàn không được để trống.';
    end if;
    if (p_payload ? 'capacity')
       and ((p_payload->>'capacity')::int < 1 or (p_payload->>'capacity')::int > 100) then
      raise exception 'Sức chứa phải từ 1 đến 100.';
    end if;
    if (p_payload ? 'shape') and (p_payload->>'shape') not in
       ('round','square','rect','sofa','booth','bar-seat') then
      raise exception 'Hình dạng bàn không hợp lệ.';
    end if;
    if (p_payload ? 'zone_id') and not exists (
      select 1 from public.floor_plan_zones z
      where z.id = (p_payload->>'zone_id')::uuid
        and z.tenant_id = v_tenant and z.branch_id = p_branch_id and z.is_active
    ) then
      raise exception 'Khu vực sơ đồ không tồn tại trong chi nhánh này.';
    end if;
    -- Khoá dòng trùng số (nếu có) rồi mới kiểm — chống đua 2 người cùng tạo
    perform 1 from public.restaurant_tables t
      where t.tenant_id = v_tenant and t.branch_id = p_branch_id
        and t.table_number = v_num and t.is_active
      for update;
    if found then
      raise exception 'Số bàn % đã tồn tại trong chi nhánh.', v_num;
    end if;

    insert into public.restaurant_tables
      (tenant_id, branch_id, table_number, name, zone, capacity,
       sort_order, zone_id, shape, position_x, position_y)
    values
      (v_tenant, p_branch_id, v_num, trim(p_payload->>'name'),
       nullif(trim(coalesce(p_payload->>'zone','')), ''),
       coalesce((p_payload->>'capacity')::int, 4),
       v_num,
       (p_payload->>'zone_id')::uuid,
       coalesce(p_payload->>'shape', 'round'),
       coalesce((p_payload->>'position_x')::int, 0),
       coalesce((p_payload->>'position_y')::int, 0))
    returning * into v_row;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, new_data)
    values (v_tenant, v_actor, 'restaurant_table', v_row.id, 'config_create', to_jsonb(v_row));
    return jsonb_build_object('ok', true, 'table', to_jsonb(v_row));

  -- ── update: sửa thông tin/vị trí 1 bàn ──
  elsif p_action = 'update' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('table_id','name','table_number','zone','capacity',
                      'sort_order','position_x','position_y');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_row from public.restaurant_tables t
      where t.id = (p_payload->>'table_id')::uuid
        and t.tenant_id = v_tenant and t.branch_id = p_branch_id and t.is_active
      for update;
    if not found then raise exception 'Không tìm thấy bàn cần sửa.'; end if;
    v_old := to_jsonb(v_row);

    if (p_payload ? 'table_number') then
      v_num := (p_payload->>'table_number')::int;
      if v_num is null or v_num < 1 or v_num > 9999 then
        raise exception 'Số bàn phải từ 1 đến 9999.';
      end if;
      if v_num <> v_row.table_number and exists (
        select 1 from public.restaurant_tables t
        where t.tenant_id = v_tenant and t.branch_id = p_branch_id
          and t.table_number = v_num and t.is_active and t.id <> v_row.id
      ) then
        raise exception 'Số bàn % đã tồn tại trong chi nhánh.', v_num;
      end if;
    end if;
    if (p_payload ? 'capacity')
       and ((p_payload->>'capacity')::int < 1 or (p_payload->>'capacity')::int > 100) then
      raise exception 'Sức chứa phải từ 1 đến 100.';
    end if;
    if (p_payload ? 'name') and trim(p_payload->>'name') = '' then
      raise exception 'Tên bàn không được để trống.';
    end if;

    update public.restaurant_tables t set
      name         = case when p_payload ? 'name' then trim(p_payload->>'name') else t.name end,
      table_number = case when p_payload ? 'table_number' then (p_payload->>'table_number')::int else t.table_number end,
      zone         = case when p_payload ? 'zone' then nullif(trim(coalesce(p_payload->>'zone','')), '') else t.zone end,
      capacity     = case when p_payload ? 'capacity' then (p_payload->>'capacity')::int else t.capacity end,
      sort_order   = case when p_payload ? 'sort_order' then (p_payload->>'sort_order')::int else t.sort_order end,
      position_x   = case when p_payload ? 'position_x' then (p_payload->>'position_x')::int else t.position_x end,
      position_y   = case when p_payload ? 'position_y' then (p_payload->>'position_y')::int else t.position_y end
    where t.id = v_row.id
    returning * into v_row;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data, new_data)
    values (v_tenant, v_actor, 'restaurant_table', v_row.id, 'config_update', v_old, to_jsonb(v_row));
    return jsonb_build_object('ok', true, 'table', to_jsonb(v_row));

  -- ── delete: xoá MỀM 1 bàn — bàn bận/còn đơn thì CHẶN và báo rõ ──
  elsif p_action = 'delete' then
    perform 1 from jsonb_object_keys(p_payload) k where k not in ('table_id');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_row from public.restaurant_tables t
      where t.id = (p_payload->>'table_id')::uuid
        and t.tenant_id = v_tenant and t.branch_id = p_branch_id and t.is_active
      for update;
    if not found then raise exception 'Không tìm thấy bàn cần xoá.'; end if;
    if v_row.status <> 'available' or v_row.current_order_id is not null then
      raise exception 'Bàn "%" đang phục vụ hoặc còn đơn — không thể xoá. Hãy thanh toán hoặc chuyển đơn trước.', v_row.name;
    end if;

    update public.restaurant_tables set is_active = false where id = v_row.id;
    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data)
    values (v_tenant, v_actor, 'restaurant_table', v_row.id, 'config_delete', to_jsonb(v_row));
    return jsonb_build_object('ok', true);

  -- ── bulk_create: tạo N bàn cho 1 khu ──
  elsif p_action = 'bulk_create' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('zone','count','start_number','capacity');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    v_count := (p_payload->>'count')::int;
    v_num   := (p_payload->>'start_number')::int;
    if v_count is null or v_count < 1 or v_count > 100 then
      raise exception 'Số lượng bàn tạo một lần phải từ 1 đến 100.';
    end if;
    if v_num is null or v_num < 1 or v_num + v_count - 1 > 9999 then
      raise exception 'Số bàn bắt đầu không hợp lệ.';
    end if;
    if coalesce(nullif(trim(p_payload->>'zone'), ''), '') = '' then
      raise exception 'Tên khu vực không được để trống.';
    end if;
    perform 1 from public.restaurant_tables t
      where t.tenant_id = v_tenant and t.branch_id = p_branch_id and t.is_active
        and t.table_number between v_num and v_num + v_count - 1
      for update;
    if found then
      raise exception 'Trong dải số %–% đã có bàn tồn tại. Chọn số bắt đầu khác.',
        v_num, v_num + v_count - 1;
    end if;

    insert into public.restaurant_tables
      (tenant_id, branch_id, table_number, name, zone, capacity, sort_order)
    select v_tenant, p_branch_id, n, 'Bàn ' || n, trim(p_payload->>'zone'),
           coalesce((p_payload->>'capacity')::int, 4), n
    from generate_series(v_num, v_num + v_count - 1) as n
    returning id into v_row.id;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, new_data)
    values (v_tenant, v_actor, 'restaurant_table', null, 'config_bulk_create',
            jsonb_build_object('branch_id', p_branch_id, 'zone', trim(p_payload->>'zone'),
                               'from', v_num, 'to', v_num + v_count - 1));
    return jsonb_build_object('ok', true, 'created', v_count);

  -- ── zone_rename: đổi tên khu TEXT + đồng bộ tên khu sơ đồ trùng tên ──
  elsif p_action = 'zone_rename' then
    perform 1 from jsonb_object_keys(p_payload) k where k not in ('old_zone','new_zone');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    v_zone     := nullif(trim(coalesce(p_payload->>'old_zone','')), '');
    v_new_zone := nullif(trim(coalesce(p_payload->>'new_zone','')), '');
    if v_zone is null or v_new_zone is null then
      raise exception 'Tên khu vực không được để trống.';
    end if;
    if v_zone = v_new_zone then
      raise exception 'Tên mới trùng tên cũ.';
    end if;

    update public.restaurant_tables t set zone = v_new_zone
      where t.tenant_id = v_tenant and t.branch_id = p_branch_id
        and t.zone = v_zone and t.is_active;
    get diagnostics v_count = row_count;
    -- Đồng bộ khu sơ đồ cùng tên để hai màn không lệch nhau (CEO 15/08 mục 5)
    update public.floor_plan_zones z set name = v_new_zone
      where z.tenant_id = v_tenant and z.branch_id = p_branch_id
        and z.name = v_zone and z.is_active;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, new_data)
    values (v_tenant, v_actor, 'restaurant_table', null, 'config_zone_rename',
            jsonb_build_object('branch_id', p_branch_id, 'old_zone', v_zone,
                               'new_zone', v_new_zone, 'tables', v_count));
    return jsonb_build_object('ok', true, 'renamed', v_count);

  -- ── zone_delete: xoá MỀM cả khu — CHẶN TOÀN BỘ nếu còn bàn bận (hết xoá nửa vời) ──
  elsif p_action = 'zone_delete' then
    perform 1 from jsonb_object_keys(p_payload) k where k not in ('zone');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    v_zone := nullif(trim(coalesce(p_payload->>'zone','')), '');
    if v_zone is null then raise exception 'Tên khu vực không được để trống.'; end if;

    select array_agg(t.id) into v_ids
    from public.restaurant_tables t
      where t.tenant_id = v_tenant and t.branch_id = p_branch_id
        and t.zone = v_zone and t.is_active
      for update;
    if v_ids is null then raise exception 'Khu vực "%" không có bàn nào.', v_zone; end if;

    select count(*) into v_count from public.restaurant_tables t
      where t.id = any(v_ids)
        and (t.status <> 'available' or t.current_order_id is not null);
    if v_count > 0 then
      raise exception 'Khu vực "%" còn % bàn đang phục vụ hoặc còn đơn — không thể xoá. Hãy xử lý xong các bàn đó trước.', v_zone, v_count;
    end if;

    update public.restaurant_tables set is_active = false where id = any(v_ids);
    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, new_data)
    values (v_tenant, v_actor, 'restaurant_table', null, 'config_zone_delete',
            jsonb_build_object('branch_id', p_branch_id, 'zone', v_zone,
                               'tables', coalesce(array_length(v_ids, 1), 0)));
    return jsonb_build_object('ok', true, 'deleted', coalesce(array_length(v_ids, 1), 0));

  else
    raise exception 'Hành động không hợp lệ.';
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. fnb_floor_zone_config_atomic — khu vực sơ đồ (floor_plan_zones)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.fnb_floor_zone_config_atomic(
  p_action    text,
  p_branch_id uuid,
  p_payload   jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_tenant uuid;
  v_zone   public.floor_plan_zones%rowtype;
  v_old    jsonb;
  v_count  int;
begin
  if v_actor is null then
    raise exception 'Bạn cần đăng nhập để thực hiện thao tác này.';
  end if;
  select p.tenant_id into v_tenant
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant is null then
    raise exception 'Tài khoản không hợp lệ hoặc đã bị khoá.';
  end if;
  -- edit_global: mọi chi nhánh trong tenant, KHÔNG bắt buộc được gán riêng.
  -- edit_branch: phải nằm trong danh sách chi nhánh được gán.
  if not public.user_has_permission(v_actor, 'floor_plan.edit_global') then
    if not public.user_has_permission(v_actor, 'floor_plan.edit_branch') then
      raise exception 'Bạn không có quyền chỉnh sửa sơ đồ bàn.';
    end if;
    if not public.user_has_branch_access(v_actor, p_branch_id) then
      raise exception 'Bạn không có quyền với chi nhánh này.';
    end if;
  end if;
  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.tenant_id = v_tenant
  ) then
    raise exception 'Chi nhánh không thuộc doanh nghiệp của bạn.';
  end if;

  if p_action = 'create' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('name','canvas_width','canvas_height','floor_level');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;
    if coalesce(nullif(trim(p_payload->>'name'), ''), '') = '' then
      raise exception 'Tên khu vực không được để trống.';
    end if;
    if (p_payload ? 'canvas_width')
       and ((p_payload->>'canvas_width')::int < 200 or (p_payload->>'canvas_width')::int > 4000) then
      raise exception 'Kích thước khung phải từ 200 đến 4000.';
    end if;
    if (p_payload ? 'canvas_height')
       and ((p_payload->>'canvas_height')::int < 200 or (p_payload->>'canvas_height')::int > 4000) then
      raise exception 'Kích thước khung phải từ 200 đến 4000.';
    end if;
    if (p_payload ? 'floor_level')
       and ((p_payload->>'floor_level')::int < 1 or (p_payload->>'floor_level')::int > 50) then
      raise exception 'Tầng phải từ 1 đến 50.';
    end if;

    insert into public.floor_plan_zones
      (tenant_id, branch_id, name, canvas_width, canvas_height, floor_level)
    values (v_tenant, p_branch_id, trim(p_payload->>'name'),
            coalesce((p_payload->>'canvas_width')::int, 1024),
            coalesce((p_payload->>'canvas_height')::int, 720),
            coalesce((p_payload->>'floor_level')::int, 1))
    returning * into v_zone;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, new_data)
    values (v_tenant, v_actor, 'floor_plan_zone', v_zone.id, 'config_create', to_jsonb(v_zone));
    return jsonb_build_object('ok', true, 'zone', to_jsonb(v_zone));

  elsif p_action = 'update' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('zone_id','name','sort_order','canvas_width','canvas_height',
                      'background_url','background_opacity','grid_size',
                      'overlay_color','floor_level');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_zone from public.floor_plan_zones z
      where z.id = (p_payload->>'zone_id')::uuid
        and z.tenant_id = v_tenant and z.branch_id = p_branch_id and z.is_active
      for update;
    if not found then raise exception 'Không tìm thấy khu vực sơ đồ.'; end if;
    v_old := to_jsonb(v_zone);

    if (p_payload ? 'name') and trim(p_payload->>'name') = '' then
      raise exception 'Tên khu vực không được để trống.';
    end if;
    if (p_payload ? 'background_opacity')
       and ((p_payload->>'background_opacity')::int < 0 or (p_payload->>'background_opacity')::int > 100) then
      raise exception 'Độ mờ ảnh nền phải từ 0 đến 100.';
    end if;
    if (p_payload ? 'grid_size')
       and ((p_payload->>'grid_size')::int < 4 or (p_payload->>'grid_size')::int > 128) then
      raise exception 'Cỡ lưới phải từ 4 đến 128.';
    end if;
    if (p_payload ? 'canvas_width')
       and ((p_payload->>'canvas_width')::int < 200 or (p_payload->>'canvas_width')::int > 4000) then
      raise exception 'Kích thước khung phải từ 200 đến 4000.';
    end if;
    if (p_payload ? 'canvas_height')
       and ((p_payload->>'canvas_height')::int < 200 or (p_payload->>'canvas_height')::int > 4000) then
      raise exception 'Kích thước khung phải từ 200 đến 4000.';
    end if;
    if (p_payload ? 'floor_level')
       and ((p_payload->>'floor_level')::int < 1 or (p_payload->>'floor_level')::int > 50) then
      raise exception 'Tầng phải từ 1 đến 50.';
    end if;

    update public.floor_plan_zones z set
      name               = case when p_payload ? 'name' then trim(p_payload->>'name') else z.name end,
      sort_order         = case when p_payload ? 'sort_order' then (p_payload->>'sort_order')::int else z.sort_order end,
      canvas_width       = case when p_payload ? 'canvas_width' then (p_payload->>'canvas_width')::int else z.canvas_width end,
      canvas_height      = case when p_payload ? 'canvas_height' then (p_payload->>'canvas_height')::int else z.canvas_height end,
      background_url     = case when p_payload ? 'background_url' then nullif(p_payload->>'background_url','') else z.background_url end,
      background_opacity = case when p_payload ? 'background_opacity' then (p_payload->>'background_opacity')::int else z.background_opacity end,
      grid_size          = case when p_payload ? 'grid_size' then (p_payload->>'grid_size')::int else z.grid_size end,
      overlay_color      = case when p_payload ? 'overlay_color' then nullif(p_payload->>'overlay_color','') else z.overlay_color end,
      floor_level        = case when p_payload ? 'floor_level' then (p_payload->>'floor_level')::int else z.floor_level end,
      updated_at         = now()
    where z.id = v_zone.id
    returning * into v_zone;

    -- Đổi tên khu sơ đồ → đồng bộ nhãn TEXT trên các bàn thuộc khu (CEO mục 5)
    if (p_payload ? 'name') and v_zone.name <> (v_old->>'name') then
      update public.restaurant_tables t set zone = v_zone.name
        where t.tenant_id = v_tenant and t.zone_id = v_zone.id and t.is_active;
    end if;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data, new_data)
    values (v_tenant, v_actor, 'floor_plan_zone', v_zone.id, 'config_update', v_old, to_jsonb(v_zone));
    return jsonb_build_object('ok', true, 'zone', to_jsonb(v_zone));

  elsif p_action = 'delete' then
    perform 1 from jsonb_object_keys(p_payload) k where k not in ('zone_id');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_zone from public.floor_plan_zones z
      where z.id = (p_payload->>'zone_id')::uuid
        and z.tenant_id = v_tenant and z.branch_id = p_branch_id and z.is_active
      for update;
    if not found then raise exception 'Không tìm thấy khu vực sơ đồ.'; end if;

    select count(*) into v_count from public.restaurant_tables t
      where t.tenant_id = v_tenant and t.zone_id = v_zone.id and t.is_active;
    if v_count > 0 then
      raise exception 'Khu vực còn % bàn — chuyển bàn sang khu khác trước khi xoá.', v_count;
    end if;

    update public.floor_plan_zones set is_active = false, updated_at = now()
      where id = v_zone.id;
    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data)
    values (v_tenant, v_actor, 'floor_plan_zone', v_zone.id, 'config_delete', to_jsonb(v_zone));
    return jsonb_build_object('ok', true);

  else
    raise exception 'Hành động không hợp lệ.';
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. fnb_floor_layout_update_atomic — lưu layout bàn, nhận cả THAO TÁC ĐƠN
--    lẫn LÔ trong một giao dịch (giữ nguyên trải nghiệm kéo-thả từng bước)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.fnb_floor_layout_update_atomic(
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := auth.uid();
  v_tenant      uuid;
  v_global      boolean;
  v_branch_edit boolean;
  v_item        jsonb;
  v_row         public.restaurant_tables%rowtype;
  v_old         jsonb := '[]'::jsonb;
  v_new         jsonb := '[]'::jsonb;
  v_n           int := 0;
begin
  if v_actor is null then
    raise exception 'Bạn cần đăng nhập để thực hiện thao tác này.';
  end if;
  select p.tenant_id into v_tenant
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant is null then
    raise exception 'Tài khoản không hợp lệ hoặc đã bị khoá.';
  end if;
  v_global      := public.user_has_permission(v_actor, 'floor_plan.edit_global');
  v_branch_edit := public.user_has_permission(v_actor, 'floor_plan.edit_branch');
  if not v_global and not v_branch_edit then
    raise exception 'Bạn không có quyền chỉnh sửa sơ đồ bàn.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    raise exception 'Danh sách bàn không hợp lệ (1–200 phần tử).';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    perform 1 from jsonb_object_keys(v_item) k
      where k not in ('table_id','shape','width','height','rotation',
                      'position_x','position_y','color','locked','zone_id');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_row from public.restaurant_tables t
      where t.id = (v_item->>'table_id')::uuid
        and t.tenant_id = v_tenant and t.is_active
      for update;
    if not found then raise exception 'Không tìm thấy bàn trong sơ đồ.'; end if;
    if not v_global and not public.user_has_branch_access(v_actor, v_row.branch_id) then
      raise exception 'Bạn không có quyền với chi nhánh của bàn này.';
    end if;

    if (v_item ? 'shape') and (v_item->>'shape') not in
       ('round','square','rect','sofa','booth','bar-seat') then
      raise exception 'Hình dạng bàn không hợp lệ.';
    end if;
    if (v_item ? 'width')
       and ((v_item->>'width')::int < 10 or (v_item->>'width')::int > 1000) then
      raise exception 'Kích thước bàn phải từ 10 đến 1000.';
    end if;
    if (v_item ? 'height')
       and ((v_item->>'height')::int < 10 or (v_item->>'height')::int > 1000) then
      raise exception 'Kích thước bàn phải từ 10 đến 1000.';
    end if;
    if (v_item ? 'position_x')
       and ((v_item->>'position_x')::int < -1000 or (v_item->>'position_x')::int > 10000) then
      raise exception 'Vị trí bàn nằm ngoài phạm vi cho phép.';
    end if;
    if (v_item ? 'position_y')
       and ((v_item->>'position_y')::int < -1000 or (v_item->>'position_y')::int > 10000) then
      raise exception 'Vị trí bàn nằm ngoài phạm vi cho phép.';
    end if;
    if (v_item ? 'zone_id') and (v_item->>'zone_id') is not null and not exists (
      select 1 from public.floor_plan_zones z
      where z.id = (v_item->>'zone_id')::uuid
        and z.tenant_id = v_tenant and z.branch_id = v_row.branch_id and z.is_active
    ) then
      raise exception 'Khu vực sơ đồ không thuộc chi nhánh của bàn.';
    end if;

    v_old := v_old || jsonb_build_array(jsonb_build_object(
      'id', v_row.id, 'shape', v_row.shape, 'width', v_row.width,
      'height', v_row.height, 'rotation', v_row.rotation,
      'position_x', v_row.position_x, 'position_y', v_row.position_y,
      'color', v_row.color, 'locked', v_row.locked, 'zone_id', v_row.zone_id));

    update public.restaurant_tables t set
      shape      = case when v_item ? 'shape' then v_item->>'shape' else t.shape end,
      width      = case when v_item ? 'width' then (v_item->>'width')::int else t.width end,
      height     = case when v_item ? 'height' then (v_item->>'height')::int else t.height end,
      rotation   = case when v_item ? 'rotation' then ((v_item->>'rotation')::int % 360 + 360) % 360 else t.rotation end,
      position_x = case when v_item ? 'position_x' then (v_item->>'position_x')::int else t.position_x end,
      position_y = case when v_item ? 'position_y' then (v_item->>'position_y')::int else t.position_y end,
      color      = case when v_item ? 'color' then nullif(v_item->>'color','') else t.color end,
      locked     = case when v_item ? 'locked' then (v_item->>'locked')::boolean else t.locked end,
      zone_id    = case when v_item ? 'zone_id' then (v_item->>'zone_id')::uuid else t.zone_id end
    where t.id = v_row.id
    returning * into v_row;

    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'id', v_row.id, 'shape', v_row.shape, 'width', v_row.width,
      'height', v_row.height, 'rotation', v_row.rotation,
      'position_x', v_row.position_x, 'position_y', v_row.position_y,
      'color', v_row.color, 'locked', v_row.locked, 'zone_id', v_row.zone_id));
    v_n := v_n + 1;
  end loop;

  insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data, new_data)
  values (v_tenant, v_actor, 'floor_plan_layout', null, 'config_layout_update', v_old, v_new);
  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. fnb_floor_decoration_config_atomic — vật trang trí sơ đồ
--    (giữ hành vi XOÁ CỨNG như hiện tại, nhưng audit TRƯỚC khi xoá)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.fnb_floor_decoration_config_atomic(
  p_action  text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_tenant uuid;
  v_zone   public.floor_plan_zones%rowtype;
  v_deco   public.floor_plan_decorations%rowtype;
  v_old    jsonb;
begin
  if v_actor is null then
    raise exception 'Bạn cần đăng nhập để thực hiện thao tác này.';
  end if;
  select p.tenant_id into v_tenant
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant is null then
    raise exception 'Tài khoản không hợp lệ hoặc đã bị khoá.';
  end if;

  if p_action = 'create' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('zone_id','kind','label','icon','color','width','height',
                      'position_x','position_y','rotation','z_index');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_zone from public.floor_plan_zones z
      where z.id = (p_payload->>'zone_id')::uuid
        and z.tenant_id = v_tenant and z.is_active;
    if not found then raise exception 'Không tìm thấy khu vực sơ đồ.'; end if;
    if not public.user_has_permission(v_actor, 'floor_plan.edit_global') then
      if not public.user_has_permission(v_actor, 'floor_plan.edit_branch') then
        raise exception 'Bạn không có quyền chỉnh sửa sơ đồ bàn.';
      end if;
      if not public.user_has_branch_access(v_actor, v_zone.branch_id) then
        raise exception 'Bạn không có quyền với chi nhánh này.';
      end if;
    end if;
    if coalesce(nullif(trim(p_payload->>'kind'), ''), '') = '' then
      raise exception 'Loại vật trang trí không được để trống.';
    end if;
    if (p_payload ? 'width')
       and ((p_payload->>'width')::int < 4 or (p_payload->>'width')::int > 2000) then
      raise exception 'Kích thước vật trang trí không hợp lệ.';
    end if;
    if (p_payload ? 'height')
       and ((p_payload->>'height')::int < 4 or (p_payload->>'height')::int > 2000) then
      raise exception 'Kích thước vật trang trí không hợp lệ.';
    end if;

    insert into public.floor_plan_decorations
      (tenant_id, branch_id, zone_id, kind, label, icon, color,
       width, height, position_x, position_y, rotation, z_index)
    values (v_tenant, v_zone.branch_id, v_zone.id,
            trim(p_payload->>'kind'),
            nullif(trim(coalesce(p_payload->>'label','')), ''),
            nullif(trim(coalesce(p_payload->>'icon','')), ''),
            nullif(trim(coalesce(p_payload->>'color','')), ''),
            coalesce((p_payload->>'width')::int, 64),
            coalesce((p_payload->>'height')::int, 64),
            coalesce((p_payload->>'position_x')::int, 0),
            coalesce((p_payload->>'position_y')::int, 0),
            coalesce((p_payload->>'rotation')::int, 0),
            coalesce((p_payload->>'z_index')::int, 0))
    returning * into v_deco;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, new_data)
    values (v_tenant, v_actor, 'floor_plan_decoration', v_deco.id, 'config_create', to_jsonb(v_deco));
    return jsonb_build_object('ok', true, 'decoration', to_jsonb(v_deco));

  elsif p_action = 'update' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('decoration_id','kind','label','icon','color','width','height',
                      'position_x','position_y','rotation','z_index','locked');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_deco from public.floor_plan_decorations d
      where d.id = (p_payload->>'decoration_id')::uuid and d.tenant_id = v_tenant
      for update;
    if not found then raise exception 'Không tìm thấy vật trang trí.'; end if;
    if not public.user_has_permission(v_actor, 'floor_plan.edit_global') then
      if not public.user_has_permission(v_actor, 'floor_plan.edit_branch') then
        raise exception 'Bạn không có quyền chỉnh sửa sơ đồ bàn.';
      end if;
      if not public.user_has_branch_access(v_actor, v_deco.branch_id) then
        raise exception 'Bạn không có quyền với chi nhánh này.';
      end if;
    end if;
    v_old := to_jsonb(v_deco);

    update public.floor_plan_decorations d set
      kind       = case when p_payload ? 'kind' then trim(p_payload->>'kind') else d.kind end,
      label      = case when p_payload ? 'label' then nullif(trim(coalesce(p_payload->>'label','')), '') else d.label end,
      icon       = case when p_payload ? 'icon' then nullif(trim(coalesce(p_payload->>'icon','')), '') else d.icon end,
      color      = case when p_payload ? 'color' then nullif(trim(coalesce(p_payload->>'color','')), '') else d.color end,
      width      = case when p_payload ? 'width' then (p_payload->>'width')::int else d.width end,
      height     = case when p_payload ? 'height' then (p_payload->>'height')::int else d.height end,
      position_x = case when p_payload ? 'position_x' then (p_payload->>'position_x')::int else d.position_x end,
      position_y = case when p_payload ? 'position_y' then (p_payload->>'position_y')::int else d.position_y end,
      rotation   = case when p_payload ? 'rotation' then ((p_payload->>'rotation')::int % 360 + 360) % 360 else d.rotation end,
      z_index    = case when p_payload ? 'z_index' then (p_payload->>'z_index')::int else d.z_index end,
      locked     = case when p_payload ? 'locked' then (p_payload->>'locked')::boolean else d.locked end
    where d.id = v_deco.id
    returning * into v_deco;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data, new_data)
    values (v_tenant, v_actor, 'floor_plan_decoration', v_deco.id, 'config_update', v_old, to_jsonb(v_deco));
    return jsonb_build_object('ok', true, 'decoration', to_jsonb(v_deco));

  elsif p_action = 'delete' then
    perform 1 from jsonb_object_keys(p_payload) k where k not in ('decoration_id');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_deco from public.floor_plan_decorations d
      where d.id = (p_payload->>'decoration_id')::uuid and d.tenant_id = v_tenant
      for update;
    if not found then raise exception 'Không tìm thấy vật trang trí.'; end if;
    if not public.user_has_permission(v_actor, 'floor_plan.edit_global') then
      if not public.user_has_permission(v_actor, 'floor_plan.edit_branch') then
        raise exception 'Bạn không có quyền chỉnh sửa sơ đồ bàn.';
      end if;
      if not public.user_has_branch_access(v_actor, v_deco.branch_id) then
        raise exception 'Bạn không có quyền với chi nhánh này.';
      end if;
    end if;

    -- Audit TRƯỚC rồi mới xoá cứng — giữ đúng hành vi xoá cứng hiện tại
    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data)
    values (v_tenant, v_actor, 'floor_plan_decoration', v_deco.id, 'config_delete', to_jsonb(v_deco));
    delete from public.floor_plan_decorations where id = v_deco.id;
    return jsonb_build_object('ok', true);

  else
    raise exception 'Hành động không hợp lệ.';
  end if;
end;
$$;

-- ── Quyền gọi: thu hồi PUBLIC/anon, chỉ cấp authenticated ──
revoke all on function public.fnb_table_config_atomic(text, uuid, jsonb) from public, anon;
grant execute on function public.fnb_table_config_atomic(text, uuid, jsonb) to authenticated;

revoke all on function public.fnb_floor_zone_config_atomic(text, uuid, jsonb) from public, anon;
grant execute on function public.fnb_floor_zone_config_atomic(text, uuid, jsonb) to authenticated;

revoke all on function public.fnb_floor_layout_update_atomic(jsonb) from public, anon;
grant execute on function public.fnb_floor_layout_update_atomic(jsonb) to authenticated;

revoke all on function public.fnb_floor_decoration_config_atomic(text, jsonb) from public, anon;
grant execute on function public.fnb_floor_decoration_config_atomic(text, jsonb) to authenticated;

comment on function public.fnb_table_config_atomic(text, uuid, jsonb) is
  'F1a 00323: cau hinh ban/khu (man Ban & Khu vuc). Quyen system.manage_branches. Chi doc/ghi trong pham vi tenant cua actor.';
comment on function public.fnb_floor_zone_config_atomic(text, uuid, jsonb) is
  'F1a 00323: khu vuc so do ban. Quyen floor_plan.edit_global hoac edit_branch + branch access.';
comment on function public.fnb_floor_layout_update_atomic(jsonb) is
  'F1a 00323: luu layout ban (don hoac lo, 1 giao dich). Quyen floor_plan.edit_*.';
comment on function public.fnb_floor_decoration_config_atomic(text, jsonb) is
  'F1a 00323: vat trang tri so do. Xoa cung giu nguyen hanh vi cu nhung audit truoc khi xoa.';

do $$ begin raise notice '00323: OK — 4 RPC cau hinh ban/so do da tao (chua thu hoi grant cu — do la F1b)'; end $$;
