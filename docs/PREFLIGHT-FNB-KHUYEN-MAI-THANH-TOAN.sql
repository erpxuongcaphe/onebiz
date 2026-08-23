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
    p.proowner,
    p.proacl,
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
      'fnb_send_to_kitchen_atomic_v2',
      '_fnb_send_to_kitchen_impl_00303'
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
payment_targets as (
  select *
  from (values
    (
      'thanh_toan_v2',
      to_regprocedure(
        'public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)'
      )
    ),
    (
      'thanh_toan_goc',
      to_regprocedure(
        'public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'
      )
    ),
    (
      'ap_dung_coupon',
      to_regprocedure('public.apply_coupon_atomic(text,uuid,uuid,numeric,uuid)')
    ),
    (
      'tang_luot_khuyen_mai',
      to_regprocedure('public.increment_promotion_usage(uuid)')
    ),
    (
      'kiem_coupon',
      to_regprocedure('public.validate_coupon(text,numeric,uuid)')
    )
  ) as v(vai_tro, oid)
),
payment_privileges as (
  select
    t.vai_tro,
    h.proname,
    h.chu_ky,
    h.security_definer,
    h.ngon_ngu,
    pg_get_userbyid(h.proowner) as chu_so_huu,
    coalesce(has_function_privilege('anon', h.oid, 'EXECUTE'), false) as anon_goi_duoc,
    coalesce(has_function_privilege('authenticated', h.oid, 'EXECUTE'), false) as authenticated_goi_duoc,
    coalesce(
      exists (
        select 1
        from aclexplode(coalesce(h.proacl, acldefault('f', h.proowner))) as a
        where a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      ),
      false
    ) as public_goi_duoc,
    coalesce(
      h.than_ham like '%public.fnb_complete_payment_atomic(%',
      false
    ) as thanh_toan_v2_goi_ham_goc
  from payment_targets t
  left join ham h on h.oid = t.oid
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
delivery_ham_dang_thi_hanh as (
  select case
    when exists (
      select 1
      from ham h
      where h.oid = to_regprocedure(
        'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
      )
        and h.than_ham like '%_fnb_send_to_kitchen_impl_00303%'
    ) then '_fnb_send_to_kitchen_impl_00303'
    else 'fnb_send_to_kitchen_atomic_v2'
  end as ten_ham
),
delivery_markers as (
  select
    (select ten_ham from delivery_ham_dang_thi_hanh) as ham_duoc_soi,
    coalesce(bool_or(than_ham like '%fnb_delivery_platforms%'), false) as doc_cau_hinh_san_tu_tenant,
    coalesce(bool_or(than_ham like '%delivery_platform_disabled%'), false) as chan_san_da_tat,
    coalesce(bool_or(than_ham like '%platform_commission_override_denied%'), false) as chan_tu_y_doi_phi_san
  from ham h
  join delivery_ham_dang_thi_hanh d on d.ten_ham = h.proname
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
  'A2D_QUYEN_GOI_TRUC_TIEP_THANH_TOAN' as muc,
  case when count(*) = 5 and count(*) filter (where proname is null) = 0 then 'THONG_TIN' else 'CAN_DUNG' end as loai,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'vai_tro', vai_tro,
        'ten_ham', proname,
        'chu_ky', chu_ky,
        'chu_so_huu', chu_so_huu,
        'security_definer', security_definer,
        'anon_goi_duoc', anon_goi_duoc,
        'authenticated_goi_duoc', authenticated_goi_duoc,
        'public_goi_duoc', public_goi_duoc,
        'thanh_toan_v2_goi_ham_goc', thanh_toan_v2_goi_ham_goc
      ) order by vai_tro
    ),
    '[]'::jsonb
  ) as chi_tiet
from payment_privileges
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
    'ham_duoc_soi', ham_duoc_soi,
    'doc_cau_hinh_san_tu_tenant', doc_cau_hinh_san_tu_tenant,
    'chan_san_da_tat', chan_san_da_tat,
    'chan_tu_y_doi_phi_san', chan_tu_y_doi_phi_san,
    'luu_y', 'Neu lop boc Size dang goi ham noi bo, preflight se soi ham noi bo thay vi chi soi lop boc. Khong thay doi cau hinh san.'
  ) as chi_tiet
from delivery_markers
order by muc;
