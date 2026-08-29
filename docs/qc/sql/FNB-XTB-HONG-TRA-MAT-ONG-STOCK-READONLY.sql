-- HONG TRA MAT ONG / XUONG TU BUA - KIEM TRA TRU KHO THEO CHI NHANH (CHI DOC)
-- K1-K4 phai true. I1 chi hien thi dinh luong da luu de doi chieu.

with target as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id
), product_target as (
  select p.id, p.tenant_id, p.code, p.name
    from public.products p
    join target t on t.tenant_id = p.tenant_id
   where p.code = 'SKU-HTR-003'
), branch_target as (
  select b.id, b.tenant_id, b.name
    from public.branches b
    join target t on t.tenant_id = b.tenant_id
   where b.name = 'Xưởng Cà Phê - Xưởng Tư Búa'
), effective_bom as (
  select public.get_active_bom_for_branch(p.id, br.id, null) as id
    from product_target p
    cross join branch_target br
), sugar_line as (
  select bi.bom_id, bi.material_id, bi.modifier_scale_target, bi.input_unit,
         bi.unit, bi.conversion_factor, m.code as material_code, g.name as group_name
    from public.bom_items bi
    join effective_bom eb on eb.id = bi.bom_id
    join public.products m on m.id = bi.material_id
    join public.modifier_groups g on g.id = bi.modifier_scale_target
   where m.code = 'SKU-BOT-009'
), exact_rows as (
  select o.id as option_id, o.label, o.sort_order, q.quantity,
         sl.input_unit, sl.unit, sl.conversion_factor
    from sugar_line sl
    join public.modifier_options o
      on o.group_id = sl.modifier_scale_target and o.is_active
    left join public.bom_modifier_option_quantities q
      on q.bom_id = sl.bom_id
     and q.material_id = sl.material_id
     and q.modifier_option_id = o.id
), fn as (
  select pg_get_functiondef(
    'public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)'::regprocedure
  ) as body
), checks as (
  select
    'K1_DUNG_MON_CHI_NHANH_VA_BOM'::text as muc,
    'DIEU_KIEN'::text as loai,
    (select count(*) from product_target) = 1
      and (select count(*) from branch_target) = 1
      and (select count(id) from effective_bom) = 1 as dat,
    jsonb_build_object(
      'san_pham', coalesce((select jsonb_agg(jsonb_build_object('ma', code, 'ten', name)) from product_target), '[]'::jsonb),
      'chi_nhanh', coalesce((select jsonb_agg(name) from branch_target), '[]'::jsonb),
      'bom_id', (select id from effective_bom)
    ) as chi_tiet
  union all
  select
    'K2_DUONG_GAN_DUNG_NHOM', 'DIEU_KIEN',
    (select count(*) from sugar_line) = 1
      and (select bool_and(group_name = 'Mức đường - Hồng Trà') from sugar_line),
    jsonb_build_object(
      'dong_duong', coalesce((select jsonb_agg(jsonb_build_object(
        'ma_nvl', material_code, 'nhom', group_name, 'don_vi_pha', input_unit,
        'don_vi_ton', unit, 'he_so', conversion_factor
      )) from sugar_line), '[]'::jsonb)
    )
  union all
  select
    'K3_MOI_MUC_DUONG_CO_DINH_LUONG', 'DIEU_KIEN',
    (select count(*) from exact_rows) > 0
      and (select bool_and(quantity is not null and quantity > 0) from exact_rows),
    jsonb_build_object('so_muc', (select count(*) from exact_rows))
  union all
  select
    'K4_THANH_TOAN_TRU_DUNG_KHO_CHI_NHANH', 'DIEU_KIEN',
    (select position('get_active_bom_for_branch(p_sku_id, p_branch_id' in body) > 0 from fn)
      and (select position('branch_id = p_branch_id' in body) > 0 from fn)
      and (select position('upsert_branch_stock(p_tenant_id, p_branch_id' in body) > 0 from fn)
      and (select position('allocate_lots_fifo(p_tenant_id, v_item.material_id, p_branch_id' in body) > 0 from fn),
    jsonb_build_object('nguyen_tac', 'BOM, ton chi nhanh, FIFO va stock movement cung dung p_branch_id cua hoa don')
  union all
  select
    'I1_DINH_LUONG_DUONG_DA_LUU', 'THONG_TIN', null::boolean,
    jsonb_build_object(
      'cac_muc', coalesce((select jsonb_agg(jsonb_build_object(
        'muc', label,
        'luong_tru_ton', quantity,
        'don_vi_ton', unit,
        'luong_pha', round(quantity / nullif(conversion_factor, 0), 4),
        'don_vi_pha', input_unit
      ) order by sort_order) from exact_rows), '[]'::jsonb)
    )
)
select muc, loai, dat, chi_tiet from checks order by muc;
