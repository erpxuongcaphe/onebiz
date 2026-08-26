-- 00353 postflight (READ ONLY)
-- ĐẠT khi K1-K4 và K6 đều dat = true. K5 chỉ là thông tin cấu hình.
-- Chưa tạo đơn, hóa đơn, phiếu bếp hoặc stock movement để kiểm này.

with wrapper_source as (
  select coalesce(
    pg_get_functiondef(to_regprocedure(
      'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    )),
    ''
  ) as definition
), save_source as (
  select coalesce(
    pg_get_functiondef(to_regprocedure(
      'public.save_fnb_product_branch_menu_scope(uuid,uuid[])'
    )),
    ''
  ) as definition
), checks as (
  select
    'K1_BANG_RLS_VA_GUARD_DA_CAI'::text as muc,
    'DIEU_KIEN'::text as loai,
    exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'fnb_product_branch_menu_scopes'
        and c.relrowsecurity
    )
      and to_regprocedure('public.enforce_fnb_product_branch_menu_scope_00353()') is not null as dat,
    jsonb_build_object(
      'rls', exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'fnb_product_branch_menu_scopes' and c.relrowsecurity
      ),
      'guard', to_regprocedure('public.enforce_fnb_product_branch_menu_scope_00353()') is not null
    ) as chi_tiet
  union all
  select
    'K2_GUI_BEP_CHAN_MON_NGOAI_PHAM_VI'::text,
    'DIEU_KIEN'::text,
    position('FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE' in definition) > 0
      and position('_fnb_send_to_kitchen_impl_00350' in definition) > 0
      and not has_function_privilege('anon', 'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE'),
    jsonb_build_object(
      'marker', position('FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE' in definition) > 0,
      'goi_lop_00350', position('_fnb_send_to_kitchen_impl_00350' in definition) > 0,
      'anon', has_function_privilege('anon', 'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE')
    )
  from wrapper_source
  union all
  select
    'K3_RPC_LUU_PHAM_VI_DUNG_QUYEN'::text,
    'DIEU_KIEN'::text,
    position('AUTH_REQUIRED' in definition) > 0
      and position('products.edit' in definition) > 0
      and position('FNB_MENU_SCOPE_BRANCH_INVALID' in definition) > 0
      and not has_function_privilege('anon', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE'),
    jsonb_build_object(
      'auth', position('AUTH_REQUIRED' in definition) > 0,
      'permission_products_edit', position('products.edit' in definition) > 0,
      'branch_guard', position('FNB_MENU_SCOPE_BRANCH_INVALID' in definition) > 0,
      'anon', has_function_privilege('anon', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE'),
      'service_role', has_function_privilege('service_role', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public.save_fnb_product_branch_menu_scope(uuid,uuid[])', 'EXECUTE')
    )
  from save_source
  union all
  select
    'K4_HAM_NOI_BO_KHONG_MO_TRINH_DUYET'::text,
    'DIEU_KIEN'::text,
    not has_function_privilege('anon', 'public._fnb_send_to_kitchen_impl_00350(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public._fnb_send_to_kitchen_impl_00350(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE'),
    jsonb_build_object(
      'anon', has_function_privilege('anon', 'public._fnb_send_to_kitchen_impl_00350(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public._fnb_send_to_kitchen_impl_00350(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE')
    )
  union all
  select
    'K5_THONG_TIN_PHAM_VI_DA_CHON'::text,
    'THONG_TIN'::text,
    null::boolean,
    jsonb_build_object(
      'dong_pham_vi', count(*),
      'sku_co_pham_vi_rieng', count(distinct product_id),
      'chi_nhanh_duoc_mo', count(distinct branch_id)
    )
  from public.fnb_product_branch_menu_scopes
  union all
  select
    'K6_KHONG_CO_LINK_CHEO_TENANT_HOAC_SAI_KENH'::text,
    'DIEU_KIEN'::text,
    not exists (
      select 1
      from public.fnb_product_branch_menu_scopes s
      left join public.products p on p.id = s.product_id
      left join public.branches b on b.id = s.branch_id
      where p.id is null
        or b.id is null
        or p.tenant_id is distinct from s.tenant_id
        or b.tenant_id is distinct from s.tenant_id
        or p.product_type <> 'sku'
        or p.channel <> 'fnb'
    ),
    jsonb_build_object(
      'so_link_loi', (
        select count(*)
        from public.fnb_product_branch_menu_scopes s
        left join public.products p on p.id = s.product_id
        left join public.branches b on b.id = s.branch_id
        where p.id is null
          or b.id is null
          or p.tenant_id is distinct from s.tenant_id
          or b.tenant_id is distinct from s.tenant_id
          or p.product_type <> 'sku'
          or p.channel <> 'fnb'
      )
    )
)
select muc, loai, dat, chi_tiet from checks order by muc;
