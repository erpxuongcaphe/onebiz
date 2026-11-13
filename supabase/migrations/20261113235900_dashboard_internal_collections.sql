-- Read-only reconciliation using the same authorization and source rules as the sales dashboard.
begin;
create function public.get_dashboard_collection_reconciliation(p_branch_id uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); tenant uuid; internal_rows jsonb; external_rows jsonb; total_rows jsonb;
begin
  -- Existing entry point enforces active tenant, branch access and sales-report permissions.
  perform public.get_operational_sales_dashboard(p_branch_id,p_day,p_day,'hour');
  select p.tenant_id into tenant from public.profiles p where p.id=actor and p.is_active;
  with money as (
    select coalesce(c.payment_method,'unknown') method,
      coalesce(i.source,'') = 'internal' internal,
      case when c.type='receipt' then c.amount else -c.amount end amount,
      c.type
    from public.cash_transactions c
    join public.invoices i on i.id=case when c.reference_type='sales_return'
      then (select r.invoice_id from public.sales_returns r where r.id=c.reference_id and r.tenant_id=tenant and r.branch_id=c.branch_id)
      else c.reference_id end and i.tenant_id=tenant and i.branch_id=c.branch_id
    where c.tenant_id=tenant and (p_branch_id is null or c.branch_id=p_branch_id)
      and c.status='completed' and c.transaction_date=p_day
      and ((c.type='receipt' and c.reference_type='invoice')
        or (c.type='payment' and c.reference_type in ('invoice','invoice_void','sales_return')))
  ), groups as (
    select internal, coalesce(sum(amount),0) net,
      coalesce(sum(amount) filter(where type='receipt'),0) received,
      -coalesce(sum(amount) filter(where type='payment'),0) refunded
    from money group by internal
  ), methods as (
    select internal, method, sum(amount) net from money group by internal, method
  )
  select
    coalesce((select jsonb_build_object('net',g.net,'received',g.received,'refunded',g.refunded,
      'methods',coalesce((select jsonb_object_agg(m.method,m.net) from methods m where m.internal=g.internal),'{}'::jsonb)) from groups g where g.internal), '{"net":0,"received":0,"refunded":0,"methods":{}}'::jsonb),
    coalesce((select jsonb_build_object('net',g.net,'received',g.received,'refunded',g.refunded,
      'methods',coalesce((select jsonb_object_agg(m.method,m.net) from methods m where m.internal=g.internal),'{}'::jsonb)) from groups g where not g.internal), '{"net":0,"received":0,"refunded":0,"methods":{}}'::jsonb)
  into internal_rows, external_rows;
  total_rows := jsonb_build_object('net',(internal_rows->>'net')::numeric+(external_rows->>'net')::numeric,
    'received',(internal_rows->>'received')::numeric+(external_rows->>'received')::numeric,
    'refunded',(internal_rows->>'refunded')::numeric+(external_rows->>'refunded')::numeric);
  return jsonb_build_object('internal',internal_rows,'external',external_rows,'total',total_rows);
end $$;
revoke all on function public.get_dashboard_collection_reconciliation(uuid,date) from public,anon;
grant execute on function public.get_dashboard_collection_reconciliation(uuid,date) to authenticated;
commit;
