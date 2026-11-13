-- Limit direct writes to own order records unless another right grants access.
-- Existing branch RLS and the order RPC-only guard remain independently active.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_own_order_invoice_write_allowed(p_invoice uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public._staff_order_owner_unrestricted() or exists(
  select 1 from public.invoices i where i.id=p_invoice
   and i.tenant_id=public.get_user_tenant_id()
   and public.can_read_branch_document_00567(i.tenant_id,i.branch_id)
   and (i.source is distinct from 'order' or i.created_by=auth.uid()
        or coalesce(i.branch_id=any(public._staff_order_independent_branches()),false)))
$$;
create function public._staff_own_legacy_order_write_allowed(p_order uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public._staff_order_owner_unrestricted() or exists(
  select 1 from public.sales_orders o where o.id=p_order
   and o.tenant_id=public.get_user_tenant_id()
   and public.can_read_branch_document_00567(o.tenant_id,o.branch_id)
   and (o.created_by=auth.uid()
        or coalesce(o.branch_id=any(public._staff_order_independent_branches()),false)))
$$;
revoke all on function public._staff_own_order_invoice_write_allowed(uuid),
 public._staff_own_legacy_order_write_allowed(uuid) from public,anon;
grant execute on function public._staff_own_order_invoice_write_allowed(uuid),
 public._staff_own_legacy_order_write_allowed(uuid) to authenticated;
do $policies$
declare item record; command text; predicate text; check_clause text;
begin
 for item in select * from (values
  ('invoices','source is distinct from ''order'' or (select public._staff_order_owner_unrestricted()) or created_by=(select auth.uid()) or coalesce(branch_id=any((select public._staff_order_independent_branches())::uuid[]),false)'),
  ('invoice_items','public._staff_own_order_invoice_write_allowed(invoice_id)'),
  ('shipping_orders','public._staff_own_order_invoice_write_allowed(invoice_id)'),
  ('sales_orders','(select public._staff_order_owner_unrestricted()) or created_by=(select auth.uid()) or coalesce(branch_id=any((select public._staff_order_independent_branches())::uuid[]),false)'),
  ('sales_order_items','public._staff_own_legacy_order_write_allowed(order_id)')
 ) as v(table_name,condition_sql) loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=item.table_name and c.relrowsecurity) then
   raise exception 'STAFF_OWN_ORDER_TABLE_RLS_MISSING: %',item.table_name;
  end if;
  predicate:='('||item.condition_sql||')';
  foreach command in array array['INSERT','UPDATE','DELETE'] loop
   check_clause:=case command
    when 'INSERT' then 'with check ('||predicate||')'
    when 'UPDATE' then 'using ('||predicate||') with check ('||predicate||')'
    else 'using ('||predicate||')' end;
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
    'staff_own_order_'||lower(command),item.table_name,command,check_clause);
  end loop;
 end loop;
end $policies$;
-- Legacy order tables have their own read path, independent of invoices.
create policy staff_own_legacy_order_read on public.sales_orders as restrictive
 for select to authenticated using (
  (select public._staff_order_owner_unrestricted())
  or created_by=(select auth.uid())
  or coalesce(branch_id=any((select public._staff_order_independent_branches())::uuid[]),false)
 );
create policy staff_own_legacy_order_item_read on public.sales_order_items as restrictive
 for select to authenticated using (public._staff_own_legacy_order_write_allowed(order_id));
commit;
