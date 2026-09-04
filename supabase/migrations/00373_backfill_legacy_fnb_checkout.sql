-- ============================================================================
-- 00373 - Backfill quyen checkout FnB cho vai tro thu tien cu.
--
-- 00370 tach quyen mo ca/thanh toan FnB khoi quyen gui bep. Mot so vai tro
-- tuy chinh cu (vi du Ke toan kiem thu ngan) khong co ten trong danh sach seed
-- nhung da co day du hai dau hieu thu tien:
--   - pos_retail.checkout
--   - finance.create_transaction
-- Chi nhung vai tro thoa DONG THOI hai dieu kien moi duoc backfill. Vai tro kho
-- chi co pos_retail.checkout se khong duoc cap nham.
-- ============================================================================

with legacy_checkout_roles as (
  select r.id
  from public.roles r
  where exists (
    select 1
    from public.role_permissions rp
    where rp.role_id = r.id
      and rp.permission_code = 'pos_retail.checkout'
  )
  and exists (
    select 1
    from public.role_permissions rp
    where rp.role_id = r.id
      and rp.permission_code = 'finance.create_transaction'
  )
)
insert into public.role_permissions (role_id, permission_code)
select id, 'pos_fnb.checkout'
from legacy_checkout_roles
on conflict (role_id, permission_code) do nothing;

-- Read-only postflight. K1 phai true. I1 cho biet bao nhieu vai tro duoc bao
-- toan tu co che cu, khong hien thong tin tai khoan ca nhan.
with eligible as (
  select r.id
  from public.roles r
  where exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id
      and rp.permission_code = 'pos_retail.checkout'
  )
  and exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id
      and rp.permission_code = 'finance.create_transaction'
  )
), missing as (
  select e.id
  from eligible e
  where not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = e.id
      and rp.permission_code = 'pos_fnb.checkout'
  )
)
select
  'K1_VAI_TRO_THU_TIEN_CU_DA_CO_CHECKOUT_FNB' as muc,
  'DIEU_KIEN' as loai,
  not exists (select 1 from missing) as dat,
  jsonb_build_object(
    'vai_tro_du_dieu_kien', (select count(*) from eligible),
    'vai_tro_con_thieu', (select count(*) from missing)
  ) as chi_tiet
union all
select
  'I1_PHAM_VI_BACKFILL',
  'THONG_TIN',
  null::boolean,
  jsonb_build_object(
    'nguyen_tac', 'pos_retail.checkout + finance.create_transaction',
    'khong_cap_theo_ten_vai_tro', true
  );

notify pgrst, 'reload schema';
