-- Aggregate visibility is separate from checkout, per-bill lookup and cash-book access.
-- Seed only managerial roles already represented by these names; future roles need an explicit grant.
insert into public.role_permissions(role_id,permission_code)
select id,'pos_fnb.view_sales_summary' from public.roles
where lower(trim(name)) in ('chủ cửa hàng','admin','ceo','cửa hàng trưởng','cửa hàng phó','quản lý vùng','tổng quản lý')
on conflict(role_id,permission_code) do nothing;

create or replace function public.get_fnb_day_sales_summary(p_branch_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; result jsonb;
begin
 select tenant_id into tenant from public.profiles where id=actor and is_active;
 if tenant is null or not coalesce(public.user_has_permission(actor,'pos_fnb.view_sales_summary'),false) then
  raise exception 'FNB_SALES_SUMMARY_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_day is null or p_branch_id is null or not public.can_read_branch_document_00567(tenant,p_branch_id) then
  raise exception 'FNB_SALES_SUMMARY_BRANCH_DENIED' using errcode='42501';
 end if;
 with inv as (
  select status,total from public.invoices
  where tenant_id=tenant and branch_id=p_branch_id and source='fnb' and deleted_at is null
   and status in ('completed','cancelled')
   and ngay_chung_tu >= (p_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
   and ngay_chung_tu < ((p_day+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
 ), orders as (
  select status from public.kitchen_orders where tenant_id=tenant and branch_id=p_branch_id
   and invoice_id is null and merged_into_id is null and status<>'completed'
   and created_at >= (p_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
   and created_at < ((p_day+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
 ), money as (
  select c.type,c.payment_method,c.amount,
   case when c.type='receipt' then c.amount else -c.amount end signed
  from public.cash_transactions c join public.invoices i on i.id=c.reference_id
   and i.tenant_id=tenant and i.branch_id=p_branch_id and i.source='fnb'
  where c.tenant_id=tenant and c.branch_id=p_branch_id and c.status='completed'
   and c.transaction_date=p_day and c.reference_type in ('invoice','invoice_void')
 ), methods as (select payment_method,sum(signed) amount from money group by payment_method)
 select jsonb_build_object(
  'completed',(select count(*) from inv where status='completed'),
  'pending',(select count(*) from orders where status<>'cancelled'),
  'cancelled',(select count(*) from inv where status='cancelled')+(select count(*) from orders where status='cancelled'),
  'invoiceValue',coalesce((select sum(total) from inv where status='completed'),0),
  'received',coalesce((select sum(amount) from money where type='receipt'),0),
  'refunded',coalesce((select sum(amount) from money where type<>'receipt'),0),
  'net',coalesce((select sum(signed) from money),0),
  'methods',coalesce((select jsonb_object_agg(coalesce(payment_method,'unknown'),amount) from methods),'{}'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.get_fnb_day_sales_summary(uuid,date) from public,anon;
grant execute on function public.get_fnb_day_sales_summary(uuid,date) to authenticated;
comment on function public.get_fnb_day_sales_summary(uuid,date) is 'F&B daily aggregates: explicit summary permission and assigned branch only. Does not change payments or stock.';

-- Enforce the same restriction on the existing invoice-list aggregate RPC for FnB scopes.
-- Retail branch summaries retain their current permissions and calculations.
do $guard$
declare definition text; anchor text := '  v_statuses := CASE';
begin
 select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='get_invoice_list_summary' and p.pronargs=7;
 if definition is null or position(anchor in definition)=0 then raise exception 'INVOICE_SUMMARY_GUARD_ANCHOR_MISSING'; end if;
 if position('FNB_SALES_SUMMARY_PERMISSION_DENIED' in definition)=0 then
  definition := replace(definition,anchor,$inject$
  IF NOT public.user_has_permission(v_actor,'pos_fnb.view_sales_summary')
   AND EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id=v_tenant AND b.branch_type='store'
    AND (p_branch_id IS NULL OR b.id=p_branch_id)
    AND (v_xem_toan_bo OR public.user_has_branch_access(v_actor,b.id))) THEN
   RAISE EXCEPTION USING errcode='42501', message='FNB_SALES_SUMMARY_PERMISSION_DENIED';
  END IF;
$inject$ || anchor);
  execute definition;
 end if;
end $guard$;
