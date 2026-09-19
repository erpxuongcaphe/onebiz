-- 00391: Read-only provenance audit for F&B stock movements at Xưởng Tư Búa.
--
-- Purpose: investigate existing F&B stock-card movements before any supply
-- catalog enforcement is enabled. This NEVER writes stock, documents, prices,
-- BOMs, catalog assignments, branch settings, or historical data.
--
-- A row without an internal-sale link is not automatically an error: it can
-- be a controlled adjustment, a legacy/test receipt, or another valid source.
-- Review its reference type and source document before deciding any action.

with tham_so as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id,
         'CNH-XTB'::text as ma_chi_nhanh
),
chi_nhanh as (
  select b.id, b.code, b.name
    from public.branches b
    join tham_so t on t.tenant_id = b.tenant_id
   where b.code = t.ma_chi_nhanh
     and b.is_active
),
thanh_phan_fnb as (
  select distinct bi.material_id as product_id
    from public.products mon
    join tham_so t on t.tenant_id = mon.tenant_id
    join public.bom b
      on b.tenant_id = t.tenant_id
     and b.product_id = mon.id
     and b.is_active
    join public.bom_items bi on bi.bom_id = b.id
   where mon.product_type = 'sku'
     and mon.channel = 'fnb'
     and mon.is_active
),
su_kien_the_kho as (
  select
    sm.id as stock_movement_id,
    sm.created_at,
    sm.type as loai_bien_dong,
    sm.quantity as so_luong,
    sm.reference_type,
    sm.reference_id,
    p.code as ma_sku_retail,
    p.name as ten_sku_retail,
    p.unit as don_vi,
    noi_bo.id as internal_sale_id,
    noi_bo.code as ma_phieu_cap_noi_bo,
    noi_bo.status as trang_thai_phieu_cap,
    pn.code as ma_phieu_nhap,
    hd.code as ma_hoa_don
  from public.stock_movements sm
  join tham_so t on t.tenant_id = sm.tenant_id
  join chi_nhanh cn on cn.id = sm.branch_id
  join thanh_phan_fnb tp on tp.product_id = sm.product_id
  join public.products p on p.id = sm.product_id
  left join public.internal_sales noi_bo
    on noi_bo.tenant_id = sm.tenant_id
   and (noi_bo.input_invoice_id = sm.reference_id or noi_bo.invoice_id = sm.reference_id)
  left join public.input_invoices pn on pn.id = sm.reference_id
  left join public.invoices hd on hd.id = sm.reference_id
)
select
  created_at as thoi_gian,
  ma_sku_retail,
  ten_sku_retail,
  don_vi,
  loai_bien_dong,
  so_luong,
  reference_type as loai_tham_chieu,
  coalesce(ma_phieu_cap_noi_bo, ma_phieu_nhap, ma_hoa_don, reference_id::text) as chung_tu_nguon,
  ma_phieu_cap_noi_bo,
  trang_thai_phieu_cap,
  case
    when internal_sale_id is not null and trang_thai_phieu_cap = 'completed'
      then 'Khớp phiếu cấp nội bộ hoàn tất'
    when internal_sale_id is not null
      then 'Có liên kết phiếu cấp nhưng cần rà trạng thái'
    when loai_tham_chieu = 'bom_consume'
      then 'Xuất theo BOM F&B; đối chiếu hóa đơn bán khi cần'
    when loai_tham_chieu in ('invoice_void', 'return_bom_restore')
      then 'Hoàn kho F&B từ hủy/trả hóa đơn'
    when loai_tham_chieu in ('inventory_check', 'initial_stock_reset', 'stock_adjustment')
      then 'Tồn đầu hoặc điều chỉnh; cần biên bản/ý nghĩa vận hành rõ ràng'
    else 'Không gắn phiếu cấp nội bộ; rà loại tham chiếu và chứng từ nguồn'
  end as ket_luan_ra_soat
from su_kien_the_kho
order by created_at desc, ma_sku_retail, stock_movement_id;

-- Expected review practice:
-- 1) completed internal-sale references are normal supply evidence;
-- 2) BOM consumption and paired void/return rows are normal F&B operations;
-- 3) opening/adjustment rows need an auditable operational explanation;
-- 4) never delete, reverse, or recreate historical movements from this report.
