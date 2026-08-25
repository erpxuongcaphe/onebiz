-- 00346 BUOC 1: chi doc, khong sua du lieu.
-- Chay ca file trong Supabase SQL Editor. Tat ca dong DIEU_KIEN phai dat=true.

with checks as (
  select
    'P1_HAM_GOC_DUNG_CHU_KY'::text as muc,
    to_regprocedure(
      'public.save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'
    ) is not null as dat,
    jsonb_build_object(
      'so_ham', (
        select count(*)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'save_purchase_order_with_uom_atomic'
      )
    ) as chi_tiet
  union all
  select
    'P2_HAM_GOC_DUNG_QUYEN',
    not has_function_privilege(
      'anon',
      'public.save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)',
      'EXECUTE'
    ),
    '{}'::jsonb
  union all
  select
    'P3_MA_PHIEU_KHONG_TRUNG_TRONG_TENANT',
    exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'purchase_orders'
        and c.contype = 'u'
        and pg_get_constraintdef(c.oid) ilike '%tenant_id%code%'
    ),
    jsonb_build_object(
      'cap_ma_trung_hien_co', (
        select count(*)
        from (
          select tenant_id, code
          from public.purchase_orders
          group by tenant_id, code
          having count(*) > 1
        ) d
      )
    )
  union all
  select
    'P4_00346_CHUA_CAI',
    to_regprocedure(
      'public.save_purchase_order_with_uom_atomic_v2(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'
    ) is null,
    jsonb_build_object(
      'bang_khoa_da_co', to_regclass('public.purchase_order_save_keys') is not null
    )
)
select muc, 'DIEU_KIEN'::text as loai, dat, chi_tiet
from checks
order by muc;
