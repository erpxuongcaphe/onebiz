-- HONG TRA XUONG TU BUA - BUOC 2: CAU HINH THU NGHIEM
--
-- Pham vi DUY NHAT:
--   * Tenant OneBiz Coffee Demo (148e8ac5-b891-4de3-9055-cfa41f39ddb0)
--   * SKU-HTR-001 - Hong Tra
--   * Chi nhanh Xưởng Cà Phê - Xưởng Tư Búa
--
-- Ket qua sau khi chay:
--   1. Hong Tra chi hien tren menu FnB cua Xưởng Tư Búa.
--   2. Hong Tra dung Muc da + Muc duong - Hong Tra + Topping.
--      (Khong dung Muc duong chung.)
--   3. Duong trong BOM dung dinh luong chinh xac:
--      60% = 21 G, 80% = 28 G, 100% = 35 G.
--
-- KHONG TAO / SUA: don hang, hoa don, phieu bep, thanh toan, ton kho,
-- lich su kho, gia ban, gia von, BOM co ban, nhom Muc duong chung.
--
-- File nay chi chay MOT LAN sau khi BUOC 1 da cho ket qua dung. Neu mot
-- dieu kien da bi thay doi, transaction dung va khong ghi mot phan du lieu.

begin;

do $guard$
declare
  v_tenant constant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_product_id uuid;
  v_branch_id uuid;
  v_sugar_group_id uuid;
  v_ice_group_id uuid;
  v_topping_group_id uuid;
  v_bom_id uuid;
  v_count integer;
  v_total_bom_items integer;
  v_sugar_qty numeric;
  v_sugar_input_quantity numeric;
  v_sugar_unit text;
  v_sugar_input_unit text;
  v_sugar_factor numeric;
  v_tea_qty numeric;
  v_tea_input_quantity numeric;
  v_tea_unit text;
  v_tea_input_unit text;
  v_tea_factor numeric;
  v_cup_qty numeric;
  v_cup_input_quantity numeric;
  v_cup_unit text;
  v_cup_input_unit text;
  v_cup_factor numeric;
  v_target uuid;
begin
  select count(*) into v_count
    from public.tenants t
   where t.id = v_tenant and t.name = 'OneBiz Coffee Demo';
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_TENANT_MISMATCH';
  end if;

  select count(*) into v_count
    from public.products p
   where p.tenant_id = v_tenant
     and p.code = 'SKU-HTR-001'
     and p.name = 'Hồng Trà'
     and p.product_type = 'sku'
     and p.channel = 'fnb'
     and p.is_active
     and p.allow_sale;
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_PRODUCT_NOT_UNIQUE_OR_NOT_SELLABLE';
  end if;
  select p.id into v_product_id
    from public.products p
   where p.tenant_id = v_tenant
     and p.code = 'SKU-HTR-001'
     and p.name = 'Hồng Trà'
     and p.product_type = 'sku'
     and p.channel = 'fnb'
     and p.is_active
     and p.allow_sale;

  select count(*) into v_count
    from public.branches b
   where b.tenant_id = v_tenant
     and b.name = 'Xưởng Cà Phê - Xưởng Tư Búa'
     and b.is_active
     and (b.cascade_mode = 'outlet' or b.branch_type = 'store');
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_BRANCH_NOT_UNIQUE_OR_NOT_OUTLET';
  end if;
  select b.id into v_branch_id
    from public.branches b
   where b.tenant_id = v_tenant
     and b.name = 'Xưởng Cà Phê - Xưởng Tư Búa'
     and b.is_active
     and (b.cascade_mode = 'outlet' or b.branch_type = 'store');

  -- Hai nhom nay dang duoc ke thua tu nhom hang. Khi gan rieng cap mon,
  -- phai giu lai ca hai de POS khong mat Muc da hoac Topping.
  select count(*) into v_count
    from public.category_modifier_groups cmg
    join public.products p on p.category_id = cmg.category_id
    join public.modifier_groups g on g.id = cmg.modifier_group_id
   where p.id = v_product_id
     and cmg.tenant_id = v_tenant
     and g.tenant_id = v_tenant
     and g.name = 'Mức đá'
     and g.rule in ('single', 'single_required')
     and g.channel in ('fnb', 'all')
     and g.is_active;
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_ICE_INHERITANCE_CHANGED';
  end if;
  select g.id into v_ice_group_id
    from public.category_modifier_groups cmg
    join public.products p on p.category_id = cmg.category_id
    join public.modifier_groups g on g.id = cmg.modifier_group_id
   where p.id = v_product_id
     and cmg.tenant_id = v_tenant
     and g.tenant_id = v_tenant
     and g.name = 'Mức đá'
     and g.rule in ('single', 'single_required')
     and g.channel in ('fnb', 'all')
     and g.is_active;

  select count(*) into v_count
    from public.category_modifier_groups cmg
    join public.products p on p.category_id = cmg.category_id
    join public.modifier_groups g on g.id = cmg.modifier_group_id
   where p.id = v_product_id
     and cmg.tenant_id = v_tenant
     and g.tenant_id = v_tenant
     and g.name = 'Topping'
     and g.rule = 'multi'
     and g.channel in ('fnb', 'all')
     and g.is_active;
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_TOPPING_INHERITANCE_CHANGED';
  end if;
  select g.id into v_topping_group_id
    from public.category_modifier_groups cmg
    join public.products p on p.category_id = cmg.category_id
    join public.modifier_groups g on g.id = cmg.modifier_group_id
   where p.id = v_product_id
     and cmg.tenant_id = v_tenant
     and g.tenant_id = v_tenant
     and g.name = 'Topping'
     and g.rule = 'multi'
     and g.channel in ('fnb', 'all')
     and g.is_active;

  select count(*) into v_count
    from public.modifier_groups g
   where g.tenant_id = v_tenant
     and g.name = 'Mức đường - Hồng Trà'
     and g.rule in ('single', 'single_required')
     and g.channel in ('fnb', 'all')
     and g.is_active;
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_SUGAR_GROUP_NOT_UNIQUE';
  end if;
  select g.id into v_sugar_group_id
    from public.modifier_groups g
   where g.tenant_id = v_tenant
     and g.name = 'Mức đường - Hồng Trà'
     and g.rule in ('single', 'single_required')
     and g.channel in ('fnb', 'all')
     and g.is_active;

  select count(*) into v_count
    from public.modifier_options o
   where o.group_id = v_sugar_group_id
     and o.is_active
     and o.label in ('60%', '80%', '100%')
     and o.scale_factor is null
     and o.linked_product_id is null;
  if v_count <> 3
     or (select count(*) from public.modifier_options o where o.group_id = v_sugar_group_id and o.is_active) <> 3
     or (select count(*) from public.modifier_options o where o.group_id = v_sugar_group_id and o.is_active and o.is_default) <> 1
     or not exists (
       select 1 from public.modifier_options o
        where o.group_id = v_sugar_group_id and o.is_active and o.label = '100%' and o.is_default
     ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_SUGAR_OPTIONS_CHANGED';
  end if;

  -- Ket qua BUOC 1 cho thay SP chua override, chua scope va chua co map cu.
  -- Dung thay vi ghi de neu co nguoi dang cau hinh song song.
  if exists (
    select 1 from public.product_modifier_groups pmg
     where pmg.tenant_id = v_tenant and pmg.product_id = v_product_id
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_PRODUCT_OVERRIDE_ALREADY_EXISTS';
  end if;
  if exists (
    select 1 from public.fnb_product_branch_menu_scopes s
     where s.tenant_id = v_tenant and s.product_id = v_product_id
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_MENU_SCOPE_ALREADY_EXISTS';
  end if;

  select count(*) into v_count
    from public.bom b
   where b.tenant_id = v_tenant
     and b.product_id = v_product_id
     and b.is_active;
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_ACTIVE_BOM_NOT_UNIQUE';
  end if;
  select b.id into v_bom_id
    from public.bom b
   where b.tenant_id = v_tenant
     and b.product_id = v_product_id
     and b.is_active;

  select count(*) into v_total_bom_items from public.bom_items bi where bi.bom_id = v_bom_id;
  if v_total_bom_items <> 3 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_BOM_ITEMS_CHANGED';
  end if;

  select count(*) into v_count
    from public.bom_items bi
    join public.products m on m.id = bi.material_id and m.tenant_id = v_tenant
   where bi.bom_id = v_bom_id
     and m.code in ('SKU-TRA-001', 'SKU-BOT-009', 'SKU-LTT-012');
  if v_count <> 3 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_BOM_MATERIALS_CHANGED';
  end if;

  select bi.quantity, bi.input_quantity, bi.unit, bi.input_unit, bi.conversion_factor, bi.modifier_scale_target
    into v_sugar_qty, v_sugar_input_quantity, v_sugar_unit, v_sugar_input_unit, v_sugar_factor, v_target
    from public.bom_items bi
    join public.products m on m.id = bi.material_id
   where bi.bom_id = v_bom_id and m.code = 'SKU-BOT-009';
  if v_sugar_qty is distinct from 0.035 or v_sugar_input_quantity is distinct from 35
     or lower(trim(v_sugar_unit)) is distinct from 'kg'
     or lower(trim(coalesce(v_sugar_input_unit, ''))) is distinct from 'g'
     or v_sugar_factor is distinct from 0.001 or v_target is not null then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_SUGAR_BOM_OR_UOM_CHANGED';
  end if;

  select bi.quantity, bi.input_quantity, bi.unit, bi.input_unit, bi.conversion_factor, bi.modifier_scale_target
    into v_tea_qty, v_tea_input_quantity, v_tea_unit, v_tea_input_unit, v_tea_factor, v_target
    from public.bom_items bi
    join public.products m on m.id = bi.material_id
   where bi.bom_id = v_bom_id and m.code = 'SKU-TRA-001';
  if v_tea_qty is distinct from 0.0136 or v_tea_input_quantity is distinct from 6.8
     or lower(trim(v_tea_unit)) is distinct from 'túi'
     or lower(trim(coalesce(v_tea_input_unit, ''))) is distinct from 'g'
     or v_tea_factor is distinct from 0.002 or v_target is not null then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_TEA_BOM_OR_UOM_CHANGED';
  end if;

  select bi.quantity, bi.input_quantity, bi.unit, bi.input_unit, bi.conversion_factor, bi.modifier_scale_target
    into v_cup_qty, v_cup_input_quantity, v_cup_unit, v_cup_input_unit, v_cup_factor, v_target
    from public.bom_items bi
    join public.products m on m.id = bi.material_id
   where bi.bom_id = v_bom_id and m.code = 'SKU-LTT-012';
  if v_cup_qty is distinct from 0.02 or v_cup_input_quantity is distinct from 1
     or lower(trim(v_cup_unit)) is distinct from 'cây'
     or lower(trim(coalesce(v_cup_input_unit, ''))) is distinct from 'cái'
     or v_cup_factor is distinct from 0.02 or v_target is not null then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_CUP_BOM_OR_UOM_CHANGED';
  end if;

  if exists (
    select 1 from public.bom_modifier_option_quantities q where q.bom_id = v_bom_id
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_EXACT_MAP_ALREADY_EXISTS';
  end if;
end;
$guard$;

do $configure$
declare
  v_tenant constant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_product_id uuid;
  v_branch_id uuid;
  v_sugar_group_id uuid;
  v_ice_group_id uuid;
  v_topping_group_id uuid;
  v_bom_id uuid;
  v_sugar_material_id uuid;
  v_option record;
  v_quantity numeric;
begin
  select id into v_product_id from public.products
   where tenant_id = v_tenant and code = 'SKU-HTR-001' and name = 'Hồng Trà';
  select id into v_branch_id from public.branches
   where tenant_id = v_tenant and name = 'Xưởng Cà Phê - Xưởng Tư Búa';
  select id into v_sugar_group_id from public.modifier_groups
   where tenant_id = v_tenant and name = 'Mức đường - Hồng Trà' and is_active;
  select g.id into v_ice_group_id
    from public.category_modifier_groups cmg
    join public.products p on p.category_id = cmg.category_id
    join public.modifier_groups g on g.id = cmg.modifier_group_id
   where p.id = v_product_id and g.name = 'Mức đá' and g.is_active;
  select g.id into v_topping_group_id
    from public.category_modifier_groups cmg
    join public.products p on p.category_id = cmg.category_id
    join public.modifier_groups g on g.id = cmg.modifier_group_id
   where p.id = v_product_id and g.name = 'Topping' and g.is_active;
  select id into v_bom_id from public.bom
   where tenant_id = v_tenant and product_id = v_product_id and is_active;
  select bi.material_id into v_sugar_material_id
    from public.bom_items bi
    join public.products m on m.id = bi.material_id
   where bi.bom_id = v_bom_id and m.code = 'SKU-BOT-009';

  -- Product override de Hong Tra chi thay Muc duong chung bang ba muc da can.
  insert into public.product_modifier_groups (
    tenant_id, product_id, modifier_group_id, sort_order
  ) values
    (v_tenant, v_product_id, v_ice_group_id, 0),
    (v_tenant, v_product_id, v_sugar_group_id, 1),
    (v_tenant, v_product_id, v_topping_group_id, 2);

  -- Co scope thi day la whitelist: Hong Tra chi hien o Xưởng Tư Búa.
  insert into public.fnb_product_branch_menu_scopes (tenant_id, product_id, branch_id)
  values (v_tenant, v_product_id, v_branch_id);

  -- Chi duong thay doi theo lua chon. Tra va ly giu BOM co ban.
  update public.bom_items
     set modifier_scale_target = v_sugar_group_id
   where bom_id = v_bom_id and material_id = v_sugar_material_id;

  -- Luu gia tri da quy doi ve don vi ton Kg. Guard o tren da xac nhan
  -- 1 G = 0.001 Kg, nen 21/28/35 G lan luot la 0.021/0.028/0.035 Kg.
  for v_option in
    select id, label
      from public.modifier_options
     where group_id = v_sugar_group_id and is_active
     order by sort_order, label
  loop
    v_quantity := case v_option.label
      when '60%' then 0.021
      when '80%' then 0.028
      when '100%' then 0.035
      else null
    end;
    if v_quantity is null then
      raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_SUGAR_OPTION_UNEXPECTED';
    end if;
    insert into public.bom_modifier_option_quantities (
      tenant_id, bom_id, material_id, modifier_option_id, quantity
    ) values (
      v_tenant, v_bom_id, v_sugar_material_id, v_option.id, v_quantity
    );
  end loop;
end;
$configure$;

do $verify$
declare
  v_tenant constant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_product_id uuid;
  v_branch_id uuid;
  v_sugar_group_id uuid;
  v_bom_id uuid;
  v_count integer;
begin
  select id into v_product_id from public.products
   where tenant_id = v_tenant and code = 'SKU-HTR-001' and name = 'Hồng Trà';
  select id into v_branch_id from public.branches
   where tenant_id = v_tenant and name = 'Xưởng Cà Phê - Xưởng Tư Búa';
  select id into v_sugar_group_id from public.modifier_groups
   where tenant_id = v_tenant and name = 'Mức đường - Hồng Trà' and is_active;
  select id into v_bom_id from public.bom
   where tenant_id = v_tenant and product_id = v_product_id and is_active;

  select count(*) into v_count from public.fnb_product_branch_menu_scopes s
   where s.tenant_id = v_tenant and s.product_id = v_product_id and s.branch_id = v_branch_id;
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_SCOPE_SAVE_FAILED';
  end if;

  select count(*) into v_count from public.product_modifier_groups pmg
   where pmg.tenant_id = v_tenant and pmg.product_id = v_product_id;
  if v_count <> 3
     or exists (
       select 1 from public.product_modifier_groups pmg
       join public.modifier_groups g on g.id = pmg.modifier_group_id
       where pmg.tenant_id = v_tenant and pmg.product_id = v_product_id
         and g.name not in ('Mức đá', 'Mức đường - Hồng Trà', 'Topping')
     ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_PRODUCT_OVERRIDE_SAVE_FAILED';
  end if;

  if not exists (
    select 1 from public.bom_items bi
    join public.products m on m.id = bi.material_id
    where bi.bom_id = v_bom_id and m.code = 'SKU-BOT-009'
      and bi.modifier_scale_target = v_sugar_group_id
  ) or exists (
    select 1 from public.bom_items bi
    join public.products m on m.id = bi.material_id
    where bi.bom_id = v_bom_id and m.code in ('SKU-TRA-001', 'SKU-LTT-012')
      and bi.modifier_scale_target is not null
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_BOM_TARGET_SAVE_FAILED';
  end if;

  select count(*) into v_count
    from public.bom_modifier_option_quantities q
    join public.modifier_options o on o.id = q.modifier_option_id
   where q.bom_id = v_bom_id and o.group_id = v_sugar_group_id
     and (o.label, q.quantity) in (('60%', 0.021), ('80%', 0.028), ('100%', 0.035));
  if v_count <> 3
     or (select count(*) from public.bom_modifier_option_quantities q where q.bom_id = v_bom_id) <> 3 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_EXACT_MAP_SAVE_FAILED';
  end if;
end;
$verify$;

commit;
