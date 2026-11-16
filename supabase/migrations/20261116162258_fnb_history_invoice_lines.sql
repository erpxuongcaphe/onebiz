begin;

-- Resolve authorization for this invoice once, then read its indexed line range.
create function public.read_fnb_history_invoice_lines(p_invoice_id uuid, p_branch_id uuid)
returns table(id uuid, product_name text, quantity numeric, unit_price numeric, total numeric, note text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  tenant uuid := public.get_user_tenant_id();
begin
  if actor is null or tenant is null or p_branch_id is null
    or not exists (
      select 1 from public.invoices i
       where i.id = p_invoice_id and i.tenant_id = tenant
         and i.branch_id = p_branch_id and i.source = 'fnb' and i.deleted_at is null
         and i.status in ('completed', 'cancelled')
    )
    or not coalesce(public._can_read_branch_inventory_00476(actor, tenant, p_branch_id), false)
    or not coalesce(public._staff_invoice_item_read(tenant, p_branch_id, 'fnb'), false)
  then
    raise exception 'FNB_HISTORY_INVOICE_NOT_ACCESSIBLE' using errcode = '42501';
  end if;

  return query
    select l.id, l.product_name::text, l.quantity, l.unit_price, l.total, l.note::text
    from public.invoice_items l
    where l.invoice_id = p_invoice_id
    order by l.id;
end;
$$;

revoke all on function public.read_fnb_history_invoice_lines(uuid, uuid) from public, anon;
grant execute on function public.read_fnb_history_invoice_lines(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
