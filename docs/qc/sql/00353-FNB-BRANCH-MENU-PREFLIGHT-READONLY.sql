-- 00353 preflight (READ ONLY)
-- ĐẠT khi P1, P2 và P3 đều dat = true.
-- P4 là thông tin đối chiếu, không chặn.

with current_send as (
  select coalesce(
    pg_get_functiondef(to_regprocedure(
      'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    )),
    ''
  ) as definition
), checks as (
  select
    'P1_NEN_HAM_VA_SCHEMA_SAN_SANG'::text as muc,
    'DIEU_KIEN'::text as loai,
    to_regclass('public.products') is not null
      and to_regclass('public.branches') is not null
      and to_regprocedure('public.user_has_permission(uuid,text)') is not null
      and to_regprocedure('public.get_user_tenant_id()') is not null as dat,
    jsonb_build_object(
      'products', to_regclass('public.products') is not null,
      'branches', to_regclass('public.branches') is not null,
      'permission_helper', to_regprocedure('public.user_has_permission(uuid,text)') is not null,
      'tenant_helper', to_regprocedure('public.get_user_tenant_id()') is not null
    ) as chi_tiet
  union all
  select
    'P2_00353_CHUA_CAI'::text,
    'DIEU_KIEN'::text,
    to_regclass('public.fnb_product_branch_menu_scopes') is null,
    jsonb_build_object('bang_da_co', to_regclass('public.fnb_product_branch_menu_scopes') is not null)
  union all
  select
    'P3_LOP_GUI_BEP_CO_THE_BOC_TIEP'::text,
    'DIEU_KIEN'::text,
    position('_fnb_send_to_kitchen_impl_00330' in definition) > 0
      and position('FNB_EXACT_RECIPE_OPTION_MISSING' in definition) > 0,
    jsonb_build_object(
      'giu_guard_size', position('_fnb_send_to_kitchen_impl_00330' in definition) > 0,
      'giu_guard_dinh_luong', position('FNB_EXACT_RECIPE_OPTION_MISSING' in definition) > 0
    )
  from current_send
  union all
  select
    'P4_THONG_TIN_MENU_FNB_DANG_BAT'::text,
    'THONG_TIN'::text,
    null::boolean,
    jsonb_build_object(
      'sku_fnb_dang_ban', count(*) filter (where is_active and allow_sale),
      'sku_fnb_tat', count(*) filter (where not is_active or not allow_sale)
    )
  from public.products
  where product_type = 'sku' and channel = 'fnb'
)
select muc, loai, dat, chi_tiet from checks order by muc;
