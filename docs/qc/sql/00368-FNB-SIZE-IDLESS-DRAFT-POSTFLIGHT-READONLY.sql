-- Read-only postflight for 00368.
with wrapper as (
  select p.proowner::regrole::text as owner_name,
         p.prosecdef,
         pg_get_functiondef(p.oid) as body
    from pg_proc p
   where p.oid = to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)')
)
select 'K1_RPC_00368_SIGNATURE_OWNER' as muc,
       'DIEU_KIEN' as loai,
       exists(select 1 from wrapper where owner_name = 'postgres' and prosecdef) as dat,
       coalesce((select jsonb_build_object('owner', owner_name, 'security_definer', prosecdef) from wrapper), '{}'::jsonb) as chi_tiet
union all
select 'K2_ONLY_UNIQUE_EXACT_SAME_PRODUCT_VARIANT',
       'DIEU_KIEN',
       exists(
         select 1 from wrapper
          where body like '%existing_variant.tenant_id = v_tenant%'
            and body like '%existing_variant.product_id = p_product_id%'
            and body like '%lower(trim(existing_variant.name)) = lower(v_name)%'
            and body like '%lower(trim(existing_variant.bom_code)) = lower(v_bom_code)%'
            and body like '%v_candidate_count = 1%'
       ),
       '{}'::jsonb
union all
select 'K3_OLDER_WRAPPERS_NOT_BROWSER_CALLABLE',
       'DIEU_KIEN',
       not has_function_privilege('anon', 'public.save_fnb_size_setup_atomic_00367(uuid,jsonb)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic_00367(uuid,jsonb)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE'),
       jsonb_build_object(
         '00367_anon', has_function_privilege('anon', 'public.save_fnb_size_setup_atomic_00367(uuid,jsonb)', 'EXECUTE'),
         '00367_authenticated', has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic_00367(uuid,jsonb)', 'EXECUTE'),
         '00357_anon', has_function_privilege('anon', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE'),
         '00357_authenticated', has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE')
       )
union all
select 'K4_PUBLIC_WRAPPER_PERMISSION',
       'DIEU_KIEN',
       not has_function_privilege('anon', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE'),
       jsonb_build_object(
         'anon', has_function_privilege('anon', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE'),
         'authenticated', has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE')
       );
