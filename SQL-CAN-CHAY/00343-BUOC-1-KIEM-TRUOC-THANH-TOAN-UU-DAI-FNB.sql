-- ============================================================================
-- 00343 BUOC 1 - KIEM TRUOC (CHI DOC)
--
-- Muc dich: doi chieu cac ham dang CAI TREN PRODUCTION truoc khi tao V3.
-- File nay chi doc pg_proc / pg_namespace va dem kitchen_orders; KHONG ghi
-- du lieu, KHONG tao ham, KHONG doi quyen, KHONG nap lai schema.
--
-- Chay CA FILE trong Supabase SQL Editor va gui lai cac bang P1-P4.
-- Neu bat ky dong P1 co trang_thai = LECH hoac P2 co V3 ton tai, DUNG LAI.
-- ============================================================================

with ham_yeu_cau(ten, chu_ky, van_tay_ky_vong) as (
  values
    ('fnb_complete_payment_atomic_v2',
     'public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)',
     'f2e66083df4f27b461524c6658c6a44a'),
    ('fnb_complete_payment_atomic',
     'public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)',
     '70de07951741ffdb4d13a82fcfc77d30'),
    ('apply_coupon_atomic',
     'public.apply_coupon_atomic(text,uuid,uuid,numeric,uuid)',
     '1c87209fdf3cbd69174395181eae5556'),
    ('increment_promotion_usage',
     'public.increment_promotion_usage(uuid)',
     'dcb441f9c088db438f5ed88a772bdb82'),
    ('validate_coupon',
     'public.validate_coupon(text,numeric,uuid)',
     'a9eabedde5fdc1800db9b2d91ecf37e5'),
    ('verify_otp_authorization',
     'public.verify_otp_authorization(uuid,text,uuid,uuid)',
     null)
), ket_qua as (
  select
    h.ten,
    h.chu_ky,
    h.van_tay_ky_vong,
    to_regprocedure(h.chu_ky) as oid
  from ham_yeu_cau h
)
select
  'P1_HAM_TIEN_DE' as muc,
  ten,
  chu_ky,
  case when oid is null then null else md5(pg_get_functiondef(oid)) end as van_tay_thuc_te,
  case
    when oid is null then 'LECH - KHONG_TIM_THAY'
    when van_tay_ky_vong is not null
      and md5(pg_get_functiondef(oid)) <> van_tay_ky_vong then 'LECH - VAN_TAY'
    else 'DAT'
  end as trang_thai,
  case when oid is null then null else pg_get_userbyid(p.proowner) end as chu_so_huu,
  case when oid is null then null else p.prosecdef end as security_definer
from ket_qua k
left join pg_proc p on p.oid = k.oid
order by ten;

select
  'P2_V3_CHUA_TON_TAI' as muc,
  to_regprocedure(
    'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
  ) is null as dat;

with ham as (
  select p.oid, p.proacl, p.proowner
  from pg_proc p
  where p.oid = to_regprocedure(
    'public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)'
  )
)
select
  'P3_QUYEN_V2_HIEN_TAI' as muc,
  has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_goi_duoc,
  has_function_privilege('anon', oid, 'EXECUTE') as anon_goi_duoc,
  exists (
    select 1
    from aclexplode(coalesce(proacl, acldefault('f', proowner))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) as public_goi_duoc
from ham;

select
  'P4_THONG_TIN_DON_BEP' as muc,
  count(*) as tong_don_bep,
  count(*) filter (where invoice_id is not null) as da_thanh_toan,
  count(*) filter (where invoice_id is null) as chua_thanh_toan
from public.kitchen_orders;
