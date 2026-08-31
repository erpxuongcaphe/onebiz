-- Read-only incident diagnostic for SKU-CAP-011 size BOM conflicts.
with target_products as (
  select p.id, p.tenant_id, p.code, p.name, p.bom_code
    from public.products p
   where upper(p.code) = 'SKU-CAP-011'
),
target_variants as (
  select v.id, v.tenant_id, v.product_id, v.name, v.bom_code,
         v.is_active, v.is_default, v.sort_order
    from public.product_variants v
    join target_products p
      on p.id = v.product_id
     and p.tenant_id = v.tenant_id
),
related_boms as (
  select b.id, b.tenant_id, b.product_id, b.variant_id, b.code,
         b.name, b.is_active
    from public.bom b
   where exists (
     select 1
       from target_products p
      where p.tenant_id = b.tenant_id
        and (
          b.product_id = p.id
          or upper(b.code) like 'SKU-CAP-011-%'
          or exists (
            select 1 from target_variants v where v.id = b.variant_id
          )
        )
   )
),
wrapper as (
  select p.proowner::regrole::text as owner_name,
         p.prosecdef,
         pg_get_functiondef(p.oid) as body
    from pg_proc p
   where p.oid = to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)')
)
select 'K1_00367_DANG_DUOC_DUNG' as muc,
       'DIEU_KIEN' as loai,
       exists (
         select 1 from wrapper
          where owner_name = 'postgres'
            and prosecdef
            and body like '%existing_variant.id <> v_variant_id%'
       ) as dat,
       coalesce((
         select jsonb_build_object(
           'owner', owner_name,
           'security_definer', prosecdef,
           'marker_00367', body like '%existing_variant.id <> v_variant_id%'
         ) from wrapper
       ), '{}'::jsonb) as chi_tiet
union all
select 'I1_SAN_PHAM_SKU_CAP_011',
       'THONG_TIN',
       null,
       jsonb_build_object(
         'so_san_pham', count(*),
         'san_pham', coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'tenant_id', tenant_id,
           'code', code,
           'name', name,
           'bom_code', bom_code
         )), '[]'::jsonb)
       )
  from target_products
union all
select 'I2_VARIANT_SKU_CAP_011',
       'THONG_TIN',
       null,
       jsonb_build_object(
         'so_variant', count(*),
         'variants', coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'product_id', product_id,
           'name', name,
           'bom_code', bom_code,
           'is_active', is_active,
           'is_default', is_default,
           'sort_order', sort_order
         ) order by sort_order, name), '[]'::jsonb)
       )
  from target_variants
union all
select 'I3_BOM_LIEN_QUAN_SKU_CAP_011',
       'THONG_TIN',
       null,
       jsonb_build_object(
         'so_bom', count(*),
         'boms', coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'product_id', product_id,
           'variant_id', variant_id,
           'code', code,
           'name', name,
           'is_active', is_active
         ) order by code, is_active desc), '[]'::jsonb)
       )
  from related_boms
union all
select 'K2_KHONG_CO_BOM_CODE_CHEO_SAN_PHAM',
       'DIEU_KIEN',
       not exists (
         select 1
           from related_boms b
          where not exists (
            select 1 from target_products p
             where p.id = b.product_id and p.tenant_id = b.tenant_id
          )
       ),
       jsonb_build_object(
         'so_bom_code_cheo_san_pham', (
           select count(*)
             from related_boms b
            where not exists (
              select 1 from target_products p
               where p.id = b.product_id and p.tenant_id = b.tenant_id
            )
         )
       );
