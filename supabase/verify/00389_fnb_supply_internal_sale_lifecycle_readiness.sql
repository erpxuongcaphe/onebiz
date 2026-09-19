-- 00389: Read-only audit of Retail -> F&B internal-sale posting.
--
-- This report NEVER writes stock, documents, prices, BOMs, catalog assignments
-- or branch configuration. It verifies the existing atomic lifecycle from the
-- immutable ledger events already posted for Xưởng Tư Búa.
--
-- A valid source leg can be either:
--   1) direct Retail SKU stock-out (reference_type = internal_sale), or
--   2) Retail BOM consumption of NVL (reference_type = bom_consume).
-- The receiving F&B branch must always receive the exact Retail SKU recorded
-- on the internal-sale line, with the same quantity.

with tham_so as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id,
         'CNH-XTB'::text as ma_chi_nhanh
),
chi_nhanh_nhan as (
  select b.id, b.code, b.name
    from public.branches b
    join tham_so t on t.tenant_id = b.tenant_id
   where b.code = t.ma_chi_nhanh
     and b.is_active
),
phieu_noi_bo as (
  select
    s.id as internal_sale_id,
    s.code as ma_phieu_noi_bo,
    s.from_branch_id,
    s.to_branch_id,
    s.invoice_id,
    s.input_invoice_id,
    s.status as trang_thai_noi_bo,
    s.created_at,
    b_xuat.code as ma_chi_nhanh_xuat,
    b_xuat.name as ten_chi_nhanh_xuat,
    b_nhan.code as ma_chi_nhanh_nhan,
    b_nhan.name as ten_chi_nhanh_nhan,
    hoa_don.code as ma_hoa_don_xuat,
    hoa_don.status as trang_thai_hoa_don_xuat,
    phieu_nhap.code as ma_hoa_don_nhap,
    phieu_nhap.status as trang_thai_hoa_don_nhap
  from public.internal_sales s
  join tham_so t on t.tenant_id = s.tenant_id
  join chi_nhanh_nhan cn on cn.id = s.to_branch_id
  join public.branches b_xuat on b_xuat.id = s.from_branch_id
  join public.branches b_nhan on b_nhan.id = s.to_branch_id
  left join public.invoices hoa_don on hoa_don.id = s.invoice_id
  left join public.input_invoices phieu_nhap on phieu_nhap.id = s.input_invoice_id
 where s.status = 'completed'
),
dong_noi_bo as (
  select
    pn.*,
    i.id as internal_sale_item_id,
    i.product_id,
    i.product_code,
    i.product_name,
    i.unit,
    i.quantity as so_luong_ban_noi_bo
  from phieu_noi_bo pn
  join public.internal_sale_items i on i.internal_sale_id = pn.internal_sale_id
),
nhap_fnb as (
  select
    d.internal_sale_item_id,
    coalesce(sum(sm.quantity) filter (
      where sm.branch_id = d.to_branch_id
        and sm.product_id = d.product_id
        and sm.type = 'in'
        and sm.reference_type = 'internal_sale'
        and sm.reference_id = d.input_invoice_id
    ), 0) as so_luong_nhap_fnb
  from dong_noi_bo d
  left join public.stock_movements sm
    on sm.tenant_id = (select tenant_id from tham_so)
   and sm.reference_id = d.input_invoice_id
 group by d.internal_sale_item_id
),
xuat_retail as (
  select
    d.internal_sale_item_id,
    count(sm.id) filter (
      where sm.branch_id = d.from_branch_id
        and sm.type = 'out'
        and sm.reference_id = d.invoice_id
        and sm.reference_type in ('internal_sale', 'bom_consume')
    ) as so_dong_xuat_retail,
    coalesce(sum(sm.quantity) filter (
      where sm.branch_id = d.from_branch_id
        and sm.product_id = d.product_id
        and sm.type = 'out'
        and sm.reference_type = 'internal_sale'
        and sm.reference_id = d.invoice_id
    ), 0) as so_luong_xuat_sku_truc_tiep,
    count(sm.id) filter (
      where sm.branch_id = d.from_branch_id
        and sm.type = 'out'
        and sm.reference_type = 'bom_consume'
        and sm.reference_id = d.invoice_id
    ) as so_dong_tieu_hao_bom_retail
  from dong_noi_bo d
  left join public.stock_movements sm
    on sm.tenant_id = (select tenant_id from tham_so)
   and sm.reference_id = d.invoice_id
 group by d.internal_sale_item_id
)
select
  d.ma_phieu_noi_bo,
  d.created_at as thoi_gian_tao,
  d.ma_chi_nhanh_xuat,
  d.ten_chi_nhanh_xuat,
  d.ma_chi_nhanh_nhan,
  d.ten_chi_nhanh_nhan,
  d.ma_hoa_don_xuat,
  d.trang_thai_hoa_don_xuat,
  d.ma_hoa_don_nhap,
  d.trang_thai_hoa_don_nhap,
  d.product_code as ma_sku_retail,
  d.product_name as ten_sku_retail,
  d.unit as don_vi,
  d.so_luong_ban_noi_bo,
  n.so_luong_nhap_fnb,
  x.so_luong_xuat_sku_truc_tiep,
  x.so_dong_tieu_hao_bom_retail,
  case
    when d.invoice_id is null or d.input_invoice_id is null
      then 'LỖI: thiếu chứng từ nguồn hoặc đích'
    when n.so_luong_nhap_fnb <> d.so_luong_ban_noi_bo
      then 'LỖI: tồn F&B chưa nhận đúng SKU hoặc sai số lượng'
    when x.so_luong_xuat_sku_truc_tiep = d.so_luong_ban_noi_bo
      then 'Đúng: Retail xuất trực tiếp SKU, F&B đã nhận đủ'
    when x.so_dong_tieu_hao_bom_retail > 0
      then 'Đúng: Retail tiêu hao NVL theo BOM, F&B đã nhận đủ SKU'
    when x.so_dong_xuat_retail = 0
      then 'LỖI: không có bút toán xuất Retail liên kết hóa đơn'
    else 'RÀ SOÁT: có xuất Retail nhưng không khớp đường đi đã biết'
  end as ket_qua_kiem_tra
from dong_noi_bo d
join nhap_fnb n on n.internal_sale_item_id = d.internal_sale_item_id
join xuat_retail x on x.internal_sale_item_id = d.internal_sale_item_id
order by d.created_at desc, d.ma_phieu_noi_bo desc, d.product_code;

-- Expected review practice:
--   1) No rows means no completed Retail -> Xưởng Tư Búa internal sale exists yet.
--   2) Every row must show one of the two “Đúng” outcomes before enabling a
--      strict supply catalog for this branch.
--   3) A “LỖI” or “RÀ SOÁT” row is evidence to investigate; do not create a
--      compensating movement or edit history from this report.
