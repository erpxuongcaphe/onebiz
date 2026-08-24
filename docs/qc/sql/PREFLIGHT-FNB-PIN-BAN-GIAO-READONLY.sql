-- ============================================================
-- PREFLIGHT FNB PIN BAN GIAO - CHI DOC
--
-- Muc dich:
--   Chup dung ban RPC PIN dang cai tren production truoc khi viet
--   migration sieu chat quyen ban giao quay FnB.
--
-- An toan:
--   Chi SELECT he thong. Khong INSERT / UPDATE / DELETE / DDL / notify.
--   Khong can dan tenant_id va khong doc PIN hay PIN hash.
--
-- Cach dung:
--   Chay toan bo file trong Supabase SQL Editor bang role postgres.
--   Gui day du cac dong P1-P5 cho nguoi lap trinh.
-- ============================================================

with ham_muc_tieu(ma, chu_ky) as (
  values
    ('verify_pos_pin', 'public.verify_pos_pin(uuid,text,uuid)'),
    ('list_pos_pin_users', 'public.list_pos_pin_users(uuid)'),
    ('user_has_branch_access', 'public.user_has_branch_access(uuid,uuid)'),
    ('user_has_permission', 'public.user_has_permission(uuid,text)')
),
ham as (
  select
    h.ma,
    h.chu_ky,
    p.oid,
    n.nspname as schema_name,
    p.proname,
    pg_get_function_identity_arguments(p.oid) as tham_so,
    r.rolname as chu_so_huu,
    p.prosecdef as security_definer,
    md5(pg_get_functiondef(p.oid)) as md5_dinh_nghia,
    pg_get_functiondef(p.oid) as dinh_nghia
  from ham_muc_tieu h
  left join pg_proc p on p.oid = to_regprocedure(h.chu_ky)
  left join pg_namespace n on n.oid = p.pronamespace
  left join pg_roles r on r.oid = p.proowner
),
cot_bat_buoc as (
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
    and (
      (table_name = 'profiles' and column_name in (
        'id', 'tenant_id', 'branch_id', 'is_active', 'pos_pin_hash',
        'pos_pin_failed_attempts', 'pos_pin_locked_until'
      ))
      or (table_name = 'audit_log' and column_name in (
        'tenant_id', 'user_id', 'action', 'entity_type', 'entity_id',
        'old_data', 'new_data', 'created_at'
      ))
      or (table_name = 'shifts' and column_name in (
        'id', 'tenant_id', 'branch_id', 'cashier_id', 'status', 'opened_at'
      ))
      or (table_name = 'branches' and column_name in ('id', 'tenant_id', 'is_active'))
      or (table_name = 'user_branches' and column_name in ('user_id', 'branch_id'))
    )
),
cot_ky_vong(table_name, column_name) as (
  values
    ('profiles', 'id'), ('profiles', 'tenant_id'), ('profiles', 'branch_id'),
    ('profiles', 'is_active'), ('profiles', 'pos_pin_hash'),
    ('profiles', 'pos_pin_failed_attempts'), ('profiles', 'pos_pin_locked_until'),
    ('audit_log', 'tenant_id'), ('audit_log', 'user_id'), ('audit_log', 'action'),
    ('audit_log', 'entity_type'), ('audit_log', 'entity_id'), ('audit_log', 'old_data'),
    ('audit_log', 'new_data'), ('audit_log', 'created_at'),
    ('shifts', 'id'), ('shifts', 'tenant_id'), ('shifts', 'branch_id'),
    ('shifts', 'cashier_id'), ('shifts', 'status'), ('shifts', 'opened_at'),
    ('branches', 'id'), ('branches', 'tenant_id'), ('branches', 'is_active'),
    ('user_branches', 'user_id'), ('user_branches', 'branch_id')
),
default_acl as (
  select
    coalesce(n.nspname, '(toan database)') as pham_vi,
    r.rolname as chu_so_huu,
    d.defaclacl::text as acl
  from pg_default_acl d
  join pg_roles r on r.oid = d.defaclrole
  left join pg_namespace n on n.oid = d.defaclnamespace
  where d.defaclobjtype = 'f'
    and r.rolname in ('postgres', 'supabase_admin')
)
select
  'P1_HAM_DANG_CAI' as muc,
  case when h.oid is not null then 'DIEU_KIEN' else 'LOI' end as loai,
  h.oid is not null as dat,
  jsonb_build_object(
    'ma', h.ma,
    'chu_ky_ky_vong', h.chu_ky,
    'chu_ky_thuc_te', h.tham_so,
    'chu_so_huu', h.chu_so_huu,
    'security_definer', h.security_definer,
    'md5_dinh_nghia', h.md5_dinh_nghia
  ) as chi_tiet
from ham h

union all

select
  'P2_QUYEN_GOI_HAM' as muc,
  'THONG_TIN' as loai,
  null::boolean as dat,
  jsonb_build_object(
    'ma', h.ma,
    'anon', case when h.oid is null then null else has_function_privilege('anon', h.oid, 'EXECUTE') end,
    'authenticated', case when h.oid is null then null else has_function_privilege('authenticated', h.oid, 'EXECUTE') end,
    'public', case when h.oid is null then null else has_function_privilege('public', h.oid, 'EXECUTE') end
  ) as chi_tiet
from ham h

union all

select
  'P3_GUARD_HIEN_CO' as muc,
  'THONG_TIN' as loai,
  null::boolean as dat,
  jsonb_build_object(
    'ma', h.ma,
    'co_auth_uid', position('auth.uid()' in coalesce(h.dinh_nghia, '')) > 0,
    'co_kiem_tenant', position('tenant_id' in coalesce(h.dinh_nghia, '')) > 0,
    'co_kiem_chi_nhanh', position('branch' in coalesce(h.dinh_nghia, '')) > 0,
    'co_kiem_quyen_fnb', position('pos_fnb.send_kitchen' in coalesce(h.dinh_nghia, '')) > 0,
    'co_for_update', position('for update' in lower(coalesce(h.dinh_nghia, ''))) > 0
  ) as chi_tiet
from ham h
where h.ma in ('verify_pos_pin', 'list_pos_pin_users')

union all

select
  'P4_SCHEMA_CHO_NHAT_KY_BAN_GIAO' as muc,
  case when count(*) = (select count(*) from cot_ky_vong) then 'DIEU_KIEN' else 'LOI' end as loai,
  count(*) = (select count(*) from cot_ky_vong) as dat,
  jsonb_build_object(
    'cot_tim_thay', jsonb_agg(jsonb_build_object('bang', c.table_name, 'cot', c.column_name) order by c.table_name, c.column_name),
    'cot_con_thieu', (
      select coalesce(jsonb_agg(jsonb_build_object('bang', e.table_name, 'cot', e.column_name) order by e.table_name, e.column_name), '[]'::jsonb)
      from cot_ky_vong e
      left join cot_bat_buoc c2 on c2.table_name = e.table_name and c2.column_name = e.column_name
      where c2.column_name is null
    )
  ) as chi_tiet
from cot_bat_buoc c

union all

select
  'P5_DEFAULT_ACL_HAM' as muc,
  'THONG_TIN' as loai,
  null::boolean as dat,
  jsonb_build_object('pham_vi', d.pham_vi, 'chu_so_huu', d.chu_so_huu, 'acl', d.acl) as chi_tiet
from default_acl d

order by muc;
