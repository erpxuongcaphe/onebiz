-- 00351 PRE-FLIGHT - CHI DOC. Khong sua du lieu.
-- Tenant OneBiz Coffee Demo anh dang dung de test XTB.
with target as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id
), expected as (
  select p.id,
         p.code,
         p.name,
         coalesce(p.has_bom, false) as flag_hien_tai,
         exists (
           select 1 from public.bom b
            where b.tenant_id = p.tenant_id
              and b.is_active
              and (
                (p.bom_code is not null and b.code = p.bom_code)
                or (p.bom_code is null and b.product_id = p.id)
              )
              and exists (select 1 from public.bom_items bi where bi.bom_id = b.id)
              and not exists (
                select 1 from public.bom_items bi
                 where bi.bom_id = b.id and bi.material_id = p.id
              )
         ) as bom_thuc_te
    from public.products p
   where p.tenant_id = (select tenant_id from target)
)
select 'P1_TENANT_DUNG' as muc,
       case when exists (select 1 from public.tenants t join target x on x.tenant_id = t.id) then true else false end as dat,
       jsonb_build_object('tenant_id', (select tenant_id from target)) as chi_tiet
union all
select 'P2_CO_BOM_LECH_FLAG', count(*) = 0,
       jsonb_build_object('so_sku_lech', count(*), 'mau', coalesce(jsonb_agg(jsonb_build_object('ma', code, 'ten', name, 'flag', flag_hien_tai, 'bom_thuc_te', bom_thuc_te) order by code) filter (where flag_hien_tai is distinct from bom_thuc_te), '[]'::jsonb))
  from expected
union all
select 'P3_BOM_TU_CHUA_SKU', count(*) = 0,
       jsonb_build_object('so_bom', count(*), 'mau', coalesce(jsonb_agg(jsonb_build_object('bom_id', b.id, 'ten', b.name, 'sku_id', b.product_id) order by b.name), '[]'::jsonb))
  from public.bom b
  join target x on x.tenant_id = b.tenant_id
 where b.is_active
   and exists (select 1 from public.bom_items bi where bi.bom_id = b.id and bi.material_id = b.product_id);
