-- Return only the receipt and stock totals needed to preview an invoice void.
-- Every selected invoice is checked at its persisted branch before any total
-- is returned; no payment account, counterparty or cash-book rows are exposed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_invoice_cancel_preview_totals(p_invoice_ids uuid[])
returns table(invoice_id uuid,refund numeric,stock_movements bigint)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; entry record; found_count integer:=0; allowed boolean;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and p.is_active;
 if tenant is null then raise exception 'INVOICE_CANCEL_PREVIEW_DENIED' using errcode='42501';end if;
 if p_invoice_ids is null or cardinality(p_invoice_ids)<1 or cardinality(p_invoice_ids)>100
  or array_position(p_invoice_ids,null) is not null
  or (select count(distinct x) from unnest(p_invoice_ids) x)<>cardinality(p_invoice_ids) then
  raise exception 'INVOICE_CANCEL_PREVIEW_INVALID' using errcode='22023';end if;
 for entry in select i.id,i.branch_id,i.source,i.status from public.invoices i
  where i.tenant_id=tenant and i.id=any(p_invoice_ids) and i.deleted_at is null loop
  found_count:=found_count+1;
  allowed:=coalesce(public.user_has_branch_access(actor,entry.branch_id),false)
   and case when entry.status='completed' then
    case when entry.source='fnb' then
     public._staff_permission_at_scope(actor,'pos_fnb.void_paid_bill',entry.branch_id)
      or public._staff_legacy_paid_void_permission(actor,entry.branch_id)
     else public._staff_permission_at_scope(actor,'pos_retail.void',entry.branch_id) end
    when entry.status in ('draft','confirmed') then public._staff_permission_at_scope(actor,'orders.cancel',entry.branch_id)
    else false end;
  if not coalesce(allowed,false) then raise exception 'INVOICE_CANCEL_PREVIEW_DENIED' using errcode='42501';end if;
 end loop;
 if found_count<>cardinality(p_invoice_ids) then raise exception 'INVOICE_CANCEL_PREVIEW_DENIED' using errcode='42501';end if;
 -- Aggregate each ledger once for the selected set; do not scan it again for
 -- every invoice when a manager previews a large batch.
 return query with cash_totals as materialized (
  select c.reference_id,c.branch_id,sum(c.amount)::numeric total from public.cash_transactions c
   where c.tenant_id=tenant and c.reference_id=any(p_invoice_ids)
    and c.reference_type='invoice' and c.type='receipt' and c.status='completed'
   group by c.reference_id,c.branch_id
 ), stock_totals as materialized (
  select sm.reference_id,sm.branch_id,count(*) total from public.stock_movements sm
   where sm.tenant_id=tenant and sm.reference_id=any(p_invoice_ids) and sm.type='out'
    and sm.reference_type in ('invoice','bom_consume','modifier_topping')
   group by sm.reference_id,sm.branch_id
 )
 select i.id,coalesce(c.total,0)::numeric,coalesce(sm.total,0)::bigint from public.invoices i
  left join cash_totals c on c.reference_id=i.id and c.branch_id=i.branch_id
  left join stock_totals sm on sm.reference_id=i.id and sm.branch_id=i.branch_id
  where i.tenant_id=tenant and i.id=any(p_invoice_ids);
end $$;
revoke all on function public.get_invoice_cancel_preview_totals(uuid[]) from public,anon;
grant execute on function public.get_invoice_cancel_preview_totals(uuid[]) to authenticated;
commit;
