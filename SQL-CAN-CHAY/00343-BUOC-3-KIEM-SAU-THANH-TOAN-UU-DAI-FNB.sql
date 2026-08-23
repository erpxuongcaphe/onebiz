-- ============================================================================
-- 00343 BUOC 3 - KIEM SAU (CHI DOC)
--
-- Chay SAU BUOC 2. File chi doc catalog va dem don; KHONG ghi du lieu.
-- SQL Editor chi hien ket qua cua SELECT cuoi, nen file dung MOT SELECT va
-- tra P1-P7 tren cung mot bang. P1-P6 phai co dat = true moi duoc chuyen
-- client sang V3. P7 chi la thong tin hien trang don bep.
-- ============================================================================

with v3 as (
  select p.oid, p.proowner, p.prosecdef, p.proacl
  from pg_proc p
  where p.oid = to_regprocedure(
    'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
  )
), don_bep as (
  select
    count(*) as tong_don_bep,
    count(*) filter (where invoice_id is not null) as da_thanh_toan,
    count(*) filter (where invoice_id is null) as chua_thanh_toan
  from public.kitchen_orders
)
select
  'P1_V3_DUNG_CHU_KY' as muc,
  count(*) = 1 as dat,
  jsonb_build_object('so_ham', count(*)) as chi_tiet
from v3

union all

select
  'P2_V3_OWNER_VA_DEFINER' as muc,
  count(*) = 1
    and bool_and(pg_get_userbyid(proowner) = 'postgres')
    and bool_and(prosecdef) as dat,
  jsonb_build_object(
    'chu_so_huu', max(pg_get_userbyid(proowner)),
    'security_definer', coalesce(bool_or(prosecdef), false)
  ) as chi_tiet
from v3

union all

select
  'P3_V3_QUYEN_GOI' as muc,
  count(*) = 1
    and bool_and(has_function_privilege('authenticated', oid, 'EXECUTE'))
    and bool_and(not has_function_privilege('anon', oid, 'EXECUTE'))
    and bool_and(not exists (
      select 1
      from aclexplode(coalesce(proacl, acldefault('f', proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )) as dat,
  jsonb_build_object(
    'authenticated_goi_duoc', coalesce(bool_or(has_function_privilege('authenticated', oid, 'EXECUTE')), false),
    'anon_goi_duoc', coalesce(bool_or(has_function_privilege('anon', oid, 'EXECUTE')), false)
  ) as chi_tiet
from v3

union all

select
  'P4_V3_DUNG_DAU_VET_00343' as muc,
  exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure(
      'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
    )
      and obj_description(p.oid, 'pg_proc') like '00343 phase A:%'
  ) as dat,
  '{}'::jsonb as chi_tiet

union all

select
  'P5_V2_CON_DE_TUONG_THICH_PHASE_A' as muc,
  to_regprocedure(
    'public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)'
  ) is not null as dat,
  '{}'::jsonb as chi_tiet

union all

select
  'P6_V3_CO_GUARD_TIEN_VA_GHI_NO' as muc,
  exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure(
      'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
    )
      and pg_get_functiondef(p.oid) like '%p_allow_debt boolean%'
      and pg_get_functiondef(p.oid) like '%FNB_PAYMENT_AMOUNT_CHANGED%'
      and pg_get_functiondef(p.oid) like '%FNB_DEBT_CONFIRMATION_REQUIRED%'
      and pg_get_functiondef(p.oid) like '%FNB_PAYMENT_BREAKDOWN_MISMATCH%'
      and pg_get_functiondef(p.oid) like '%v_paid_to_record := least(p_paid, v_expected_total)%'
      and pg_get_functiondef(p.oid) like '%''tendered_amount'', v_tendered_to_display%'
  ) as dat,
  '{}'::jsonb as chi_tiet

union all

select
  'P7_THONG_TIN_DON_BEP' as muc,
  null::boolean as dat,
  jsonb_build_object(
    'tong_don_bep', tong_don_bep,
    'da_thanh_toan', da_thanh_toan,
    'chua_thanh_toan', chua_thanh_toan
  ) as chi_tiet
from don_bep
order by muc;
