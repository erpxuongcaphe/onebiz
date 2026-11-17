begin;

create function public.cancel_supplier_receipt_atomic(
  p_order_id uuid, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  tenant uuid := public.get_user_tenant_id();
  reason text := btrim(coalesce(p_reason, ''));
  receipt public.purchase_orders%rowtype;
  line record;
  available numeric;
begin
  if actor is null or tenant is null or not exists (
    select 1 from public.profiles where id = actor and tenant_id = tenant and is_active
  ) then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if length(reason) not between 3 and 500 then
    raise exception 'PURCHASE_CANCEL_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into receipt from public.purchase_orders
   where id = p_order_id and tenant_id = tenant for update;
  if not found
    or not coalesce(public.user_has_branch_access(actor, receipt.branch_id), false)
    or not coalesce(public._staff_permission_at_scope(actor, 'inventory.create_po', receipt.branch_id), false)
    or not coalesce(public._staff_permission_at_scope(actor, 'inventory.adjust', receipt.branch_id), false)
  then
    raise exception 'PURCHASE_CANCEL_SCOPE_DENIED' using errcode = '42501';
  end if;

  if receipt.status = 'cancelled' then
    return jsonb_build_object('purchase_order_id', receipt.id, 'status', 'cancelled', 'idempotent', true);
  end if;
  if coalesce(receipt.paid, 0) > 0 then
    raise exception 'PURCHASE_CANCEL_PAYMENT_REVIEW_REQUIRED' using errcode = '22023';
  end if;
  if receipt.status in ('partial', 'completed') then
    if exists(select 1 from public.supplier_returns
       where purchase_order_id = receipt.id and tenant_id = tenant and status = 'completed') then
      raise exception 'PURCHASE_CANCEL_RETURN_REVIEW_REQUIRED' using errcode = '22023';
    end if;
    if exists(select 1 from public.product_lots where purchase_order_id = receipt.id
        and tenant_id = tenant and branch_id = receipt.branch_id
        and status in ('active','expired','consumed') and current_qty < initial_qty) then
      raise exception 'PURCHASE_CANCEL_RECEIPT_ALREADY_USED' using errcode = '22023';
    end if;
    for line in
      select product_id, sum(received_quantity) as quantity
      from public.purchase_order_items where purchase_order_id = receipt.id and received_quantity > 0
      group by product_id order by product_id
    loop
      perform 1 from public.products where id = line.product_id and tenant_id = tenant for update;
      select quantity - coalesce(reserved, 0) into available from public.branch_stock
      where product_id = line.product_id and branch_id = receipt.branch_id
        and tenant_id = tenant and variant_id is null for update;
      if coalesce(available, 0) < line.quantity then
        raise exception 'PURCHASE_CANCEL_STOCK_REVIEW_REQUIRED' using errcode = '22023';
      end if;
    end loop;
    -- Use the normal reversal, with negative stock disabled. Its mutations and
    -- the status change below share the same transaction and receipt lock.
    perform public.revert_received_purchase_order_atomic(receipt.id, actor, false);
  end if;
  return public.set_purchase_order_state_atomic(receipt.id, 'cancelled', reason);
end;
$$;

revoke all on function public.cancel_supplier_receipt_atomic(uuid, text) from public, anon;
grant execute on function public.cancel_supplier_receipt_atomic(uuid, text) to authenticated;

-- The purchase dialog previously checked product stock across all branches.
-- Preview the receipt's own branch and its receipt lots instead.
create function public.get_supplier_receipt_cancel_risks(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  tenant uuid := public.get_user_tenant_id();
  receipt public.purchase_orders%rowtype;
begin
  select * into receipt from public.purchase_orders where id = p_order_id and tenant_id = tenant;
  if not found or actor is null or not exists (
    select 1 from public.profiles where id = actor and tenant_id = tenant and is_active
  ) or not coalesce(public.user_has_branch_access(actor, receipt.branch_id), false)
    or not coalesce(public._staff_permission_at_scope(actor, 'inventory.create_po', receipt.branch_id), false)
  then raise exception 'PURCHASE_CANCEL_SCOPE_DENIED' using errcode = '42501'; end if;
  if receipt.status not in ('partial','completed') then
    raise exception 'PURCHASE_CANCEL_STATUS_INVALID' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(risk)), '[]'::jsonb) from (
      select min(i.product_name) product_name, min(i.unit) unit, sum(i.received_quantity) needed
      from public.purchase_order_items i
      left join public.products p on p.id = i.product_id and p.tenant_id = tenant
      left join public.branch_stock s on s.product_id = i.product_id and s.tenant_id = tenant
        and s.branch_id = receipt.branch_id and s.variant_id is null
      where i.purchase_order_id = receipt.id and i.received_quantity > 0
      group by i.product_id, p.stock, s.quantity, s.reserved
      having least(coalesce(p.stock,0),coalesce(s.quantity,0)-coalesce(s.reserved,0)) < sum(i.received_quantity)
        or exists(select 1 from public.product_lots l where l.purchase_order_id = receipt.id and l.tenant_id = tenant
          and l.branch_id = receipt.branch_id and l.product_id = i.product_id
          and l.status in ('active','expired','consumed') and l.current_qty < l.initial_qty)
    ) risk
  );
end
$$;
revoke all on function public.get_supplier_receipt_cancel_risks(uuid) from public, anon;
grant execute on function public.get_supplier_receipt_cancel_risks(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
