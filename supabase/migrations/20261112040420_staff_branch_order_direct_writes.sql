-- Local order exceptions must use invariant-preserving, branch-checked RPCs.
-- Users without order exceptions retain their previous direct-write behavior.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_direct_order_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.user_branch_permission_overrides o
    where o.user_id=auth.uid() and o.permission_code in ('orders.create','orders.cancel'))
$$;
revoke all on function public._staff_direct_order_write_allowed() from public,anon;
grant execute on function public._staff_direct_order_write_allowed() to authenticated;
do $policies$
declare t text; command text;
begin
 foreach t in array array['invoices','invoice_items','sales_orders','sales_order_items','shipping_orders'] loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=t and c.relrowsecurity) then
    raise exception 'STAFF_ORDER_TABLE_RLS_MISSING: %',t;
  end if;
  foreach command in array array['INSERT','UPDATE','DELETE'] loop
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
     'staff_order_'||lower(command),t,command,
     case command when 'INSERT' then 'with check ((select public._staff_direct_order_write_allowed()))'
       when 'UPDATE' then 'using ((select public._staff_direct_order_write_allowed())) with check ((select public._staff_direct_order_write_allowed()))'
       else 'using ((select public._staff_direct_order_write_allowed()))' end);
  end loop;
 end loop;
end $policies$;
commit;
