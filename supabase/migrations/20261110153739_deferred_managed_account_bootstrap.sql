-- GoTrue adminUserCreate INSERTs auth.users, then UPDATEs app_metadata in the
-- same transaction. Validate the final persisted row at commit, not the INSERT
-- snapshot. Failed validation still rolls back the entire Auth transaction.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
do $migration$
declare body text;
begin
  body := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  body := replace(body, E'\r\n', E'\n');
  if strpos(body, 'MANAGED_ACCOUNT_SERVER_CONTEXT_REQUIRED') = 0
     or strpos(body, 'managed_tenant_id') = 0 then
    raise exception 'ACCOUNT_BOOTSTRAP_CONTRACT_CHANGED';
  end if;
  if strpos(body, E'begin\n') = 0 then
    raise exception 'ACCOUNT_BOOTSTRAP_BODY_CHANGED';
  end if;
  body := replace(body, E'begin\n', E'begin\n  -- Deferred event NEW is the INSERT snapshot; re-read trusted final metadata.\n  select u.* into new from auth.users u where u.id = new.id;\n  if not found then return null; end if;\n');
  execute body;
end $migration$;
drop trigger on_auth_user_created on auth.users;
create constraint trigger on_auth_user_created
after insert on auth.users
deferrable initially deferred
for each row execute function public.handle_new_user();
comment on trigger on_auth_user_created on auth.users is
  'Bootstrap at commit after GoTrue writes server-controlled app_metadata; untrusted tenant/role claims remain rejected atomically.';
commit;
