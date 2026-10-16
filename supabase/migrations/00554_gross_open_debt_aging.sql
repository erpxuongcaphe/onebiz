begin;

-- Outstanding documents and unused advances are separate until explicitly allocated.
-- This current-balance reader does not change the legacy net-aging report contract.
create function public.get_counterparty_open_debt_aging(p_branch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant_id uuid; v_result jsonb;
begin
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);
  select tenant_id into v_tenant_id from public.profiles
  where id = auth.uid() and coalesce(is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE';
  end if;

  with first_receipt as (
    select reference_id, min(created_at) received_at
    from public.stock_movements
    where tenant_id = v_tenant_id and reference_type = 'purchase_order' and type = 'in'
      and (p_branch_id is null or branch_id = p_branch_id)
    group by reference_id
  ), documents as (
    select 'customer'::text party_type, i.customer_id party_id,
      coalesce(nullif(trim(i.customer_name), ''), 'Khách lẻ') party_name,
      i.debt amount, coalesce(i.ngay_chung_tu, i.created_at) debt_date
    from public.invoices i
    where i.tenant_id = v_tenant_id and i.status = 'completed'
      and i.deleted_at is null and i.debt > 0
      and (p_branch_id is null or i.branch_id = p_branch_id)
    union all
    select 'supplier', p.supplier_id, s.name, p.debt, coalesce(r.received_at, p.created_at)
    from public.purchase_orders p
    join public.suppliers s on s.id = p.supplier_id and s.tenant_id = p.tenant_id
    left join first_receipt r on r.reference_id = p.id
    where p.tenant_id = v_tenant_id and p.status in ('completed', 'partial') and p.debt > 0
      and (p_branch_id is null or p.branch_id = p_branch_id)
    union all
    select o.party_type, coalesce(o.customer_id, o.supplier_id),
      coalesce(c.name, s.name), o.amount,
      o.opening_date::timestamp at time zone 'Asia/Ho_Chi_Minh'
    from public.debt_opening_balances o
    left join public.customers c on c.id = o.customer_id and c.tenant_id = o.tenant_id
    left join public.suppliers s on s.id = o.supplier_id and s.tenant_id = o.tenant_id
    where o.tenant_id = v_tenant_id and o.amount > 0
      and (p_branch_id is null or o.branch_id = p_branch_id)
    union all
    select 'customer', a.customer_id, c.name, a.amount, a.created_at
    from public.customer_debt_adjustments a
    join public.customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
    left join public.cash_transactions ct on ct.id = a.cash_transaction_id and ct.tenant_id = a.tenant_id
    where a.tenant_id = v_tenant_id and a.amount > 0
      and coalesce(ct.category, '') <> 'customer_advance'
      and a.idempotency_key not like 'customer-advance-allocation:%'
      and (p_branch_id is null or a.branch_id = p_branch_id)
  ), aged as (
    select *, greatest(0, (now() at time zone 'Asia/Ho_Chi_Minh')::date
      - (debt_date at time zone 'Asia/Ho_Chi_Minh')::date) days_old
    from documents
  ), grouped as (
    select party_type,
      coalesce(party_id::text, 'walk-in:' || party_name) party_id,
      max(party_name) party_name, count(*)::int document_count,
      sum(amount) outstanding, max(days_old) oldest_days, min(debt_date) oldest_date,
      coalesce(sum(amount) filter (where days_old <= 30), 0) bucket_0_30,
      coalesce(sum(amount) filter (where days_old between 31 and 60), 0) bucket_31_60,
      coalesce(sum(amount) filter (where days_old between 61 and 90), 0) bucket_61_90,
      coalesce(sum(amount) filter (where days_old > 90), 0) bucket_91_plus
    from aged group by party_type, coalesce(party_id::text, 'walk-in:' || party_name)
  )
  select jsonb_build_object('generated_at', now(),
    'customers', coalesce(jsonb_agg(to_jsonb(g) order by outstanding desc, party_id)
      filter (where party_type = 'customer'), '[]'::jsonb),
    'suppliers', coalesce(jsonb_agg(to_jsonb(g) order by outstanding desc, party_id)
      filter (where party_type = 'supplier'), '[]'::jsonb)) into v_result
  from grouped g;
  return v_result;
end; $$;

revoke all on function public.get_counterparty_open_debt_aging(uuid) from public, anon;
grant execute on function public.get_counterparty_open_debt_aging(uuid) to authenticated;
commit;
