-- 00357 PRE-FLIGHT (READ ONLY)
-- Run before 00357_atomic_fnb_size_setup.sql. Every DIEU_KIEN row must be true.

select 'P1_NEN_DU_LIEU_SAN_SANG' as muc, 'DIEU_KIEN' as loai,
  to_regclass('public.product_variants') is not null
    and to_regclass('public.bom') is not null
    and to_regclass('public.bom_items') is not null
    and to_regclass('public.bom_modifier_option_quantities') is not null as dat,
  jsonb_build_object(
    'variants', to_regclass('public.product_variants') is not null,
    'bom', to_regclass('public.bom') is not null,
    'bom_items', to_regclass('public.bom_items') is not null,
    'exact_quantities', to_regclass('public.bom_modifier_option_quantities') is not null
  ) as chi_tiet
union all
select 'P2_RPC_PHU_THUOC_SAN_SANG', 'DIEU_KIEN',
  to_regprocedure('public.user_has_permission(uuid,text)') is not null
    and to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') is not null,
  jsonb_build_object(
    'permission_helper', to_regprocedure('public.user_has_permission(uuid,text)') is not null,
    'exact_quantity_rpc', to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') is not null
  )
union all
select 'P3_00357_CHUA_CAI', 'DIEU_KIEN',
  to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is null,
  jsonb_build_object(
    'ham_da_co', to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null
  )
union all
select 'I1_THONG_TIN_SIZE_FNB_HIEN_CO', 'THONG_TIN', null::boolean,
  jsonb_build_object(
    'san_pham_co_size', count(distinct pv.product_id),
    'size_dang_bat', count(*) filter (where pv.is_active),
    'size_co_bom_code', count(*) filter (where pv.is_active and nullif(trim(pv.bom_code), '') is not null)
  )
from public.product_variants pv
join public.products p on p.id = pv.product_id and p.tenant_id = pv.tenant_id
where p.channel = 'fnb';
