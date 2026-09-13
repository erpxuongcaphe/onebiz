-- Read-only preflight for 00378. No schema or business data is changed.
with expected(table_name, column_name) as (
  values
    ('products','stock'), ('products','min_stock'), ('products','max_stock'),
    ('branch_stock','quantity'), ('branch_stock','reserved'),
    ('stock_movements','quantity'),
    ('inventory_check_items','system_stock'),
    ('inventory_check_items','actual_stock'),
    ('inventory_check_items','difference')
), columns_now as (
  select c.table_name, c.column_name, c.numeric_precision, c.numeric_scale
    from information_schema.columns c
    join expected e using (table_name, column_name)
   where c.table_schema = 'public' and c.data_type = 'numeric'
)
select 'P1_CAC_COT_TON_KHO_SAN_SANG' as muc, 'DIEU_KIEN' as loai,
       (select count(*) from columns_now) = 9 as dat,
       jsonb_build_object('so_cot', (select count(*) from columns_now)) as chi_tiet
union all
select 'P2_00378_CHUA_CAI', 'DIEU_KIEN',
       (select bool_and(numeric_scale = 2) from columns_now),
       jsonb_build_object('scale_hien_tai',
         (select jsonb_agg(distinct numeric_scale) from columns_now))
union all
select 'P3_BOM_VA_FIFO_DA_DUNG_4_SO_LE', 'DIEU_KIEN',
       (select numeric_scale = 4 from information_schema.columns
         where table_schema='public' and table_name='bom_items' and column_name='quantity')
       and
       (select numeric_scale = 4 from information_schema.columns
         where table_schema='public' and table_name='product_lots' and column_name='current_qty'),
       jsonb_build_object('muc_tieu', 'dong bo stock ledger voi BOM va FIFO')
union all
select 'P4_GUARD_CAP_NHAT_TON_KHO_SAN_SANG', 'DIEU_KIEN',
       exists (
         select 1 from pg_trigger
          where tgrelid = 'public.products'::regclass
            and tgname = 'trg_guard_direct_product_stock_update_00288'
            and not tgisinternal
       ),
       jsonb_build_object('trigger', 'trg_guard_direct_product_stock_update_00288')
union all
select 'I1_HOA_DON_UAT_CHUNG_MINH_LAM_TRON', 'THONG_TIN', null,
       jsonb_build_object(
         'hoa_don', 'HD001620',
         'cac_luong_tru', coalesce((
           select jsonb_agg(jsonb_build_object('ma', p.code, 'so_luong', sm.quantity)
                            order by p.code, sm.quantity)
             from public.invoices i
             join public.stock_movements sm on sm.reference_id = i.id
             join public.products p on p.id = sm.product_id
            where i.code = 'HD001620' and sm.reference_type = 'bom_consume'
         ), '[]'::jsonb)
       );
