-- ============================================================================
-- 00350 — FnB: định lượng BOM chính xác theo từng lựa chọn
--
-- VẤN ĐỀ
-- `modifier_options.scale_factor` là mô hình cũ: một tỷ lệ được áp dụng chung
-- cho mọi món. Thực tế công thức không tuyến tính: Hồng Trà 80% có thể là 28g
-- đường nhưng một đồ uống khác không nhất thiết là 80% của định lượng 100%.
--
-- CÁCH LÀM
-- Thêm bảng `bom_modifier_option_quantities` với khoá:
--   BOM × nguyên liệu × lựa chọn modifier = định lượng chính xác / 1 ly.
-- Khi BOM có ít nhất một dòng trong bảng mới cho một nguyên liệu đang gắn
-- modifier group, tầng gửi bếp và tầng thanh toán bắt buộc dùng định lượng
-- chính xác. BOM chưa khai vẫn đi theo `scale_factor` cũ để chuyển đổi dần.
--
-- KHÔNG ĐỤNG
-- Không cập nhật món, BOM, tồn, đơn bếp, hoá đơn hay stock_movements cũ.
-- Hủy bill vẫn hoàn theo stock_movements đã ghi, không tính lại công thức.
-- ============================================================================

begin;

-- ── 1. Bảng định lượng chính xác ───────────────────────────────────────────
create table if not exists public.bom_modifier_option_quantities (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bom_id uuid not null references public.bom(id) on delete cascade,
  material_id uuid not null references public.products(id) on delete restrict,
  modifier_option_id uuid not null references public.modifier_options(id) on delete restrict,
  quantity numeric(15,4) not null check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bom_modifier_option_quantities_unique
    unique (bom_id, material_id, modifier_option_id)
);

create index if not exists idx_bmoq_bom_material
  on public.bom_modifier_option_quantities(bom_id, material_id);

create index if not exists idx_bmoq_option
  on public.bom_modifier_option_quantities(modifier_option_id);

comment on table public.bom_modifier_option_quantities is
  '00350: Dinh luong chinh xac NVL theo BOM va lua chon FnB. Co dong o day thi uu tien so gram/ml nay, khong suy tu scale_factor chung.';

-- ── 2. Guard cấu hình: cùng tenant, đúng group, đúng BOM item ─────────────
create or replace function public.enforce_bom_modifier_option_quantity_00350()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_bom_tenant uuid;
  v_group_id uuid;
  v_group_rule text;
  v_item_count integer;
begin
  select b.tenant_id into v_bom_tenant
    from public.bom b
   where b.id = new.bom_id;
  if v_bom_tenant is null then
    raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_BOM_NOT_FOUND';
  end if;
  if new.tenant_id is distinct from v_bom_tenant then
    raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_TENANT_MISMATCH';
  end if;

  select g.id, g.rule into v_group_id, v_group_rule
    from public.modifier_options o
    join public.modifier_groups g on g.id = o.group_id
   where o.id = new.modifier_option_id
     and o.is_active
     and g.is_active
     and g.tenant_id = v_bom_tenant;
  if v_group_id is null then
    raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_OPTION_TENANT_MISMATCH';
  end if;
  if v_group_rule not in ('single', 'single_required') then
    raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_GROUP_MUST_SELECT_ONE';
  end if;

  select count(*) into v_item_count
    from public.bom_items bi
   where bi.bom_id = new.bom_id
     and bi.material_id = new.material_id
     and bi.modifier_scale_target = v_group_id;
  if v_item_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_BOM_ITEM_TARGET_MISMATCH';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_enforce_bom_modifier_option_quantity_00350
  on public.bom_modifier_option_quantities;
create trigger trg_enforce_bom_modifier_option_quantity_00350
before insert or update on public.bom_modifier_option_quantities
for each row execute function public.enforce_bom_modifier_option_quantity_00350();

revoke all on function public.enforce_bom_modifier_option_quantity_00350()
  from public, anon, authenticated, service_role;

-- Bảng này không có dữ liệu kinh doanh cũ. RLS tách tuyệt đối theo tenant,
-- giống các bảng modifier trước đó. Hàm thanh toán SECURITY DEFINER vẫn đọc
-- được để bảo vệ tính toàn vẹn của giao dịch.
alter table public.bom_modifier_option_quantities enable row level security;
drop policy if exists bmoq_tenant_select on public.bom_modifier_option_quantities;
drop policy if exists bmoq_tenant_insert on public.bom_modifier_option_quantities;
drop policy if exists bmoq_tenant_update on public.bom_modifier_option_quantities;
drop policy if exists bmoq_tenant_delete on public.bom_modifier_option_quantities;
create policy bmoq_tenant_select on public.bom_modifier_option_quantities
  for select using (tenant_id = (select public.get_user_tenant_id()));
create policy bmoq_tenant_insert on public.bom_modifier_option_quantities
  for insert with check (tenant_id = (select public.get_user_tenant_id()));
create policy bmoq_tenant_update on public.bom_modifier_option_quantities
  for update using (tenant_id = (select public.get_user_tenant_id()))
  with check (tenant_id = (select public.get_user_tenant_id()));
create policy bmoq_tenant_delete on public.bom_modifier_option_quantities
  for delete using (tenant_id = (select public.get_user_tenant_id()));

-- The BOM editor only reads rows directly. All mutations go through the
-- atomic SECURITY DEFINER RPC below, so a browser cannot create a partial map.
revoke all on table public.bom_modifier_option_quantities from public, anon;
grant select on table public.bom_modifier_option_quantities to authenticated;

-- Lưu cả bộ định lượng trong một RPC để giao diện không có khoảnh khắc xóa
-- trước rồi lỗi khi chèn lại. Trigger ở trên vẫn là lớp kiểm cuối cùng.
create or replace function public.save_bom_modifier_option_quantities(
  p_bom_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_row jsonb;
  v_material_id uuid;
  v_option_id uuid;
  v_quantity numeric;
  v_seen text[] := array[]::text[];
  v_key text;
  v_group_id uuid;
  v_expected_count integer;
  v_provided_count integer;
  v_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant from public.profiles p
   where p.id = v_actor and p.is_active;
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not exists (select 1 from public.bom b where b.id = p_bom_id and b.tenant_id = v_tenant) then
    raise exception using errcode = '42501', message = 'FNB_EXACT_RECIPE_BOM_TENANT_MISMATCH';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_ROWS_INVALID';
  end if;

  -- Validate all input before replacing anything.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_material_id := nullif(v_row->>'materialId', '')::uuid;
      v_option_id := nullif(v_row->>'modifierOptionId', '')::uuid;
      v_quantity := (v_row->>'quantity')::numeric;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_ROW_FORMAT_INVALID';
    end;
    if v_material_id is null or v_option_id is null or v_quantity is null or v_quantity < 0 then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_ROW_INVALID';
    end if;
    v_key := v_material_id::text || ':' || v_option_id::text;
    if v_key = any(v_seen) then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_DUPLICATE_ROW';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;

  -- Once a material starts using exact quantities, it must cover every
  -- currently active option of its select-one group. A caller therefore cannot
  -- leave only 80% mapped and accidentally sell a new 60% option by fallback.
  for v_material_id, v_group_id in
    select distinct
      (r.value->>'materialId')::uuid,
      mo.group_id
    from jsonb_array_elements(p_rows) r(value)
    join public.modifier_options mo
      on mo.id = (r.value->>'modifierOptionId')::uuid
  loop
    select count(*) into v_expected_count
      from public.modifier_options mo
     where mo.group_id = v_group_id
       and mo.is_active;
    select count(distinct (r.value->>'modifierOptionId')::uuid) into v_provided_count
      from jsonb_array_elements(p_rows) r(value)
      join public.modifier_options mo
        on mo.id = (r.value->>'modifierOptionId')::uuid
     where (r.value->>'materialId')::uuid = v_material_id
       and mo.group_id = v_group_id;
    if v_expected_count = 0 or v_provided_count <> v_expected_count then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_GROUP_INCOMPLETE';
    end if;
  end loop;

  delete from public.bom_modifier_option_quantities where bom_id = p_bom_id;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_material_id := (v_row->>'materialId')::uuid;
    v_option_id := (v_row->>'modifierOptionId')::uuid;
    v_quantity := (v_row->>'quantity')::numeric;
    insert into public.bom_modifier_option_quantities (
      tenant_id, bom_id, material_id, modifier_option_id, quantity
    ) values (v_tenant, p_bom_id, v_material_id, v_option_id, v_quantity);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('success', true, 'saved', v_count);
end;
$function$;

revoke all on function public.save_bom_modifier_option_quantities(uuid, jsonb)
  from public, anon;
grant execute on function public.save_bom_modifier_option_quantities(uuid, jsonb)
  to authenticated;

-- ── 3. Tầng gửi bếp: chặn thiếu định lượng trước khi ghi bất cứ gì ─────────
do $rename_send$
begin
  if to_regprocedure('public._fnb_send_to_kitchen_impl_00330(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null then
    return;
  end if;
  if to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00350_SEND_KITCHEN_RPC_MISSING';
  end if;
  if position('_fnb_send_to_kitchen_impl_00303' in pg_get_functiondef(
    to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)')
  )) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00350_SEND_KITCHEN_PREREQUISITE_CHANGED';
  end if;
  alter function public.fnb_send_to_kitchen_atomic_v2(
    uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
  ) rename to _fnb_send_to_kitchen_impl_00330;
end;
$rename_send$;

create or replace function public.fnb_send_to_kitchen_atomic_v2(
  p_branch_id uuid,
  p_table_id uuid default null,
  p_order_type text default 'dine_in',
  p_note text default null,
  p_idempotency_key text default null,
  p_items jsonb default '[]'::jsonb,
  p_delivery_platform text default null,
  p_delivery_fee numeric default 0,
  p_platform_commission_percent numeric default null,
  p_delivery_staff_id uuid default null,
  p_delivery_distance_tier text default null,
  p_existing_order_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_item jsonb;
  v_pid uuid;
  v_vid uuid;
  v_bom_id uuid;
  v_exact record;
  v_option_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;
  select p.tenant_id into v_tenant
    from public.profiles p
   where p.id = v_actor and p.is_active
   limit 1;
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  -- Không tự chọn thay nhân viên. Có mapping chính xác thì nhóm đó phải có
  -- option khớp trước khi chuyển xuống nghiệp vụ 00330/00303.
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_pid := coalesce(nullif(v_item->>'productId', '')::uuid, nullif(v_item->>'product_id', '')::uuid);
    continue when v_pid is null;
    v_vid := coalesce(nullif(v_item->>'variantId', '')::uuid, nullif(v_item->>'variant_id', '')::uuid);
    v_bom_id := public.get_active_bom_for_branch(v_pid, p_branch_id, v_vid);
    continue when v_bom_id is null;

    for v_exact in
      select distinct
        bi.material_id,
        mo.group_id,
        g.name as group_name,
        coalesce(p.name, p.code, bi.material_id::text) as material_name
      from public.bom_items bi
      join public.bom_modifier_option_quantities q
        on q.bom_id = bi.bom_id and q.material_id = bi.material_id
      join public.modifier_options mo on mo.id = q.modifier_option_id
      join public.modifier_groups g on g.id = mo.group_id
      left join public.products p on p.id = bi.material_id
      where bi.bom_id = v_bom_id
        and bi.modifier_scale_target = mo.group_id
    loop
      v_option_id := null;
      begin
        select nullif(o.value->>'optionId', '')::uuid into v_option_id
          from jsonb_array_elements(coalesce(v_item->'modifierSelections', '[]'::jsonb)) s
          cross join lateral jsonb_array_elements(coalesce(s.value->'options', '[]'::jsonb)) o(value)
         where s.value->>'groupId' = v_exact.group_id::text
         limit 1;
      exception when invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_INVALID_OPTION';
      end;
      if v_option_id is null then
        raise exception using errcode = 'P0001',
          message = 'FNB_EXACT_RECIPE_SELECTION_REQUIRED',
          detail = format('Nhom "%s" can chon de tinh dung %s.', v_exact.group_name, v_exact.material_name);
      end if;
      if not exists (
        select 1 from public.bom_modifier_option_quantities q
         where q.bom_id = v_bom_id
           and q.material_id = v_exact.material_id
           and q.modifier_option_id = v_option_id
      ) then
        raise exception using errcode = 'P0001',
          message = 'FNB_EXACT_RECIPE_OPTION_MISSING',
          detail = format('Chua khai dinh luong %s cho lua chon nay.', v_exact.material_name);
      end if;
    end loop;
  end loop;

  return public._fnb_send_to_kitchen_impl_00330(
    p_branch_id, p_table_id, p_order_type, p_note, p_idempotency_key, p_items,
    p_delivery_platform, p_delivery_fee, p_platform_commission_percent,
    p_delivery_staff_id, p_delivery_distance_tier, p_existing_order_id
  );
end;
$function$;

revoke all on function public._fnb_send_to_kitchen_impl_00330(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) from public, anon;
grant execute on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) to authenticated;

-- ── 4. Tầng thanh toán: dùng định lượng chính xác nếu BOM đã khai ──────────
-- Giữ nguyên chữ ký để mọi hàm thanh toán/đổi trả đang gọi theo OID không đổi.
create or replace function public.consume_bom_for_sale(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_id uuid,
  p_qty numeric,
  p_invoice_id uuid,
  p_created_by uuid,
  p_invoice_code text default null,
  p_modifier_selections jsonb default null,
  p_skip_bom_consume boolean default false,
  p_variant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_bom_id uuid;
  v_bom record;
  v_item record;
  v_consumed jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_consume_qty numeric;
  v_available numeric;
  v_allow_negative boolean;
  v_note text;
  v_modifier_scale numeric;
  v_sel jsonb;
  v_opt jsonb;
  v_linked_id uuid;
  v_topping_qty numeric;
  v_topping_name text;
  v_exact_enabled boolean;
  v_exact_quantity numeric;
  v_exact_option_id uuid;
  v_exact_group_name text;
begin
  if p_tenant_id is null or p_branch_id is null or p_sku_id is null then
    raise exception 'consume_bom_for_sale: tenant_id, branch_id, sku_id are required';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'consume_bom_for_sale: qty must be > 0';
  end if;

  if not p_skip_bom_consume then
    v_bom_id := public.get_active_bom_for_branch(p_sku_id, p_branch_id, p_variant_id);
  else
    v_bom_id := null;
  end if;

  v_allow_negative := coalesce(
    (public.get_tenant_setting(p_tenant_id, 'allow_negative_stock', 'true'::jsonb))::boolean,
    true
  );

  if v_bom_id is not null then
    select b.id, b.name, b.code into v_bom from public.bom b where b.id = v_bom_id;
    v_note := format('Tiêu hao NVL theo BOM [%s] — HĐ %s',
      coalesce(v_bom.code, v_bom.name, 'BOM'), coalesce(p_invoice_code, p_invoice_id::text));

    for v_item in
      select bi.material_id, bi.unit, bi.quantity, coalesce(bi.waste_percent, 0) as waste_percent,
             bi.modifier_scale_target, p.code as material_code, p.name as material_name
        from public.bom_items bi
        left join public.products p on p.id = bi.material_id
       where bi.bom_id = v_bom_id
       order by bi.sort_order, bi.id
    loop
      if v_item.material_id = p_sku_id then continue; end if;

      -- Có dòng exact cho BOM + NVL này thì không được suy diễn từ % chung.
      select exists (
        select 1
          from public.bom_modifier_option_quantities q
          join public.modifier_options mo on mo.id = q.modifier_option_id
         where q.bom_id = v_bom_id
           and q.material_id = v_item.material_id
           and mo.group_id = v_item.modifier_scale_target
      ) into v_exact_enabled;

      v_modifier_scale := 1;
      v_exact_quantity := null;
      v_exact_option_id := null;
      v_exact_group_name := null;
      if v_exact_enabled then
        if p_modifier_selections is not null and jsonb_typeof(p_modifier_selections) = 'array' then
          begin
            select nullif(o.value->>'optionId', '')::uuid, s.value->>'groupName'
              into v_exact_option_id, v_exact_group_name
              from jsonb_array_elements(p_modifier_selections) s
              cross join lateral jsonb_array_elements(coalesce(s.value->'options', '[]'::jsonb)) o(value)
             where s.value->>'groupId' = v_item.modifier_scale_target::text
             limit 1;
          exception when invalid_text_representation then
            raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_INVALID_OPTION';
          end;
        end if;
        if v_exact_option_id is null then
          raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_SELECTION_REQUIRED',
            detail = coalesce(v_exact_group_name, 'Nhóm lựa chọn') || ' chưa được chọn.';
        end if;
        select q.quantity into v_exact_quantity
          from public.bom_modifier_option_quantities q
         where q.bom_id = v_bom_id
           and q.material_id = v_item.material_id
           and q.modifier_option_id = v_exact_option_id;
        if not found then
          raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_OPTION_MISSING',
            detail = format('Chua khai dinh luong %s cho lua chon nay.', coalesce(v_item.material_name, v_item.material_code, 'NVL'));
        end if;
        v_consume_qty := round((v_exact_quantity * (1 + v_item.waste_percent / 100) * p_qty)::numeric, 4);
      else
        if v_item.modifier_scale_target is not null
           and p_modifier_selections is not null
           and jsonb_typeof(p_modifier_selections) = 'array' then
          for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
            if (v_sel->>'groupId')::uuid = v_item.modifier_scale_target then
              for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
                if v_opt->>'scaleFactor' is not null and v_opt->>'scaleFactor' <> 'null' then
                  v_modifier_scale := least(v_modifier_scale, coalesce((v_opt->>'scaleFactor')::numeric, 1));
                end if;
              end loop;
              exit;
            end if;
          end loop;
        end if;
        v_consume_qty := round((v_item.quantity * (1 + v_item.waste_percent / 100) * p_qty * v_modifier_scale)::numeric, 4);
      end if;

      if v_consume_qty <= 0 then continue; end if;
      select coalesce(sum(quantity), 0) into v_available from public.branch_stock
       where product_id = v_item.material_id and branch_id = p_branch_id and variant_id is null;
      if v_available < v_consume_qty then
        if not v_allow_negative then
          raise exception 'NVL_INSUFFICIENT: NVL "%" tại chi nhánh thiếu — còn %, cần % (cho %s × %s)',
            coalesce(v_item.material_name, v_item.material_code, v_item.material_id::text), v_available,
            v_consume_qty, p_qty, coalesce(v_bom.name, 'BOM');
        else
          v_warnings := v_warnings || jsonb_build_object(
            'material_id', v_item.material_id, 'material_code', v_item.material_code,
            'material_name', v_item.material_name, 'available', v_available, 'required', v_consume_qty,
            'modifier_mode', case when v_exact_enabled then 'exact' else 'legacy_scale' end,
            'modifier_scale', case when v_exact_enabled then null else v_modifier_scale end,
            'exact_unit_quantity', v_exact_quantity,
            'reason', format('NVL "%s" còn %s nhưng cần %s — tồn kho sẽ âm',
              coalesce(v_item.material_name, v_item.material_code), v_available, v_consume_qty)
          );
        end if;
      end if;

      perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_item.material_id, -v_consume_qty);
      perform public.increment_product_stock(v_item.material_id, -v_consume_qty);
      begin
        perform public.allocate_lots_fifo(p_tenant_id, v_item.material_id, p_branch_id, v_consume_qty, 'invoice', p_invoice_id);
      exception when others then null;
      end;
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity, reference_type, reference_id, note, created_by
      ) values (
        p_tenant_id, p_branch_id, v_item.material_id, 'out', v_consume_qty, 'bom_consume', p_invoice_id,
        v_note || case when v_exact_enabled
          then format(' [%s × %s × exact %s]', p_qty, coalesce(v_item.material_name, 'NVL'), v_exact_quantity)
          else format(' [%s × %s × scale %s]', p_qty, coalesce(v_item.material_name, 'NVL'), v_modifier_scale)
        end,
        p_created_by
      );
      v_consumed := v_consumed || jsonb_build_object(
        'material_id', v_item.material_id, 'material_code', v_item.material_code,
        'material_name', v_item.material_name, 'qty', v_consume_qty, 'unit', v_item.unit,
        'modifier_mode', case when v_exact_enabled then 'exact' else 'legacy_scale' end,
        'modifier_scale', case when v_exact_enabled then null else v_modifier_scale end,
        'exact_unit_quantity', v_exact_quantity, 'modifier_option_id', v_exact_option_id
      );
    end loop;
  end if;

  -- Giữ nguyên đường legacy cho option linked_product_id. Topping mới phải đi
  -- theo SKU-TPP có BOM riêng; migration này không làm thay đổi topping cũ.
  if p_modifier_selections is not null and jsonb_typeof(p_modifier_selections) = 'array' then
    for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
      for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
        if v_opt->>'linkedProductId' is not null and v_opt->>'linkedProductId' <> '' and v_opt->>'linkedProductId' <> 'null' then
          v_linked_id := (v_opt->>'linkedProductId')::uuid;
          v_topping_name := coalesce(v_opt->>'label', 'Topping');
          v_topping_qty := p_qty;
          select coalesce(sum(quantity), 0) into v_available from public.branch_stock
           where product_id = v_linked_id and branch_id = p_branch_id and variant_id is null;
          if v_available < v_topping_qty then
            if not v_allow_negative then
              raise exception 'NVL_INSUFFICIENT: Topping "%" tại chi nhánh thiếu — còn %, cần %', v_topping_name, v_available, v_topping_qty;
            else
              v_warnings := v_warnings || jsonb_build_object('material_id', v_linked_id, 'material_name', v_topping_name,
                'available', v_available, 'required', v_topping_qty,
                'reason', format('Topping NVL "%s" còn %s nhưng cần %s', v_topping_name, v_available, v_topping_qty));
            end if;
          end if;
          perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_linked_id, -v_topping_qty);
          perform public.increment_product_stock(v_linked_id, -v_topping_qty);
          begin
            perform public.allocate_lots_fifo(p_tenant_id, v_linked_id, p_branch_id, v_topping_qty, 'invoice', p_invoice_id);
          exception when others then null;
          end;
          insert into public.stock_movements (
            tenant_id, branch_id, product_id, type, quantity, reference_type, reference_id, note, created_by
          ) values (
            p_tenant_id, p_branch_id, v_linked_id, 'out', v_topping_qty, 'modifier_topping', p_invoice_id,
            format('Topping %s × %s — HĐ %s', v_topping_name, v_topping_qty, coalesce(p_invoice_code, p_invoice_id::text)),
            p_created_by
          );
          v_consumed := v_consumed || jsonb_build_object('material_id', v_linked_id, 'material_name', v_topping_name,
            'qty', v_topping_qty, 'kind', 'modifier_topping');
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'bom_id', v_bom_id, 'bom_name', coalesce(v_bom.name, null),
    'consumed', v_consumed, 'warnings', v_warnings, 'allow_negative', v_allow_negative, 'skipped_bom', p_skip_bom_consume);
end;
$function$;

revoke all on function public.consume_bom_for_sale(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, boolean, uuid
) from public, anon;
grant execute on function public.consume_bom_for_sale(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, boolean, uuid
) to authenticated;

comment on function public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid) is
  '00350: Tieu hao BOM FnB. Neu da khai bom_modifier_option_quantities cho NVL + lua chon thi dung dung dinh luong do; neu chua khai thi giu scale_factor legacy de chuyen doi dan.';

-- ── 5. Hậu kiểm trong migration: hỏng thì cuộn lại toàn bộ ─────────────────
do $verify$
declare v_count integer;
begin
  if to_regclass('public.bom_modifier_option_quantities') is null
     or to_regprocedure('public.enforce_bom_modifier_option_quantity_00350()') is null
     or to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') is null
     or to_regprocedure('public._fnb_send_to_kitchen_impl_00330(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00350_INSTALL_INCOMPLETE';
  end if;
  select count(*) into v_count from pg_proc p
   where p.oid = to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)')
     and pg_get_functiondef(p.oid) like '%FNB_EXACT_RECIPE_OPTION_MISSING%'
     and pg_get_functiondef(p.oid) like '%_fnb_send_to_kitchen_impl_00330%';
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_00350_SEND_WRAPPER_NOT_ACTIVE';
  end if;
  if position('bom_modifier_option_quantities' in pg_get_functiondef(
    to_regprocedure('public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)')
  )) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00350_CONSUME_NOT_ACTIVE';
  end if;
end;
$verify$;

commit;
notify pgrst, 'reload schema';
