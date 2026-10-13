begin;
create function public.get_party_cash_history_sources(p_mode text,p_party_id uuid,p_branch_id uuid default null,p_page integer default 0,p_size integer default 25,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid; v_from date; v_to date; v_sort text; v_asc boolean; v_result jsonb;
begin
 select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if v_tenant is null or not coalesce(public.user_has_permission(auth.uid(),'finance.view_cash_book'),false) then
  raise exception 'PARTY_CASH_HISTORY_DENIED' using errcode='42501'; end if;
 if p_mode is null or p_mode not in ('customer','supplier') or p_party_id is null or p_page is null or p_page<0 or p_size is null or p_size not between 1 and 1000
  or jsonb_typeof(p_filters) is distinct from 'object' then raise exception 'PARTY_CASH_FILTER_INVALID' using errcode='22023'; end if;
 if (p_mode='customer' and not exists(select 1 from public.customers where id=p_party_id and tenant_id=v_tenant))
  or (p_mode='supplier' and not exists(select 1 from public.suppliers where id=p_party_id and tenant_id=v_tenant)) then
  raise exception 'PARTY_CASH_HISTORY_DENIED' using errcode='42501'; end if;
 if p_branch_id is not null and (not exists(select 1 from public.branches where id=p_branch_id and tenant_id=v_tenant)
  or not coalesce(public.user_has_branch_access(auth.uid(),p_branch_id),false)) then raise exception 'PARTY_CASH_HISTORY_DENIED' using errcode='42501'; end if;
 v_from:=nullif(p_filters->>'dateFrom','')::date; v_to:=nullif(p_filters->>'dateTo','')::date;
 v_sort:=coalesce(nullif(p_filters->>'sortBy',''),'transaction_date'); v_asc:=coalesce((p_filters->>'ascending')::boolean,false);
 if (v_from is not null and not isfinite(v_from)) or (v_to is not null and not isfinite(v_to)) or v_from>v_to or v_sort not in ('transaction_date','amount','code')
  or coalesce(p_filters->>'type','') not in ('','receipt','payment') or coalesce(p_filters->>'status','') not in ('','draft','completed','cancelled')
  or coalesce(p_filters->>'paymentMethod','') not in ('','cash','transfer','card','ewallet') then raise exception 'PARTY_CASH_FILTER_INVALID' using errcode='22023'; end if;
 with source as (
  select c.*,p.full_name as creator_name,b.name as branch_name
  from public.cash_transactions c
  join public.branches b on b.id=c.branch_id and b.tenant_id=v_tenant
  left join public.profiles p on p.id=c.created_by and p.tenant_id=v_tenant
  where c.tenant_id=v_tenant and public.user_has_branch_access(auth.uid(),c.branch_id)
   and (p_branch_id is null or c.branch_id=p_branch_id)
   and ((p_mode='customer' and (c.customer_id=p_party_id or (c.customer_id is null and (
    exists(select 1 from public.invoices i where i.id=c.reference_id and c.reference_type in ('invoice','invoice_void') and i.tenant_id=v_tenant and i.customer_id=p_party_id and public.user_has_branch_access(auth.uid(),i.branch_id))
    or exists(select 1 from public.sales_returns r where r.id=c.reference_id and c.reference_type in ('sales_return','return') and r.tenant_id=v_tenant and r.customer_id=p_party_id and public.user_has_branch_access(auth.uid(),r.branch_id))))))
   or (p_mode='supplier' and (c.supplier_id=p_party_id or (c.supplier_id is null and (
    exists(select 1 from public.purchase_orders po where po.id=c.reference_id and c.reference_type='purchase_order' and po.tenant_id=v_tenant and po.supplier_id=p_party_id and public.user_has_branch_access(auth.uid(),po.branch_id))
    or exists(select 1 from public.supplier_returns r where r.id=c.reference_id and c.reference_type='supplier_return' and r.tenant_id=v_tenant and r.supplier_id=p_party_id and public.user_has_branch_access(auth.uid(),r.branch_id)))))))
   and (v_from is null or c.transaction_date>=v_from) and (v_to is null or c.transaction_date<=v_to)
   and (coalesce(p_filters->>'type','')='' or c.type=p_filters->>'type')
   and (coalesce(p_filters->>'status','')='' or coalesce(c.status,'completed')=p_filters->>'status')
   and (coalesce(p_filters->>'paymentMethod','')='' or c.payment_method=p_filters->>'paymentMethod')
   and (coalesce(btrim(p_filters->>'search'),'')='' or strpos(lower(coalesce(c.code,'')||' '||coalesce(c.note,'')),lower(btrim(p_filters->>'search')))>0)
 ), ordered as (
  select *,row_number() over(order by
   case when v_sort='amount' and v_asc then amount end asc,case when v_sort='amount' and not v_asc then amount end desc,
   case when v_sort='code' and v_asc then code end asc,case when v_sort='code' and not v_asc then code end desc,
   case when v_sort='transaction_date' and v_asc then transaction_date end asc,case when v_sort='transaction_date' and not v_asc then transaction_date end desc,
   case when v_asc then created_at end asc,case when not v_asc then created_at end desc,
   case when v_asc then id end asc,case when not v_asc then id end desc) as position from source
 ) select jsonb_build_object('total',(select count(*) from source),'items',coalesce((select jsonb_agg(
  (to_jsonb(s)-'position'-'creator_name'-'branch_name')||jsonb_build_object('profiles',jsonb_build_object('full_name',creator_name),'branches',jsonb_build_object('name',branch_name),'status',coalesce(status,'completed')) order by position)
  from (select * from ordered order by position offset p_page::bigint*p_size limit p_size) s),'[]'::jsonb)) into v_result;
 return v_result;
end; $$;
revoke all on function public.get_party_cash_history_sources(text,uuid,uuid,integer,integer,jsonb) from public,anon;
grant execute on function public.get_party_cash_history_sources(text,uuid,uuid,integer,integer,jsonb) to authenticated;
commit;
