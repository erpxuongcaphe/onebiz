-- ============================================================================
-- FNB GO-LIVE PREFLIGHT - CHI DOC
-- Tenant da xac minh: OneBiz Coffee Demo
--
-- Chay TOAN BO file trong Supabase SQL Editor. File chi co mot cau SELECT,
-- khong tao/sua/xoa du lieu. Moi dong loai DIEU_KIEN phai dat=true. Dong
-- THONG_TIN dung de lap danh sach nhap; khong tu dong coi dat=false la loi.
-- Tien quyet: 00350 phai da cai. Day la cong gate truoc UAT/go-live, khong
-- phai preflight cua rieng migration 00350.
-- ============================================================================

with
tham_so as (
  select
    '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id,
    'OneBiz Coffee Demo'::text as tenant_name
),
ham as (
  select
    to_regprocedure(
      'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
    ) as payment_v3_oid,
    to_regprocedure(
      'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    ) as send_v2_oid,
    to_regprocedure(
      'public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    ) as send_impl_oid,
    to_regprocedure(
      'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'
    ) as payment_impl_oid,
    to_regprocedure('public.get_active_bom_for_branch(uuid,uuid,uuid)') as bom_lookup_oid,
    to_regprocedure(
      'public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)'
    ) as bom_consume_oid,
    to_regprocedure(
      'public.restore_bom_for_return(uuid,uuid,uuid,numeric,uuid,uuid,text,uuid)'
    ) as bom_restore_oid,
    to_regclass('public.bom_modifier_option_quantities') as exact_mapping_table,
    to_regprocedure(
      'public.save_bom_modifier_option_quantities(uuid,jsonb)'
    ) as exact_save_oid
),
dinh_nghia_ham as (
  select
    h.*,
    coalesce(pg_get_functiondef(h.payment_v3_oid), '') as payment_v3,
    coalesce(pg_get_functiondef(h.send_v2_oid), '') as send_v2,
    coalesce(pg_get_functiondef(h.payment_impl_oid), '') as payment_impl,
    coalesce(pg_get_functiondef(h.bom_lookup_oid), '') as bom_lookup,
    coalesce(pg_get_functiondef(h.bom_consume_oid), '') as bom_consume,
    coalesce(pg_get_functiondef(h.bom_restore_oid), '') as bom_restore,
    coalesce(obj_description(h.payment_v3_oid, 'pg_proc'), '') as payment_v3_note,
    coalesce(obj_description(h.send_v2_oid, 'pg_proc'), '') as send_v2_note
  from ham h
),
chi_nhanh_fnb as (
  select b.id, b.name
  from public.branches b
  cross join tham_so t
  where b.tenant_id = t.tenant_id
    and b.is_active = true
    and b.branch_type = 'store'
),
mon_fnb as (
  select p.*
  from public.products p
  cross join tham_so t
  where p.tenant_id = t.tenant_id
    and p.is_active = true
    and p.allow_sale = true
    and p.product_type = 'sku'
    and p.channel = 'fnb'
),
quy_cach as (
  select pv.*
  from public.product_variants pv
  join mon_fnb p on p.id = pv.product_id and p.tenant_id = pv.tenant_id
  where pv.is_active = true
),
mon_co_quy_cach as (
  select product_id, count(*) as so_quy_cach,
         count(*) filter (where is_default) as so_mac_dinh
  from quy_cach
  group by product_id
),
loi_quy_cach as (
  select
    count(*) filter (where coalesce(q.sell_price, 0) <= 0) as thieu_gia,
    count(*) filter (where nullif(btrim(q.bom_code), '') is null) as thieu_ma_bom,
    count(*) filter (
      where nullif(btrim(q.bom_code), '') is not null
        and not exists (
          select 1 from public.bom b
          where b.tenant_id = q.tenant_id
            and b.code = q.bom_code
            and b.is_active = true
            and exists (
              select 1 from public.bom_items bi
              where bi.bom_id = b.id and bi.quantity > 0
            )
        )
    ) as ma_bom_khong_co_cong_thuc,
    count(*) filter (
      where nullif(btrim(q.bom_code), '') is not null
        and exists (select 1 from chi_nhanh_fnb)
        and exists (
          select 1 from chi_nhanh_fnb cn
          where not exists (
            select 1 from public.bom b
            where b.tenant_id = q.tenant_id
              and b.code = q.bom_code
              and b.is_active = true
              and (b.branch_id = cn.id or b.branch_id is null)
              and exists (
                select 1 from public.bom_items bi
                where bi.bom_id = b.id and bi.quantity > 0
              )
          )
        )
    ) as chua_ap_dung_du_chi_nhanh
  from quy_cach q
),
loi_mon as (
  select
    count(*) as tong_mon,
    count(*) filter (where mcq.product_id is null and coalesce(p.sell_price, 0) <= 0)
      as mon_mot_gia_thieu_gia,
    count(*) filter (
      where mcq.product_id is null
        and p.inventory_role = 'fnb_menu_item'
        and coalesce(p.has_bom, false) = false
    ) as mon_menu_chua_khai_quan_ly_tieu_hao,
    count(*) filter (
      where mcq.product_id is null
        and coalesce(p.has_bom, false) = true
        and not exists (
          select 1 from public.bom b
          where b.tenant_id = p.tenant_id
            and b.is_active = true
            and (b.product_id = p.id or (p.bom_code is not null and b.code = p.bom_code))
            and exists (
              select 1 from public.bom_items bi
              where bi.bom_id = b.id and bi.quantity > 0
            )
        )
    ) as mon_bat_bom_nhung_thieu_cong_thuc,
    count(*) filter (where mcq.product_id is not null and mcq.so_mac_dinh <> 1)
      as mon_sai_so_mac_dinh
  from mon_fnb p
  left join mon_co_quy_cach mcq on mcq.product_id = p.id
),
loi_bom as (
  select
    count(*) filter (
      where b.is_active = true
        and (bi.quantity is null or bi.quantity <= 0 or btrim(coalesce(bi.unit, '')) = '')
    ) as dong_cong_thuc_khong_hop_le
  from public.bom b
  cross join tham_so t
  left join public.bom_items bi on bi.bom_id = b.id
  where b.tenant_id = t.tenant_id
),
topping as (
  select
    count(*) as tong,
    count(*) filter (where coalesce(p.sell_price, 0) <= 0) as thieu_gia,
    count(*) filter (
      where not exists (
        select 1 from public.bom b
        where b.tenant_id = p.tenant_id
          and b.is_active = true
          and (b.product_id = p.id or (p.bom_code is not null and b.code = p.bom_code))
          and exists (
            select 1 from public.bom_items bi
            where bi.bom_id = b.id and bi.quantity > 0
          )
      )
    ) as thieu_cong_thuc
  from mon_fnb p
  where p.code ilike 'SKU-TPP%'
),
tuy_chon as (
  select
    count(distinct mg.id) filter (
      where mg.is_active = true and mg.rule = 'single_required'
        and (
          select count(*) from public.modifier_options moi
          where moi.group_id = mg.id and moi.is_active = true and moi.is_default = true
        ) <> 1
    ) as nhom_bat_buoc_sai_mac_dinh,
    count(distinct mg.id) filter (
      where mg.is_active = true and mg.rule = 'single'
        and (
          select count(*) from public.modifier_options moi
          where moi.group_id = mg.id and moi.is_active = true and moi.is_default = true
        ) > 1
    ) as nhom_tuy_chon_nhieu_mac_dinh,
    count(*) filter (
      where mg.is_active = true
        and mo.is_active = true
        and mo.scale_factor is not null
        and mo.linked_product_id is not null
    ) as lua_chon_vua_nhan_dinh_luong_vua_tru_sku
  from public.modifier_groups mg
  cross join tham_so t
  left join public.modifier_options mo on mo.group_id = mg.id
  where mg.tenant_id = t.tenant_id
),
dinh_luong_tuy_chon_chinh_xac as (
  select
    count(*) as dong_bom_co_tuy_chon,
    count(*) filter (
      where so_lua_chon_dang_bat = 0
         or so_dinh_luong_da_khai <> so_lua_chon_dang_bat
    ) as dong_bom_thieu_dinh_luong
  from (
    select
      b.id as bom_id,
      bi.material_id,
      bi.modifier_scale_target as nhom_tuy_chon_id,
      count(mo.id) as so_lua_chon_dang_bat,
      count(q.id) as so_dinh_luong_da_khai
    from public.bom b
    join mon_fnb p on p.id = b.product_id and p.tenant_id = b.tenant_id
    join public.bom_items bi on bi.bom_id = b.id
    join public.modifier_groups mg
      on mg.id = bi.modifier_scale_target
     and mg.tenant_id = b.tenant_id
     and mg.is_active = true
     and mg.rule in ('single', 'single_required')
    left join public.modifier_options mo
      on mo.group_id = mg.id and mo.is_active = true
    left join public.bom_modifier_option_quantities q
      on q.bom_id = b.id
     and q.material_id = bi.material_id
     and q.modifier_option_id = mo.id
    cross join tham_so t
    where b.tenant_id = t.tenant_id
      and b.is_active = true
    group by b.id, bi.material_id, bi.modifier_scale_target
  ) muc_tieu
),
size_cu as (
  select
    count(distinct mg.id) as so_nhom_size_cu,
    count(distinct cmg.category_id) + count(distinct pmg.product_id) as so_lien_ket
  from public.modifier_groups mg
  cross join tham_so t
  left join public.category_modifier_groups cmg on cmg.modifier_group_id = mg.id
  left join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
  where mg.tenant_id = t.tenant_id
    and mg.is_active = true
    and lower(btrim(mg.name)) = 'size'
),
ha_tang as (
  select
    (select count(*) from chi_nhanh_fnb) as so_chi_nhanh_fnb,
    (select count(*) from public.restaurant_tables rt cross join tham_so t
      where rt.tenant_id = t.tenant_id and rt.is_active = true) as so_ban,
    (select count(*) from public.kitchen_stations ks cross join tham_so t
      where ks.tenant_id = t.tenant_id and ks.is_active = true) as so_tram_bep,
    (select count(*) from public.kitchen_orders ko cross join tham_so t
      where ko.tenant_id = t.tenant_id) as so_don_bep
),
kiem as (
  select 'P0_TENANT_DUNG'::text as muc, 'DIEU_KIEN'::text as loai,
    exists (
      select 1 from public.tenants x cross join tham_so t
      where x.id = t.tenant_id and x.name = t.tenant_name
    ) as dat,
    jsonb_build_object('tenant_id', t.tenant_id, 'tenant_name', t.tenant_name) as chi_tiet,
    'Dừng nếu sai tenant; không dùng kết quả cho công ty khác.'::text as viec_can_lam
  from tham_so t

  union all
  select 'P1_THANH_TOAN_V3', 'DIEU_KIEN',
    d.payment_v3_oid is not null
      and d.payment_v3_note like '00343 phase A:%'
      and d.payment_v3 like '%FNB_PAYMENT_AMOUNT_CHANGED%'
      and d.payment_v3 like '%FNB_DEBT_CONFIRMATION_REQUIRED%'
      and has_function_privilege('authenticated', d.payment_v3_oid, 'EXECUTE')
      and not has_function_privilege('anon', d.payment_v3_oid, 'EXECUTE'),
    jsonb_build_object('chu_ky_co_mat', d.payment_v3_oid is not null, 'dau_vet_00343', d.payment_v3_note like '00343 phase A:%'),
    'Khôi phục đúng 00343 trước khi vận hành.'
  from dinh_nghia_ham d

  union all
  select 'P2_GUI_BEP_GUARD_SIZE', 'DIEU_KIEN',
    d.send_v2_oid is not null
      and d.send_v2_note like '00330:%'
      and d.send_v2 like '%chưa có công thức riêng%'
      and d.send_v2 like '%chưa có giá bán%'
      and has_function_privilege('authenticated', d.send_v2_oid, 'EXECUTE')
      and not has_function_privilege('anon', d.send_v2_oid, 'EXECUTE')
      and d.send_impl_oid is not null
      and not has_function_privilege('authenticated', d.send_impl_oid, 'EXECUTE'),
    jsonb_build_object('dau_vet_00330', d.send_v2_note like '00330:%', 'ham_noi_bo_da_khoa', d.send_impl_oid is not null and not has_function_privilege('authenticated', d.send_impl_oid, 'EXECUTE')),
    'Khôi phục đúng 00330; không mở đường gọi hàm nội bộ.'
  from dinh_nghia_ham d

  union all
  select 'P3_CONG_THUC_SIZE_XUYEN_SUOT', 'DIEU_KIEN',
    d.bom_lookup like '%p_variant_id%'
      and d.bom_consume like '%p_variant_id%'
      and d.bom_consume like '%get_active_bom_for_branch%'
      and d.bom_restore like '%p_variant_id%'
      and d.bom_restore like '%get_active_bom_for_branch%',
    jsonb_build_object('tra_bom', d.bom_lookup_oid is not null, 'tru_kho', d.bom_consume_oid is not null, 'hoan_kho', d.bom_restore_oid is not null),
    'Dừng nếu thiếu mắt xích chọn, trừ hoặc hoàn kho theo quy cách.'
  from dinh_nghia_ham d

  union all
  select 'P4_GIA_TOPPING_MAY_CHU', 'DIEU_KIEN',
    d.payment_impl_oid is not null and d.payment_impl like '%GIA_TOPPING_SERVER_00304%',
    jsonb_build_object('dau_vet_00304', d.payment_impl like '%GIA_TOPPING_SERVER_00304%'),
    'Dừng nếu giá topping chưa được máy chủ kiểm soát.'
  from dinh_nghia_ham d

  union all
  select 'P5_DINH_LUONG_TUY_CHON_CHINH_XAC', 'DIEU_KIEN',
    d.exact_mapping_table is not null
      and d.exact_save_oid is not null
      and d.send_v2 like '%FNB_EXACT_RECIPE_OPTION_MISSING%'
      and d.bom_consume like '%bom_modifier_option_quantities%'
      and dl.dong_bom_thieu_dinh_luong = 0,
    jsonb_build_object(
      'bang_dinh_luong', d.exact_mapping_table is not null,
      'rpc_luu_nguyen_tu', d.exact_save_oid is not null,
      'dong_bom_co_tuy_chon', dl.dong_bom_co_tuy_chon,
      'dong_bom_thieu_dinh_luong', dl.dong_bom_thieu_dinh_luong
    ),
    'Chạy 00350, rồi khai đủ định lượng thật cho từng lựa chọn của mỗi dòng BOM có gắn nhóm. Nhập 0 cho lựa chọn không tiêu hao.'
  from dinh_nghia_ham d
  cross join dinh_luong_tuy_chon_chinh_xac dl

  union all
  select 'D1_GIA_MON', 'DIEU_KIEN',
    lm.tong_mon > 0 and lm.mon_mot_gia_thieu_gia = 0 and lq.thieu_gia = 0,
    jsonb_build_object('tong_mon_dang_ban', lm.tong_mon, 'mon_mot_gia_thieu_gia', lm.mon_mot_gia_thieu_gia, 'quy_cach_thieu_gia', lq.thieu_gia),
    'Nhập giá lớn hơn 0 cho món một giá và mọi quy cách đang bật.'
  from loi_mon lm cross join loi_quy_cach lq

  union all
  select 'D2_QUY_CACH_VA_CONG_THUC', 'DIEU_KIEN',
    lm.mon_sai_so_mac_dinh = 0
      and lq.thieu_ma_bom = 0
      and lq.ma_bom_khong_co_cong_thuc = 0
      and lq.chua_ap_dung_du_chi_nhanh = 0,
    jsonb_build_object('mon_sai_so_mac_dinh', lm.mon_sai_so_mac_dinh, 'quy_cach_thieu_ma_bom', lq.thieu_ma_bom, 'ma_bom_khong_co_cong_thuc', lq.ma_bom_khong_co_cong_thuc, 'quy_cach_chua_ap_dung_du_chi_nhanh', lq.chua_ap_dung_du_chi_nhanh),
    'Mỗi món nhiều cỡ cần đúng một mặc định; mỗi cỡ có BOM riêng áp dụng đủ quán.'
  from loi_mon lm cross join loi_quy_cach lq

  union all
  select 'D3_BOM_HOP_LE', 'DIEU_KIEN',
    lm.mon_bat_bom_nhung_thieu_cong_thuc = 0 and lb.dong_cong_thuc_khong_hop_le = 0,
    jsonb_build_object('mon_bat_bom_nhung_thieu', lm.mon_bat_bom_nhung_thieu_cong_thuc, 'dong_bom_sai_luong_hoac_don_vi', lb.dong_cong_thuc_khong_hop_le),
    'BOM đang bật phải có nguyên liệu, lượng dương và đơn vị đầy đủ.'
  from loi_mon lm cross join loi_bom lb

  union all
  select 'D4_TOPPING_SKU', 'DIEU_KIEN',
    tp.tong = 0 or (tp.thieu_gia = 0 and tp.thieu_cong_thuc = 0),
    jsonb_build_object('tong_topping_sku', tp.tong, 'thieu_gia', tp.thieu_gia, 'thieu_cong_thuc', tp.thieu_cong_thuc),
    'Nếu dùng topping SKU, nhập đủ giá và BOM trước khi bật.'
  from topping tp

  union all
  select 'D5_TUY_CHON', 'DIEU_KIEN',
    tc.nhom_bat_buoc_sai_mac_dinh = 0
      and tc.nhom_tuy_chon_nhieu_mac_dinh = 0
      and tc.lua_chon_vua_nhan_dinh_luong_vua_tru_sku = 0,
    jsonb_build_object('nhom_bat_buoc_sai_mac_dinh', tc.nhom_bat_buoc_sai_mac_dinh, 'nhom_tuy_chon_nhieu_mac_dinh', tc.nhom_tuy_chon_nhieu_mac_dinh, 'lua_chon_co_nguy_co_tru_hai_lan', tc.lua_chon_vua_nhan_dinh_luong_vua_tru_sku),
    'Sửa mặc định và gỡ cấu hình vừa nhân định lượng vừa trừ SKU.'
  from tuy_chon tc

  union all
  select 'D6_HA_TANG_QUAN', 'DIEU_KIEN',
    ht.so_chi_nhanh_fnb > 0 and ht.so_tram_bep > 0,
    jsonb_build_object('chi_nhanh_fnb', ht.so_chi_nhanh_fnb, 'ban_dang_bat', ht.so_ban, 'tram_bep_dang_bat', ht.so_tram_bep, 'don_bep_hien_co', ht.so_don_bep),
    'Cấu hình ít nhất một trạm bếp; bàn có thể bổ sung theo mô hình phục vụ tại quán.'
  from ha_tang ht

  union all
  select 'I1_MON_CHUA_KHAI_TIEU_HAO', 'THONG_TIN', null::boolean,
    jsonb_build_object('so_mon', lm.mon_menu_chua_khai_quan_ly_tieu_hao),
    'Phân loại từng món: có BOM, bán nguyên trạng 1:1, hoặc không quản lý tồn có lý do được duyệt.'
  from loi_mon lm

  union all
  select 'I2_SIZE_CU_DANG_BAT', 'THONG_TIN', null::boolean,
    jsonb_build_object('nhom_size_cu', sc.so_nhom_size_cu, 'so_lien_ket', sc.so_lien_ket),
    'Không bật đồng thời Size cũ và quy cách mới trên cùng món; chuyển từng nhóm sau UAT.'
  from size_cu sc
),
ket_luan as (
  select coalesce(bool_and(dat), false) as dat
  from kiem
  where loai = 'DIEU_KIEN'
)
select muc, loai, dat, chi_tiet, viec_can_lam
from kiem
union all
select
  'Z_KET_LUAN',
  'KET_LUAN',
  k.dat,
  jsonb_build_object(
    'ket_luan', case when k.dat then 'ĐẠT CỔNG DỮ LIỆU - được phép UAT có kiểm soát' else 'CHƯA SẴN SÀNG - chưa được bật bán FnB' end
  ),
  case when k.dat
    then 'UAT 1 món một giá, 1 món M/L, 1 món nguyên trạng 1:1 và 1 topping; đối chiếu bếp, tồn, giá vốn, thanh toán và hoàn kho.'
    else 'Xử lý các dòng ĐIỀU_KIEN có dat=false rồi chạy lại toàn bộ file.'
  end
from ket_luan k
order by muc;
