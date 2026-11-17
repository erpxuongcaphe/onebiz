begin;

-- Reconcile one fully received supplier line on the branch cost ledger.
-- Historical sales and production postings retain their recorded values.
create function private.correct_supplier_receipt_line(
  p_order_id uuid, p_line_id uuid, p_quantity numeric, p_unit_price numeric,
  p_reason text, p_token text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  tenant uuid := public.get_user_tenant_id();
  reason text := btrim(coalesce(p_reason, ''));
  po public.purchase_orders%rowtype;
  item public.purchase_order_items%rowtype;
  product public.products%rowtype;
  stock public.branch_stock%rowtype;
  lot public.product_lots%rowtype;
  balance public.fnb_branch_product_cost_balances%rowtype;
  received public.fnb_branch_product_cost_events%rowtype;
  input_invoice public.input_invoices%rowtype;
  opening_qty numeric;
  opening_value numeric;
  used_qty numeric;
  used_value numeric;
  prior_qty_delta numeric;
  prior_value_delta numeric;
  current_receipt_value numeric;
  receipts integer;
  lots integer;
  stock_delta numeric;
  stock_price numeric;
  qty_new numeric;
  lot_new numeric;
  line_new numeric;
  tax_new numeric;
  total_new numeric;
  receipt_value numeric;
  used_value_new numeric;
  cost_new numeric;
  plan jsonb;
  token text;
begin
  if actor is null or tenant is null or not exists (
    select 1 from public.profiles where id = actor and tenant_id = tenant and is_active
  ) then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_quantity is null or not (p_quantity between 0.0001 and 999999999)
    or p_unit_price is null or not (p_unit_price between 0 and 999999999)
    or p_quantity <> round(p_quantity, 4) or length(reason) not between 3 and 500
  then raise exception 'PURCHASE_CORRECTION_INPUT_INVALID' using errcode = '22023'; end if;

  select * into po from public.purchase_orders where id = p_order_id and tenant_id = tenant for update;
  if not found or not coalesce(public.user_has_branch_access(actor, po.branch_id), false)
    or not coalesce(public._staff_permission_at_scope(actor, 'inventory.create_po', po.branch_id), false)
    or not coalesce(public._staff_permission_at_scope(actor, 'inventory.adjust', po.branch_id), false)
    or not coalesce(public.user_has_permission(actor, 'products.view_cost'), false)
  then raise exception 'PURCHASE_CORRECTION_SCOPE_DENIED' using errcode = '42501'; end if;
  if po.status <> 'completed' or coalesce(po.closed_short, false)
    or not public._fnb_branch_cost_tracking_enabled_00390(tenant, po.branch_id)
    or exists(select 1 from public.fnb_purchase_sales_order_links where purchase_order_id = po.id)
    or exists(select 1 from public.supplier_returns where purchase_order_id = po.id and tenant_id = tenant and status = 'completed')
  then raise exception 'PURCHASE_CORRECTION_DOCUMENT_REVIEW'; end if;

  select * into item from public.purchase_order_items where id = p_line_id and purchase_order_id = po.id for update;
  if not found or item.received_quantity is distinct from item.quantity or coalesce(item.unit_price_missing, false)
    or coalesce(item.conversion_factor, 0) <= 0 or item.quantity <= 0
    or exists(select 1 from public.purchase_order_items where purchase_order_id = po.id and product_id = item.product_id and id <> item.id)
  then raise exception 'PURCHASE_CORRECTION_LINE_REVIEW'; end if;
  select * into input_invoice from public.input_invoices where purchase_order_id = po.id and tenant_id = tenant for update;
  if found and (input_invoice.status <> 'unrecorded' or input_invoice.total_amount is distinct from po.total
    or input_invoice.tax_amount is distinct from po.tax_amount) then raise exception 'PURCHASE_CORRECTION_INPUT_INVOICE_REVIEW'; end if;
  if input_invoice.id is not null and exists (
    select 1 from public.input_invoices where purchase_order_id = po.id and tenant_id = tenant and id <> input_invoice.id
  ) then raise exception 'PURCHASE_CORRECTION_INPUT_INVOICE_REVIEW'; end if;

  select * into product from public.products where id = item.product_id and tenant_id = tenant for update;
  select * into stock from public.branch_stock
    where product_id = item.product_id and tenant_id = tenant and branch_id = po.branch_id and variant_id is null for update;
  select * into balance from public.fnb_branch_product_cost_balances
    where product_id = item.product_id and tenant_id = tenant and branch_id = po.branch_id for update;
  select count(*) into lots from public.product_lots
    where purchase_order_id = po.id and product_id = item.product_id and tenant_id = tenant and branch_id = po.branch_id;
  select * into lot from public.product_lots
    where purchase_order_id = po.id and product_id = item.product_id and tenant_id = tenant and branch_id = po.branch_id for update;
  if stock.id is null or product.id is null or balance.product_id is null
    or stock.quantity is distinct from balance.costed_quantity or balance.deficit_quantity <> 0
    or lots <> 1 or lot.initial_qty is distinct from item.received_quantity
    or lot.status not in ('active', 'expired', 'consumed')
    or stock.quantity is distinct from coalesce((
      select sum(current_qty) from public.product_lots where tenant_id = tenant and branch_id = po.branch_id
        and product_id = item.product_id and status in ('active','expired')
    ), 0)
  then raise exception 'PURCHASE_CORRECTION_STOCK_REVIEW'; end if;

  select count(*) into receipts from public.fnb_branch_product_cost_events
    where tenant_id = tenant and branch_id = po.branch_id and product_id = item.product_id
      and source_reference_id = po.id and source_type = 'purchase_receipt';
  select * into received from public.fnb_branch_product_cost_events
    where tenant_id = tenant and branch_id = po.branch_id and product_id = item.product_id
      and source_reference_id = po.id and source_type = 'purchase_receipt';
  if receipts <> 1 or received.direction <> 'in' then raise exception 'PURCHASE_CORRECTION_COST_REVIEW'; end if;
  current_receipt_value := round(item.quantity * item.unit_price, 4);

  -- Replay the original purchase at its corrected value for a segment whose
  -- only successors are weighted-average consumption. Other successors need
  -- their own reconciliation rules (returns, transfers, subsequent receipts).
  select coalesce(sum(case direction when 'in' then quantity else -quantity end), 0),
         coalesce(sum(case direction when 'in' then total_cost else -total_cost end), 0)
    into opening_qty, opening_value from public.fnb_branch_product_cost_events
    where tenant_id = tenant and branch_id = po.branch_id and product_id = item.product_id and created_at < received.created_at;
  if exists(select 1 from public.fnb_branch_product_cost_events
    where tenant_id = tenant and branch_id = po.branch_id and product_id = item.product_id
      and created_at >= received.created_at and id <> received.id
      and not (source_reference_type = 'purchase_order_correction' and source_reference_id = po.id)
      and (created_at = received.created_at or direction <> 'out' or source_type not in ('production_consume', 'bom_consume')))
  then raise exception 'PURCHASE_CORRECTION_LATER_MOVEMENTS_REVIEW'; end if;
  select coalesce(sum(quantity), 0), coalesce(sum(total_cost), 0)
    into used_qty, used_value from public.fnb_branch_product_cost_events
    where tenant_id = tenant and branch_id = po.branch_id and product_id = item.product_id and created_at > received.created_at
      and source_type in ('production_consume', 'bom_consume');
  select coalesce(sum(case direction when 'in' then quantity else -quantity end), 0),
         coalesce(sum(case direction when 'in' then total_cost else -total_cost end), 0)
    into prior_qty_delta, prior_value_delta from public.fnb_branch_product_cost_events
    where tenant_id = tenant and branch_id = po.branch_id and product_id = item.product_id and created_at > received.created_at
      and source_reference_type = 'purchase_order_correction' and source_reference_id = po.id;
  if opening_qty < 0 or opening_value < 0 or received.quantity + prior_qty_delta <> item.quantity
    or opening_qty + item.quantity - used_qty <> stock.quantity
    or opening_value + received.total_cost - used_value + prior_value_delta <> balance.total_cost
    or (prior_qty_delta = 0 and prior_value_delta = 0 and received.total_cost <> current_receipt_value)
  then raise exception 'PURCHASE_CORRECTION_COST_REVIEW'; end if;

  qty_new := round(p_quantity * item.conversion_factor, 4);
  stock_delta := qty_new - item.quantity;
  stock_price := round(p_quantity * p_unit_price / nullif(qty_new, 0), 8);
  lot_new := lot.current_qty + stock_delta;
  receipt_value := round(qty_new * stock_price, 4);
  if qty_new <= 0 or lot_new < 0 or stock.quantity + stock_delta < coalesce(stock.reserved, 0)
    or product.stock + stock_delta < 0 or (lot.status = 'consumed' and lot_new > 0)
  then raise exception 'PURCHASE_CORRECTION_STOCK_SHORT'; end if;
  if stock_delta = 0 and p_unit_price = coalesce(item.transaction_unit_price, item.unit_price) then
    raise exception 'PURCHASE_CORRECTION_NO_CHANGE';
  end if;
  line_new := round(p_quantity * p_unit_price - coalesce(item.discount, 0), 0);
  tax_new := round(line_new * coalesce(item.vat_rate, 0) / 100, 0);
  total_new := po.total + line_new - item.total + tax_new - coalesce(item.vat_amount, 0);
  if line_new < 0 or total_new < coalesce(po.paid, 0)
    or po.debt is distinct from greatest(0, po.total - coalesce(po.paid, 0))
  then raise exception 'PURCHASE_CORRECTION_DEBT_REVIEW'; end if;
  used_value_new := round((opening_value + receipt_value) * used_qty / (opening_qty + qty_new), 4);
  cost_new := opening_value + receipt_value - used_value_new;
  if cost_new < 0 or (stock.quantity + stock_delta = 0 and cost_new <> 0) then
    raise exception 'PURCHASE_CORRECTION_COST_REVIEW';
  end if;

  plan := jsonb_build_object('oldQuantity',coalesce(item.transaction_quantity,item.quantity),
    'newQuantity',p_quantity,'oldUnitPrice',coalesce(item.transaction_unit_price,item.unit_price),'newUnitPrice',p_unit_price,
    'stockBefore',stock.quantity,'stockAfter',stock.quantity+stock_delta,'stockUnit',item.unit,
    'lotBefore',lot.current_qty,'lotAfter',lot_new,'oldValue',balance.total_cost,'newValue',cost_new,
    'usedCostDelta',used_value_new-(opening_value+current_receipt_value-balance.total_cost),'oldTotal',po.total,'newTotal',total_new,
    'oldDebt',po.debt,'newDebt',total_new-coalesce(po.paid,0),'paid',coalesce(po.paid,0));
  token := md5(jsonb_build_array(actor, po, item, product.stock, stock, lot, balance, input_invoice, reason, plan)::text);
  if p_token is null then return plan || jsonb_build_object('token', token); end if;
  if p_token is distinct from token then raise exception 'PURCHASE_CORRECTION_PREVIEW_STALE' using errcode = '40001'; end if;

  update public.purchase_order_items set quantity=qty_new,received_quantity=qty_new,unit_price=stock_price,
    transaction_quantity=p_quantity,transaction_unit_price=p_unit_price,total=line_new,vat_amount=tax_new where id=item.id;
  update public.purchase_orders set subtotal=subtotal+line_new-item.total,tax_amount=tax_amount+tax_new-coalesce(item.vat_amount,0),
    total=total_new,debt=total_new-coalesce(po.paid,0),updated_at=now() where id=po.id;
  if input_invoice.id is not null then
    update public.input_invoices set total_amount=total_new,tax_amount=po.tax_amount+tax_new-coalesce(item.vat_amount,0),
      updated_at=now() where id=input_invoice.id;
  end if;
  if stock_delta <> 0 then
    update public.branch_stock set quantity=stock.quantity+stock_delta,updated_at=now() where id=stock.id;
    update public.products set stock=product.stock+stock_delta,updated_at=now() where id=product.id;
    update public.product_lots set initial_qty=qty_new,current_qty=lot_new,
      status=case when lot_new=0 then 'consumed' else lot.status end where id=lot.id;
    insert into public.stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_by)
      values(tenant,po.branch_id,item.product_id,case when stock_delta>0 then 'in' else 'out' end,abs(stock_delta),
        'purchase_order_correction',po.id,po.code||' · '||reason,actor);
  end if;
  -- A price correction can move value in a different direction from quantity.
  -- Replace the balance in the valuation ledger as two entries, netting to
  -- exactly the same quantity change as the stock ledger.
  insert into public.fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,
    source_reference_type,source_reference_id,quantity,unit_cost,total_cost,note,created_by)
    select tenant,po.branch_id,item.product_id,v.direction,'inventory_adjustment','purchase_order_correction',po.id,
      v.quantity,round(v.value/nullif(v.quantity,0),12),v.value,po.code||' · '||reason,actor
    from (values ('out',stock.quantity,balance.total_cost),('in',stock.quantity+stock_delta,cost_new)) v(direction,quantity,value)
    where v.quantity > 0;
  update public.fnb_branch_product_cost_balances set costed_quantity=stock.quantity+stock_delta,total_cost=cost_new,
    unit_cost=coalesce(round(cost_new/nullif(stock.quantity+stock_delta,0),12),0),updated_by=actor,updated_at=now()
    where tenant_id=tenant and branch_id=po.branch_id and product_id=item.product_id;
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
    values(tenant,actor,'purchase_order_quantity_price_correction','purchase_order',po.id,to_jsonb(item),
      plan||jsonb_build_object('reason',reason,'lineId',item.id));
  return plan || jsonb_build_object('applied', true);
end
$$;
revoke all on function private.correct_supplier_receipt_line(uuid,uuid,numeric,numeric,text,text) from public,anon,authenticated;

create function public.preview_supplier_receipt_correction(p_order_id uuid,p_line_id uuid,p_quantity numeric,p_unit_price numeric,p_reason text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.correct_supplier_receipt_line(p_order_id,p_line_id,p_quantity,p_unit_price,p_reason,null)
$$;
create function public.apply_supplier_receipt_correction(p_order_id uuid,p_line_id uuid,p_quantity numeric,p_unit_price numeric,p_reason text,p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null then raise exception 'PURCHASE_CORRECTION_PREVIEW_STALE' using errcode = '40001'; end if;
  return private.correct_supplier_receipt_line(p_order_id,p_line_id,p_quantity,p_unit_price,p_reason,p_token);
end
$$;
revoke all on function public.preview_supplier_receipt_correction(uuid,uuid,numeric,numeric,text) from public,anon;
revoke all on function public.apply_supplier_receipt_correction(uuid,uuid,numeric,numeric,text,text) from public,anon;
grant execute on function public.preview_supplier_receipt_correction(uuid,uuid,numeric,numeric,text) to authenticated;
grant execute on function public.apply_supplier_receipt_correction(uuid,uuid,numeric,numeric,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
