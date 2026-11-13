-- Minimal order headers for the purchasing forecast, independently authorized
-- from invoice listing. No customer, price or payment detail is returned.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_purchase_forecast_order_headers(
 p_branch uuid default null,p_from timestamptz default null,p_to timestamptz default null,
 p_customer_ids uuid[] default null,p_offset integer default 0,p_limit integer default 200
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();tenant uuid;branches uuid[];result jsonb;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false);
 if tenant is null then raise exception 'PURCHASE_FORECAST_AUTH_REQUIRED' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>200
  or (p_from is not null and p_to is not null and p_from>=p_to)
  or (p_customer_ids is not null and (cardinality(p_customer_ids)>5000 or array_position(p_customer_ids,null) is not null)) then
  raise exception 'PURCHASE_FORECAST_FILTER_INVALID' using errcode='22023'; end if;
 select coalesce(array_agg(b.id),'{}'::uuid[]) into branches from public.branches b where b.tenant_id=tenant
  and public.can_read_branch_document_00567(tenant,b.id)
  and public._staff_permission_at_scope(actor,'inventory.create_po',b.id);
 if (p_branch is null and cardinality(branches)=0) or (p_branch is not null and not coalesce(p_branch=any(branches),false)) then
  raise exception 'PURCHASE_FORECAST_BRANCH_DENIED' using errcode='42501'; end if;
 with filtered as materialized (
  select i.id,i.branch_id,b.name branch_name from public.invoices i
  join public.branches b on b.id=i.branch_id and b.tenant_id=tenant
  where i.tenant_id=tenant and i.branch_id=any(branches) and (p_branch is null or i.branch_id=p_branch)
   and i.source='order' and i.deleted_at is null and i.fulfilled_by_id is null
   and i.status in ('draft','confirmed','delivering')
   and (p_from is null or i.created_at>=p_from) and (p_to is null or i.created_at<p_to)
   and (p_customer_ids is null or i.customer_id=any(p_customer_ids))
   and not exists(select 1 from public.sales_order_processing_closures c
    where c.order_id=i.id and c.tenant_id=tenant and c.closed_at is not null)
 ), page as (select * from filtered order by id offset p_offset limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branch_id',branch_id,
  'branches',jsonb_build_object('name',branch_name)) order by id) from page),'[]'::jsonb),
  'total',(select count(*) from filtered)) into result;
 return result;
end $$;
revoke all on function public.get_purchase_forecast_order_headers(uuid,timestamptz,timestamptz,uuid[],integer,integer) from public,anon;
grant execute on function public.get_purchase_forecast_order_headers(uuid,timestamptz,timestamptz,uuid[],integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
