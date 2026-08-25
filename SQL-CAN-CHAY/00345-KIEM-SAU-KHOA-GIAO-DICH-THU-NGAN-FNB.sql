-- 00345 — HAU KIEM CHI DOC. Khong ghi, khong goi RPC nghiep vu.
-- DAT = true o tat ca dong DIEU_KIEN moi duoc coi la lop khoa da cai dung.
with ham as (
  select *
  from (values
    ('HUY_CHUA_TT', 'public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)'),
    ('HUY_DA_TT', 'public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'),
    ('THANH_TOAN', 'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)')
  ) as x(nhom, chu_ky)
), thong_tin as (
  select
    h.nhom,
    h.chu_ky,
    to_regprocedure(h.chu_ky) as oid
  from ham h
), ket_qua as (
  select
    'K1_CHU_KY_VA_QUYEN'::text as muc,
    'DIEU_KIEN'::text as loai,
    t.nhom,
    case when t.oid is null then false else
      has_function_privilege('authenticated', t.chu_ky, 'EXECUTE')
      and not has_function_privilege('anon', t.chu_ky, 'EXECUTE')
    end as dat,
    jsonb_build_object(
      'chu_ky', t.chu_ky,
      'authenticated_goi_duoc', case when t.oid is not null then has_function_privilege('authenticated', t.chu_ky, 'EXECUTE') else false end,
      'anon_goi_duoc', case when t.oid is not null then has_function_privilege('anon', t.chu_ky, 'EXECUTE') else false end,
      'anon_hoac_public_goi_duoc', case when t.oid is not null then has_function_privilege('anon', t.chu_ky, 'EXECUTE') else false end,
      'ghi_chu_public', 'anon_goi_duoc=true bao gom ca grant PUBLIC; phai la false'
    ) as chi_tiet
  from thong_tin t

  union all

  select
    'K2_WRAPPER_DUNG_NOI_DUNG',
    'DIEU_KIEN',
    t.nhom,
    case t.nhom
      when 'HUY_CHUA_TT' then pg_get_functiondef(t.oid) like '%FNB_CANCEL_BRANCH_ACCESS_DENIED%'
        and pg_get_functiondef(t.oid) like '%_fnb_cancel_unpaid_order_impl_00066%'
      when 'HUY_DA_TT' then pg_get_functiondef(t.oid) like '%FNB_VOID_ACTOR_MISMATCH%'
        and pg_get_functiondef(t.oid) like '%FNB_VOID_ORDER_INVOICE_MISMATCH%'
        and pg_get_functiondef(t.oid) like '%_fnb_void_invoice_impl_00329%'
      when 'THANH_TOAN' then pg_get_functiondef(t.oid) like '%FNB_PAYMENT_OPEN_SHIFT_REQUIRED%'
        and pg_get_functiondef(t.oid) like '%_fnb_complete_payment_impl_00343%'
        and pg_get_functiondef(t.oid) like '%v_order.invoice_id is not null%'
      else false
    end as dat,
    jsonb_build_object('co_lop_boc_00345', t.oid is not null) as chi_tiet
  from thong_tin t

  union all

  select
    'K3_HAM_NOI_BO_DA_KHOA',
    'DIEU_KIEN',
    'CA_3',
    not exists (
      select 1
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          '_fnb_cancel_unpaid_order_impl_00066',
          '_fnb_void_invoice_impl_00329',
          '_fnb_complete_payment_impl_00343'
        )
        and (
          has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE')
        )
    ),
    jsonb_build_object('ghi_chu', 'Ham noi bo khong duoc goi truc tiep tu trinh duyet')

  union all

  select
    'I1_GIOI_HAN_00345',
    'THONG_TIN',
    'PHAM_VI',
    null,
    jsonb_build_object(
      'da_khoa', 'RPC huy bill chua thanh toan, huy bill da thanh toan, thanh toan',
      'chua_khoa', 'Quyen ghi truc tiep bang du lieu FnB se xu ly o dot rieng sau khi kiem ke caller'
    )
)
select muc, loai, nhom, dat, chi_tiet
from ket_qua
order by case loai when 'DIEU_KIEN' then 1 else 2 end, muc, nhom;
