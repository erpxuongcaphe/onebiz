-- ============================================================
-- QC sổ lô FIFO - CHỈ ĐỌC, KHÔNG THAY ĐỔI DỮ LIỆU
-- ============================================================
-- Mục tiêu:
--   1. Tách chênh lệch thật khỏi trường hợp lô đã hết hạn bị màn hình bỏ sót.
--   2. Liệt kê đầy đủ lô và thời điểm cập nhật để truy nguyên chứng từ.
--
-- File chỉ có WITH/SELECT. Không có INSERT, UPDATE, DELETE, ALTER hay RPC.

with tenant_hien_tai as (
  select tenant_id
  from public.profiles
  where id = auth.uid()
),
ton_chi_nhanh as (
  select bs.tenant_id, bs.branch_id, bs.product_id,
         sum(coalesce(bs.quantity, 0))::numeric as ton_chi_nhanh
  from public.branch_stock bs
  join tenant_hien_tai t on t.tenant_id = bs.tenant_id
  where bs.variant_id is null
  group by bs.tenant_id, bs.branch_id, bs.product_id
),
theo_lo as (
  select pl.tenant_id, pl.branch_id, pl.product_id,
         sum(pl.current_qty) filter (where pl.status = 'active')::numeric
           as lo_dang_hoat_dong,
         sum(pl.current_qty) filter (where pl.status = 'expired')::numeric
           as lo_het_han,
         sum(pl.current_qty) filter (
           where pl.status in ('active', 'expired')
         )::numeric as tong_lo_con_trong_kho,
         count(*) filter (where pl.status = 'active') as so_lo_dang_hoat_dong,
         count(*) filter (where pl.status = 'expired') as so_lo_het_han,
         min(pl.expiry_date) filter (
           where pl.status in ('active', 'expired') and pl.current_qty > 0
         ) as han_som_nhat,
         max(pl.updated_at) as cap_nhat_lo_gan_nhat
  from public.product_lots pl
  join tenant_hien_tai t on t.tenant_id = pl.tenant_id
  group by pl.tenant_id, pl.branch_id, pl.product_id
),
so_kho as (
  select sm.tenant_id, sm.branch_id, sm.product_id,
         sum(case when sm.type = 'in' then sm.quantity else -sm.quantity end)::numeric
           as ton_theo_so_kho,
         max(sm.created_at) as phat_sinh_gan_nhat
  from public.stock_movements sm
  join tenant_hien_tai t on t.tenant_id = sm.tenant_id
  group by sm.tenant_id, sm.branch_id, sm.product_id
)
select
  b.name as chi_nhanh,
  p.code as ma_hang,
  p.name as ten_hang,
  p.unit as don_vi,
  tc.ton_chi_nhanh,
  coalesce(sk.ton_theo_so_kho, 0) as ton_theo_so_kho,
  coalesce(tl.lo_dang_hoat_dong, 0) as lo_dang_hoat_dong,
  coalesce(tl.lo_het_han, 0) as lo_het_han,
  coalesce(tl.tong_lo_con_trong_kho, 0) as tong_lo_con_trong_kho,
  tc.ton_chi_nhanh - coalesce(tl.lo_dang_hoat_dong, 0)
    as lech_neu_chi_tinh_lo_active,
  tc.ton_chi_nhanh - coalesce(tl.tong_lo_con_trong_kho, 0)
    as lech_lo_thuc,
  coalesce(tl.so_lo_dang_hoat_dong, 0) as so_lo_dang_hoat_dong,
  coalesce(tl.so_lo_het_han, 0) as so_lo_het_han,
  tl.han_som_nhat,
  tl.cap_nhat_lo_gan_nhat,
  sk.phat_sinh_gan_nhat
from ton_chi_nhanh tc
join public.products p on p.id = tc.product_id
join public.branches b on b.id = tc.branch_id
left join theo_lo tl
  on tl.tenant_id = tc.tenant_id
 and tl.branch_id = tc.branch_id
 and tl.product_id = tc.product_id
left join so_kho sk
  on sk.tenant_id = tc.tenant_id
 and sk.branch_id = tc.branch_id
 and sk.product_id = tc.product_id
where abs(tc.ton_chi_nhanh - coalesce(tl.lo_dang_hoat_dong, 0)) > 0.01
order by abs(tc.ton_chi_nhanh - coalesce(tl.lo_dang_hoat_dong, 0)) desc;
