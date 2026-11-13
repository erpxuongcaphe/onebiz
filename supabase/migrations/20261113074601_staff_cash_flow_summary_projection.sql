-- Summary-only reader for report users who cannot inspect the cash book.
-- Return only month, category, type and totals; never individual transactions.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.get_cash_flow_category_summary(
 p_from date,p_to date,p_branch uuid default null
) returns table(transaction_date date,type text,category text,amount numeric)
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;
begin
 if p_from is null or p_to is null or p_from>p_to then
  raise exception 'REPORT_DATE_RANGE_INVALID' using errcode='22023';
 end if;
 perform public.assert_report_access('reports.analytics',p_branch);
 select p.tenant_id into v_tenant from public.profiles p
  where p.id=auth.uid() and coalesce(p.is_active,true);
 return query
 select date_trunc('month',c.transaction_date::timestamp)::date,
  case when c.type='receipt' then 'receipt' else 'payment' end,
  coalesce(c.category,'Khác'),sum(coalesce(c.amount,0))::numeric
 from public.cash_transactions c
 where c.tenant_id=v_tenant and (p_branch is null or c.branch_id=p_branch)
  and c.status='completed' and c.transaction_date>=p_from and c.transaction_date<=p_to
 group by 1,2,3 order by 1,2,3;
end $$;
revoke all on function public.get_cash_flow_category_summary(date,date,uuid) from public,anon;
grant execute on function public.get_cash_flow_category_summary(date,date,uuid) to authenticated;

-- The alerts page needs only receipt/payment totals, not individual vouchers.
create function public.get_cash_flow_alert_totals(
 p_from date,p_to date,p_branch uuid default null
) returns table(type text,amount numeric)
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;
begin
 if p_from is null or p_to is null or p_from>p_to then
  raise exception 'REPORT_DATE_RANGE_INVALID' using errcode='22023';
 end if;
 perform public.assert_report_access('reports.dashboard',p_branch);
 select p.tenant_id into v_tenant from public.profiles p
  where p.id=auth.uid() and coalesce(p.is_active,true);
 return query select c.type::text,sum(coalesce(c.amount,0))::numeric
 from public.cash_transactions c
 where c.tenant_id=v_tenant and (p_branch is null or c.branch_id=p_branch)
  and c.status='completed' and c.type in ('receipt','payment')
  and c.transaction_date>=p_from and c.transaction_date<=p_to
 group by c.type;
end $$;
revoke all on function public.get_cash_flow_alert_totals(date,date,uuid) from public,anon;
grant execute on function public.get_cash_flow_alert_totals(date,date,uuid) to authenticated;
commit;
