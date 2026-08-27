-- 00354 preflight (READ ONLY)
-- ĐẠT khi P1, P2 và P3 đều dat = true. P4 chỉ là số liệu đối chiếu.
-- Không tạo đơn, hóa đơn, phiếu bếp, tồn kho hay thay đổi menu.

with current_send as (
  select coalesce(
    pg_get_functiondef(to_regprocedure(
      'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    )),
    ''
  ) as definition
), checks as (
  select
    'P1_NEN_00353_SAN_SANG'::text as muc,
    'DIEU_KIEN'::text as loai,
    to_regclass('public.fnb_product_branch_menu_scopes') is not null
      and to_regprocedure('public.save_fnb_product_branch_menu_scope(uuid,uuid[])') is not null as dat,
    jsonb_build_object(
      'bang_scope', to_regclass('public.fnb_product_branch_menu_scopes') is not null,
      'ham_scope', to_regprocedure('public.save_fnb_product_branch_menu_scope(uuid,uuid[])') is not null
    ) as chi_tiet
  union all
  select
    'P2_00354_CHUA_CAI'::text,
    'DIEU_KIEN'::text,
    to_regclass('public.fnb_product_branch_menu_policies') is null
      and to_regprocedure('public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])') is null,
    jsonb_build_object(
      'bang_da_co', to_regclass('public.fnb_product_branch_menu_policies') is not null,
      'ham_da_co', to_regprocedure('public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])') is not null
    )
  union all
  select
    'P3_LOP_GUI_BEP_CO_THE_BOC_TIEP'::text,
    'DIEU_KIEN'::text,
    position('FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE' in definition) > 0
      and position('_fnb_send_to_kitchen_impl_00350' in definition) > 0,
    jsonb_build_object(
      'giu_guard_00353', position('FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE' in definition) > 0,
      'giu_guard_00350', position('_fnb_send_to_kitchen_impl_00350' in definition) > 0
    )
  from current_send
  union all
  select
    'P4_THONG_TIN_SCOPE_CU'::text,
    'THONG_TIN'::text,
    null::boolean,
    jsonb_build_object(
      'dong_scope_hien_co', count(*),
      'sku_da_chon_quan', count(distinct product_id)
    )
  from public.fnb_product_branch_menu_scopes
)
select muc, loai, dat, chi_tiet from checks order by muc;
