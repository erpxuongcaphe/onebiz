-- PREFLIGHT F&B KHUYEN MAI / THANH TOAN
-- READ-ONLY: This file contains exactly one SELECT statement. It does not
-- create, change, or call any business object. Paste the tenant UUID once
-- below. Leaving the placeholder unchanged intentionally stops at UUID cast.
--
-- Purpose:
--   1. Read the exact production functions before any payment hardening.
--   2. Show which promotion checks are present in the server function body.
--   3. List active F&B promotion configuration for one tenant only.
--
-- Important: text markers are evidence to review, not a security verdict.

with tt as (
  select 'DAN_TENANT_ID_VAO_DAY'::uuid as tenant_id
),
tenant_duoc_chon as (
  select t.id, t.name
  from public.tenants t
  join tt on tt.tenant_id = t.id
),
ham as (
  select
    p.oid,
    p.proname,
    pg_get_function_identity_arguments(p.oid) as chu_ky,
    md5(pg_get_functiondef(p.oid)) as van_tay_md5,
    p.prosecdef as security_definer,
    l.lanname as ngon_ngu,
    regexp_replace(lower(pg_get_functiondef(p.oid)), E'\\s+', ' ', 'g') as than_ham
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname = any (array[
      'fnb_complete_payment_atomic_v2',
      'fnb_complete_payment_atomic',
      'increment_promotion_usage',
      'apply_coupon_atomic',
      'validate_coupon',
      'fnb_send_to_kitchen_atomic_v2'
    ])
),
payment_v2 as (
  select h.*
  from ham h
  where h.oid = to_regprocedure(
    'public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)'
  )
),
payment_goc as (
  select h.*
  from ham h
  where h.oid = to_regprocedure(
    'public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'
  )
),
payment_markers as (
  select
    count(*) as so_ban_dung_chu_ky,
    coalesce(bool_or(than_ham like '%auth.uid%' and than_ham like '%get_user_tenant_id%'), false) as co_xac_thuc,
    coalesce(bool_or(than_ham like '%user_has_branch_access%'), false) as co_kiem_chi_nhanh,
    coalesce(bool_or(than_ham like '%p.channel%' and than_ham like '%fnb%' and than_ham like '%both%'), false) as co_kiem_kenh,
    coalesce(bool_or(than_ham like '%p.branch_ids%'), false) as co_kiem_chi_nhanh_km,
    coalesce(bool_or(than_ham like '%usage_limit%' and than_ham like '%usage_count%'), false) as co_kiem_luot_dung,
    coalesce(bool_or(than_ham like '%min_order_amount%'), false) as co_kiem_don_toi_thieu,
    coalesce(bool_or(than_ham like '%time_start%' and than_ham like '%time_end%'), false) as co_kiem_khung_gio,
    coalesce(bool_or(than_ham like '%days_of_week%'), false) as co_kiem_thu,
    coalesce(bool_or(than_ham like '%applies_to%' and than_ham like '%applies_to_ids%'), false) as co_kiem_mat_hang,
    coalesce(bool_or(than_ham like '%p.value%' and than_ham like '%p.type%'), false) as co_tinh_lai_gia_tri_km,
    coalesce(bool_or(than_ham like '%validate_coupon%'), false) as co_tinh_lai_coupon,
    coalesce(bool_or(than_ham like '%increment_promotion_usage%'), false) as co_tang_luot_dung,
    coalesce(bool_or(than_ham like '%promotion_discount = coalesce(p_promotion_discount%'), false) as ghi_giam_gia_tu_tham_so,
    coalesce(bool_or(than_ham like '%coalesce(p_coupon_discount%'), false) as dung_giam_coupon_tu_tham_so
  from payment_v2
),
payment_goc_markers as (
  select
    count(*) as so_ban_dung_chu_ky,
    coalesce(bool_or(than_ham like '%auth.uid%' and than_ham like '%get_user_tenant_id%'), false) as co_xac_thuc,
    coalesce(bool_or(than_ham like '%user_has_branch_access%'), false) as co_kiem_chi_nhanh,
    coalesce(bool_or(than_ham like '%pos_fnb.discount%'), false) as co_kiem_quyen_giam_gia,
    coalesce(bool_or(than_ham like '%verify_otp_authorization%'), false) as co_kiem_otp_tai_server,
    coalesce(bool_or(than_ham like '%p_discount_amount%'), false) as nhan_so_tien_giam_tu_client
  from payment_goc
),
coupon_markers as (
  select
    count(*) as so_ban,
    coalesce(bool_or(than_ham like '%is_active%' and than_ham like '%start_date%' and than_ham like '%end_date%'), false) as co_kiem_hieu_luc,
    coalesce(bool_or(than_ham like '%max_uses%' and than_ham like '%used_count%'), false) as co_kiem_gioi_han_luot,
    coalesce(bool_or(than_ham like '%max_uses_per_customer%'), false) as co_kiem_gioi_han_khach,
    coalesce(bool_or(than_ham like '%p_discount_amount%'), false) as nhan_so_tien_giam_tu_client
  from ham
  where proname = 'apply_coupon_atomic'
),
khuyen_mai_fnb_dang_bat as (
  select
    p.id,
    p.name,
    p.type,
    p.value,
    p.min_order_amount,
    p.channel,
    p.branch_ids,
    p.usage_limit,
    p.usage_count,
    p.time_start,
    p.time_end,
    p.days_of_week,
    p.applies_to,
    p.applies_to_ids,
    p.gift_product_ids,
    p.start_date,
    p.end_date
  from public.promotions p
  join tenant_duoc_chon t on t.id = p.tenant_id
  where p.is_active
    and p.start_date <= now()
    and p.end_date >= now()
    and p.channel in ('fnb', 'both')
),
don_fnb_hien_co as (
  select
    count(*) as so_don_bep,
    count(*) filter (where ko.invoice_id is not null) as so_don_bep_da_co_hoa_don,
    count(*) filter (where ko.invoice_id is null) as so_don_bep_chua_thanh_toan
  from public.kitchen_orders ko
  join tenant_duoc_chon t on t.id = ko.tenant_id
),
delivery_markers as (
  select
    coalesce(bool_or(than_ham like '%fnb_delivery_platforms%'), false) as doc_cau_hinh_san_tu_tenant,
    coalesce(bool_or(than_ham like '%delivery_platform_disabled%'), false) as chan_san_da_tat,
    coalesce(bool_or(than_ham like '%platform_commission_override_denied%'), false) as chan_tu_y_doi_phi_san
  from ham
  where proname = 'fnb_send_to_kitchen_atomic_v2'
)
select
  'A0_TENANT' as muc,
  case when exists (select 1 from tenant_duoc_chon) then 'THONG_TIN' else 'CAN_DUNG' end as loai,
  jsonb_build_object(
    'tenant_found', exists (select 1 from tenant_duoc_chon),
    'tenant_name', (select name from tenant_duoc_chon)
  ) as chi_tiet
union all
select
  'A1_HAM_DANG_CAI' as muc,
  'THONG_TIN' as loai,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'ten_ham', proname,
          'chu_ky', chu_ky,
          'van_tay_md5', van_tay_md5,
          'security_definer', security_definer,
          'ngon_ngu', ngon_ngu
        ) order by proname, chu_ky
      )
      from ham
    ),
    '[]'::jsonb
  ) as chi_tiet
union all
select
  'A2_THANH_TOAN_FNB_V2' as muc,
  case when so_ban_dung_chu_ky = 1 then 'THONG_TIN' else 'CAN_DUNG' end as loai,
  jsonb_build_object(
    'so_ban_dung_chu_ky_ky_vong', so_ban_dung_chu_ky,
    'co_xac_thuc_va_tenant', co_xac_thuc,
    'co_kiem_chi_nhanh_nguoi_dung', co_kiem_chi_nhanh,
    'co_kiem_kenh_fnb', co_kiem_kenh,
    'co_kiem_chi_nhanh_ap_dung_km', co_kiem_chi_nhanh_km,
    'co_kiem_gioi_han_luot_dung', co_kiem_luot_dung,
    'co_kiem_gia_tri_don_toi_thieu', co_kiem_don_toi_thieu,
    'co_kiem_khung_gio', co_kiem_khung_gio,
    'co_kiem_thu_trong_tuan', co_kiem_thu,
    'co_kiem_mat_hang_nhom_hang', co_kiem_mat_hang,
    'co_tinh_lai_gia_tri_khuyen_mai_tu_server', co_tinh_lai_gia_tri_km,
    'co_tinh_lai_coupon_tu_server', co_tinh_lai_coupon,
    'co_tang_luot_dung_trong_transaction', co_tang_luot_dung,
    'ghi_promotion_discount_tu_tham_so_client', ghi_giam_gia_tu_tham_so,
    'dung_coupon_discount_tu_tham_so_client', dung_giam_coupon_tu_tham_so,
    'luu_y', 'Cac cot co_kiem la dau vet trong than ham dang cai, khong tu dong ket luan an toan. Cot ghi/dung tham so client can duoc doi chieu truoc khi viet migration.'
  ) as chi_tiet
from payment_markers
union all
select
  'A2B_THANH_TOAN_FNB_GOC' as muc,
  case when so_ban_dung_chu_ky = 1 then 'THONG_TIN' else 'CAN_DUNG' end as loai,
  jsonb_build_object(
    'so_ban_dung_chu_ky_ky_vong', so_ban_dung_chu_ky,
    'co_xac_thuc_va_tenant', co_xac_thuc,
    'co_kiem_chi_nhanh_nguoi_dung', co_kiem_chi_nhanh,
    'co_kiem_quyen_giam_gia', co_kiem_quyen_giam_gia,
    'co_kiem_otp_tai_server', co_kiem_otp_tai_server,
    'nhan_so_tien_giam_tu_client', nhan_so_tien_giam_tu_client,
    'luu_y', 'Muc nay chi cho thay gate hien co cua thanh toan goc. Chinh sach giam gia thu cong va OTP se duoc tach rieng neu can sua.'
  ) as chi_tiet
from payment_goc_markers
union all
select
  'A2C_COUPON_ATOMIC' as muc,
  case when so_ban = 1 then 'THONG_TIN' else 'CAN_DUNG' end as loai,
  jsonb_build_object(
    'so_ban_apply_coupon_atomic', so_ban,
    'co_kiem_hieu_luc', co_kiem_hieu_luc,
    'co_kiem_gioi_han_luot', co_kiem_gioi_han_luot,
    'co_kiem_gioi_han_theo_khach', co_kiem_gioi_han_khach,
    'nhan_so_tien_giam_tu_client', nhan_so_tien_giam_tu_client,
    'luu_y', 'Coupon duoc tach ra de xem helper dang cai co tu kiem dieu kien hay chi nhan gia tri tu client.'
  ) as chi_tiet
from coupon_markers
union all
select
  'A3_KHUYEN_MAI_FNB_DANG_CO_HIEU_LUC' as muc,
  'THONG_TIN' as loai,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'ten', name,
          'loai', type,
          'gia_tri', value,
          'don_toi_thieu', min_order_amount,
          'kenh', channel,
          'chi_nhanh_ap_dung', branch_ids,
          'gioi_han_luot', usage_limit,
          'da_dung', usage_count,
          'khung_gio', jsonb_build_object('tu', time_start, 'den', time_end),
          'thu_ap_dung', days_of_week,
          'pham_vi_hang', applies_to,
          'id_pham_vi_hang', applies_to_ids,
          'qua_tang', gift_product_ids,
          'bat_dau', start_date,
          'ket_thuc', end_date
        ) order by name
      )
      from khuyen_mai_fnb_dang_bat
    ),
    '[]'::jsonb
  ) as chi_tiet
union all
select
  'A4_DON_FNB_HIEN_CO' as muc,
  'THONG_TIN' as loai,
  jsonb_build_object(
    'so_don_bep', so_don_bep,
    'so_don_bep_da_co_hoa_don', so_don_bep_da_co_hoa_don,
    'so_don_bep_chua_thanh_toan', so_don_bep_chua_thanh_toan
  ) as chi_tiet
from don_fnb_hien_co
union all
select
  'A5_GUI_BEP_VA_PHI_SAN' as muc,
  'THONG_TIN' as loai,
  jsonb_build_object(
    'doc_cau_hinh_san_tu_tenant', doc_cau_hinh_san_tu_tenant,
    'chan_san_da_tat', chan_san_da_tat,
    'chan_tu_y_doi_phi_san', chan_tu_y_doi_phi_san,
    'luu_y', 'Muc nay chi doi chieu dau vet cua ham gui bep dang cai; khong thay doi cau hinh san.'
  ) as chi_tiet
from delivery_markers
order by muc;
