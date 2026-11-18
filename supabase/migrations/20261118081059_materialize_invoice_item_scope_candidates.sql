begin;
set local lock_timeout = '3s';

create or replace function public._staff_invoice_item_allowed_scopes()
returns text[] language sql stable security definer set search_path = '' as $$
  -- Materialize the distinct pairs before authorization. Without this fence
  -- PostgreSQL can push the permission filter below DISTINCT, once per invoice.
  with candidates as materialized (
    select distinct i.branch_id, coalesce(i.source, 'pos') as source
    from public.invoices i
    where i.tenant_id = (select public.get_user_tenant_id())
      and i.branch_id is not null
  )
  select coalesce(array_agg(q.branch_id::text || ':' || q.source), '{}'::text[])
  from candidates q
  where public._staff_invoice_item_read(
    (select public.get_user_tenant_id()), q.branch_id, q.source
  )
$$;

commit;
