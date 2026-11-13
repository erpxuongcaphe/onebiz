-- Aggregate only the remaining product demand for open orders a purchasing
-- operator may access. This avoids granting raw invoice-line SELECT to make
-- purchase forecasting work when invoice visibility is more restricted.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_purchase_forecast_remaining_lines(p_order_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; ids uuid[]; result jsonb;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false);
 if tenant is null then raise exception 'PURCHASE_FORECAST_AUTH_REQUIRED' using errcode='42501'; end if;
 if p_order_ids is null or cardinality(p_order_ids)>100 or array_position(p_order_ids,null) is not null then
  raise exception 'PURCHASE_FORECAST_IDS_INVALID' using errcode='22023'; end if;
 select coalesce(array_agg(distinct x),'{}'::uuid[]) into ids from unnest(p_order_ids) x;
 if cardinality(ids)=0 then return '[]'::jsonb; end if;
 if (select count(*) from public.invoices i where i.id=any(ids) and i.tenant_id=tenant
     and i.source='order' and i.status in ('draft','confirmed','delivering') and i.deleted_at is null
     and i.fulfilled_by_id is null and public.can_read_branch_document_00567(tenant,i.branch_id)
     and public._staff_permission_at_scope(actor,'inventory.create_po',i.branch_id)
     and not exists(select 1 from public.sales_order_processing_closures c
       where c.order_id=i.id and c.tenant_id=tenant and c.closed_at is not null)) <> cardinality(ids) then
  raise exception 'PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED' using errcode='42501'; end if;
 -- A missing child would overstate demand. Reject instead of producing an
 -- incomplete forecast when a linked completed invoice is outside scope.
 if exists(select 1 from public.invoices c where c.tenant_id=tenant and c.source_order_id=any(ids)
   and c.status='completed' and c.deleted_at is null and c.voided_at is null and c.cancelled_at is null
   and not public.can_read_branch_document_00567(tenant,c.branch_id)) then
  raise exception 'PURCHASE_FORECAST_CHILD_SCOPE_REQUIRED' using errcode='42501'; end if;
 with ordered as (
  select l.invoice_id order_id,l.product_id,sum(coalesce(l.quantity,0)) quantity,sum(coalesce(l.total,0)) amount
  from public.invoice_items l join public.invoices i on i.id=l.invoice_id and i.tenant_id=tenant
  where l.invoice_id=any(ids) and l.product_id is not null group by l.invoice_id,l.product_id
 ), issued as (
  select c.source_order_id order_id,l.product_id,sum(coalesce(l.quantity,0)) quantity
  from public.invoices c join public.invoice_items l on l.invoice_id=c.id
  where c.tenant_id=tenant and c.source_order_id=any(ids) and c.status='completed'
   and c.deleted_at is null and c.voided_at is null and c.cancelled_at is null and l.product_id is not null
  group by c.source_order_id,l.product_id
 ), remaining as (
  select o.order_id,o.product_id,o.quantity ordered_quantity,coalesce(i.quantity,0) issued_quantity,
   greatest(0,o.quantity-coalesce(i.quantity,0)) remaining_quantity,o.amount
  from ordered o left join issued i on i.order_id=o.order_id and i.product_id=o.product_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('orderId',r.order_id,'productId',r.product_id,
  'orderedQuantity',r.ordered_quantity,'issuedQuantity',r.issued_quantity,'remainingQuantity',r.remaining_quantity,
  'remainingAmount',case when r.ordered_quantity>0 then r.amount*r.remaining_quantity/r.ordered_quantity else 0 end)
  order by r.order_id,r.product_id),'[]'::jsonb) into result from remaining r;
 return result;
end $$;
revoke all on function public.get_purchase_forecast_remaining_lines(uuid[]) from public,anon;
grant execute on function public.get_purchase_forecast_remaining_lines(uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
