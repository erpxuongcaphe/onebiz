-- 00348: The project grants EXECUTE to authenticated/service_role by default.
-- Trigger functions are invoked by PostgreSQL when their table changes and do
-- not need any API role to call them directly. 00347 was already installed on
-- production, so this is intentionally a separate, no-data hotfix.

begin;

revoke all on function public.enforce_modifier_option_integrity_00347()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_modifier_group_integrity_00347()
  from public, anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
