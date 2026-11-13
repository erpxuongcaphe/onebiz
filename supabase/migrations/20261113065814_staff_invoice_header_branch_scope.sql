-- Restrict direct invoice headers when an invoice/order/F&B view exception is
-- explicitly configured. Independent POS, print, cash and report permissions
-- remain effective; the existing tenant, branch and own-order policies apply too.
-- Do not enable these three view codes in the branch catalog until every
-- remaining consumer and the ordered rollout have passed acceptance.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public._staff_invoice_header_exception_flags()
returns integer language sql stable security definer set search_path='' as $$
 select coalesce(bit_or(case q.code when 'invoices.view' then 1 when 'orders.view' then 2 else 4 end),0)
 from (
  select o.permission_code code from public.user_branch_permission_overrides o
   where o.tenant_id=public.get_user_tenant_id() and o.user_id=auth.uid()
    and o.permission_code in ('invoices.view','orders.view','pos_fnb.view_orders')
  union all
  select o.permission_code from public.user_permission_overrides o
   where o.tenant_id=public.get_user_tenant_id() and o.user_id=auth.uid()
    and o.override_type='revoke' and o.permission_code in ('invoices.view','orders.view','pos_fnb.view_orders')
 ) q
$$;

create function public._staff_invoice_header_read(p_tenant uuid,p_branch uuid,p_source text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();member boolean;report_scope boolean;code text;
begin
 if actor is null or p_tenant is distinct from public.get_user_tenant_id()
  or not exists(select 1 from public.profiles p where p.id=actor and p.tenant_id=p_tenant and coalesce(p.is_active,false))
  or not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant) then return false;end if;
 if public._staff_invoice_item_read(p_tenant,p_branch,p_source) then return true;end if;
 member:=coalesce(public.user_has_branch_access(actor,p_branch),false);
 report_scope:=member or coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false);
 if member then
  -- These pre-existing capabilities also read invoice headers for returns,
  -- payment history, customer debt, reporting or F&B order lookup.
  -- Viewing F&B orders must not grant visibility of retail orders, or vice versa.
  if p_source='order' and public._staff_permission_at_scope(actor,'orders.view',p_branch) then return true;end if;
  if p_source='fnb' and public._staff_permission_at_scope(actor,'pos_fnb.view_orders',p_branch) then return true;end if;
  foreach code in array array['finance.view_cash_book','finance.create_transaction',
   'finance.void_transaction','customers.view_debt'] loop
   if public._staff_permission_at_scope(actor,code,p_branch) then return true;end if;
  end loop;
 end if;
 -- General analytics still has existing direct-header consumers. F&B summary
 -- permissions use scoped aggregate readers and do not expose header rows.
 if report_scope and public._staff_permission_at_scope(actor,'reports.analytics',p_branch) then return true;end if;
 return false;
end $$;

-- Resolve branch/source pairs once per query; do not scan invoice rows.
create function public._staff_invoice_header_allowed_scopes()
returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(b.id::text||':'||s.source),'{}'::text[])
 from public.branches b cross join (values ('order'),('fnb'),('pos'),('internal'),('other')) s(source)
 where b.tenant_id=public.get_user_tenant_id() and public._staff_invoice_header_read(b.tenant_id,b.id,s.source)
$$;
revoke all on function public._staff_invoice_header_exception_flags(),public._staff_invoice_header_read(uuid,uuid,text),
 public._staff_invoice_header_allowed_scopes() from public,anon;
grant execute on function public._staff_invoice_header_exception_flags(),public._staff_invoice_header_read(uuid,uuid,text),
 public._staff_invoice_header_allowed_scopes() to authenticated;

create policy staff_invoice_header_view_scope on public.invoices as restrictive for select to authenticated using (
 ((select public._staff_invoice_header_exception_flags()) & 1)=0
  and (source is distinct from 'order' or ((select public._staff_invoice_header_exception_flags()) & 2)=0)
  and (source is distinct from 'fnb' or ((select public._staff_invoice_header_exception_flags()) & 4)=0)
 or coalesce((branch_id::text||':'||case when coalesce(source,'pos') in ('order','fnb','pos','internal')
  then coalesce(source,'pos') else 'other' end)=any((select public._staff_invoice_header_allowed_scopes())::text[]),false)
);
commit;
