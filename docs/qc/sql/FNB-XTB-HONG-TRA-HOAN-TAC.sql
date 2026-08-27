-- HONG TRA XUONG TU BUA - HOAN TAC CHI KHI CAN
--
-- Chi dung khi BUOC 2 vua chay xong va CHUA co giao dich FnB phat sinh tu
-- Hong Tra thu nghiem. File nay khoi phuc dung trang thai truoc BUOC 2:
--   * bo whitelist Xưởng Tư Búa -> Hong Tra tro lai hien theo quy uoc cu;
--   * bo override cap mon -> quay ve ke thua nhom hang;
--   * bo lien ket duong voi Muc duong - Hong Tra va ba dinh luong chinh xac.
--
-- Khong xoa nhom Muc duong - Hong Tra hay ba lua chon 60/80/100%, vi chung
-- da ton tai truoc khi cau hinh SKU. File tu dung neu cau hinh da bi sua
-- sau BUOC 2, de khong xoa nham du lieu moi.

begin;

do $guard$
declare
  v_tenant constant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_product_id uuid;
  v_branch_id uuid;
  v_sugar_group_id uuid;
  v_bom_id uuid;
  v_count integer;
begin
  select id into v_product_id from public.products
   where tenant_id = v_tenant and code = 'SKU-HTR-001' and name = 'Hồng Trà'
     and product_type = 'sku' and channel = 'fnb';
  select id into v_branch_id from public.branches
   where tenant_id = v_tenant and name = 'Xưởng Cà Phê - Xưởng Tư Búa';
  select id into v_sugar_group_id from public.modifier_groups
   where tenant_id = v_tenant and name = 'Mức đường - Hồng Trà' and is_active;
  select id into v_bom_id from public.bom
   where tenant_id = v_tenant and product_id = v_product_id and is_active;

  if v_product_id is null or v_branch_id is null or v_sugar_group_id is null or v_bom_id is null then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_ROLLBACK_TARGET_MISSING';
  end if;

  select count(*) into v_count from public.fnb_product_branch_menu_scopes s
   where s.tenant_id = v_tenant and s.product_id = v_product_id;
  if v_count <> 1 or not exists (
    select 1 from public.fnb_product_branch_menu_scopes s
     where s.tenant_id = v_tenant and s.product_id = v_product_id and s.branch_id = v_branch_id
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_ROLLBACK_SCOPE_CHANGED';
  end if;

  select count(*) into v_count from public.product_modifier_groups pmg
   where pmg.tenant_id = v_tenant and pmg.product_id = v_product_id;
  if v_count <> 3 or exists (
    select 1 from public.product_modifier_groups pmg
    join public.modifier_groups g on g.id = pmg.modifier_group_id
    where pmg.tenant_id = v_tenant and pmg.product_id = v_product_id
      and g.name not in ('Mức đá', 'Mức đường - Hồng Trà', 'Topping')
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_ROLLBACK_OVERRIDE_CHANGED';
  end if;

  if not exists (
    select 1 from public.bom_items bi
    join public.products m on m.id = bi.material_id
    where bi.bom_id = v_bom_id and m.code = 'SKU-BOT-009'
      and bi.modifier_scale_target = v_sugar_group_id
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_ROLLBACK_SUGAR_TARGET_CHANGED';
  end if;

  select count(*) into v_count
    from public.bom_modifier_option_quantities q
    join public.modifier_options o on o.id = q.modifier_option_id
   where q.bom_id = v_bom_id and o.group_id = v_sugar_group_id
     and (o.label, q.quantity) in (('60%', 0.021), ('80%', 0.028), ('100%', 0.035));
  if v_count <> 3
     or (select count(*) from public.bom_modifier_option_quantities q where q.bom_id = v_bom_id) <> 3 then
    raise exception using errcode = 'P0001', message = 'FNB_XTB_HONG_TRA_ROLLBACK_EXACT_MAP_CHANGED';
  end if;
end;
$guard$;

do $rollback$
declare
  v_tenant constant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_product_id uuid;
  v_sugar_group_id uuid;
  v_bom_id uuid;
  v_sugar_material_id uuid;
begin
  select id into v_product_id from public.products
   where tenant_id = v_tenant and code = 'SKU-HTR-001' and name = 'Hồng Trà';
  select id into v_sugar_group_id from public.modifier_groups
   where tenant_id = v_tenant and name = 'Mức đường - Hồng Trà' and is_active;
  select id into v_bom_id from public.bom
   where tenant_id = v_tenant and product_id = v_product_id and is_active;
  select bi.material_id into v_sugar_material_id
    from public.bom_items bi
    join public.products m on m.id = bi.material_id
   where bi.bom_id = v_bom_id and m.code = 'SKU-BOT-009';

  delete from public.bom_modifier_option_quantities where bom_id = v_bom_id;
  update public.bom_items
     set modifier_scale_target = null
   where bom_id = v_bom_id and material_id = v_sugar_material_id;
  delete from public.product_modifier_groups
   where tenant_id = v_tenant and product_id = v_product_id;
  delete from public.fnb_product_branch_menu_scopes
   where tenant_id = v_tenant and product_id = v_product_id;
end;
$rollback$;

commit;
