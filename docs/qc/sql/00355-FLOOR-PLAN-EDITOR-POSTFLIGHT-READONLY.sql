-- 00355 postflight (READ ONLY)
-- ĐẠT khi K1-K4 đều dat = true. K5 chỉ là số liệu đối chiếu.
-- Không tạo/sửa/xoá bàn, khu vực, vật thể, đơn FnB, tồn kho hoặc dữ liệu kinh doanh.

with constraints as (
  select
    c.conname,
    pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public'
    and r.relname = 'floor_plan_decorations'
    and c.conname in (
      'floor_plan_decorations_width_check',
      'floor_plan_decorations_height_check'
    )
), decoration_rpc as (
  select coalesce(
    pg_get_functiondef(to_regprocedure('public.fnb_floor_decoration_config_atomic(text,jsonb)')),
    ''
  ) as definition
), checks as (
  select
    'K1_RANG_BUOC_CHO_PHEP_PRESET_MONG'::text as muc,
    'DIEU_KIEN'::text as loai,
    (select definition from constraints where conname = 'floor_plan_decorations_width_check') like '%4%2000%'
      and (select definition from constraints where conname = 'floor_plan_decorations_height_check') like '%4%2000%' as dat,
    jsonb_build_object(
      'width', (select definition from constraints where conname = 'floor_plan_decorations_width_check'),
      'height', (select definition from constraints where conname = 'floor_plan_decorations_height_check')
    ) as chi_tiet
  union all
  select
    'K2_RPC_VA_BANG_CUNG_GIOI_HAN_4PX'::text,
    'DIEU_KIEN'::text,
    position($needle$'width')::int < 4$needle$ in definition) > 0
      and position($needle$'height')::int < 4$needle$ in definition) > 0,
    jsonb_build_object(
      'rpc_da_cho_phep_4px', true,
      'ghi_chu', 'Cua, cua so, TV va tuong co the duoc tao dung preset giao dien.'
    )
  from decoration_rpc
  union all
  select
    'K3_QUYEN_GHI_VAN_CHI_AUTHENTICATED'::text,
    'DIEU_KIEN'::text,
    not has_function_privilege('anon', 'public.fnb_floor_decoration_config_atomic(text,jsonb)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.fnb_floor_decoration_config_atomic(text,jsonb)', 'EXECUTE'),
    jsonb_build_object(
      'anon', has_function_privilege('anon', 'public.fnb_floor_decoration_config_atomic(text,jsonb)', 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public.fnb_floor_decoration_config_atomic(text,jsonb)', 'EXECUTE')
    )
  union all
  select
    'K4_KHONG_CO_VAT_THE_DUOI_GIOI_HAN'::text,
    'DIEU_KIEN'::text,
    not exists (
      select 1 from public.floor_plan_decorations where width < 4 or height < 4
    ),
    jsonb_build_object(
      'so_vat_the_duoi_4px', (
        select count(*) from public.floor_plan_decorations where width < 4 or height < 4
      )
    )
  union all
  select
    'K5_THONG_TIN_VAT_THE_MONG'::text,
    'THONG_TIN'::text,
    null::boolean,
    jsonb_build_object(
      'so_vat_the_thap_hon_20px', (
        select count(*) from public.floor_plan_decorations where width < 20 or height < 20
      )
    )
)
select muc, loai, dat, chi_tiet from checks order by muc;
