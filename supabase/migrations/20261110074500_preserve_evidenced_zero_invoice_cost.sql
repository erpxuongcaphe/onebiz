-- Keep an evidenced zero distinct from a missing historical cost snapshot.
-- Reports already count only NULL as missing. Existing invoice rows are untouched.
create or replace function public.set_invoice_item_unit_cost()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cost numeric;
  v_branch uuid;
  v_tenant uuid;
  v_bom uuid;
  v_receipt record;
begin
  if new.unit_cost is not null and new.unit_cost <> 0 then
    return new;
  end if;

  select p.cost_price into v_cost
  from public.products p where p.id = new.product_id;

  if coalesce(v_cost, 0) = 0 and new.invoice_id is not null then
    select i.branch_id, i.tenant_id into v_branch, v_tenant
    from public.invoices i where i.id = new.invoice_id;

    v_bom := public.get_active_bom_for_branch(new.product_id, v_branch, null);
    if v_bom is not null then
      v_cost := public.bom_unit_cost(v_bom);
    elsif v_branch is not null and v_cost = 0 then
      -- A zero catalog default alone is ambiguous. Require a real receipt at
      -- this branch and do not fall back past a later inbound movement.
      select sm.reference_type, sm.reference_id, sm.unit_cost
      into v_receipt
      from public.stock_movements sm
      where sm.tenant_id = v_tenant and sm.branch_id = v_branch
        and sm.product_id = new.product_id and sm.type = 'in' and sm.quantity > 0
      order by sm.created_at desc, sm.id desc
      limit 1;

      if found and v_receipt.reference_type = 'purchase_order'
        and v_receipt.unit_cost is not distinct from 0
        and exists (
          select 1
          from public.purchase_orders po
          join public.purchase_order_items poi on poi.purchase_order_id = po.id
          where po.id = v_receipt.reference_id and po.tenant_id = v_tenant
            and po.branch_id = v_branch and po.status in ('completed', 'partial')
            and coalesce(po.shipping_cost, 0) = 0 and coalesce(po.other_cost, 0) = 0
            and poi.product_id = new.product_id and poi.received_quantity > 0
          group by po.id
          having bool_and(poi.unit_price is not distinct from 0
                          and coalesce(poi.vat_amount, 0) = 0)
        )
      then
        new.unit_cost := 0;
        return new;
      end if;
    end if;
  end if;

  new.unit_cost := nullif(v_cost, 0);
  return new;
end;
$function$;
