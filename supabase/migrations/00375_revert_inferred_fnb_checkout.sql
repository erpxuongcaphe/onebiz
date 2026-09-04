-- ============================================================================
-- 00375 - Go quyen FnB da bi suy dien tu quyen Retail + tai chinh.
--
-- 00373 la hotfix theo chan doan ban dau va da tu dong cap pos_fnb.checkout
-- cho vai tro co pos_retail.checkout + finance.create_transaction. Nguyen tac
-- dung cua he thong la quyen POS nao phai duoc quan tri chi dinh quyen POS do;
-- khong suy dien quyen FnB tu chuc danh hoac quyen cua kenh Retail.
--
-- Chi dao nguoc pham vi ma 00373 da them ngoai tap vai tro duoc 00370 seed ro
-- rang. Khong sua pos_retail.checkout, quyen tai chinh, chuc danh, chi nhanh
-- hay user_permission_overrides.
-- ============================================================================

delete from public.role_permissions target
using public.roles r
where target.role_id = r.id
  and target.permission_code = 'pos_fnb.checkout'
  and r.name not in (
    'Chu cua hang', 'Chủ cửa hàng',
    'Admin',
    'Quan ly', 'Quản lý',
    'Thu ngan F&B', 'Thu ngân F&B'
  )
  and exists (
    select 1
    from public.role_permissions retail
    where retail.role_id = r.id
      and retail.permission_code = 'pos_retail.checkout'
  )
  and exists (
    select 1
    from public.role_permissions finance
    where finance.role_id = r.id
      and finance.permission_code = 'finance.create_transaction'
  );

-- K1 phai true. I1 = 0 xac nhan khong con quyen FnB nao do quy tac 00373
-- tu suy dien. Quyen FnB duoc admin cap rieng sau migration khong bi anh huong.
with inferred_fnb_roles as (
  select r.id
  from public.roles r
  join public.role_permissions fnb
    on fnb.role_id = r.id
   and fnb.permission_code = 'pos_fnb.checkout'
  where r.name not in (
    'Chu cua hang', 'Chủ cửa hàng',
    'Admin',
    'Quan ly', 'Quản lý',
    'Thu ngan F&B', 'Thu ngân F&B'
  )
    and exists (
      select 1 from public.role_permissions retail
      where retail.role_id = r.id
        and retail.permission_code = 'pos_retail.checkout'
    )
    and exists (
      select 1 from public.role_permissions finance
      where finance.role_id = r.id
        and finance.permission_code = 'finance.create_transaction'
    )
)
select
  'K1_KHONG_CON_TU_SUY_DIEN_QUYEN_FNB' as muc,
  'DIEU_KIEN' as loai,
  not exists (select 1 from inferred_fnb_roles) as dat,
  jsonb_build_object(
    'quyen_retail_duoc_giu_nguyen', true,
    'quyen_tai_chinh_duoc_giu_nguyen', true,
    'quyen_cap_rieng_khong_bi_sua', true
  ) as chi_tiet
union all
select
  'I1_VAI_TRO_CON_QUYEN_FNB_DO_SUY_DIEN',
  'THONG_TIN',
  null::boolean,
  jsonb_build_object('so_vai_tro', (select count(*) from inferred_fnb_roles));

notify pgrst, 'reload schema';
