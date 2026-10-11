-- Catalog only. Run after the separately approved foundation change.
begin read only;
set local statement_timeout='10s';
select c.relname,c.relrowsecurity,
 has_table_privilege('authenticated',c.oid,'INSERT') as direct_insert,
 has_table_privilege('authenticated',c.oid,'UPDATE') as direct_update,
 has_table_privilege('authenticated',c.oid,'DELETE') as direct_delete,
 has_table_privilege('authenticated',c.oid,'TRUNCATE') as direct_truncate
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
 ('profiles','branches','tenants','roles','role_permissions','user_branches')
order by c.relname;
-- Must return zero rows: leftover column-write grants.
select table_name,column_name,grantee,privilege_type
from information_schema.column_privileges
where table_schema='public' and table_name in
 ('profiles','branches','tenants','roles','role_permissions','user_branches')
 and grantee in ('authenticated','anon','PUBLIC')
 and privilege_type in ('INSERT','UPDATE','REFERENCES');
select tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and policyname like 'foundation_%'
order by tablename,policyname;
select p.oid::regprocedure as signature,p.prosecdef,r.rolname as owner,
 p.proconfig,p.proacl,
 position('SELF_ACCESS_CHANGE_DENIED' in pg_get_functiondef(p.oid))>0 as self_access_guard,
 position('SELF_ROLE_CHANGE_DENIED' in pg_get_functiondef(p.oid))>0 as self_role_guard
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in
 ('foundation_actor_active','foundation_override_allowed','update_managed_user_atomic',
 'initialize_managed_user_atomic','save_role_atomic','delete_role_atomic')
order by p.proname;
rollback;
