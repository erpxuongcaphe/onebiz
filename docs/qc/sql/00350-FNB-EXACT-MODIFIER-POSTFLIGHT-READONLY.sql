-- 00350 postflight (read-only) — run after migration, before entering recipes.

with r as (
  select
    to_regclass('public.bom_modifier_option_quantities') as mapping_table,
    to_regprocedure('public.enforce_bom_modifier_option_quantity_00350()') as guard_fn,
    to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') as save_fn,
    to_regprocedure('public._fnb_send_to_kitchen_impl_00330(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') as send_inner,
    to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') as send_outer,
    to_regprocedure('public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)') as consume_fn
), results as (
  select
    'K1_SCHEMA_VA_GUARD'::text as muc,
    'DIEU_KIEN'::text as loai,
    mapping_table is not null and guard_fn is not null and save_fn is not null
      and exists (select 1 from pg_trigger where tgname = 'trg_enforce_bom_modifier_option_quantity_00350' and not tgisinternal) as dat,
    jsonb_build_object('bang', mapping_table is not null, 'guard', guard_fn is not null, 'luu_nguyen_tu', save_fn is not null) as chi_tiet
  from r
  union all
  select
    'K2_DUONG_GHI_BEP_DA_BOC', 'DIEU_KIEN',
    send_inner is not null
      and coalesce(position('FNB_EXACT_RECIPE_OPTION_MISSING' in pg_get_functiondef(send_outer)) > 0, false)
      and coalesce(position('_fnb_send_to_kitchen_impl_00330' in pg_get_functiondef(send_outer)) > 0, false),
    jsonb_build_object('ham_noi_bo', send_inner is not null)
  from r
  union all
  select
    'K3_THANH_TOAN_DUNG_DINH_LUONG', 'DIEU_KIEN',
    coalesce(position('bom_modifier_option_quantities' in pg_get_functiondef(consume_fn)) > 0, false)
      and coalesce(position('FNB_EXACT_RECIPE_OPTION_MISSING' in pg_get_functiondef(consume_fn)) > 0, false),
    '{}'::jsonb
  from r
  union all
  select
    'K4_GUARD_KHONG_MO_TRINH_DUYET', 'DIEU_KIEN',
    not has_function_privilege('anon', guard_fn, 'execute')
      and not has_function_privilege('authenticated', guard_fn, 'execute')
      and not has_function_privilege('service_role', guard_fn, 'execute'),
    jsonb_build_object(
      'anon', has_function_privilege('anon', guard_fn, 'execute'),
      'authenticated', has_function_privilege('authenticated', guard_fn, 'execute'),
      'service_role', has_function_privilege('service_role', guard_fn, 'execute')
    )
  from r
  union all
  select
    'K5_DOC_BANG_CHI_DANG_NHAP', 'DIEU_KIEN',
    has_table_privilege('authenticated', mapping_table, 'select')
      and not has_table_privilege('anon', mapping_table, 'select'),
    jsonb_build_object(
      'authenticated_select', has_table_privilege('authenticated', mapping_table, 'select'),
      'anon_select', has_table_privilege('anon', mapping_table, 'select')
    )
  from r
  union all
  select
    'K6_RPC_LUU_CHI_CHO_DANG_NHAP', 'DIEU_KIEN',
    not has_function_privilege('anon', save_fn, 'execute')
      and has_function_privilege('authenticated', save_fn, 'execute'),
    jsonb_build_object(
      'anon', has_function_privilege('anon', save_fn, 'execute'),
      'authenticated', has_function_privilege('authenticated', save_fn, 'execute')
    )
  from r
  union all
  select
    'I1_DINH_LUONG_DA_KHAI', 'THONG_TIN', null,
    jsonb_build_object('so_dong', count(*), 'bom', count(distinct bom_id), 'nguyen_lieu', count(distinct material_id))
  from public.bom_modifier_option_quantities
)
select muc, loai, dat, chi_tiet from results order by muc;
