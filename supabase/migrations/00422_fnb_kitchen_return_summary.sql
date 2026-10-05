-- Read-only kitchen warning. Do not guess which kitchen row an invoice return
-- belongs to: legacy invoices do not carry a kitchen-item foreign key.
begin;

create or replace function public.fnb_kitchen_return_summary(p_branch_id uuid)
returns table(kitchen_order_id uuid, sold_quantity numeric, returned_quantity numeric)
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found or v_tenant_id is null then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not coalesce(public.user_has_permission(v_actor, 'pos_fnb.view_orders'), false) then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if p_branch_id is null or not coalesce(public.user_has_branch_access(v_actor, p_branch_id), false) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  return query
  select ko.id, sum(ii.quantity)::numeric,
         sum(least(ii.quantity, greatest(coalesce(ii.returned_qty, 0), 0)))::numeric
    from public.kitchen_orders ko
    join public.invoices i on i.id = ko.invoice_id
      and i.tenant_id = ko.tenant_id and i.branch_id = ko.branch_id
    join public.invoice_items ii on ii.invoice_id = i.id
   where ko.tenant_id = v_tenant_id and ko.branch_id = p_branch_id
     and ko.status in ('pending', 'preparing', 'ready')
     and i.source = 'fnb' and i.status = 'completed'
   group by ko.id
  having sum(greatest(coalesce(ii.returned_qty, 0), 0)) > 0;
end;
$$;

revoke all on function public.fnb_kitchen_return_summary(uuid) from public, anon;
grant execute on function public.fnb_kitchen_return_summary(uuid) to authenticated;
commit;
