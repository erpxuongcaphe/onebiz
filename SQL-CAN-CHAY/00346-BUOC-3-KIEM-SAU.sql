-- 00346 BUOC 3: chi doc, khong sua du lieu.
-- Chay sau BUOC 2. Tat ca dong DIEU_KIEN phai dat=true.

with fn as (
  select pg_get_functiondef(
    'public.save_purchase_order_with_uom_atomic_v2(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'::regprocedure
  ) as def
), checks as (
  select
    'K1_HAM_V2_DUNG_CHU_KY'::text as muc,
    to_regprocedure(
      'public.save_purchase_order_with_uom_atomic_v2(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'
    ) is not null as dat,
    '{}'::jsonb as chi_tiet
  union all
  select
    'K2_CO_KHOA_VA_DAU_VAN_TAY',
    def ilike '%pg_advisory_xact_lock%'
      and def ilike '%v_saved_hash <> v_request_hash%'
      and def ilike '%PURCHASE_ORDER_CODE_CONFLICT%',
    '{}'::jsonb
  from fn
  union all
  select
    'K3_CO_GUARD_NGUOI_CHI_NHANH_NCC',
    def ilike '%created_by <> v_actor%'
      and def ilike '%user_has_branch_access%'
      and def ilike '%supplier_id <> p_supplier_id%',
    '{}'::jsonb
  from fn
  union all
  select
    'K4_HAM_NOI_BO_KHONG_MO_ANON',
    not has_function_privilege(
      'anon',
      'public.save_purchase_order_with_uom_atomic_v2(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.save_purchase_order_with_uom_atomic_v2(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)',
      'EXECUTE'
    ),
    '{}'::jsonb
  union all
  select
    'K5_BANG_KHOA_KHONG_MO_TRINH_DUYET',
    to_regclass('public.purchase_order_save_keys') is not null
      and not has_table_privilege('anon', 'public.purchase_order_save_keys', 'SELECT')
      and not has_table_privilege('authenticated', 'public.purchase_order_save_keys', 'SELECT')
      and not has_table_privilege('authenticated', 'public.purchase_order_save_keys', 'INSERT'),
    jsonb_build_object(
      'so_khoa_da_ghi', (select count(*) from public.purchase_order_save_keys)
    )
  union all
  select
    'K6_KHONG_CO_MA_PO_TRUNG',
    not exists (
      select 1
      from public.purchase_orders
      group by tenant_id, code
      having count(*) > 1
    ),
    '{}'::jsonb
)
select muc, 'DIEU_KIEN'::text as loai, dat, chi_tiet
from checks
order by muc;
