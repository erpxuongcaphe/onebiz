-- ============================================================
-- POSTFLIGHT FNB PIN BAN GIAO - CHI DOC
-- Chay SAU 00344. Khong goi RPC PIN, khong tao session, khong ghi audit.
-- Tat ca dong DIEU_KIEN phai dat = true truoc khi deploy client.
-- ============================================================

with ham as (
  select
    p.oid,
    p.proname,
    pg_get_function_identity_arguments(p.oid) as tham_so,
    pg_get_userbyid(p.proowner) as chu_so_huu,
    p.prosecdef as security_definer,
    pg_get_functiondef(p.oid) as dinh_nghia
  from pg_proc p
  where p.oid in (
    to_regprocedure('public.verify_pos_pin(uuid,text,uuid)'),
    to_regprocedure('public.list_pos_pin_users(uuid)')
  )
)
select
  'K1_CHU_KY_VA_CHU_SO_HUU' as muc,
  'DIEU_KIEN' as loai,
  count(*) = 2
    and bool_and(chu_so_huu = 'postgres' and security_definer) as dat,
  jsonb_agg(jsonb_build_object(
    'ham', proname,
    'tham_so', tham_so,
    'chu_so_huu', chu_so_huu,
    'security_definer', security_definer
  ) order by proname) as chi_tiet
from ham

union all

select
  'K2_GUARD_BAN_GIAO' as muc,
  'DIEU_KIEN' as loai,
  coalesce(bool_and(
    position('auth.uid()' in dinh_nghia) > 0
    and position('pos_fnb.send_kitchen' in dinh_nghia) > 0
    and position('user_has_branch_access' in dinh_nghia) > 0
  ), false) as dat,
  jsonb_agg(jsonb_build_object(
    'ham', proname,
    'co_auth', position('auth.uid()' in dinh_nghia) > 0,
    'co_quyen_fnb', position('pos_fnb.send_kitchen' in dinh_nghia) > 0,
    'co_chi_nhanh', position('user_has_branch_access' in dinh_nghia) > 0
  ) order by proname) as chi_tiet
from ham

union all

select
  'K3_KHOA_VA_NHAT_KY' as muc,
  'DIEU_KIEN' as loai,
  coalesce(
    position('for update' in lower((select dinh_nghia from ham where proname = 'verify_pos_pin'))) > 0
    and position('pos_pin_handover' in (select dinh_nghia from ham where proname = 'verify_pos_pin')) > 0
    and position('source_shift_id' in (select dinh_nghia from ham where proname = 'verify_pos_pin')) > 0,
    false
  ) as dat,
  jsonb_build_object('yeu_cau', 'Khoa PIN, ghi A giao B nhan va source_shift_id') as chi_tiet

union all

select
  'K4_KHONG_CHUYEN_SO_QUY_HOAC_CA' as muc,
  'DIEU_KIEN' as loai,
  coalesce(
    position('update public.shifts' in lower((select dinh_nghia from ham where proname = 'verify_pos_pin'))) = 0
    and position('update public.cash_transactions' in lower((select dinh_nghia from ham where proname = 'verify_pos_pin'))) = 0
    and position('update public.invoices' in lower((select dinh_nghia from ham where proname = 'verify_pos_pin'))) = 0,
    false
  ) as dat,
  jsonb_build_object('nguyen_tac', 'Gio theo chi nhanh; ca, quy va hoa don giu dung nguoi thuc hien') as chi_tiet

union all

select
  'K5_QUYEN_GOI' as muc,
  'DIEU_KIEN' as loai,
  not has_function_privilege('anon', h.oid, 'execute')
    and not has_function_privilege('public', h.oid, 'execute')
    and has_function_privilege('authenticated', h.oid, 'execute') as dat,
  jsonb_build_object(
    'ham', h.proname,
    'anon', has_function_privilege('anon', h.oid, 'execute'),
    'public', has_function_privilege('public', h.oid, 'execute'),
    'authenticated', has_function_privilege('authenticated', h.oid, 'execute')
  ) as chi_tiet
from ham h
order by muc;
