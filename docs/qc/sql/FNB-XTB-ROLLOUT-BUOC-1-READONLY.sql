-- ============================================================================
-- FNB XUONG TU BUA - BUOC 1: PHAN LO MENU DE NHAP LIEU (CHI DOC)
--
-- Muc dich:
--   Lap danh sach day du 124 mon F&B dang ban va chia theo nhom de nhap lieu.
--   Moi dong cho biet ro con thieu gia, BOM, pham vi menu hay tuy chon.
--
-- An toan du lieu:
--   File nay chi SELECT. Khong tao/sua/xoa san pham, BOM, ton kho, don hang,
--   hoa don, phieu bep hay ca lam viec.
--
-- Cach dung:
--   Chay TOAN BO file trong Supabase SQL Editor, sau do gui bang T2 va T3
--   cho Codex. Khong dung ket qua nay de tu dong suy dien cong thuc.
-- ============================================================================

with
tham_so as (
  select
    '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id,
    'OneBiz Coffee Demo'::text as tenant_name,
    'Xưởng Cà Phê - Xưởng Tư Búa'::text as branch_name
),
chi_nhanh as (
  select b.id, b.name
  from public.branches b
  cross join tham_so t
  where b.tenant_id = t.tenant_id
    and b.name = t.branch_name
    and b.is_active = true
    and (b.cascade_mode = 'outlet' or b.branch_type = 'store')
),
mon_fnb as (
  select
    p.id,
    p.tenant_id,
    p.code,
    p.name,
    p.category_id,
    p.sell_price,
    p.unit,
    p.has_bom,
    p.bom_code,
    c.name as nhom_hang
  from public.products p
  cross join tham_so t
  left join public.categories c
    on c.id = p.category_id
   and c.tenant_id = p.tenant_id
  where p.tenant_id = t.tenant_id
    and p.is_active = true
    and p.allow_sale = true
    and p.product_type = 'sku'
    and p.channel = 'fnb'
),
bom_hieu_luc as (
  -- Giong get_active_bom_for_branch: uu tien BOM rieng XTB, roi moi dung chung.
  select distinct on (p.id)
    p.id as product_id,
    b.id as bom_id,
    b.code as ma_bom,
    case
      when b.branch_id = cn.id then 'RIENG_XUONG_TU_BUA'
      when b.branch_id is null then 'DUNG_CHUNG'
      else null
    end as nguon_bom,
    coalesce(
      exists (
        select 1 from public.bom_items bi where bi.bom_id = b.id
      )
      and not exists (
        select 1
        from public.bom_items bi
        where bi.bom_id = b.id
          and (
            bi.material_id is null
            or coalesce(bi.quantity, 0) <= 0
            or nullif(btrim(coalesce(bi.unit, '')), '') is null
          )
      ),
      false
    ) as co_bom_hop_le
  from mon_fnb p
  cross join chi_nhanh cn
  left join public.bom b
    on b.tenant_id = p.tenant_id
   and b.is_active = true
   and (
     (p.bom_code is not null and b.code = p.bom_code)
     or (p.bom_code is null and b.product_id = p.id)
   )
   and (b.branch_id = cn.id or b.branch_id is null)
  order by
    p.id,
    case when b.branch_id = cn.id then 0 else 1 end,
    b.version desc nulls last
),
quy_cach as (
  select
    pv.product_id,
    count(*) filter (where pv.is_active) as so_quy_cach,
    count(*) filter (where pv.is_active and pv.is_default) as so_quy_cach_mac_dinh,
    count(*) filter (where pv.is_active and coalesce(pv.sell_price, 0) <= 0) as quy_cach_thieu_gia,
    count(*) filter (
      where pv.is_active
        and (
          nullif(btrim(coalesce(pv.bom_code, '')), '') is null
          or not coalesce(vb.co_bom_hop_le, false)
        )
    ) as quy_cach_thieu_bom
  from public.product_variants pv
  join mon_fnb p on p.id = pv.product_id
  cross join chi_nhanh cn
  left join lateral (
    select
      exists (
        select 1 from public.bom_items bi where bi.bom_id = b.id
      )
      and not exists (
        select 1
        from public.bom_items bi
        where bi.bom_id = b.id
          and (
            bi.material_id is null
            or coalesce(bi.quantity, 0) <= 0
            or nullif(btrim(coalesce(bi.unit, '')), '') is null
          )
      ) as co_bom_hop_le
    from public.bom b
    where b.tenant_id = p.tenant_id
      and b.is_active = true
      and b.code = pv.bom_code
      and (b.branch_id = cn.id or b.branch_id is null)
    order by
      case when b.branch_id = cn.id then 0 else 1 end,
      b.version desc nulls last
    limit 1
  ) vb on true
  group by pv.product_id
),
pham_vi_menu as (
  select
    p.id as product_id,
    count(s.id) as so_dong_pham_vi,
    bool_or(s.branch_id = cn.id) as mo_tai_xtb
  from mon_fnb p
  cross join chi_nhanh cn
  left join public.fnb_product_branch_menu_scopes s
    on s.tenant_id = p.tenant_id
   and s.product_id = p.id
  group by p.id
),
tuy_chon_cap_mon as (
  select
    p.id as product_id,
    string_agg(g.name, ' | ' order by pmg.sort_order, g.name) as danh_sach
  from mon_fnb p
  join public.product_modifier_groups pmg
    on pmg.product_id = p.id
   and pmg.tenant_id = p.tenant_id
  join public.modifier_groups g
    on g.id = pmg.modifier_group_id
   and g.tenant_id = p.tenant_id
   and g.is_active = true
  group by p.id
),
tuy_chon_ke_thua as (
  select
    p.id as product_id,
    string_agg(g.name, ' | ' order by cmg.sort_order, g.name) as danh_sach
  from mon_fnb p
  join public.category_modifier_groups cmg
    on cmg.category_id = p.category_id
   and cmg.tenant_id = p.tenant_id
  join public.modifier_groups g
    on g.id = cmg.modifier_group_id
   and g.tenant_id = p.tenant_id
   and g.is_active = true
  group by p.id
),
menu_phan_lo as (
  select
    p.*,
    coalesce(q.so_quy_cach, 0) as so_quy_cach,
    coalesce(q.so_quy_cach_mac_dinh, 0) as so_quy_cach_mac_dinh,
    coalesce(q.quy_cach_thieu_gia, 0) as quy_cach_thieu_gia,
    coalesce(q.quy_cach_thieu_bom, 0) as quy_cach_thieu_bom,
    coalesce(b.co_bom_hop_le, false) as co_bom_hop_le,
    b.ma_bom as ma_bom_hieu_luc,
    b.nguon_bom,
    coalesce(s.so_dong_pham_vi, 0) as so_dong_pham_vi,
    coalesce(s.mo_tai_xtb, false) as mo_tai_xtb,
    pm.danh_sach as tuy_chon_cap_mon,
    cm.danh_sach as tuy_chon_ke_thua,
    case
      when coalesce(s.so_dong_pham_vi, 0) = 0 then 'DUNG_CHUNG_TAT_CA_CHI_NHANH'
      when coalesce(s.mo_tai_xtb, false) then 'MO_TAI_XUONG_TU_BUA'
      else 'CHI_MO_O_CHI_NHANH_KHAC'
    end as trang_thai_menu,
    case
      when coalesce(q.so_quy_cach, 0) > 0
        and (coalesce(q.so_quy_cach_mac_dinh, 0) <> 1
          or coalesce(q.quy_cach_thieu_gia, 0) > 0
          or coalesce(q.quy_cach_thieu_bom, 0) > 0)
        then 'CAN_CHOT_QUY_CACH_TRUOC'
      when coalesce(q.so_quy_cach, 0) = 0 and coalesce(p.sell_price, 0) <= 0
        then 'THIEU_GIA_BAN'
      when coalesce(p.has_bom, false) and not coalesce(b.co_bom_hop_le, false)
        then 'THIEU_CONG_THUC'
      when coalesce(s.so_dong_pham_vi, 0) > 0 and not coalesce(s.mo_tai_xtb, false)
        then 'CHUA_MO_MENU_XUONG_TU_BUA'
      when coalesce(q.so_quy_cach, 0) = 0 and coalesce(p.has_bom, false) = false
        then 'CAN_XAC_NHAN_BAN_NGUYEN_TRANG_HAY_CONG_THUC'
      else 'SAN_SANG_RAP_CONG_THUC'
    end as buoc_ke_tiep
  from mon_fnb p
  left join bom_hieu_luc b on b.product_id = p.id
  left join quy_cach q on q.product_id = p.id
  left join pham_vi_menu s on s.product_id = p.id
  left join tuy_chon_cap_mon pm on pm.product_id = p.id
  left join tuy_chon_ke_thua cm on cm.product_id = p.id
),
ket_qua as (
  select
    'T1_TENANT_VA_CHI_NHANH'::text as muc,
    'DIEU_KIEN'::text as loai,
    exists (
      select 1 from public.tenants x cross join tham_so t
      where x.id = t.tenant_id and x.name = t.tenant_name
    ) and (select count(*) from chi_nhanh) = 1 as dat,
    jsonb_build_object(
      'tenant', (select tenant_name from tham_so),
      'chi_nhanh', (select branch_name from tham_so),
      'so_chi_nhanh_khop', (select count(*) from chi_nhanh)
    ) as chi_tiet,
    0 as thu_tu

  union all
  select
    'T2_TONG_QUAN_MENU',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'tong_mon', count(*),
      'mon_co_gia', count(*) filter (where so_quy_cach = 0 and coalesce(sell_price, 0) > 0),
      'mon_co_bom_hop_le_tai_xtb', count(*) filter (where co_bom_hop_le),
      'mon_mo_tai_xtb', count(*) filter (where trang_thai_menu in ('MO_TAI_XUONG_TU_BUA', 'DUNG_CHUNG_TAT_CA_CHI_NHANH')),
      'mon_can_cong_thuc_nguon', count(*) filter (where buoc_ke_tiep in ('THIEU_CONG_THUC', 'CAN_XAC_NHAN_BAN_NGUYEN_TRANG_HAY_CONG_THUC'))
    ),
    1
  from menu_phan_lo

  union all
  select
    'T3_PHAN_LO_NHOM_MON',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'nhom', coalesce(nhom_hang, '(chua gan nhom)'),
      'tong_mon', count(*),
      'thieu_gia', count(*) filter (where buoc_ke_tiep = 'THIEU_GIA_BAN'),
      'thieu_cong_thuc', count(*) filter (where buoc_ke_tiep = 'THIEU_CONG_THUC'),
      'can_chot_quy_cach', count(*) filter (where buoc_ke_tiep = 'CAN_CHOT_QUY_CACH_TRUOC'),
      'can_xac_nhan_mo_hinh_ton', count(*) filter (where buoc_ke_tiep = 'CAN_XAC_NHAN_BAN_NGUYEN_TRANG_HAY_CONG_THUC'),
      'mo_tai_xtb', count(*) filter (where trang_thai_menu in ('MO_TAI_XUONG_TU_BUA', 'DUNG_CHUNG_TAT_CA_CHI_NHANH'))
    ),
    2
  from menu_phan_lo
  group by coalesce(nhom_hang, '(chua gan nhom)')

  union all
  select
    'T4_MON_CAN_NHAP_LIEU',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'nhom', coalesce(nhom_hang, '(chua gan nhom)'),
      'ma', code,
      'ten', name,
      'don_vi_ban', unit,
      'gia_ban', sell_price,
      'co_bom_danh_dau', has_bom,
      'co_bom_hop_le_tai_xtb', co_bom_hop_le,
      'ma_bom_hieu_luc', ma_bom_hieu_luc,
      'nguon_bom', nguon_bom,
      'so_quy_cach', so_quy_cach,
      'so_quy_cach_mac_dinh', so_quy_cach_mac_dinh,
      'quy_cach_thieu_gia', quy_cach_thieu_gia,
      'quy_cach_thieu_bom', quy_cach_thieu_bom,
      'trang_thai_menu', trang_thai_menu,
      'tuy_chon_hieu_luc', coalesce(tuy_chon_cap_mon, tuy_chon_ke_thua, ''),
      'nguon_tuy_chon', case when tuy_chon_cap_mon is not null then 'CAP_MON' else 'KE_THUA_NHOM_HANG' end,
      'buoc_ke_tiep', buoc_ke_tiep
    ),
    3
  from menu_phan_lo
)
select muc, loai, dat, chi_tiet
from ket_qua
order by thu_tu, chi_tiet->>'nhom', chi_tiet->>'ma';
