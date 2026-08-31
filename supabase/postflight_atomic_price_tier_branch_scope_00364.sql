-- Read-only postflight for 00364_atomic_price_tier_branch_scope.sql.

with function_state as (
  select
    p.prosecdef,
    pg_get_userbyid(p.proowner) as owner_name,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  where p.oid = to_regprocedure(
    'public.save_branch_price_tier_assignments_00363(uuid,jsonb,text)'
  )
), overlap_state as (
  select count(*)::int as groups
  from public.branch_price_tier_assignments a
  join public.branch_price_tier_assignments b
    on b.tenant_id = a.tenant_id
   and b.branch_id = a.branch_id
   and b.id > a.id
   and tstzrange(b.starts_at, b.ends_at, '[)')
       && tstzrange(a.starts_at, a.ends_at, '[)')
)
select 'K1_HAM_LUU_PHAM_VI_NGUYEN_TU'::text as muc,
       'DIEU_KIEN'::text as loai,
       coalesce(
         definition ilike '%delete from public.branch_price_tier_assignments%'
         and definition ilike '%price_assignment_replace%'
         and prosecdef
         and owner_name = 'postgres',
         false
       ) as dat,
       jsonb_build_object(
         'security_definer', coalesce(prosecdef, false),
         'owner', owner_name,
         'co_xoa_va_thay_the', coalesce(
           definition ilike '%delete from public.branch_price_tier_assignments%',
           false
         ),
         'co_audit', coalesce(definition ilike '%price_assignment_replace%', false)
       ) as chi_tiet
  from function_state
union all
select 'K2_HAM_XOA_GIA_NEN_TANG_THEO_SIZE', 'DIEU_KIEN',
       to_regprocedure('public.delete_platform_price_targets_00364(jsonb)') is not null,
       jsonb_build_object(
         'ham_da_co',
         to_regprocedure('public.delete_platform_price_targets_00364(jsonb)') is not null
       )
union all
select 'K3_QUYEN_GOI_DUNG_VAI_TRO', 'DIEU_KIEN',
       not has_function_privilege(
         'anon',
         'public.save_branch_price_tier_assignments_00363(uuid,jsonb,text)',
         'EXECUTE'
       )
       and has_function_privilege(
         'authenticated',
         'public.save_branch_price_tier_assignments_00363(uuid,jsonb,text)',
         'EXECUTE'
       )
       and not has_function_privilege(
         'anon',
         'public.delete_platform_price_targets_00364(jsonb)',
         'EXECUTE'
       )
       and has_function_privilege(
         'authenticated',
         'public.delete_platform_price_targets_00364(jsonb)',
         'EXECUTE'
       ),
       jsonb_build_object(
         'anon_luu', has_function_privilege(
           'anon',
           'public.save_branch_price_tier_assignments_00363(uuid,jsonb,text)',
           'EXECUTE'
         ),
         'authenticated_luu', has_function_privilege(
           'authenticated',
           'public.save_branch_price_tier_assignments_00363(uuid,jsonb,text)',
           'EXECUTE'
         ),
         'anon_xoa_gia_size', has_function_privilege(
           'anon',
           'public.delete_platform_price_targets_00364(jsonb)',
           'EXECUTE'
         ),
         'authenticated_xoa_gia_size', has_function_privilege(
           'authenticated',
           'public.delete_platform_price_targets_00364(jsonb)',
           'EXECUTE'
         )
       )
union all
select 'K4_KHONG_CO_LICH_BANG_GIA_CHONG_NHAU', 'DIEU_KIEN', groups = 0,
       jsonb_build_object('so_cap_chong_nhau', groups)
  from overlap_state
union all
select 'I1_THONG_TIN_PHAM_VI_VA_GIA_SIZE', 'THONG_TIN', null::boolean,
       jsonb_build_object(
         'dong_phan_cong', (select count(*) from public.branch_price_tier_assignments),
         'chi_nhanh_da_gan', (
           select count(distinct branch_id) from public.branch_price_tier_assignments
         ),
         'gia_nen_tang_theo_size', (
           select count(*) from public.product_platform_prices where variant_id is not null
         )
       );
