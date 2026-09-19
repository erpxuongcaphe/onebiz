-- 00390: Read-only boundary report for Retail SKU sales vs F&B stock card.
-- Never writes products, prices, BOMs, stock, documents or catalog data.
with tham_so as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id,
         'CNH-XTB'::text as ma_chi_nhanh
),
chi_nhanh as (
  select b.id from public.branches b join tham_so t on t.tenant_id = b.tenant_id
   where b.code = t.ma_chi_nhanh and b.is_active
),
thanh_phan_fnb as (
  select distinct bi.material_id as product_id
    from public.products mon
    join tham_so t on t.tenant_id = mon.tenant_id
    join public.bom b on b.tenant_id = t.tenant_id and b.product_id = mon.id and b.is_active
    join public.bom_items bi on bi.bom_id = b.id
   where mon.product_type = 'sku' and mon.channel = 'fnb' and mon.is_active
),
sku_retail as (
  select p.id, p.code, p.name, p.unit
    from public.products p join thanh_phan_fnb tp on tp.product_id = p.id
   where p.product_type = 'sku' and coalesce(p.channel, 'retail') <> 'fnb' and p.is_active
),
ban_retail as (
  select ii.product_id, count(distinct i.id) as so_hoa_don_retail,
         coalesce(sum(ii.quantity), 0) as so_luong_ban_retail
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id
    join tham_so t on t.tenant_id = i.tenant_id
    left join public.internal_sales noi_bo on noi_bo.invoice_id = i.id
   where i.status <> 'cancelled' and noi_bo.id is null
   group by ii.product_id
),
cap_noi_bo_vao_quan as (
  select d.product_id, count(distinct s.id) as so_phieu_cap,
         coalesce(sum(d.quantity), 0) as so_luong_cap
    from public.internal_sales s
    join chi_nhanh cn on cn.id = s.to_branch_id
    join public.internal_sale_items d on d.internal_sale_id = s.id
    join tham_so t on t.tenant_id = s.tenant_id
   where s.status = 'completed'
   group by d.product_id
),
the_kho_fnb as (
  select sm.product_id,
         count(*) as so_dong_the_kho,
         coalesce(sum(sm.quantity) filter (where sm.type = 'in'), 0) as tong_nhap,
         coalesce(sum(sm.quantity) filter (where sm.type = 'out'), 0) as tong_xuat,
         coalesce(sum(case when sm.type = 'in' then sm.quantity when sm.type = 'out' then -sm.quantity else 0 end), 0) as ton_bien_dong
    from public.stock_movements sm
    join chi_nhanh cn on cn.id = sm.branch_id
    join tham_so t on t.tenant_id = sm.tenant_id
   group by sm.product_id
)
select r.code as ma_sku_retail, r.name as ten_sku_retail, r.unit as don_vi,
       coalesce(br.so_hoa_don_retail, 0) as so_hoa_don_ban_retail,
       coalesce(br.so_luong_ban_retail, 0) as so_luong_ban_retail,
       coalesce(cn.so_phieu_cap, 0) as so_phieu_cap_vao_fnb,
       coalesce(cn.so_luong_cap, 0) as so_luong_cap_vao_fnb,
       coalesce(tk.so_dong_the_kho, 0) as so_dong_the_kho_fnb,
       coalesce(tk.tong_nhap, 0) as tong_nhap_fnb,
       coalesce(tk.tong_xuat, 0) as tong_xuat_fnb,
       coalesce(tk.ton_bien_dong, 0) as ton_theo_the_kho_fnb,
       'Retail sales and F&B stock are independent ledgers; do not reconcile one from the other.' as nguyen_tac
  from sku_retail r
  left join ban_retail br on br.product_id = r.id
  left join cap_noi_bo_vao_quan cn on cn.product_id = r.id
  left join the_kho_fnb tk on tk.product_id = r.id
 order by r.code;

-- Read results as three separate facts:
-- Retail sales excludes internal-sale source invoices.
-- Internal supply shows completed documents received by Xưởng Tư Búa.
-- F&B stock card is branch-local and must never be replaced by Retail sales.
