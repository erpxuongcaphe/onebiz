-- HONG TRA XUONG TU BUA - BUOC 3: KIEM SAU (CHI DOC)
--
-- DAT khi K1-K6 deu true. I1 chi la thong tin de anh doi chieu tren man hinh.
-- File nay khong sua du lieu va khong tao giao dich FnB.

with target as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id
), product_target as (
  select p.id, p.tenant_id, p.category_id
    from public.products p
    join target t on t.tenant_id = p.tenant_id
   where p.code = 'SKU-HTR-001' and p.name = 'Hồng Trà'
), branch_target as (
  select b.id, b.tenant_id
    from public.branches b
    join target t on t.tenant_id = b.tenant_id
   where b.name = 'Xưởng Cà Phê - Xưởng Tư Búa'
), sugar_group as (
  select g.id
    from public.modifier_groups g
    join target t on t.tenant_id = g.tenant_id
   where g.name = 'Mức đường - Hồng Trà' and g.is_active
), active_bom as (
  select b.id
    from public.bom b
    join product_target p on p.id = b.product_id
   where b.is_active
), checks as (
  select
    'K1_DUNG_TENANT_VA_SAN_PHAM'::text as muc,
    'DIEU_KIEN'::text as loai,
    (select count(*) from product_target) = 1 as dat,
    jsonb_build_object(
      'tenant', 'OneBiz Coffee Demo',
      'san_pham', coalesce((select jsonb_agg(jsonb_build_object('ma', p.id, 'code', 'SKU-HTR-001')) from product_target p), '[]'::jsonb)
    ) as chi_tiet
  union all
  select
    'K2_MENU_CHI_XUONG_TU_BUA',
    'DIEU_KIEN',
    (select count(*) from public.fnb_product_branch_menu_scopes s join product_target p on p.id = s.product_id) = 1
      and exists (
        select 1 from public.fnb_product_branch_menu_scopes s
        join product_target p on p.id = s.product_id
        join branch_target b on b.id = s.branch_id
      ),
    jsonb_build_object(
      'chi_nhanh_duoc_mo', coalesce((
        select jsonb_agg(b.name order by b.name)
          from public.fnb_product_branch_menu_scopes s
          join product_target p on p.id = s.product_id
          join public.branches b on b.id = s.branch_id
      ), '[]'::jsonb)
    )
  union all
  select
    'K3_TUY_CHON_HIEN_TREN_POS_DUNG_THU_TU',
    'DIEU_KIEN',
    coalesce((
      select jsonb_agg(g.name order by pmg.sort_order)
        from public.product_modifier_groups pmg
        join product_target p on p.id = pmg.product_id
        join public.modifier_groups g on g.id = pmg.modifier_group_id
    ), '[]'::jsonb) = '["Mức đá", "Mức đường - Hồng Trà", "Topping"]'::jsonb,
    jsonb_build_object(
      'nhom_hieu_luc', coalesce((
        select jsonb_agg(jsonb_build_object('thu_tu', pmg.sort_order, 'ten', g.name) order by pmg.sort_order)
          from public.product_modifier_groups pmg
          join product_target p on p.id = pmg.product_id
          join public.modifier_groups g on g.id = pmg.modifier_group_id
      ), '[]'::jsonb)
    )
  union all
  select
    'K4_BOM_GIU_TRA_LY_VA_GAN_DUONG_DUNG_NHOM',
    'DIEU_KIEN',
    (select count(*) from active_bom) = 1
      and exists (
        select 1 from public.bom_items bi
        join active_bom b on b.id = bi.bom_id
        join public.products m on m.id = bi.material_id
        join sugar_group g on g.id = bi.modifier_scale_target
       where m.code = 'SKU-BOT-009'
         and bi.quantity = 0.035 and bi.input_quantity = 35 and lower(trim(bi.unit)) = 'kg'
         and lower(trim(bi.input_unit)) = 'g' and bi.conversion_factor = 0.001
      )
      and exists (
        select 1 from public.bom_items bi
        join active_bom b on b.id = bi.bom_id
        join public.products m on m.id = bi.material_id
       where m.code = 'SKU-TRA-001'
         and bi.quantity = 0.0136 and bi.input_quantity = 6.8 and lower(trim(bi.unit)) = 'túi'
         and lower(trim(bi.input_unit)) = 'g' and bi.conversion_factor = 0.002
         and bi.modifier_scale_target is null
      )
      and exists (
        select 1 from public.bom_items bi
        join active_bom b on b.id = bi.bom_id
        join public.products m on m.id = bi.material_id
       where m.code = 'SKU-LTT-012'
         and bi.quantity = 0.02 and bi.input_quantity = 1 and lower(trim(bi.unit)) = 'cây'
         and lower(trim(bi.input_unit)) = 'cái' and bi.conversion_factor = 0.02
         and bi.modifier_scale_target is null
      ),
    jsonb_build_object(
      'dong_bom', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ma', m.code,
          'so_luong_ton', bi.quantity,
          'so_luong_pha', bi.input_quantity,
          'don_vi_ton', bi.unit,
          'don_vi_pha', bi.input_unit,
          'he_so', bi.conversion_factor,
          'nhom_dinh_luong', g.name
        ) order by m.code)
          from public.bom_items bi
          join active_bom b on b.id = bi.bom_id
          join public.products m on m.id = bi.material_id
          left join public.modifier_groups g on g.id = bi.modifier_scale_target
      ), '[]'::jsonb)
    )
  union all
  select
    'K5_BA_MUC_DUONG_CHINH_XAC',
    'DIEU_KIEN',
    (select count(*) from public.bom_modifier_option_quantities q join active_bom b on b.id = q.bom_id) = 3
      and not exists (
        select 1
          from public.bom_modifier_option_quantities q
          join active_bom b on b.id = q.bom_id
          join public.modifier_options o on o.id = q.modifier_option_id
          join public.products m on m.id = q.material_id
         where m.code <> 'SKU-BOT-009'
            or (o.label, q.quantity) not in (('60%', 0.021), ('80%', 0.028), ('100%', 0.035))
      ),
    jsonb_build_object(
      'muc_duong', coalesce((
        select jsonb_agg(jsonb_build_object(
          'muc', o.label,
          'luong_tru_ton_kg', q.quantity,
          'luong_pha_g', round(q.quantity / nullif(bi.conversion_factor, 0), 4)
        ) order by o.sort_order)
          from public.bom_modifier_option_quantities q
          join active_bom b on b.id = q.bom_id
          join public.modifier_options o on o.id = q.modifier_option_id
          join public.bom_items bi on bi.bom_id = q.bom_id and bi.material_id = q.material_id
      ), '[]'::jsonb)
    )
  union all
  select
    'K6_MUC_DUONG_CHUNG_KHONG_CON_HIEU_LUC_CHO_HONG_TRA',
    'DIEU_KIEN',
    not exists (
      select 1 from public.product_modifier_groups pmg
      join product_target p on p.id = pmg.product_id
      join public.modifier_groups g on g.id = pmg.modifier_group_id
     where g.name = 'Mức đường'
    ),
    jsonb_build_object(
      'ghi_chu', 'Hong Tra dung Muc duong - Hong Tra; nhom chung giu nguyen cho mon khac.'
    )
  union all
  select
    'I1_KHONG_TAO_GIAO_DICH_KHI_CAU_HINH',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'ghi_chu', 'Buoc cau hinh chi ghi scope menu, link tuy chon cap mon, target BOM va ba dinh luong. Khong co lenh ghi don, hoa don, phieu bep hay ton kho.'
    )
)
select muc, loai, dat, chi_tiet from checks order by muc;
