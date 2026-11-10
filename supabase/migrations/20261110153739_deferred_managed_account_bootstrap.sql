-- Validate final trusted metadata at commit without changing Auth-owned triggers.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
create schema account_bootstrap_internal;
revoke all on schema account_bootstrap_internal from public;
create table account_bootstrap_internal.pending (id uuid primary key);
revoke all on account_bootstrap_internal.pending from public;
alter table account_bootstrap_internal.pending enable row level security;
do $migration$
declare body text;
begin
  body := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  body := replace(body, E'\r\n', E'\n');
  if strpos(body, 'MANAGED_ACCOUNT_SERVER_CONTEXT_REQUIRED') = 0
     or strpos(body, 'managed_tenant_id') = 0 then
    raise exception 'ACCOUNT_BOOTSTRAP_CONTRACT_CHANGED';
  end if;
  if strpos(body, E'begin\n') = 0 or strpos(body, E'declare\n') = 0 then
    raise exception 'ACCOUNT_BOOTSTRAP_BODY_CHANGED';
  end if;
  body := replace(body,'public.handle_new_user()', 'account_bootstrap_internal.finish_bootstrap()');
  body := replace(body,'new.', 'account_row.');
  body := replace(body,E'declare\n', E'declare\n  account_row auth.users%rowtype;\n');
  body := replace(body, E'begin\n', E'begin\n  delete from account_bootstrap_internal.pending where id = new.id;\n  select u.* into account_row from auth.users u where u.id = new.id;\n  if not found then return null; end if;\n');
  execute body;
end $migration$;
revoke all on function account_bootstrap_internal.finish_bootstrap() from public;
create constraint trigger finish_managed_account_bootstrap
after insert on account_bootstrap_internal.pending
deferrable initially deferred
for each row execute function account_bootstrap_internal.finish_bootstrap();
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into account_bootstrap_internal.pending(id) values(new.id);
 return new;
end;
$$;
comment on function public.handle_new_user() is
 'Queue bootstrap in the same transaction; final server metadata is validated at commit. Invalid scope rolls back Auth creation.';
commit;
