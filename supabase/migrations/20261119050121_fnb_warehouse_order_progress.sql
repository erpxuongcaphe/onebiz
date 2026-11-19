begin;

-- Derive branch-facing progress from posted dispatches and their current receipt quantities.
create or replace function public.get_fnb_purchase_order_links(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'purchaseOrderId', p.id,
   'salesOrderCode', i.code,
   'processed', progress.closed,
   'cancelled', i.status = 'cancelled',
   'revision', l.revision,
   'blockedReason', private.fnb_order_change_block_reason(p.id),
   'receiptProgress', case
     when not delivery.dispatched then 'none'
     when not delivery.any_received then 'awaiting'
     when delivery.all_received then 'received'
     else 'partial'
   end
 )), '[]'::jsonb)
 from public.fnb_purchase_sales_order_links l
 join public.purchase_orders p on p.id = l.purchase_order_id and p.tenant_id = l.tenant_id
 join public.invoices i on i.id = l.sales_order_id and i.tenant_id = l.tenant_id
 cross join lateral (
   select coalesce(
     (select c.closed_at is not null and c.reopened_at is null
      from public.sales_order_processing_closures c
      where c.order_id = i.id and c.tenant_id = l.tenant_id and c.branch_id = i.branch_id),
     i.fulfilled_by_id is not null
   ) as closed
 ) progress
 cross join lateral (
   select count(*) > 0 as dispatched,
          bool_or(dispatch.any_received) as any_received,
          bool_and(dispatch.all_received) as all_received
   from public.invoices child
   join public.internal_sales s on s.invoice_id = child.id and s.tenant_id = l.tenant_id
     and s.from_branch_id = i.branch_id and s.to_branch_id = p.branch_id and s.status = 'completed'
   left join public.input_invoices input on input.id = s.input_invoice_id
     and input.tenant_id = l.tenant_id and input.branch_id = p.branch_id
   cross join lateral (
     select case when s.receipt_mode = 'legacy' then coalesce(input.status = 'recorded', false)
                 else coalesce(bool_or(received.quantity > 0), false) end as any_received,
            case when s.receipt_mode = 'legacy' then coalesce(input.status = 'recorded', false)
                 else coalesce(bool_and(coalesce(received.quantity, 0) >= item.quantity), false) end as all_received
     from public.internal_sale_items item
     left join lateral (
       select sum(ri.quantity) as quantity
       from public.internal_sale_receipts r
       join public.internal_sale_receipt_items ri on ri.receipt_id = r.id and ri.sale_item_id = item.id
       where r.internal_sale_id = s.id and r.tenant_id = l.tenant_id and r.branch_id = p.branch_id
     ) received on true
     where s.receipt_mode = 'actual' and item.internal_sale_id = s.id
   ) dispatch
   where child.source_order_id = i.id and child.tenant_id = l.tenant_id
     and child.branch_id = i.branch_id and child.status = 'completed' and child.deleted_at is null
 ) delivery
 where l.tenant_id = public.get_user_tenant_id() and p.id = any(p_ids[1:500])
   and public._staff_my_inventory_view(p.branch_id)
   and public.user_has_branch_access(auth.uid(), p.branch_id);
$$;

commit;
