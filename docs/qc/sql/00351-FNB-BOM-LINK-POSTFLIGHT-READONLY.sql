-- 00351 POST-FLIGHT - CHI DOC. Khong sua du lieu.
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
                select 1 from public.bom_items bi where bi.bom_id = b.id and bi.material_id = p.id)
         ) as bom_thuc_te
    from public.products p
   where p.tenant_id = (select tenant_id from target)
)
select 'K1_KHONG_CON_LECH_FLAG' as muc,
       'DIEU_KIEN' as loai,
       count(*) = 0 as dat,
       jsonb_build_object('so_sku_lech', count(*)) as chi_tiet
  from expected
 where flag_hien_tai is distinct from bom_thuc_te
union all
select 'K2_HONG_TRA_XTB_CO_BOM',
       'DIEU_KIEN',
       coalesce((select bool_or(flag_hien_tai) from expected where code = 'SKU-HTR-001'), false)
       and exists (
         select 1
           from public.bom b
           join public.products p on p.id = b.product_id
           join public.branches br on br.id = b.branch_id
          where p.tenant_id = (select tenant_id from target)
            and p.code = 'SKU-HTR-001'
            and br.name = 'Xưởng Cà Phê - Xưởng Tư Búa'
            and b.is_active
            and (select count(*) from public.bom_items bi where bi.bom_id = b.id) = 3
       ),
       jsonb_build_object(
         'ma', 'SKU-HTR-001',
         'co_bom', coalesce((select bool_or(flag_hien_tai) from expected where code = 'SKU-HTR-001'), false),
         'bom_xtb_ba_dong', exists (
           select 1
             from public.bom b
             join public.products p on p.id = b.product_id
             join public.branches br on br.id = b.branch_id
            where p.tenant_id = (select tenant_id from target)
              and p.code = 'SKU-HTR-001'
              and br.name = 'Xưởng Cà Phê - Xưởng Tư Búa'
              and b.is_active
              and (select count(*) from public.bom_items bi where bi.bom_id = b.id) = 3
         )
       )
union all
select 'K3_TRIGGER_DA_CAI',
       'DIEU_KIEN',
       exists (select 1 from pg_trigger where tgrelid = 'public.bom'::regclass and tgname = 'trg_sync_product_bom_status_00351' and not tgisinternal)
       and exists (select 1 from pg_trigger where tgrelid = 'public.bom_items'::regclass and tgname = 'trg_sync_product_bom_status_item_00351' and not tgisinternal),
       jsonb_build_object('bom', exists (select 1 from pg_trigger where tgrelid = 'public.bom'::regclass and tgname = 'trg_sync_product_bom_status_00351' and not tgisinternal), 'bom_items', exists (select 1 from pg_trigger where tgrelid = 'public.bom_items'::regclass and tgname = 'trg_sync_product_bom_status_item_00351' and not tgisinternal));
