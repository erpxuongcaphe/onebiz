begin transaction read only;

with function_info as (
  select p.oid,
         p.prosecdef,
         pg_get_userbyid(p.proowner) as owner_name,
         lower(pg_get_functiondef(p.oid)) as body
    from pg_proc p
   where p.oid = to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)')
), checks as (
  select 'K1_RPC_00366_DUNG_CHU_KY_VA_CHU_SO_HUU'::text as muc,
         'DIEU_KIEN'::text as loai,
         exists (
           select 1 from function_info
            where owner_name = 'postgres' and prosecdef
         ) as dat,
         jsonb_build_object(
           'owner', (select owner_name from function_info),
           'security_definer', (select prosecdef from function_info)
         ) as chi_tiet

  union all

  select 'K2_BOM_NEN_DUOC_XU_LY_CUNG_GIAO_DICH',
         'DIEU_KIEN',
         exists (
           select 1 from function_info
            where body like '%variant_id is null%'
              and body like '%-legacy-%'
              and body like '%save_fnb_size_setup_atomic_00357%'
         ),
         '{}'::jsonb

  union all

  select 'K3_HAM_NEN_KHONG_MO_CHO_TRINH_DUYET',
         'DIEU_KIEN',
         not has_function_privilege('anon', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE')
           and not has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE'),
         jsonb_build_object(
           'anon', has_function_privilege('anon', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE'),
           'authenticated', has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE')
         )

  union all

  select 'K4_QUYEN_GOI_WRAPPER',
         'DIEU_KIEN',
         not has_function_privilege('anon', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE')
           and has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE'),
         jsonb_build_object(
           'anon', has_function_privilege('anon', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE'),
           'authenticated', has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE')
         )
)
select muc, loai, dat, chi_tiet
from checks
order by muc;

rollback;
