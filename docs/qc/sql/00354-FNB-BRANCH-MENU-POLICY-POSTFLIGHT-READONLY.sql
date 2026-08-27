-- 00354 postflight (READ ONLY)
-- ĐẠT khi K1-K5 và K7 đều dat = true. K6 là số liệu đối chiếu.
-- Không tạo đơn, hóa đơn, phiếu bếp, tồn kho hay thay đổi menu.

with wrapper_source as (
  select coalesce(
    pg_get_functiondef(to_regprocedure(
      'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    )),
    ''
  ) as definition
), policy_save_source as (
  select coalesce(
    pg_get_functiondef(to_regprocedure(
      'public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])'
    )),
    ''
  ) as definition
), legacy_save_source as (
  select coalesce(
    pg_get_functiondef(to_regprocedure(
      'public.save_fnb_product_branch_menu_scope(uuid,uuid[])'
    )),
    ''
  ) as definition
), checks as (
  select
    'K1_BANG_CHINH_SACH_RLS_VA_GUARD_DA_CAI'::text as muc,
    'DIEU_KIEN'::text as loai,
    exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'fnb_product_branch_menu_policies'
        and c.relrowsecurity
    )
      and to_regprocedure('public.enforce_fnb_product_branch_menu_policy_00354()') is not null as dat,
    jsonb_build_object(
      'rls', exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'fnb_product_branch_menu_policies' and c.relrowsecurity
      ),
      'guard', to_regprocedure('public.enforce_fnb_product_branch_menu_policy_00354()') is not null
    ) as chi_tiet
  union all
  select
    'K2_GUI_BEP_CHAN_MON_AN_THEO_CHI_NHANH'::text,
    'DIEU_KIEN'::text,
    position('FNB_MENU_POLICY_PRODUCT_NOT_AVAILABLE' in definition) > 0
      and position('_fnb_send_to_kitchen_impl_00353' in definition) > 0
      and not has_function_privilege('anon', 'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE'),
    jsonb_build_object(
      'marker', position('FNB_MENU_POLICY_PRODUCT_NOT_AVAILABLE' in definition) > 0,
      'goi_lop_00353', position('_fnb_send_to_kitchen_impl_00353' in definition) > 0,
      'anon', has_function_privilege('anon', 'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE')
    )
  from wrapper_source
  union all
  select
    'K3_RPC_LUU_CHINH_SACH_DUNG_QUYEN'::text,
    'DIEU_KIEN'::text,
    position('AUTH_REQUIRED' in definition) > 0
      and position('products.edit' in definition) > 0
      and position('FNB_MENU_POLICY_BRANCH_INVALID' in definition) > 0
      and position('FNB_MENU_POLICY_MODE_INVALID' in definition) > 0
      and not has_function_privilege('anon', 'public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])', 'EXECUTE'),
    jsonb_build_object(
      'auth', position('AUTH_REQUIRED' in definition) > 0,
      'permission_products_edit', position('products.edit' in definition) > 0,
      'mode_guard', position('FNB_MENU_POLICY_MODE_INVALID' in definition) > 0,
      'branch_guard', position('FNB_MENU_POLICY_BRANCH_INVALID' in definition) > 0,
      'anon', has_function_privilege('anon', 'public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])', 'EXECUTE'),
      'service_role', has_function_privilege('service_role', 'public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])', 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])', 'EXECUTE')
    )
  from policy_save_source
  union all
  select
    'K4_RPC_CU_TUONG_THICH_VA_KHONG_MO_ANON'::text,
    'DIEU_KIEN'::text,
    position('save_fnb_product_branch_menu_policy' in definition) > 0
      and not has_function_privilege('anon', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE'),
    jsonb_build_object(
      'goi_lop_moi', position('save_fnb_product_branch_menu_policy' in definition) > 0,
      'anon', has_function_privilege('anon', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE')
    )
  from legacy_save_source
  union all
  select
    'K5_SCOPE_CU_DA_CO_NGHIA_CHINH_SACH'::text,
    'DIEU_KIEN'::text,
    not exists (
      select 1
      from public.fnb_product_branch_menu_scopes scope
      left join public.fnb_product_branch_menu_policies policy
        on policy.tenant_id = scope.tenant_id
       and policy.product_id = scope.product_id
      where policy.product_id is null
    ),
    jsonb_build_object(
      'scope_chua_co_policy', (
        select count(*)
        from public.fnb_product_branch_menu_scopes scope
        left join public.fnb_product_branch_menu_policies policy
          on policy.tenant_id = scope.tenant_id
         and policy.product_id = scope.product_id
        where policy.product_id is null
      )
    )
  union all
  select
    'K6_THONG_TIN_CHINH_SACH_MENU'::text,
    'THONG_TIN'::text,
    null::boolean,
    jsonb_build_object(
      'sku_only', count(*) filter (where mode = 'only'),
      'sku_except', count(*) filter (where mode = 'except'),
      'dong_chi_nhanh_lien_ket', (select count(*) from public.fnb_product_branch_menu_scopes)
    )
  from public.fnb_product_branch_menu_policies
  union all
  select
    'K7_KHONG_CO_LINK_CHEO_TENANT_HOAC_SAI_KENH'::text,
    'DIEU_KIEN'::text,
    not exists (
      select 1
      from public.fnb_product_branch_menu_policies policy
      left join public.products p on p.id = policy.product_id
      where p.id is null
        or p.tenant_id is distinct from policy.tenant_id
        or p.product_type <> 'sku'
        or p.channel <> 'fnb'
    ),
    jsonb_build_object(
      'so_policy_loi', (
        select count(*)
        from public.fnb_product_branch_menu_policies policy
        left join public.products p on p.id = policy.product_id
        where p.id is null
          or p.tenant_id is distinct from policy.tenant_id
          or p.product_type <> 'sku'
          or p.channel <> 'fnb'
      )
    )
)
select muc, loai, dat, chi_tiet from checks order by muc;
