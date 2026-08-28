-- 00357 POST-FLIGHT (READ ONLY)
-- Every DIEU_KIEN row must be true. THONG_TIN rows are for comparison only.

with fn as (
  select p.oid, pg_get_functiondef(p.oid) as body,
         pg_get_userbyid(p.proowner) as owner_name,
         p.prosecdef
  from pg_proc p
  where p.oid = to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)')
)
select 'K1_RPC_DUNG_CHU_KY_VA_CHU_SO_HUU' as muc, 'DIEU_KIEN' as loai,
  exists (select 1 from fn where owner_name = 'postgres' and prosecdef) as dat,
  coalesce((select jsonb_build_object('owner', owner_name, 'security_definer', prosecdef) from fn), '{}'::jsonb) as chi_tiet
union all
select 'K2_RPC_CO_GUARD_VA_GIAO_DICH_NGUYEN_TU', 'DIEU_KIEN',
  exists (
    select 1 from fn
    where position('products.edit' in body) > 0
      and position('for update' in lower(body)) > 0
      and position('delete from public.bom_items' in lower(body)) > 0
      and position('save_bom_modifier_option_quantities' in body) > 0
  ), '{}'::jsonb
union all
select 'K3_QUYEN_GOI', 'DIEU_KIEN',
  not has_function_privilege('anon', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE'),
  jsonb_build_object(
    'anon', has_function_privilege('anon', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE'),
    'authenticated', has_function_privilege('authenticated', 'public.save_fnb_size_setup_atomic(uuid,jsonb)', 'EXECUTE')
  )
union all
select 'K4_KHONG_CO_SIZE_MAC_DINH_TRUNG', 'DIEU_KIEN',
  not exists (
    select 1 from public.product_variants pv
     where pv.is_active
     group by pv.tenant_id, pv.product_id
    having count(*) filter (where pv.is_default) > 1
  ), jsonb_build_object(
    'san_pham_loi', (
      select count(*) from (
        select pv.product_id from public.product_variants pv
         where pv.is_active group by pv.tenant_id, pv.product_id
        having count(*) filter (where pv.is_default) > 1
      ) duplicated_defaults
    )
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
