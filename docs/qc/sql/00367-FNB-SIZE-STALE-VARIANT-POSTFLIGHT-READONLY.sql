-- Read-only postflight for 00367.
with function_info as (
  select p.proowner::regrole::text as owner_name,
         p.prosecdef,
         pg_get_functiondef(p.oid) as body
    from pg_proc p
   where p.oid = to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)')
)
select 'K1_RPC_00367_SIGNATURE_OWNER' as muc,
       'DIEU_KIEN' as loai,
       exists(select 1 from function_info where owner_name = 'postgres' and prosecdef) as dat,
       coalesce((select jsonb_build_object('owner', owner_name, 'security_definer', prosecdef) from function_info), '{}'::jsonb) as chi_tiet
union all
select 'K2_ONLY_EXACT_REQUESTED_VARIANT_CAN_ADOPT',
       'DIEU_KIEN',
       exists(
         select 1 from function_info
          where body like '%existing_variant.product_id <> p_product_id%'
            and body like '%v_variant_id is null%'
            and body like '%existing_variant.id <> v_variant_id%'
       ),
       '{}'::jsonb
union all
select 'K3_INNER_RPC_NOT_BROWSER_CALLABLE',
       'DIEU_KIEN',
       not has_function_privilege('anon', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE'),
       jsonb_build_object(
         'anon', has_function_privilege('anon', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE'),
         'authenticated', has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic_00357(uuid,jsonb)', 'EXECUTE')
       )
union all
select 'K4_WRAPPER_PERMISSION',
       'DIEU_KIEN',
       not has_function_privilege('anon', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE'),
       jsonb_build_object(
         'anon', has_function_privilege('anon', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE'),
         'authenticated', has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE')
       );
