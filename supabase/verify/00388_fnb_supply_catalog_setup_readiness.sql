-- 00388: Read-only readiness report for configuring an F&B supply catalog.
--
-- This file NEVER writes catalog rows, stock, prices, BOMs or documents.
-- It is a review aid only: compare the exact Retail SKU referenced by each
-- F&B recipe with the catalog assigned to Xưởng Tư Búa before an administrator
-- adds or enables anything.

with tham_so as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id,
         'CNH-XTB'::text as ma_chi_nhanh
),
chi_nhanh as (
  select b.id, b.code, b.name
    from public.branches b
    join tham_so t on t.tenant_id = b.tenant_id
   where b.code = t.ma_chi_nhanh
     and b.is_active
),
mon_fnb as (
  select p.id, p.code, p.name
    from public.products p
    join tham_so t on t.tenant_id = p.tenant_id
   where p.product_type = 'sku'
     and p.channel = 'fnb'
     and p.is_active
),
cong_thuc_menu as (
  -- A menu item can have a parent BOM, or a distinct BOM for each size.  Keep
  -- the size in the report so a reviewer cannot approve a supply SKU after
  -- seeing only the default size's recipe.
  select distinct
    m.id as menu_product_id,
    m.code as menu_code,
    m.name as menu_name,
    null::uuid as variant_id,
    'Mặc định'::text as variant_name,
    b.id as bom_id
  from mon_fnb m
  join public.bom b
    on b.tenant_id = (select tenant_id from tham_so)
   and b.is_active
   and b.product_id = m.id
   and b.variant_id is null

  union

  select distinct
    m.id as menu_product_id,
    m.code as menu_code,
    m.name as menu_name,
    v.id as variant_id,
    v.name as variant_name,
    b.id as bom_id
  from mon_fnb m
  join public.product_variants v
    on v.tenant_id = (select tenant_id from tham_so)
   and v.product_id = m.id
   and v.is_active
  join public.bom b
    on b.tenant_id = (select tenant_id from tham_so)
   and b.is_active
   and b.product_id = m.id
   and (b.variant_id = v.id or nullif(btrim(b.code), '') = nullif(btrim(v.bom_code), ''))
),
thanh_phan_bom as (
  select distinct
    m.menu_product_id,
    m.menu_code,
    m.menu_name,
    m.variant_id,
    m.variant_name,
    material.id as supply_product_id,
    material.code as supply_code,
    material.name as supply_name,
    material.product_type as supply_product_type,
    material.channel as supply_channel,
    material.inventory_role as supply_inventory_role,
    bi.unit as recipe_unit
  from cong_thuc_menu m
  join public.bom_items bi on bi.bom_id = m.bom_id
  join public.products material on material.id = bi.material_id
),
tong_hop as (
  select
    s.supply_product_id,
    s.supply_code,
    s.supply_name,
    s.supply_product_type,
    s.supply_channel,
    s.supply_inventory_role,
    string_agg(distinct s.recipe_unit, ', ' order by s.recipe_unit) as don_vi_cong_thuc,
    count(distinct s.menu_product_id) as so_mon_fnb_dang_dung,
    count(distinct (s.menu_product_id, coalesce(s.variant_id, '00000000-0000-0000-0000-000000000000'::uuid))) as so_cong_thuc_tham_chieu,
    string_agg(
      distinct s.menu_code || ' · ' || s.menu_name ||
        case when s.variant_id is null then '' else ' · ' || s.variant_name end,
      E'\n'
    ) as mon_fnb_tham_chieu
  from thanh_phan_bom s
 group by s.supply_product_id, s.supply_code, s.supply_name,
          s.supply_product_type, s.supply_channel, s.supply_inventory_role
)
select
  c.code as ma_chi_nhanh,
  c.name as ten_chi_nhanh,
  th.supply_code as ma_sku_thanh_phan,
  th.supply_name as ten_sku_thanh_phan,
  th.supply_product_type as loai_san_pham,
  th.supply_channel as kenh,
  th.supply_inventory_role as vai_tro_ton,
  th.don_vi_cong_thuc,
  th.so_mon_fnb_dang_dung,
  th.so_cong_thuc_tham_chieu,
  th.mon_fnb_tham_chieu,
  exists (
    select 1 from public.fnb_supply_catalog catalog
     where catalog.tenant_id = (select tenant_id from tham_so)
       and catalog.branch_id = c.id
       and catalog.product_id = th.supply_product_id
  ) as da_nam_trong_danh_muc_cap,
  case
    when th.supply_product_type <> 'sku' or th.supply_channel = 'fnb'
      then 'RÀ SOÁT: BOM chưa tham chiếu Retail SKU cấp cho quán'
    when exists (
      select 1 from public.fnb_supply_catalog catalog
       where catalog.tenant_id = (select tenant_id from tham_so)
         and catalog.branch_id = c.id
         and catalog.product_id = th.supply_product_id
    ) then 'Đã cấu hình'
    else 'Cần quản trị viên duyệt và thêm SKU chính xác'
  end as trang_thai_duyet
from tong_hop th
cross join chi_nhanh c
order by trang_thai_duyet desc, th.supply_code;

-- Expected review practice:
--   1) “Đã cấu hình” needs no action.
--   2) “Cần ... thêm SKU chính xác” is a candidate, not an automatic approval.
--   3) “RÀ SOÁT” must be corrected in the BOM before catalog activation.
