-- 00356 preflight (CHỈ ĐỌC).
-- ĐẠT khi P1-P3 đều true. P4 chỉ ghi nhận số liên kết hiện có.

with checks as (
  select
    'P1_BANG_NEN_SAN_SANG'::text as muc,
    'DIEU_KIEN'::text as loai,
    to_regclass('public.products') is not null
      and to_regclass('public.modifier_groups') is not null
      and to_regclass('public.product_modifier_groups') is not null as dat,
    jsonb_build_object(
      'products', to_regclass('public.products') is not null,
      'modifier_groups', to_regclass('public.modifier_groups') is not null,
      'product_modifier_groups', to_regclass('public.product_modifier_groups') is not null
    ) as chi_tiet
  union all
  select
    'P2_HELPER_QUYEN_SAN_SANG',
    'DIEU_KIEN',
    to_regprocedure('public.user_has_permission(uuid,text)') is not null,
    jsonb_build_object('user_has_permission', to_regprocedure('public.user_has_permission(uuid,text)') is not null)
  union all
  select
    'P3_00356_CHUA_CAI',
    'DIEU_KIEN',
    to_regprocedure('public.save_product_modifier_groups_atomic(uuid,uuid[])') is null,
    jsonb_build_object('ham_da_co', to_regprocedure('public.save_product_modifier_groups_atomic(uuid,uuid[])') is not null)
  union all
  select
    'P4_THONG_TIN_LIEN_KET_HIEN_CO',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'tong_lien_ket', count(*),
      'so_mon_override', count(distinct product_id)
    )
  from public.product_modifier_groups
)
select muc, loai, dat, chi_tiet from checks order by muc;
