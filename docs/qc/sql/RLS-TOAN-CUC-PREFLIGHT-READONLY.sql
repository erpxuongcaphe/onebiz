-- ============================================================
-- OneBiz - RLS inventory TOAN CUC (CHI DOC)
-- ============================================================
-- Muc dich:
--   Chup trang thai THUC TE cua tat ca bang public truoc khi bat RLS.
--   File nay khong can tenant_id, khong doc du lieu nghiep vu va khong ghi DB.
--
-- Cach dung:
--   1. Chay toan bo file trong Supabase SQL Editor.
--   2. Gui lai ca 5 bang ket qua P1-P5.
--   3. Khong bat RLS hay sua GRANT dua tren mot bang ket qua don le.
--
-- Luu y:
--   P3 phai doi chieu voi docs/PREFLIGHT-WEB-TABLE-ACCESS-2026-08-03.sql.
--   P4 in tung policy song de tranh them policy rong: policy permissive
--   cua PostgreSQL duoc ket hop bang OR.
-- ============================================================

-- P1 - Tong quan: bao nhieu bang public dang bat/tat RLS va co grant rong.
select
  'P1_TONG_QUAN' as muc,
  count(*) filter (where c.relkind in ('r', 'p')) as tong_bang,
  count(*) filter (where c.relkind in ('r', 'p') and c.relrowsecurity) as rls_da_bat,
  count(*) filter (where c.relkind in ('r', 'p') and not c.relrowsecurity) as rls_dang_tat,
  count(*) filter (
    where c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
  ) as bang_anon_co_quyen,
  count(*) filter (
    where c.relkind in ('r', 'p')
      and exists (
        select 1
        from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
        where acl.grantee = 0
      )
  ) as bang_public_co_quyen
from pg_class c
where c.relnamespace = 'public'::regnamespace;

-- P2 - Inventory tung bang. Khong ket luan bang nao "an toan" tu dong.
select
  'P2_BANG' as muc,
  c.relname as bang,
  pg_get_userbyid(c.relowner) as chu_so_huu,
  c.relrowsecurity as rls_da_bat,
  c.relforcerowsecurity as rls_bat_buoc_ca_owner,
  exists (
    select 1
    from information_schema.columns col
    where col.table_schema = 'public'
      and col.table_name = c.relname
      and col.column_name = 'tenant_id'
  ) as co_tenant_id,
  exists (
    select 1
    from information_schema.columns col
    where col.table_schema = 'public'
      and col.table_name = c.relname
      and col.column_name = 'user_id'
  ) as co_user_id,
  count(p.policyname) as so_policy,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as auth_delete
from pg_class c
left join pg_policies p
  on p.schemaname = 'public'
 and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace
  and c.relkind in ('r', 'p')
group by c.oid, c.relname, c.relowner, c.relrowsecurity, c.relforcerowsecurity
order by c.relrowsecurity, c.relname;

-- P3 - Grant hieu luc. Dung ACL he thong de bao gom ca PUBLIC (grantee = 0),
-- khong phu thuoc information_schema co hien grant PUBLIC hay khong.
with grant_rows as (
  select
    c.relname as bang,
    coalesce(r.rolname, 'PUBLIC') as grantee,
    acl.privilege_type
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
  left join pg_roles r on r.oid = acl.grantee
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and (
      acl.grantee = 0
      or r.rolname in ('anon', 'authenticated', 'service_role')
    )
)
select
  'P3_GRANT' as muc,
  bang,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as quyen
from grant_rows
group by bang, grantee
order by bang, grantee;

-- P4 - Toan bo policy song, ca permissive/restrictive va WITH CHECK.
select
  'P4_POLICY' as muc,
  tablename as bang,
  policyname as ten_policy,
  permissive,
  roles,
  cmd as lenh,
  qual as dieu_kien_doc_sua,
  with_check as dieu_kien_them_sua
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- P5 - Default privileges: bang/hay function moi co the tu nhan quyen rong.
select
  'P5_DEFAULT_ACL' as muc,
  coalesce(n.nspname, '(toan database)') as pham_vi,
  pg_get_userbyid(d.defaclrole) as chu_so_huu,
  d.defaclobjtype as loai_doi_tuong,
  coalesce(array_to_string(d.defaclacl, ', '), '(mac dinh PostgreSQL)') as acl
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
where d.defaclnamespace = 0
   or n.nspname = 'public'
order by pham_vi, chu_so_huu, loai_doi_tuong;
