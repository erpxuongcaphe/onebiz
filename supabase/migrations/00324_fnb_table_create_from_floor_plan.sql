-- ============================================================================
-- 00324 — vá quyền nhánh CREATE của fnb_table_config_atomic (F1a, bổ sung)
--
-- VÌ SAO: kiểm trước khi merge PR #218 phát hiện hồi quy thật.
--   Trang "Sơ đồ bàn" (/he-thong/so-do-ban) mở cho ai có floor_plan.edit_global
--   HOẶC floor_plan.edit_branch. Trong đó có nút thêm bàn từ bảng hình (gọi
--   createTable). Vai trò "Quản lý" của OneBiz có floor_plan.edit_branch nhưng
--   KHÔNG có system.manage_branches → sau khi client chuyển sang RPC, họ kéo
--   thả được nhưng bấm thêm bàn sẽ bị chặn, trong khi hôm nay họ làm được.
--
-- NGUYÊN TẮC F1a: khoá đường ghi lại, KHÔNG đổi phạm vi người dùng làm được.
--   Nên nhánh create tách hai lối:
--     • Tạo từ màn "Bàn & Khu vực" (payload KHÔNG có zone_id)
--         → vẫn bắt buộc system.manage_branches (như 00323).
--     • Tạo từ sơ đồ bàn (payload CÓ zone_id — chỉ editor sơ đồ gửi kèm)
--         → cho phép thêm floor_plan.edit_global, hoặc floor_plan.edit_branch
--           kèm user_has_branch_access. Vẫn CHẶT hơn hôm nay: hôm nay RLS chỉ
--           cô lập tenant nên mọi nhân viên ghi được ở MỌI chi nhánh.
--   Các action khác (update/delete/bulk_create/zone_rename/zone_delete) giữ
--   nguyên system.manage_branches.
--
-- Migration chỉ THAY THÂN HÀM, không đụng bảng/dữ liệu/quyền gọi.
-- ============================================================================

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
  v_manage   boolean;
  v_plan_ok  boolean;
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
  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.tenant_id = v_tenant
  ) then
    raise exception 'Chi nhánh không thuộc doanh nghiệp của bạn.';
  end if;

  v_manage := public.user_has_permission(v_actor, 'system.manage_branches');

  -- Lối tạo bàn TỪ SƠ ĐỒ: chỉ khi payload mang zone_id (editor sơ đồ gửi).
  v_plan_ok := p_action = 'create'
    and (p_payload ? 'zone_id')
    and (
      public.user_has_permission(v_actor, 'floor_plan.edit_global')
      or (
        public.user_has_permission(v_actor, 'floor_plan.edit_branch')
        and public.user_has_branch_access(v_actor, p_branch_id)
      )
    );

  if not (v_manage or v_plan_ok) then
    raise exception 'Bạn không có quyền quản lý bàn và khu vực.';
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
  end if;

  -- ── Mọi action còn lại: bắt buộc system.manage_branches (không nới) ──
  if not v_manage then
    raise exception 'Bạn không có quyền quản lý bàn và khu vực.';
  end if;

  -- ── update: sửa thông tin/vị trí 1 bàn ──
  if p_action = 'update' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('table_id','name','table_number','zone','capacity',
                      'sort_order','position_x','position_y');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_row from public.restaurant_tables t
      where t.id = (p_payload->>'table_id')::uuid
        and t.tenant_id = v_tenant and t.branch_id = p_branch_id
      for update;
    if v_row.id is null then
      raise exception 'Không tìm thấy bàn cần sửa trong chi nhánh này.';
    end if;
    v_old := to_jsonb(v_row);

    if (p_payload ? 'table_number') then
      v_num := (p_payload->>'table_number')::int;
      if v_num is null or v_num < 1 or v_num > 9999 then
        raise exception 'Số bàn phải từ 1 đến 9999.';
      end if;
      if exists (
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
    if (p_payload ? 'name')
       and coalesce(nullif(trim(p_payload->>'name'), ''), '') = '' then
      raise exception 'Tên bàn không được để trống.';
    end if;

    update public.restaurant_tables t set
      name         = case when p_payload ? 'name' then trim(p_payload->>'name') else t.name end,
      table_number = case when p_payload ? 'table_number' then (p_payload->>'table_number')::int else t.table_number end,
      zone         = case when p_payload ? 'zone' then nullif(trim(p_payload->>'zone'), '') else t.zone end,
      capacity     = case when p_payload ? 'capacity' then (p_payload->>'capacity')::int else t.capacity end,
      sort_order   = case when p_payload ? 'sort_order' then (p_payload->>'sort_order')::int else t.sort_order end,
      position_x   = case when p_payload ? 'position_x' then (p_payload->>'position_x')::int else t.position_x end,
      position_y   = case when p_payload ? 'position_y' then (p_payload->>'position_y')::int else t.position_y end
    where t.id = v_row.id
    returning * into v_row;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data, new_data)
    values (v_tenant, v_actor, 'restaurant_table', v_row.id, 'config_update', v_old, to_jsonb(v_row));
    return jsonb_build_object('ok', true, 'table', to_jsonb(v_row));

  -- ── delete: xoá mềm 1 bàn, chặn khi bàn đang phục vụ / còn đơn ──
  elsif p_action = 'delete' then
    perform 1 from jsonb_object_keys(p_payload) k where k not in ('table_id');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    select * into v_row from public.restaurant_tables t
      where t.id = (p_payload->>'table_id')::uuid
        and t.tenant_id = v_tenant and t.branch_id = p_branch_id
      for update;
    if v_row.id is null then
      raise exception 'Không tìm thấy bàn cần xoá trong chi nhánh này.';
    end if;
    if v_row.status <> 'available' or v_row.current_order_id is not null then
      raise exception 'Bàn "%" đang phục vụ hoặc còn đơn — không thể xoá. Hãy thanh toán hoặc chuyển đơn trước.', v_row.name;
    end if;
    v_old := to_jsonb(v_row);

    update public.restaurant_tables t set is_active = false
    where t.id = v_row.id returning * into v_row;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data, new_data)
    values (v_tenant, v_actor, 'restaurant_table', v_row.id, 'config_delete', v_old, to_jsonb(v_row));
    return jsonb_build_object('ok', true);

  -- ── bulk_create: tạo nhiều bàn cho một khu ──
  elsif p_action = 'bulk_create' then
    perform 1 from jsonb_object_keys(p_payload) k
      where k not in ('zone','count','start_number','capacity');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    v_zone  := nullif(trim(coalesce(p_payload->>'zone','')), '');
    v_count := (p_payload->>'count')::int;
    v_num   := (p_payload->>'start_number')::int;
    if v_zone is null then raise exception 'Tên khu vực không được để trống.'; end if;
    if v_count is null or v_count < 1 or v_count > 200 then
      raise exception 'Số lượng bàn phải từ 1 đến 200.';
    end if;
    if v_num is null or v_num < 1 or v_num > 9999 then
      raise exception 'Số bàn bắt đầu phải từ 1 đến 9999.';
    end if;
    if v_num + v_count - 1 > 9999 then
      raise exception 'Dãy số bàn vượt quá 9999.';
    end if;
    if (p_payload ? 'capacity')
       and ((p_payload->>'capacity')::int < 1 or (p_payload->>'capacity')::int > 100) then
      raise exception 'Sức chứa phải từ 1 đến 100.';
    end if;

    perform 1 from public.restaurant_tables t
      where t.tenant_id = v_tenant and t.branch_id = p_branch_id and t.is_active
        and t.table_number between v_num and v_num + v_count - 1
      for update;
    if found then
      raise exception 'Dãy số bàn % đến % đã có bàn tồn tại.', v_num, v_num + v_count - 1;
    end if;

    with moi as (
      insert into public.restaurant_tables
        (tenant_id, branch_id, table_number, name, zone, capacity, sort_order)
      select v_tenant, p_branch_id, v_num + i, 'Bàn ' || (v_num + i), v_zone,
             coalesce((p_payload->>'capacity')::int, 4), v_num + i
      from generate_series(0, v_count - 1) i
      returning id
    )
    select array_agg(id) into v_ids from moi;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, new_data)
    values (v_tenant, v_actor, 'restaurant_table', null, 'config_bulk_create',
            jsonb_build_object('zone', v_zone, 'count', v_count,
                               'start_number', v_num, 'ids', to_jsonb(v_ids)));
    return jsonb_build_object('ok', true, 'created', v_count);

  -- ── zone_rename: đổi tên khu + đồng bộ tên khu sơ đồ trùng tên ──
  elsif p_action = 'zone_rename' then
    perform 1 from jsonb_object_keys(p_payload) k where k not in ('old_zone','new_zone');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    v_zone     := nullif(trim(coalesce(p_payload->>'old_zone','')), '');
    v_new_zone := nullif(trim(coalesce(p_payload->>'new_zone','')), '');
    if v_zone is null or v_new_zone is null then
      raise exception 'Tên khu vực không được để trống.';
    end if;
    if length(v_new_zone) > 100 then
      raise exception 'Tên khu vực tối đa 100 ký tự.';
    end if;

    update public.restaurant_tables t set zone = v_new_zone
    where t.tenant_id = v_tenant and t.branch_id = p_branch_id
      and t.zone = v_zone and t.is_active;
    get diagnostics v_count = row_count;

    update public.floor_plan_zones z set name = v_new_zone, updated_at = now()
    where z.tenant_id = v_tenant and z.branch_id = p_branch_id
      and z.name = v_zone and z.is_active;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data, new_data)
    values (v_tenant, v_actor, 'restaurant_table', null, 'config_zone_rename',
            jsonb_build_object('zone', v_zone),
            jsonb_build_object('zone', v_new_zone, 'tables', v_count, 'branch_id', p_branch_id));
    return jsonb_build_object('ok', true, 'renamed', v_count);

  -- ── zone_delete: xoá mềm toàn bộ bàn trong khu; còn bàn bận → chặn TẤT CẢ ──
  elsif p_action = 'zone_delete' then
    perform 1 from jsonb_object_keys(p_payload) k where k not in ('zone');
    if found then raise exception 'Trường dữ liệu không hợp lệ.'; end if;

    v_zone := nullif(trim(coalesce(p_payload->>'zone','')), '');
    if v_zone is null then raise exception 'Tên khu vực không được để trống.'; end if;

    perform 1 from public.restaurant_tables t
      where t.tenant_id = v_tenant and t.branch_id = p_branch_id
        and t.zone = v_zone and t.is_active
      for update;

    select count(*) into v_count from public.restaurant_tables t
      where t.tenant_id = v_tenant and t.branch_id = p_branch_id
        and t.zone = v_zone and t.is_active
        and (t.status <> 'available' or t.current_order_id is not null);
    if v_count > 0 then
      raise exception 'Khu "%" còn % bàn đang phục vụ hoặc còn đơn — không thể xoá khu.', v_zone, v_count;
    end if;

    update public.restaurant_tables t set is_active = false
    where t.tenant_id = v_tenant and t.branch_id = p_branch_id
      and t.zone = v_zone and t.is_active;
    get diagnostics v_count = row_count;

    insert into public.audit_log (tenant_id, user_id, entity_type, entity_id, action, old_data)
    values (v_tenant, v_actor, 'restaurant_table', null, 'config_zone_delete',
            jsonb_build_object('zone', v_zone, 'tables', v_count, 'branch_id', p_branch_id));
    return jsonb_build_object('ok', true, 'deleted', v_count);
  end if;

  raise exception 'Thao tác không hợp lệ.';
end $$;

revoke all on function public.fnb_table_config_atomic(text, uuid, jsonb) from public, anon;
grant execute on function public.fnb_table_config_atomic(text, uuid, jsonb) to authenticated;

comment on function public.fnb_table_config_atomic(text, uuid, jsonb) is
  'F1a 00324: cau hinh ban/khu. system.manage_branches cho moi thao tac; RIENG tao ban tu so do (payload co zone_id) chap nhan floor_plan.edit_global hoac edit_branch + branch access.';

do $$
begin
  raise notice '00324: da cap nhat fnb_table_config_atomic — them loi tao ban tu so do';
end $$;
