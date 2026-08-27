-- 00355 preflight (READ ONLY)
-- ĐẠT khi P1, P2 và P3 đều dat = true.
-- P4 chỉ ghi nhận ràng buộc hiện tại để đối chiếu sau khi chạy migration.
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
), checks as (
  select
    'P1_BANG_VA_RPC_NEN_SAN_SANG'::text as muc,
    'DIEU_KIEN'::text as loai,
    to_regclass('public.floor_plan_decorations') is not null
      and to_regprocedure('public.fnb_floor_decoration_config_atomic(text,jsonb)') is not null as dat,
    jsonb_build_object(
      'bang', to_regclass('public.floor_plan_decorations') is not null,
      'rpc', to_regprocedure('public.fnb_floor_decoration_config_atomic(text,jsonb)') is not null
    ) as chi_tiet
  union all
  select
    'P2_DUNG_HAM_RANG_BUOC_CUA_BANG'::text,
    'DIEU_KIEN'::text,
    exists (select 1 from constraints where conname = 'floor_plan_decorations_width_check')
      and exists (select 1 from constraints where conname = 'floor_plan_decorations_height_check'),
    jsonb_build_object(
      'width_check', exists (select 1 from constraints where conname = 'floor_plan_decorations_width_check'),
      'height_check', exists (select 1 from constraints where conname = 'floor_plan_decorations_height_check')
    )
  union all
  select
    'P3_RPC_DA_CHO_PHEP_VAT_MONG_TU_4PX'::text,
    'DIEU_KIEN'::text,
    position($needle$'width')::int < 4$needle$ in coalesce(
      pg_get_functiondef(to_regprocedure('public.fnb_floor_decoration_config_atomic(text,jsonb)')),
      ''
    )) > 0
      and position($needle$'height')::int < 4$needle$ in coalesce(
        pg_get_functiondef(to_regprocedure('public.fnb_floor_decoration_config_atomic(text,jsonb)')),
        ''
      )) > 0,
    jsonb_build_object(
      'gioi_han_rpc', '4px den 2000px',
      'ghi_chu', 'Migration 00355 chi dong bo CHECK cua bang voi gioi han RPC da co.'
    )
  union all
  select
    'P4_THONG_TIN_RANG_BUOC_HIEN_TAI'::text,
    'THONG_TIN'::text,
    null::boolean,
    coalesce(jsonb_object_agg(conname, definition), '{}'::jsonb)
  from constraints
)
select muc, loai, dat, chi_tiet from checks order by muc;
