-- OneBiz ERP - POS order number uses Vietnam timezone

create or replace function public.pos_create_sale(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_shift_id uuid,
  p_lines jsonb,
  p_payment_method text,
  p_payment_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  order_id uuid;
  order_no text;
  total numeric := 0;
  line jsonb;
  qty numeric;
  unit_price numeric;
  prod_id uuid;
  sku text;
  name text;
begin
  if not public.has_permission('pos.order.create') or not public.has_permission('pos.payment.record') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  if p_branch_id is null then
    raise exception 'branch_id required';
  end if;

  if not public.has_permission('branch.read_all') and p_branch_id <> public.current_branch_id() then
    raise exception 'Branch mismatch';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lines must be array';
  end if;

  order_no := 'POS-' || to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  insert into public.pos_orders (
    tenant_id, branch_id, shift_id, order_number, status,
    subtotal, discount, tax, total,
    created_by
  )
  values (
    t_id, p_branch_id, p_shift_id, order_no, 'paid',
    0, 0, 0, 0,
    auth.uid()
  )
  returning id into order_id;

  for line in select * from jsonb_array_elements(p_lines) loop
    prod_id := (line->>'product_id')::uuid;
    qty := (line->>'quantity')::numeric;
    unit_price := (line->>'unit_price')::numeric;
    if qty is null or qty <= 0 then
      raise exception 'Invalid quantity';
    end if;
    if unit_price is null or unit_price < 0 then
      raise exception 'Invalid unit_price';
    end if;

    select p.sku, p.name into sku, name
    from public.inventory_products p
    where p.id = prod_id and p.tenant_id = t_id;

    if sku is null then
      raise exception 'Product not found';
    end if;

    insert into public.pos_order_items (
      tenant_id, order_id, product_id, sku, name, quantity, unit_price
    )
    values (
      t_id, order_id, prod_id, sku, name, qty, unit_price
    );

    total := total + (qty * unit_price);

    perform public.inventory_apply_stock_movement(
      prod_id,
      p_warehouse_id,
      'sale',
      -qty,
      'pos_order',
      order_id,
      order_no
    );
  end loop;

  update public.pos_orders
  set subtotal = total, total = total, updated_at = now()
  where id = order_id;

  insert into public.pos_payments (tenant_id, order_id, method, amount)
  values (t_id, order_id, p_payment_method, p_payment_amount);

  return order_id;
end;
$$;

grant execute on function public.pos_create_sale(uuid, uuid, uuid, jsonb, text, numeric) to authenticated;
