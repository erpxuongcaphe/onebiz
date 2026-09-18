-- Read-only structural checks after 00386; not an end-to-end permission test.
select
  to_regclass('public.fnb_supply_catalog') is not null as catalog_table_ok,
  to_regclass('public.fnb_supply_catalog_audit') is not null as audit_table_ok,
  to_regprocedure('public.save_fnb_supply_catalog(uuid[],uuid[],text)') is not null as save_rpc_ok;

select c.relname, c.relrowsecurity as rls_enabled,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_can_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_can_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_can_delete
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('fnb_supply_catalog', 'fnb_supply_catalog_audit');

select p.proname, p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p where p.oid = to_regprocedure('public.save_fnb_supply_catalog(uuid[],uuid[],text)');
