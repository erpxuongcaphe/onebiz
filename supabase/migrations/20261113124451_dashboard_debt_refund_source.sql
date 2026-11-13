begin;

-- Keep the production classifier intact; recognize a refund only when its
-- settlement, cash voucher, received return, branch and amount all agree.
create or replace function private.report_cash_operating_expenses_v1(p_tenant uuid,p_from timestamptz,p_to timestamptz,p_branch uuid)
returns table(cash_id uuid,branch_id uuid,category text,amount numeric)
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.assert_report_access('reports.analytics',p_branch);
 perform public.assert_report_access('reports.view_detail',p_branch);
 perform public.assert_report_access('reports.view_profit',p_branch);
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.tenant_id=p_tenant and coalesce(p.is_active,true)) then
  raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';
 end if;
 if p_from is null or p_to is null or p_from>=p_to then
  raise exception 'REPORT_DATE_RANGE_INVALID' using errcode='22007';
 end if;
 return query
 with cash as materialized (
  select c.* from public.cash_transactions c
  where c.tenant_id=p_tenant and c.type='payment' and coalesce(c.status,'completed')='completed'
   and c.created_at>=p_from and c.created_at<p_to and (p_branch is null or c.branch_id=p_branch)
   and public.user_has_branch_access(auth.uid(),c.branch_id)
 ), evidence as (
  select c.*,
   exists(select 1 from public.management_finance_settlements s join public.management_finance_events e on e.id=s.event_id and e.tenant_id=c.tenant_id where s.cash_transaction_id=c.id) as recognition_link,
   exists(select 1 from public.supplier_advances a where a.tenant_id=c.tenant_id and a.branch_id=c.branch_id and a.cash_transaction_id=c.id) as supplier_advance_link,
   exists(select 1 from public.customer_advances a where a.tenant_id=c.tenant_id and a.branch_id=c.branch_id and a.cash_transaction_id=c.id) as customer_advance_link,
   exists(select 1 from public.party_advance_refunds r where r.tenant_id=c.tenant_id and r.branch_id=c.branch_id and r.cash_id=c.id) as advance_refund_link,
   case c.reference_type
    when 'purchase_order' then exists(select 1 from public.purchase_orders d where d.tenant_id=c.tenant_id and d.branch_id=c.branch_id and d.id=c.reference_id)
    when 'input_invoice' then exists(select 1 from public.input_invoices d where d.tenant_id=c.tenant_id and d.branch_id=c.branch_id and d.id=c.reference_id)
    when 'invoice_void' then exists(select 1 from public.invoices d where d.tenant_id=c.tenant_id and d.branch_id=c.branch_id and d.id=c.reference_id)
    when 'sales_return' then exists(select 1 from public.sales_returns d where d.tenant_id=c.tenant_id and d.branch_id=c.branch_id and d.id=c.reference_id)
    when 'supplier_return' then exists(select 1 from public.supplier_returns d where d.tenant_id=c.tenant_id and d.branch_id=c.branch_id and d.id=c.reference_id)
    when 'internal_sale_cancel' then exists(select 1 from public.internal_sales d where d.tenant_id=c.tenant_id and c.branch_id in(d.from_branch_id,d.to_branch_id) and d.id=c.reference_id)
    when 'internal_return_settlement' then exists(
      select 1 from public.internal_return_settlements s
      join public.internal_stock_return_events e on e.id=s.event_id and e.action='received'
      join public.internal_stock_returns r on r.id=e.return_id and r.tenant_id=c.tenant_id
      where s.id=c.reference_id and s.cash_id=c.id and s.tenant_id=c.tenant_id
       and s.kind='refund' and s.amount=c.amount and r.to_branch_id=c.branch_id and r.status in ('partial','received')
    )
    else false end as settlement_link
  from cash c
 ), classified as (
  select e.*,case
   when recognition_link or supplier_advance_link or customer_advance_link or advance_refund_link or settlement_link then 'non_expense'
   when reference_type is not null or reference_id is not null then 'unresolved'
   when coalesce(e.category,'')=any(array['supplier_advance','customer_advance','supplier_advance_refund','customer_advance_refund',
    'Nhập hàng','Mua hàng nội bộ','Mua hang noi bo','Hoan giao dich noi bo','Hoàn tiền hủy đơn','Hoàn trả','Trả hàng','Tra hang','Trả nhà cung cấp','supplier_payment']) then 'unresolved'
   else 'legacy_operating_expense' end as classification
  from evidence e
 )
 select c.id,c.branch_id,case when c.classification='unresolved' then private.report_expense_source_unresolved_v1()
   else coalesce(nullif(btrim(c.category),''),'Chưa phân loại') end,c.amount
 from classified c where c.classification<>'non_expense';
end $$;

-- Current outstanding balances of invoices from the selected day. This is not
-- a historical debt snapshot or the difference between sales and cash flow.
create or replace function public.get_sales_day_invoice_receivable(p_branch_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; branch_kind text; result jsonb;
begin
 select tenant_id into tenant from public.profiles where id=actor and is_active;
 if tenant is null or not public.user_has_permission(actor,'customers.view_debt') then
  raise exception 'DASHBOARD_DEBT_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_day is null or p_day > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
  raise exception 'DASHBOARD_RANGE_INVALID' using errcode='22023';
 end if;
 if p_branch_id is null then
  if not public.user_has_permission(actor,'reports.view_all_branches') or not public.user_has_permission(actor,'reports.dashboard') then
   raise exception 'DASHBOARD_ALL_BRANCHES_DENIED' using errcode='42501';
  end if;
  if exists(select 1 from public.branches b where b.tenant_id=tenant and b.branch_type='store') and not public.user_has_permission(actor,'pos_fnb.view_sales_summary') then
   raise exception 'DASHBOARD_SALES_PERMISSION_DENIED' using errcode='42501';
  end if;
 else
  select b.branch_type into branch_kind from public.branches b where b.id=p_branch_id and b.tenant_id=tenant;
  if branch_kind is null or not public.can_read_branch_document_00567(tenant,p_branch_id) then
   raise exception 'DASHBOARD_BRANCH_DENIED' using errcode='42501';
  end if;
  if not public.user_has_permission(actor,case when branch_kind='store' then 'pos_fnb.view_sales_summary' else 'reports.dashboard' end) then
   raise exception 'DASHBOARD_SALES_PERMISSION_DENIED' using errcode='42501';
  end if;
 end if;
 select jsonb_build_object('amount',coalesce(sum(greatest(i.debt,0)),0),
  'invoice_count',count(*) filter(where i.debt>0),
  'missing_count',count(*) filter(where i.debt is null)) into result
 from public.invoices i where i.tenant_id=tenant and i.deleted_at is null and i.status='completed'
  and (p_branch_id is null or i.branch_id=p_branch_id)
  and (p_branch_id is not null or coalesce(i.source,'')<>'internal')
  and i.ngay_chung_tu >= (p_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
  and i.ngay_chung_tu < ((p_day+1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
 return result;
end $$;
revoke all on function public.get_sales_day_invoice_receivable(uuid,date) from public,anon;
grant execute on function public.get_sales_day_invoice_receivable(uuid,date) to authenticated;
commit;
