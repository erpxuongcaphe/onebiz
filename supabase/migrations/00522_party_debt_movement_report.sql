begin;
create function public.get_party_debt_movements(p_mode text,p_party_id uuid,p_branch_id uuid,p_from date,p_to date,p_page integer default 0,p_size integer default 200)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid; v_balance jsonb; v_current numeric; v_result jsonb;
begin
 perform public.assert_report_access('reports.analytics',p_branch_id);
 perform public.assert_report_access('reports.view_detail',p_branch_id);
 select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if v_tenant is null or p_branch_id is null or not public.user_has_branch_access(auth.uid(),p_branch_id)
  or not public.user_has_permission(auth.uid(),'finance.view_cash_book')
  or not public.user_has_permission(auth.uid(),case p_mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end) then
  raise exception 'DEBT_MOVEMENT_DENIED' using errcode='42501'; end if;
 if p_mode is null or p_mode not in ('customer','supplier') or p_party_id is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to
  or p_page is null or p_page<0 or p_size is null or p_size not between 1 and 200 then raise exception 'DEBT_MOVEMENT_FILTER_INVALID' using errcode='22023'; end if;
 if not exists(select 1 from public.branches where id=p_branch_id and tenant_id=v_tenant)
  or (p_mode='customer' and not exists(select 1 from public.customers where id=p_party_id and tenant_id=v_tenant))
  or (p_mode='supplier' and not exists(select 1 from public.suppliers where id=p_party_id and tenant_id=v_tenant)) then raise exception 'DEBT_PARTY_DENIED' using errcode='42501'; end if;
 v_balance:=public.get_counterparty_balance_summary(p_branch_id);
 select coalesce((entry->>'debt')::numeric,0)-coalesce((entry->>'advance')::numeric,0) into v_current
 from jsonb_array_elements(v_balance->(case p_mode when 'customer' then 'customers' else 'suppliers' end)) entry where entry->>'party_id'=p_party_id::text;
 v_current:=coalesce(v_current,0);
 with source as (
  select 'invoice:'||i.id as key,i.id,'invoice'::text as kind,i.code,
   coalesce(nullif(to_jsonb(i)->>'invoice_date','')::date,(i.created_at at time zone 'Asia/Ho_Chi_Minh')::date) as date,i.created_at,i.status,
   i.total as amount,case when i.status='completed' and i.deleted_at is null then i.total else 0 end as delta,coalesce(i.note,'') as note,false as unmapped
  from public.invoices i where p_mode='customer' and i.tenant_id=v_tenant and i.branch_id=p_branch_id and i.customer_id=p_party_id
  union all
  select 'purchase_order:'||po.id,po.id,'purchase_order',po.code,(po.created_at at time zone 'Asia/Ho_Chi_Minh')::date,po.created_at,po.status,
   po.total,case when po.status in ('completed','partial') then po.total else 0 end,coalesce(po.note,''),po.status='partial'
  from public.purchase_orders po where p_mode='supplier' and po.tenant_id=v_tenant and po.branch_id=p_branch_id and po.supplier_id=p_party_id
  union all
  select 'sales_return:'||r.id,r.id,'sales_return',r.code,(r.created_at at time zone 'Asia/Ho_Chi_Minh')::date,r.created_at,r.status,r.total,
   case when r.status in ('confirmed','completed') then -r.total else 0 end,coalesce(r.note,''),false
  from public.sales_returns r where p_mode='customer' and r.tenant_id=v_tenant and r.branch_id=p_branch_id and r.customer_id=p_party_id
  union all
  select 'supplier_return:'||r.id,r.id,'supplier_return',r.code,(r.created_at at time zone 'Asia/Ho_Chi_Minh')::date,r.created_at,r.status,r.total,
   case when r.status='completed' then -r.total else 0 end,coalesce(r.note,''),false
  from public.supplier_returns r where p_mode='supplier' and r.tenant_id=v_tenant and r.branch_id=p_branch_id and r.supplier_id=p_party_id
  union all
  select 'opening:'||o.id,o.id,'opening','Đầu kỳ',(o.opening_date),o.created_at,'completed',abs(o.amount),o.amount,coalesce(o.note,''),false
  from public.debt_opening_balances o where o.tenant_id=v_tenant and o.branch_id=p_branch_id and o.party_type=p_mode
   and (case p_mode when 'customer' then o.customer_id else o.supplier_id end)=p_party_id
  union all
  select 'adjustment:'||a.id,a.id,'adjustment','Điều chỉnh',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',abs(a.amount),a.amount,a.reason,false
  from public.customer_debt_adjustments a where p_mode='customer' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and a.customer_id=p_party_id
   and a.cash_transaction_id is null and coalesce(a.idempotency_key,'') not like 'sales-return-credit:%'
   and coalesce(a.idempotency_key,'') not like 'customer-advance-%' and coalesce(a.idempotency_key,'') not like 'cancel-customer-advance:%'
  union all
  select 'cash:'||c.id,c.id,'cash',c.code,c.transaction_date,c.created_at,coalesce(c.status,'completed'),c.amount,
   case when coalesce(c.status,'completed')='completed' and (c.reference_type in ('invoice','invoice_void','sales_return','return','purchase_order','supplier_return') or c.category in ('customer_advance','supplier_advance'))
    then c.amount*(case when (p_mode='customer' and c.type='receipt') or (p_mode='supplier' and c.type='payment') then -1 else 1 end) else 0 end,
   coalesce(c.note,''),coalesce(c.status,'completed')='completed' and not (coalesce(c.reference_type,'') in ('invoice','invoice_void','sales_return','return','purchase_order','supplier_return') or c.category in ('customer_advance','supplier_advance'))
  from public.cash_transactions c where c.tenant_id=v_tenant and c.branch_id=p_branch_id and (
   (p_mode='customer' and (c.customer_id=p_party_id or exists(select 1 from public.invoices i where i.id=c.reference_id and c.reference_type in ('invoice','invoice_void') and i.tenant_id=v_tenant and i.customer_id=p_party_id)
    or exists(select 1 from public.sales_returns r where r.id=c.reference_id and c.reference_type in ('sales_return','return') and r.tenant_id=v_tenant and r.customer_id=p_party_id)))
   or (p_mode='supplier' and (c.supplier_id=p_party_id or exists(select 1 from public.purchase_orders po where po.id=c.reference_id and c.reference_type='purchase_order' and po.tenant_id=v_tenant and po.supplier_id=p_party_id)
    or exists(select 1 from public.supplier_returns r where r.id=c.reference_id and c.reference_type='supplier_return' and r.tenant_id=v_tenant and r.supplier_id=p_party_id))))
  union all
  select 'allocation:'||a.id,a.id,'allocation','Cấn ứng trước',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',a.amount,0,a.note,false
  from public.customer_advance_allocations a join public.invoices i on i.id=a.invoice_id and i.tenant_id=a.tenant_id
  where p_mode='customer' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and i.customer_id=p_party_id
  union all
  select 'allocation:'||a.id,a.id,'allocation','Cấn ứng trước',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',a.amount,0,a.note,false
  from public.supplier_advance_allocations a join public.purchase_orders po on po.id=a.purchase_order_id and po.tenant_id=a.tenant_id
  where p_mode='supplier' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and po.supplier_id=p_party_id
 ), running as (
  select source.*,sum(delta) over(order by date,created_at,key rows unbounded preceding) as balance from source
 ), filtered as(select * from running where date between p_from and p_to)
 select jsonb_build_object('basis','current_effective_documents','current_net',v_current,
  'difference',v_current-coalesce((select sum(delta) from source),0),
  'unmapped',(select count(*) from source where unmapped),
  'opening',coalesce((select sum(delta) from source where date<p_from),0),
  'increase',coalesce((select sum(greatest(delta,0)) from filtered),0),
  'decrease',coalesce((select sum(greatest(-delta,0)) from filtered),0),
  'closing',coalesce((select sum(delta) from source where date<=p_to),0),
  'total',(select count(*) from filtered),
  'items',coalesce((select jsonb_agg(to_jsonb(r) order by date,created_at,key) from (select * from filtered order by date,created_at,key offset p_page::bigint*p_size limit p_size) r),'[]'::jsonb)) into v_result;
 return v_result;
end; $$;
revoke all on function public.get_party_debt_movements(text,uuid,uuid,date,date,integer,integer) from public,anon;
grant execute on function public.get_party_debt_movements(text,uuid,uuid,date,date,integer,integer) to authenticated;
commit;
