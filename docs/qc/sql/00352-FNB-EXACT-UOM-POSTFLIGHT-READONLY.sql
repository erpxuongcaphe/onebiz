-- 00352 BƯỚC 3 - chỉ đọc. Không sửa dữ liệu.
-- ĐẠT khi K1-K5 đều có dat = true. Chưa tạo đơn/phiếu để kiểm này.

with function_source as (
  select pg_get_functiondef('public.save_bom_modifier_option_quantities(uuid,jsonb)'::regprocedure) as definition
), checks as (
  select
    'K1_RPC_NHAN_DON_VI_PHA_CHE'::text as muc,
    'DIEU_KIEN'::text as loai,
    position('inputQuantity' in definition) > 0
      and position('inputUnit' in definition) > 0 as dat,
    jsonb_build_object('marker', 'inputQuantity + inputUnit') as chi_tiet
  from function_source
  union all
  select
    'K2_MAY_CHU_TU_QUY_DOI_VE_DON_VI_TON'::text,
    'DIEU_KIEN'::text,
    position('v_normalized_quantity := round(v_input_quantity * v_factor, 4)' in definition) > 0,
    jsonb_build_object('marker', 'input_quantity x conversion_factor')
  from function_source
  union all
  select
    'K3_CHAN_DON_VI_KHONG_KHOP_BOM'::text,
    'DIEU_KIEN'::text,
    position('FNB_EXACT_RECIPE_INPUT_UNIT_MISMATCH' in definition) > 0,
    jsonb_build_object('marker', 'FNB_EXACT_RECIPE_INPUT_UNIT_MISMATCH')
  from function_source
  union all
  select
    'K4_QUYEN_GOI'::text,
    'DIEU_KIEN'::text,
    not has_function_privilege('anon', 'public.save_bom_modifier_option_quantities(uuid,jsonb)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.save_bom_modifier_option_quantities(uuid,jsonb)', 'EXECUTE'),
    jsonb_build_object(
      'anon', has_function_privilege('anon', 'public.save_bom_modifier_option_quantities(uuid,jsonb)', 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public.save_bom_modifier_option_quantities(uuid,jsonb)', 'EXECUTE')
    )
  from function_source
  union all
  select
    'K5_CHI_NHOM_HIEN_TREN_POS_MOI_DUOC_KHAI_DINH_LUONG'::text,
    'DIEU_KIEN'::text,
    position('FNB_EXACT_RECIPE_GROUP_NOT_EFFECTIVE_FOR_PRODUCT' in definition) > 0
      and position('g.channel in (''fnb'', ''all'')' in definition) > 0,
    jsonb_build_object(
      'marker', 'FNB_EXACT_RECIPE_GROUP_NOT_EFFECTIVE_FOR_PRODUCT',
      'kenh', 'fnb/all'
    )
  from function_source
)
select muc, loai, dat, chi_tiet from checks order by muc;
