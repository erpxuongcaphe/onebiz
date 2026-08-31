-- Read-only preflight for 00368.
with exact_candidates as (
  select v.tenant_id, v.product_id, lower(trim(v.name)) as size_name,
         lower(trim(v.bom_code)) as bom_code, count(*) as candidate_count
    from public.product_variants v
   where v.is_active
     and nullif(trim(v.name), '') is not null
     and nullif(trim(v.bom_code), '') is not null
   group by v.tenant_id, v.product_id, lower(trim(v.name)), lower(trim(v.bom_code))
)
select 'P1_00367_READY' as muc,
       'DIEU_KIEN' as loai,
       to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null
         and to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is not null as dat,
       jsonb_build_object(
         'wrapper', to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null,
         'inner_00357', to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is not null
       ) as chi_tiet
union all
select 'P2_EXACT_VARIANT_IDENTITY_IS_UNIQUE',
       'DIEU_KIEN',
       not exists(select 1 from exact_candidates where candidate_count > 1),
       jsonb_build_object(
         'nhom_trung', (select count(*) from exact_candidates where candidate_count > 1)
       );
