-- Restore the existing tenant boundary. No permissive policies or grants added.
-- Live preflight 2026-10-07: all three tables disabled; existing policies copied
-- into the isolated acceptance fixture. Cash UPDATE/DELETE are RPC-only.
begin;
set local lock_timeout = '1s';
do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_items','cash_transactions'] loop
    if not exists(select 1 from pg_policy where polrelid=('public.'||t)::regclass and polcmd='r')
       or not exists(select 1 from pg_policy where polrelid=('public.'||t)::regclass and polcmd='a') then
      raise exception '00446: missing read/insert policy on %; run live preflight', t;
    end if;
    if exists(select 1 from pg_policy where polrelid=('public.'||t)::regclass
      and (polcmd='*' or coalesce(pg_get_expr(polqual,polrelid),'')='true'
        or coalesce(pg_get_expr(polwithcheck,polrelid),'')='true')) then
      raise exception '00446: broad policy on %; review before enabling', t;
    end if;
  end loop;
end $$;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.cash_transactions enable row level security;
commit;
