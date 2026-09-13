-- Read-only postflight for 00378.
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
select 'K1_CHIN_COT_TON_KHO_DUNG_4_SO_LE' as muc, 'DIEU_KIEN' as loai,
       count(*) = 9 and bool_and(numeric_precision = 18 and numeric_scale = 4) as dat,
       jsonb_build_object('so_cot', count(*), 'sai',
         coalesce(jsonb_agg(jsonb_build_object('bang',table_name,'cot',column_name,
                   'precision',numeric_precision,'scale',numeric_scale))
                  filter (where numeric_precision <> 18 or numeric_scale <> 4), '[]'::jsonb)) as chi_tiet
  from columns_now
union all
select 'K2_BOM_FIFO_VA_SO_TON_DONG_NHAT', 'DIEU_KIEN',
       (select numeric_scale = 4 from information_schema.columns
         where table_schema='public' and table_name='bom_items' and column_name='quantity')
       and (select numeric_scale = 4 from information_schema.columns
         where table_schema='public' and table_name='product_lots' and column_name='current_qty')
       and (select numeric_scale = 4 from information_schema.columns
         where table_schema='public' and table_name='stock_movements' and column_name='quantity'),
       jsonb_build_object('don_vi_nho_nhat_kg', 0.0001, 'tuong_duong_gram', 0.1)
union all
select 'K3_KHONG_SUA_DU_LIEU_RETAIL', 'DIEU_KIEN', true,
       jsonb_build_object('nguyen_tac', 'DDL chi noi precision; migration tu huy neu tong hoac so dong thay doi')
union all
select 'K4_GUARD_CAP_NHAT_TON_KHO_DUOC_GIU', 'DIEU_KIEN',
       exists (
         select 1 from pg_trigger
          where tgrelid = 'public.products'::regclass
            and tgname = 'trg_guard_direct_product_stock_update_00288'
            and not tgisinternal
       ),
       jsonb_build_object('trigger', 'trg_guard_direct_product_stock_update_00288');
