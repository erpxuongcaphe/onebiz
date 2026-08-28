-- 00358 BUOC 1 - CHI DOC. Tat ca DIEU_KIEN phai dat=true truoc khi chay migration.
select 'P1_HAM_NEN_DUNG_CHU_KY' as muc, 'DIEU_KIEN' as loai,
       to_regprocedure('public.mark_order_processed(uuid,uuid)') is not null as dat,
       jsonb_build_object('chu_ky', 'public.mark_order_processed(uuid,uuid)') as chi_tiet
union all
select 'P2_CO_COT_NEO_VA_AUDIT', 'DIEU_KIEN',
       exists (
         select 1 from information_schema.columns
         where table_schema='public' and table_name='invoices' and column_name='fulfilled_by_id'
       ) and to_regclass('public.audit_log') is not null,
       jsonb_build_object(
         'fulfilled_by_id', exists (
           select 1 from information_schema.columns
           where table_schema='public' and table_name='invoices' and column_name='fulfilled_by_id'
         ),
         'audit_log', to_regclass('public.audit_log') is not null
       )
union all
select 'P3_HAM_NEN_GIU_GUARD_00337', 'DIEU_KIEN',
       coalesce((
         select pg_get_functiondef(p.oid) ~* 'c\.status = ''completed'''
            and pg_get_functiondef(p.oid) ~* 'c\.voided_at is null'
            and pg_get_functiondef(p.oid) ~* 'c\.cancelled_at is null'
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='mark_order_processed'
           and pg_get_function_identity_arguments(p.oid)='p_order_id uuid, p_invoice_id uuid'
       ), false),
       '{}'::jsonb;
