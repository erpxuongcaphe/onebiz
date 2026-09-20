-- 00392: Read-only inventory of F&B UAT residue at Xưởng Tư Búa.
--
-- Safety contract:
--   * scopes every operational check to tenant + branch code CNH-XTB;
--   * never mutates stock, finance, KDS, documents, products, BOMs or setup;
--   * does not infer that every XTB record is disposable test data;
--   * reports configuration separately from operational and audit history.

with tham_so as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id,
         'CNH-XTB'::text as ma_chi_nhanh
),
chi_nhanh as (
  select b.id, b.code, b.name
    from public.branches b
    join tham_so t on t.tenant_id = b.tenant_id
   where b.code = t.ma_chi_nhanh
),
ton_hien_tai as (
  select
    count(*) filter (where abs(coalesce(bs.quantity, 0)) > 0.00005) as so_sku_con_ton,
    coalesce(sum(abs(bs.quantity)) filter (where abs(coalesce(bs.quantity, 0)) > 0.00005), 0) as tong_tri_tuyet_doi
  from public.branch_stock bs
  join chi_nhanh cn on cn.id = bs.branch_id
  join tham_so t on t.tenant_id = bs.tenant_id
),
kds_dang_mo as (
  select count(*) as so_don
  from public.kitchen_orders ko
  join chi_nhanh cn on cn.id = ko.branch_id
  join tham_so t on t.tenant_id = ko.tenant_id
  -- `served` is the terminal KDS state; `completed` is retained for legacy rows.
  where ko.status not in ('completed', 'cancelled', 'served')
),
hoa_don_fnb_con_hieu_luc as (
  select count(*) as so_hoa_don,
         coalesce(sum(i.total), 0) as tong_tien
  from public.invoices i
  join chi_nhanh cn on cn.id = i.branch_id
  join tham_so t on t.tenant_id = i.tenant_id
  where i.source = 'fnb'
    and i.status <> 'cancelled'
    and i.deleted_at is null
    and i.voided_at is null
    -- A completed F&B invoice is no longer operationally active once every
    -- sold line has been returned. Keep its accounting history, but do not
    -- flag it as an unfinished UAT sale.
    and exists (
      select 1
      from public.invoice_items ii
      where ii.invoice_id = i.id
        and coalesce(ii.returned_qty, 0) < ii.quantity
    )
),
phieu_noi_bo_hoan_tat as (
  select count(*) as so_phieu,
         coalesce(sum(s.total), 0) as tong_tien
  from public.internal_sales s
  join chi_nhanh cn on cn.id = s.to_branch_id
  join tham_so t on t.tenant_id = s.tenant_id
  where s.status = 'completed'
),
kiem_kho as (
  select count(*) as so_phieu,
         count(*) filter (where lower(coalesce(ic.note, '')) similar to '%(uat|test|thử nghiệm|nghiệm thu)%') as so_phieu_co_dau_uat,
         jsonb_agg(
           jsonb_build_object(
             'ma', ic.code,
             'trang_thai', ic.status,
             'ghi_chu', ic.note,
             'tao_luc', ic.created_at
           ) order by ic.created_at desc
         ) as danh_sach
  from public.inventory_checks ic
  join chi_nhanh cn on cn.id = ic.branch_id
  join tham_so t on t.tenant_id = ic.tenant_id
),
lich_su_the_kho_gon as (
  select coalesce(sum(g.so_dong), 0) as so_dong,
         coalesce(sum(g.nhap), 0) as tong_nhap,
         coalesce(sum(g.xuat), 0) as tong_xuat,
         coalesce(jsonb_object_agg(g.reference_type, g.so_dong), '{}'::jsonb) as theo_nguon
  from (
    select coalesce(sm.reference_type, '(khong co)') as reference_type,
           count(*) as so_dong,
           sum(case when sm.type = 'in' then sm.quantity else 0 end) as nhap,
           sum(case when sm.type = 'out' then sm.quantity else 0 end) as xuat
    from public.stock_movements sm
    join chi_nhanh cn on cn.id = sm.branch_id
    join tham_so t on t.tenant_id = sm.tenant_id
    group by coalesce(sm.reference_type, '(khong co)')
  ) g
),
cau_hinh_cap_hang as (
  select count(c.product_id) as so_sku_duoc_duyet,
         coalesce(bool_or(s.enforcement_enabled), false) as dang_bat_chan_danh_muc
  from chi_nhanh cn
  left join public.fnb_supply_catalog c on c.branch_id = cn.id
  left join public.fnb_supply_branch_scopes s on s.branch_id = cn.id
)
select * from (
  select 1 as thu_tu,
         'K1_DUNG_CHI_NHANH_THU_NGHIEM'::text as muc,
         'DIEU_KIEN'::text as loai,
         ((select count(*) from chi_nhanh) = 1) as dat,
         jsonb_build_object(
           'ma_chi_nhanh', (select code from chi_nhanh),
           'ten_chi_nhanh', (select name from chi_nhanh)
         ) as chi_tiet
  union all
  select 2, 'K2_KHONG_CON_TON_THU', 'DIEU_KIEN', t.so_sku_con_ton = 0,
         jsonb_build_object('so_sku_con_ton', t.so_sku_con_ton,
                            'tong_so_luong_tuyet_doi', t.tong_tri_tuyet_doi)
    from ton_hien_tai t
  union all
  select 3, 'K3_KHONG_CON_DON_KDS_DANG_MO', 'DIEU_KIEN', k.so_don = 0,
         jsonb_build_object('so_don_dang_mo', k.so_don)
    from kds_dang_mo k
  union all
  select 4, 'K4_HOA_DON_FNB_CON_HIEU_LUC', 'DIEU_KIEN', h.so_hoa_don = 0,
         jsonb_build_object('so_hoa_don', h.so_hoa_don, 'tong_tien', h.tong_tien,
                            'luu_y', 'Neu > 0, phai doi chieu nghiep vu; khong xoa vat ly')
    from hoa_don_fnb_con_hieu_luc h
  union all
  select 5, 'I1_CAU_HINH_CAP_HANG_THAT', 'THONG_TIN', null,
         jsonb_build_object('so_sku_duoc_duyet', c.so_sku_duoc_duyet,
                            'dang_bat_chan_danh_muc', c.dang_bat_chan_danh_muc,
                            'phan_loai', 'GIU_LAI_CAU_HINH_VAN_HANH')
    from cau_hinh_cap_hang c
  union all
  select 6, 'I2_PHIEU_CAP_NOI_BO_HOAN_TAT', 'THONG_TIN', null,
         jsonb_build_object('so_phieu', p.so_phieu, 'tong_tien', p.tong_tien,
                            'phan_loai', 'LICH_SU_KE_TOAN_KHO_KHONG_XOA')
    from phieu_noi_bo_hoan_tat p
  union all
  select 7, 'I3_LICH_SU_KIEM_KHO', 'THONG_TIN', null,
         jsonb_build_object('so_phieu', k.so_phieu,
                            'so_phieu_co_dau_uat', k.so_phieu_co_dau_uat,
                            'danh_sach', coalesce(k.danh_sach, '[]'::jsonb),
                            'phan_loai', 'AUDIT_GIU_LAI_CHO_DEN_KHI_CHOT_NGHIEM_THU')
    from kiem_kho k
  union all
  select 8, 'I4_LICH_SU_THE_KHO', 'THONG_TIN', null,
         jsonb_build_object('so_dong', l.so_dong,
                            'tong_nhap', l.tong_nhap,
                            'tong_xuat', l.tong_xuat,
                            'theo_nguon', l.theo_nguon,
                            'phan_loai', 'SO_CAI_BAT_BIEN_KHONG_XOA')
    from lich_su_the_kho_gon l
) bao_cao
order by thu_tu;

-- Interpretation:
--   K2/K3 must be true before considering XTB operationally clean.
--   K4 false does not authorize deletion: reconcile each valid invoice first.
--   I1 is real go-live configuration and must be retained.
--   I2/I3/I4 are accounting/stock audit history; archive or exclude UAT from
--   default reports later, but do not physically delete from this report.
