-- 00352 BƯỚC 1 - chỉ đọc. Không sửa dữ liệu.
-- ĐẠT khi P1, P2 và P3 đều có dat = true.

with checks as (
  select
    'P1_00350_VA_00320_SAN_SANG'::text as muc,
    'DIEU_KIEN'::text as loai,
    to_regclass('public.bom_modifier_option_quantities') is not null
      and to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') is not null
      and to_regprocedure('public.normalize_bom_item_uom_00320()') is not null as dat,
    jsonb_build_object(
      'bang_dinh_luong', to_regclass('public.bom_modifier_option_quantities') is not null,
      'ham_luu', to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') is not null,
      'guard_quy_doi_bom', to_regprocedure('public.normalize_bom_item_uom_00320()') is not null
    ) as chi_tiet
  union all
  select
    'P2_CHUA_CO_DINH_LUONG_CU_CAN_RAP_RIEN'::text,
    'DIEU_KIEN'::text,
    not exists (select 1 from public.bom_modifier_option_quantities),
    jsonb_build_object('so_dong_hien_co', (select count(*) from public.bom_modifier_option_quantities))
  union all
  select
    'P3_CHUA_CAI_00352'::text,
    'DIEU_KIEN'::text,
    coalesce(obj_description('public.save_bom_modifier_option_quantities(uuid,jsonb)'::regprocedure, 'pg_proc'), '')
      not like '%00352%',
    jsonb_build_object(
      'marker_hien_tai', coalesce(obj_description('public.save_bom_modifier_option_quantities(uuid,jsonb)'::regprocedure, 'pg_proc'), '')
    )
)
select muc, loai, dat, chi_tiet from checks order by muc;
