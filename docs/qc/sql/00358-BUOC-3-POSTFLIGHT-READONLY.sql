-- 00358 BUOC 3 - CHI DOC. Tat ca DIEU_KIEN phai dat=true.
with fn as (
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='mark_order_processed'
    and pg_get_function_identity_arguments(p.oid)='p_order_id uuid, p_invoice_id uuid'
), acl as (
  select
    has_function_privilege('anon', 'public.mark_order_processed(uuid,uuid)', 'execute') as anon,
    has_function_privilege('authenticated', 'public.mark_order_processed(uuid,uuid)', 'execute') as authenticated
)
select 'K1_GIU_DU_GUARD_HOA_DON_CON' as muc, 'DIEU_KIEN' as loai,
       coalesce((select def ~* 'c\.source_order_id = p_order_id'
                            and def ~* 'c\.branch_id = v_don\.branch_id'
                            and def ~* 'c\.status = ''completed'''
                            and def ~* 'c\.voided_at is null'
                            and def ~* 'c\.cancelled_at is null' from fn), false) as dat,
       '{}'::jsonb as chi_tiet
union all
select 'K2_CHI_GHI_FULFILLED_BY_ID', 'DIEU_KIEN',
       coalesce((select def ~* 'set fulfilled_by_id = p_invoice_id'
                            and def !~* 'set[^;]*status\s*='
                            and def !~* 'set[^;]*total\s*='
                            and def !~* 'set[^;]*paid\s*=' from fn), false),
       '{}'::jsonb
union all
select 'K3_CO_NHAT_KY_NGUOI_VA_THOI_DIEM', 'DIEU_KIEN',
       coalesce((select def ~* 'insert into public\.audit_log'
                            and def ~* 'sales_order_processing_completed'
                            and def ~* 'sales_order_processing_reopened'
                            and def ~* '''changed_at''' from fn), false),
       '{}'::jsonb
union all
select 'K4_KHONG_BAT_SO_LUONG_KHOP', 'DIEU_KIEN',
       coalesce((select def ~* '''quantity_match_required'', false'
                            and def !~* 'invoice_items' from fn), false),
       jsonb_build_object('nguyen_tac', 'Chenh lech so luong chi doi chieu, khong chan chot')
union all
select 'K5_QUYEN_GOI', 'DIEU_KIEN',
       (select not anon and authenticated from acl),
       (select jsonb_build_object('anon', anon, 'authenticated', authenticated) from acl)
union all
select 'I1_SO_NHAT_KY_00358', 'THONG_TIN', null,
       jsonb_build_object('so_dong', count(*))
from public.audit_log
where action in ('sales_order_processing_completed', 'sales_order_processing_reopened');
