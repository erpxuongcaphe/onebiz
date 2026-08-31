-- Read-only postflight for 00365.
with function_info as (
  select p.oid,
         pg_get_userbyid(p.proowner) as owner,
         p.prosecdef as security_definer,
         pg_get_functiondef(p.oid) as body
    from pg_proc p
   where p.oid = to_regprocedure(
     'public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])'
   )
), checks as (
  select 'K1_RPC_DUNG_CHU_KY_VA_CHU_SO_HUU'::text as muc,
         'DIEU_KIEN'::text as loai,
         exists(select 1 from function_info where owner = 'postgres' and security_definer) as dat,
         coalesce((select jsonb_build_object('owner', owner, 'security_definer', security_definer) from function_info), '{}'::jsonb) as chi_tiet
  union all
  select 'K2_TAO_CHA_VA_SIZE_CUNG_GIAO_DICH', 'DIEU_KIEN',
         exists(select 1 from function_info where body like '%insert into public.products%' and body like '%save_fnb_size_setup_atomic%'),
         '{}'::jsonb
  union all
  select 'K3_TUY_CHON_DUOC_GAN_TRUOC_DINH_LUONG', 'DIEU_KIEN',
         exists(select 1 from function_info where body like '%save_product_modifier_groups_atomic%' and body like '%save_fnb_size_setup_atomic%'),
         '{}'::jsonb
  union all
  select 'K4_QUYEN_GOI', 'DIEU_KIEN',
         not has_function_privilege('anon', 'public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])', 'EXECUTE')
           and has_function_privilege('authenticated', 'public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])', 'EXECUTE'),
         jsonb_build_object(
           'anon', has_function_privilege('anon', 'public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])', 'EXECUTE'),
           'authenticated', has_function_privilege('authenticated', 'public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])', 'EXECUTE')
         )
)
select muc, loai, dat, chi_tiet from checks order by muc;
