-- ============================================================
-- PREFLIGHT F&B POS - THU NGAN, HUY BILL, NVL VA QUYEN GHI
-- Chi doc. Khong INSERT / UPDATE / DELETE / DDL / transaction.
-- Tenant da chot: OneBiz Coffee Demo (148e8ac5-b891-4de3-9055-cfa41f39ddb0)
--
-- Muc dich:
--   1. Khong cho F&B go-live neu authenticated con ghi truc tiep vao
--      chung tu/bep/kho qua PostgREST.
--   2. Xac minh 5 RPC then chot co owner, SECURITY DEFINER va grant dung.
--   3. In ma tran quyen va chi nhanh cua nhan su F&B dang hoat dong.
--
-- Cach doc:
--   - Dong DIEU_KIEN phai DAT = true truoc khi nhap du lieu mo ban.
--   - Dong THONG_TIN de doi chieu cau hinh, khong tu dong la loi.
-- ============================================================

with
tenant_scope as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id
),
target_tables(table_name) as (
  values
    ('invoices'),
    ('invoice_items'),
    ('kitchen_orders'),
    ('kitchen_order_items'),
    ('stock_movements'),
    ('branch_stock'),
    ('product_lots'),
    ('lot_allocations'),
    ('cash_transactions'),
    ('restaurant_tables'),
    ('pos_exception_events')
),
table_security as (
  select
    tt.table_name,
    coalesce(c.relrowsecurity, false) as rls_bat,
    coalesce(has_table_privilege('authenticated', c.oid::regclass, 'insert'), false) as auth_insert,
    coalesce(has_table_privilege('authenticated', c.oid::regclass, 'update'), false) as auth_update,
    coalesce(has_table_privilege('authenticated', c.oid::regclass, 'delete'), false) as auth_delete,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'ten_policy', pol.policyname,
          'lenh', pol.cmd,
          'using', pol.qual,
          'with_check', pol.with_check
        ) order by pol.policyname
      )
      from pg_policies pol
      where pol.schemaname = 'public' and pol.tablename = tt.table_name
    ), '[]'::jsonb) as policies
  from target_tables tt
  left join pg_class c
    on c.relname = tt.table_name
   and c.relnamespace = 'public'::regnamespace
),
target_rpcs(rpc_name) as (
  values
    ('fnb_send_to_kitchen_atomic_v2'),
    ('fnb_complete_payment_atomic_v3'),
    ('fnb_cancel_unpaid_order_atomic'),
    ('fnb_void_invoice_atomic'),
    ('verify_pos_pin'),
    ('list_pos_pin_users')
),
rpc_security as (
  select
    r.rpc_name,
    count(p.oid) as so_overload,
    coalesce(bool_and(p.prosecdef), false) as security_definer,
    coalesce(bool_and(pg_get_userbyid(p.proowner) = 'postgres'), false) as owner_postgres,
    coalesce(bool_and(not has_function_privilege('anon', p.oid, 'execute')), false) as anon_bi_chan,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )), false) as public_bi_chan,
    coalesce(bool_and(has_function_privilege('authenticated', p.oid, 'execute')), false) as authenticated_goi_duoc,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'chu_ky', p.oid::regprocedure::text,
        'chu_so_huu', pg_get_userbyid(p.proowner),
        'security_definer', p.prosecdef
      ) order by p.oid::regprocedure::text
    ) filter (where p.oid is not null), '[]'::jsonb) as chi_tiet
  from target_rpcs r
  left join pg_proc p
    on p.proname = r.rpc_name
   and p.pronamespace = 'public'::regnamespace
  group by r.rpc_name
),
cancel_void_branch_guard as (
  select
    r.rpc_name,
    count(p.oid) = 1 as dung_mot_ham,
    coalesce(bool_and(
      position('user_has_branch_access' in pg_get_functiondef(p.oid)) > 0
    ), false) as co_kiem_chi_nhanh,
    coalesce(bool_and(
      case when r.rpc_name = 'fnb_void_invoice_atomic' then
        position('p_voided_by <> v_actor' in pg_get_functiondef(p.oid)) > 0
        or position('p_voided_by != v_actor' in pg_get_functiondef(p.oid)) > 0
        or position('p_voided_by is distinct from v_actor' in pg_get_functiondef(p.oid)) > 0
      else true end
    ), false) as voided_by_la_nguoi_dang_nhap,
    coalesce(bool_and(
      case when r.rpc_name = 'fnb_void_invoice_atomic' then
        position('p_kitchen_order_id' in pg_get_functiondef(p.oid)) > 0
        and position('invoice_id = p_invoice_id' in pg_get_functiondef(p.oid)) > 0
      else true end
    ), false) as don_bep_khop_hoa_don,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'chu_ky', p.oid::regprocedure::text,
        'co_kiem_chi_nhanh', position('user_has_branch_access' in pg_get_functiondef(p.oid)) > 0,
        'voided_by_la_nguoi_dang_nhap', case when r.rpc_name = 'fnb_void_invoice_atomic' then
          position('p_voided_by <> v_actor' in pg_get_functiondef(p.oid)) > 0
          or position('p_voided_by != v_actor' in pg_get_functiondef(p.oid)) > 0
          or position('p_voided_by is distinct from v_actor' in pg_get_functiondef(p.oid)) > 0
        else true end,
        'don_bep_khop_hoa_don', case when r.rpc_name = 'fnb_void_invoice_atomic' then
          position('p_kitchen_order_id' in pg_get_functiondef(p.oid)) > 0
          and position('invoice_id = p_invoice_id' in pg_get_functiondef(p.oid)) > 0
        else true end,
        'md5_ham_dang_cai', md5(pg_get_functiondef(p.oid))
      ) order by p.oid::regprocedure::text
    ) filter (where p.oid is not null), '[]'::jsonb) as chi_tiet
  from (
    values
      ('fnb_cancel_unpaid_order_atomic'),
      ('fnb_void_invoice_atomic')
  ) as r(rpc_name)
  left join pg_proc p
    on p.proname = r.rpc_name
   and p.pronamespace = 'public'::regnamespace
  group by r.rpc_name
),
payment_shift_guard as (
  select
    count(p.oid) = 1 as dung_mot_ham,
    coalesce(bool_and(
      position('FNB_PAYMENT_OPEN_SHIFT_REQUIRED' in pg_get_functiondef(p.oid)) > 0
      and position('SHIFT_NOT_OPEN_FOR_USER_BRANCH' in pg_get_functiondef(p.oid)) > 0
    ), false) as bat_buoc_ca_dang_mo,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'chu_ky', p.oid::regprocedure::text,
        'bat_buoc_ca_dang_mo', position('FNB_PAYMENT_OPEN_SHIFT_REQUIRED' in pg_get_functiondef(p.oid)) > 0,
        'co_guard_ca_dung_chi_nhanh', position('SHIFT_NOT_OPEN_FOR_USER_BRANCH' in pg_get_functiondef(p.oid)) > 0,
        'md5_ham_dang_cai', md5(pg_get_functiondef(p.oid))
      ) order by p.oid::regprocedure::text
    ) filter (where p.oid is not null), '[]'::jsonb) as chi_tiet
  from pg_proc p
  where p.proname = 'fnb_complete_payment_atomic_v3'
    and p.pronamespace = 'public'::regnamespace
),
active_staff as (
  select
    p.id,
    p.full_name,
    p.role,
    p.role_id,
    p.branch_id,
    public.user_has_permission(p.id, 'pos_fnb.send_kitchen') as gui_bep,
    public.user_has_permission(p.id, 'pos_fnb.view_orders') as thanh_toan,
    public.user_has_permission(p.id, 'pos_fnb.cancel_unpaid_order')
      or public.user_has_permission(p.id, 'pos_fnb.void') as huy_chua_thu,
    public.user_has_permission(p.id, 'pos_fnb.void_paid_bill')
      or public.user_has_permission(p.id, 'pos_fnb.void') as huy_da_thu,
    public.user_has_permission(p.id, 'pos_fnb.discount') as giam_gia,
    public.user_has_permission(p.id, 'pos_fnb.manage_tables') as cau_hinh_ban
  from public.profiles p
  cross join tenant_scope t
  where p.tenant_id = t.tenant_id
    and coalesce(p.is_active, true)
),
security_ready as (
  select
    (select count(*) = 11 from table_security)
    and (select bool_and(rls_bat and not auth_insert and not auth_update and not auth_delete) from table_security) as direct_dml_da_khoa,
    (select bool_and(
      so_overload = 1
      and security_definer
      and owner_postgres
      and anon_bi_chan
      and public_bi_chan
      and authenticated_goi_duoc
    ) from rpc_security) as rpc_da_khoa,
    (select bool_and(
      dung_mot_ham
      and co_kiem_chi_nhanh
      and voided_by_la_nguoi_dang_nhap
      and don_bep_khop_hoa_don
    ) from cancel_void_branch_guard) as huy_bill_dung_chi_nhanh,
    (select dung_mot_ham and bat_buoc_ca_dang_mo from payment_shift_guard) as thanh_toan_bat_buoc_co_ca
),
handover_schema as (
  select
    count(*) filter (where column_name = 'customer_id') > 0 as co_customer_id,
    count(*) filter (where column_name = 'customer_name') > 0 as co_customer_name,
    count(*) filter (where column_name = 'discount_amount') > 0 as co_giam_gia,
    count(*) filter (where column_name = 'discount_reason') > 0 as co_ly_do_giam,
    count(*) filter (where column_name = 'note') > 0 as co_ghi_chu,
    count(*) filter (where column_name = 'delivery_platform') > 0 as co_kenh_giao,
    count(*) filter (where column_name = 'delivery_fee') > 0 as co_phi_giao
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'kitchen_orders'
),
unpaid_order_financials as (
  select
    count(*) filter (where invoice_id is null and status not in ('completed', 'cancelled')) as don_chua_thu,
    count(*) filter (
      where invoice_id is null
        and status not in ('completed', 'cancelled')
        and coalesce(discount_amount, 0) <> 0
    ) as don_chua_thu_co_giam_gia
  from public.kitchen_orders ko
  cross join tenant_scope t
  where ko.tenant_id = t.tenant_id
)
select
  'P0_TENANT_DUNG' as muc,
  'DIEU_KIEN' as loai,
  exists(
    select 1 from public.tenants ten
    cross join tenant_scope t
    where ten.id = t.tenant_id and ten.name = 'OneBiz Coffee Demo'
  ) as dat,
  jsonb_build_object('tenant_id', (select tenant_id from tenant_scope), 'tenant_name', 'OneBiz Coffee Demo') as chi_tiet,
  'Dung neu tenant hoac ten cong ty khac.' as viec_can_lam

union all

select
  'P1_RLS_VA_GHI_TRUC_TIEP' as muc,
  'DIEU_KIEN' as loai,
  direct_dml_da_khoa as dat,
  (
    select jsonb_agg(
      jsonb_build_object(
        'bang', table_name,
        'rls_bat', rls_bat,
        'authenticated_insert', auth_insert,
        'authenticated_update', auth_update,
        'authenticated_delete', auth_delete
      ) order by table_name
    ) from table_security
  ) as chi_tiet,
  'Neu false: dung go-live; khoa ghi truc tiep bang migration rieng sau khi ra soat caller hop le.' as viec_can_lam
from security_ready

union all

select
  'P3B_HUY_BILL_DUNG_CHI_NHANH' as muc,
  'DIEU_KIEN' as loai,
  huy_bill_dung_chi_nhanh as dat,
  (
    select jsonb_agg(
      jsonb_build_object(
        'ham', rpc_name,
        'dung_mot_ham', dung_mot_ham,
        'co_kiem_chi_nhanh', co_kiem_chi_nhanh,
        'voided_by_la_nguoi_dang_nhap', voided_by_la_nguoi_dang_nhap,
        'don_bep_khop_hoa_don', don_bep_khop_hoa_don,
        'chi_tiet', chi_tiet
      ) order by rpc_name
    ) from cancel_void_branch_guard
  ) as chi_tiet,
  'Neu false: dung go-live. Can boc RPC huy bill bang kiem chi nhanh, khoa quan he hoa don-don bep va khong tin nguoi huy do client gui len.' as viec_can_lam
from security_ready

union all

select
  'P3C_THANH_TOAN_TRONG_CA' as muc,
  'DIEU_KIEN' as loai,
  thanh_toan_bat_buoc_co_ca as dat,
  (select jsonb_build_object(
    'dung_mot_ham', dung_mot_ham,
    'bat_buoc_ca_dang_mo', bat_buoc_ca_dang_mo,
    'chi_tiet', chi_tiet
  ) from payment_shift_guard) as chi_tiet,
  'Neu false: dung go-live. Thanh toan FnB phai co ca dang mo cua dung thu ngan va dung chi nhanh; retry da thanh toan khong duoc tao giao dich moi.' as viec_can_lam
from security_ready

union all

select
  'P2_POLICY_BANG_NHAY_CAM' as muc,
  'THONG_TIN' as loai,
  null::boolean as dat,
  (
    select jsonb_agg(
      jsonb_build_object('bang', table_name, 'policies', policies)
      order by table_name
    ) from table_security
  ) as chi_tiet,
  'Doi chieu policy tenant/chi nhanh truoc khi viet bat ky migration RLS nao.' as viec_can_lam

union all

select
  'P3_RPC_THU_NGAN_VA_HUY_BILL' as muc,
  'DIEU_KIEN' as loai,
  rpc_da_khoa as dat,
  (
    select jsonb_agg(
      jsonb_build_object(
        'ham', rpc_name,
        'so_overload', so_overload,
        'security_definer', security_definer,
        'owner_postgres', owner_postgres,
        'anon_bi_chan', anon_bi_chan,
        'public_bi_chan', public_bi_chan,
        'authenticated_goi_duoc', authenticated_goi_duoc,
        'chi_tiet', chi_tiet
      ) order by rpc_name
    ) from rpc_security
  ) as chi_tiet,
  'Neu false: dung go-live; khong thanh toan/huy bill qua giao dien cho toi khi sua xong.' as viec_can_lam
from security_ready

union all

select
  'P4_MA_TRAN_QUYEN_NHAN_SU_FNB' as muc,
  'DIEU_KIEN' as loai,
  coalesce((select bool_or(gui_bep and thanh_toan) from active_staff), false) as dat,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'ten', coalesce(s.full_name, s.id::text),
        'vai_tro', s.role,
        'chi_nhanh_mac_dinh', b.name,
        'gui_bep', s.gui_bep,
        'thanh_toan', s.thanh_toan,
        'huy_chua_thu', s.huy_chua_thu,
        'huy_da_thu', s.huy_da_thu,
        'giam_gia', s.giam_gia,
        'cau_hinh_ban', s.cau_hinh_ban,
        'chi_nhanh_duoc_vao', coalesce(accessible.branches, '[]'::jsonb)
      ) order by coalesce(s.full_name, s.id::text)
    )
    from active_staff s
    left join public.branches b on b.id = s.branch_id
    cross join lateral (
      select jsonb_agg(
        jsonb_build_object('id', branch.id, 'ten', branch.name)
        order by branch.name
      ) as branches
      from public.branches branch
      cross join tenant_scope t
      where branch.tenant_id = t.tenant_id
        and coalesce(branch.is_active, true)
        and public.user_has_branch_access(s.id, branch.id)
    ) accessible
  ), '[]'::jsonb) as chi_tiet,
  'Can it nhat mot nhan su co ca gui bep va thanh toan; ra soat tung nguoi truoc khi cap PIN.' as viec_can_lam

union all

select
  'P5_TRAM_BEP_DANG_BAT' as muc,
  'DIEU_KIEN' as loai,
  exists(
    select 1
    from public.kitchen_stations ks
    cross join tenant_scope t
    where ks.tenant_id = t.tenant_id and ks.is_active
  ) as dat,
  (
    select coalesce(jsonb_agg(
      jsonb_build_object('chi_nhanh', b.name, 'tram', ks.name, 'bat', ks.is_active)
      order by b.name, ks.sort_order, ks.name
    ), '[]'::jsonb)
    from public.kitchen_stations ks
    join public.branches b on b.id = ks.branch_id
    cross join tenant_scope t
    where ks.tenant_id = t.tenant_id
  ) as chi_tiet,
  'Cau hinh toi thieu mot tram Bar pha che cho moi chi nhanh FnB se mo ban.' as viec_can_lam

union all

select
  'P6_BAN_GIAO_CA_KHAC_MAY' as muc,
  'THONG_TIN' as loai,
  null::boolean as dat,
  jsonb_build_object(
    'customer_id_da_luu_tren_don_bep', co_customer_id,
    'customer_name_da_luu_tren_don_bep', co_customer_name,
    'ghi_chu_da_luu', co_ghi_chu,
    'kenh_giao_da_luu', co_kenh_giao,
    'phi_giao_da_luu', co_phi_giao
  ) as chi_tiet,
  'Cung may: gio tam giu theo chi nhanh. Khac may: xac nhan lai khach truoc thanh toan neu don bep chua luu customer_id/customer_name.' as viec_can_lam
from handover_schema

union all

select
  'P7_GIAM_GIA_DON_CHUA_THU' as muc,
  'THONG_TIN' as loai,
  null::boolean as dat,
  jsonb_build_object(
    'co_cot_giam_gia', co_giam_gia,
    'co_cot_ly_do_giam', co_ly_do_giam,
    'don_chua_thu', don_chua_thu,
    'don_chua_thu_co_giam_gia_da_luu', don_chua_thu_co_giam_gia
  ) as chi_tiet,
  'Neu co don da gui bep co giam gia, doi chieu tong tren ca khac truoc thanh toan; khong duoc suy dien gia tri tu UI cu.' as viec_can_lam
from handover_schema
cross join unpaid_order_financials

union all

select
  'Z_KET_LUAN_BAO_MAT_THU_NGAN' as muc,
  'KET_LUAN' as loai,
  direct_dml_da_khoa
    and rpc_da_khoa
    and huy_bill_dung_chi_nhanh
    and thanh_toan_bat_buoc_co_ca
    and coalesce((select bool_or(gui_bep and thanh_toan) from active_staff), false) as dat,
  jsonb_build_object(
    'direct_dml_da_khoa', direct_dml_da_khoa,
    'rpc_da_khoa', rpc_da_khoa,
    'huy_bill_dung_chi_nhanh', huy_bill_dung_chi_nhanh,
    'thanh_toan_bat_buoc_co_ca', thanh_toan_bat_buoc_co_ca,
    'co_nhan_su_gui_bep_va_thanh_toan', coalesce((select bool_or(gui_bep and thanh_toan) from active_staff), false)
  ) as chi_tiet,
  'Chi phan bao mat/quyen thu ngan. Van phai dat D1-D6 du lieu FnB va UAT mot mau do uong truoc mo ban.' as viec_can_lam
from security_ready;
