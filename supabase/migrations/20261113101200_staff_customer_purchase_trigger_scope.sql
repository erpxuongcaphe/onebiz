begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Internal invoice trigger runs as its owner; callers must not directly invoke
-- this unscoped security-definer helper on arbitrary customers.
do $migration$
declare helper regprocedure := 'public.recompute_customer_last_purchase(uuid)'::regprocedure;
 trigger_func oid;
begin
  select t.tgfoid into trigger_func from pg_trigger t
   where t.tgrelid='public.invoices'::regclass
     and t.tgname='trg_invoices_sync_last_purchase' and not t.tgisinternal and t.tgenabled <> 'D';
  if trigger_func is null or not exists (
    select 1 from pg_proc p join pg_proc f on f.oid=helper
    where p.oid=trigger_func and p.prosecdef and p.proowner=f.proowner
      and position('public.recompute_customer_last_purchase' in pg_get_functiondef(p.oid))>0
  ) then raise exception 'STAFF_CUSTOMER_PURCHASE_TRIGGER_CHANGED'; end if;
end
$migration$;
revoke execute on function public.recompute_customer_last_purchase(uuid) from public, anon, authenticated;
commit;
