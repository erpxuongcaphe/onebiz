-- ============================================================================
-- PREFLIGHT A1 — trước khi khoá sổ nhật ký (00328). CHỈ ĐỌC.
-- Chạy 2 lần: trước và sau migration để đối chiếu.
-- ============================================================================

select * from (
  select 1 as stt, 'A. QUYỀN TRÊN audit_log' as muc,
         g.grantee || ' | ' || g.privilege_type as ket_qua
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.table_name = 'audit_log'
    and g.grantee in ('authenticated','anon','public')

  union all
  select 2, 'B. SỐ DÒNG NHẬT KÝ (không được đổi)', count(*)::text
  from public.audit_log

  union all
  select 3, 'C. RLS audit_log',
         'rowsecurity=' || c.relrowsecurity::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'audit_log'

  union all
  select 4, 'D. POLICY audit_log',
         p.policyname || ' | lệnh=' || p.cmd
           || ' | vai trò=' || array_to_string(p.roles, ',')
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'audit_log'

  union all
  select 5, 'E. GHI NHẬT KÝ 7 NGÀY QUA (chứng minh luồng ghi vẫn sống)',
         count(*)::text || ' dòng'
  from public.audit_log where created_at >= now() - interval '7 days'
) t order by stt, ket_qua;
