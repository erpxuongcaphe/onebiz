-- Read-only preflight for 00367.
select 'P1_00366_WRAPPER_AND_INNER_READY' as muc,
       'DIEU_KIEN' as loai,
       to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null
         and to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is not null as dat,
       jsonb_build_object(
         'wrapper', to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null,
         'inner_00357', to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is not null
       ) as chi_tiet
union all
select 'P2_STALE_SIZE_VARIANT_SHAPE_PRESENT',
       'THONG_TIN',
       null,
       jsonb_build_object(
         'so_dong', count(*)
       )
  from public.bom parent_bom
  join public.product_variants size_variant
    on size_variant.tenant_id = parent_bom.tenant_id
   and size_variant.product_id = parent_bom.product_id
   and size_variant.is_active
   and lower(size_variant.bom_code) = lower(parent_bom.code)
 where parent_bom.variant_id is null;
