-- Scope partial deliveries to branch requests linked to a warehouse sales order.
begin;

create function public.warehouse_order_open_quantities(p_order_id uuid, p_exclude_invoice_id uuid default null)
returns table(product_id uuid, variant_id uuid, unit_key text, remaining numeric)
language sql stable set search_path = '' as $$
  select ii.product_id, ii.variant_id, lower(btrim(ii.unit)),
         sum(case when i.id = p_order_id then ii.quantity else -ii.quantity end)
  from public.invoices parent
  join public.invoices i on i.tenant_id = parent.tenant_id and i.branch_id = parent.branch_id
    and (i.id = parent.id or (
      i.source_order_id = parent.id and i.source = 'internal' and i.status = 'completed'
      and i.deleted_at is null and i.voided_at is null and i.cancelled_at is null
      and i.id is distinct from p_exclude_invoice_id
    ))
  join public.invoice_items ii on ii.invoice_id = i.id
  where parent.id = p_order_id
  group by ii.product_id, ii.variant_id, lower(btrim(ii.unit));
$$;
revoke all on function public.warehouse_order_open_quantities(uuid, uuid) from public, anon, authenticated;

create function public.fill_warehouse_delivery_draft(p_order_id uuid, p_draft_id uuid)
returns integer language plpgsql set search_path = '' as $$
declare
  v_count integer;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
begin
  -- Allocate remaining stock units across repeated lines in a stable order.
  with lines as (
    select ii.*, greatest(0, least(ii.quantity, coalesce(q.remaining,0) -
      coalesce(sum(ii.quantity) over (
        partition by ii.product_id, ii.variant_id, lower(btrim(ii.unit))
        order by ii.id rows between unbounded preceding and 1 preceding
      ),0))) as keep
    from public.invoice_items ii
    left join public.warehouse_order_open_quantities(p_order_id) q
      on q.product_id=ii.product_id and q.variant_id is not distinct from ii.variant_id
      and q.unit_key=lower(btrim(ii.unit))
    where ii.invoice_id=p_order_id
  )
  insert into public.invoice_items (
    invoice_id, product_id, product_name, quantity, unit, unit_price, unit_cost,
    discount, total, note, vat_rate, vat_amount, variant_id,
    transaction_quantity, transaction_unit, transaction_unit_price, conversion_factor
  )
  select p_draft_id, product_id, product_name, keep, unit, unit_price, unit_cost,
    round(discount * keep / quantity,2), round(total * keep / quantity,2), note,
    vat_rate, round(vat_amount * keep / quantity,2), variant_id,
    case when keep=quantity then transaction_quantity
         else round(keep / nullif(conversion_factor,0),4) end,
    transaction_unit, transaction_unit_price, conversion_factor
  from lines where keep>0;
  get diagnostics v_count = row_count;
  if v_count=0 then raise exception 'Đơn gốc đã xuất đủ hàng.' using errcode='22023'; end if;
  select coalesce(sum(total),0),coalesce(sum(vat_amount),0),coalesce(sum(total+coalesce(vat_amount,0)),0)
    into v_subtotal,v_tax,v_total
  from public.invoice_items where invoice_id=p_draft_id;
  update public.invoices set subtotal=v_subtotal,tax_amount=v_tax,discount_amount=0,
    delivery_fee=0,total=v_total,debt=v_total where id=p_draft_id;
  return v_count;
end $$;
revoke all on function public.fill_warehouse_delivery_draft(uuid, uuid) from public, anon, authenticated;

do $$
declare v_def text; v_anchor text;
begin
  select pg_get_functiondef('public.create_child_sale_from_order(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'v_item_count int;', 'v_item_count int; v_warehouse boolean;');
  v_def := replace(v_def, 'for share;', 'for no key update;');
  v_anchor := 'v_child_code := public.next_code';
  if position(v_anchor in v_def)=0 or position('for no key update;' in v_def)=0 then
    raise exception 'Unexpected child draft function';
  end if;
  v_def := replace(v_def,v_anchor,$patch$
  v_warehouse := exists (select 1 from public.fnb_purchase_sales_order_links
    where sales_order_id=p_order_id and tenant_id=v_tenant_id);
  if v_warehouse then
    if exists (select 1 from public.sales_order_processing_closures
      where order_id=p_order_id and closed_at is not null)
       or exists (select 1 from public.invoices where id=p_order_id and fulfilled_by_id is not null) then
      raise exception 'Đơn đã đóng xử lý. Mở lại đơn gốc trước khi giao bù.' using errcode='22023';
    end if;
    if exists (select 1 from public.invoices where source_order_id=p_order_id
      and tenant_id=v_tenant_id and status='draft' and deleted_at is null
      and voided_at is null and cancelled_at is null) then
      raise exception 'Đơn gốc đã có đợt giao nháp. Mở lại đợt đang có trong POS.' using errcode='22023';
    end if;
  end if;
  v_child_code := public.next_code$patch$);
  v_anchor := 'insert into public.invoice_items (';
  if position(v_anchor in v_def)=0 or position('get diagnostics v_item_count = row_count;' in v_def)=0
    or position('v_warehouse boolean;' in v_def)=0 then raise exception 'Unexpected child draft items'; end if;
  v_def := replace(v_def,v_anchor,$patch$
  if v_warehouse then
    v_item_count := public.fill_warehouse_delivery_draft(p_order_id,v_child_id);
  else
    insert into public.invoice_items ($patch$);
  v_def := replace(v_def,'get diagnostics v_item_count = row_count;',
    'get diagnostics v_item_count = row_count; end if;');
  execute v_def;

  select pg_get_functiondef('public.remember_sales_order_processing_closed()'::regprocedure) into v_def;
  v_anchor := 'if not found then return new; end if;';
  if position(v_anchor in v_def)=0 or position('for no key update' in v_def)=0 then
    raise exception 'Unexpected order closure function';
  end if;
  v_def := replace(v_def,v_anchor,$patch$
  if not found then return new; end if;
  if exists (select 1 from public.fnb_purchase_sales_order_links
    where sales_order_id=v_parent.id and tenant_id=v_parent.tenant_id) then
    if new.source <> 'internal' then
      raise exception 'Đợt giao đơn kho tổng phải xuất bằng luồng bán nội bộ.' using errcode='22023';
    end if;
    if not exists (select 1 from public.invoice_items where invoice_id=new.id) then
      raise exception 'Đợt giao chưa có mặt hàng.' using errcode='22023';
    end if;
    if exists (
      select 1 from public.invoice_items ii
      left join public.warehouse_order_open_quantities(v_parent.id,new.id) q
        on q.product_id=ii.product_id and q.variant_id is not distinct from ii.variant_id
        and q.unit_key=lower(btrim(ii.unit))
      where ii.invoice_id=new.id
      group by ii.product_id,ii.variant_id,lower(btrim(ii.unit)),q.remaining
      having sum(ii.quantity)>coalesce(q.remaining,0)
    ) then
      raise exception 'Đợt giao vượt số lượng còn thiếu. Kiểm tra lại đơn gốc.' using errcode='22023';
    end if;
    if exists (select 1 from public.warehouse_order_open_quantities(v_parent.id)
      where remaining>0) then return new; end if;
  end if;$patch$);
  execute v_def;

  select pg_get_functiondef('public.duplicate_invoice_to_order_atomic(uuid,uuid)'::regprocedure) into v_def;
  v_anchor := 'select count(*)::integer into v_item_count';
  if position(v_anchor in v_def)=0 then raise exception 'Unexpected order duplication function'; end if;
  v_def := replace(v_def,v_anchor,$patch$
  if v_source.source='internal' and v_source.source_order_id is not null then
    raise exception 'Hóa đơn đã gắn đơn gốc. Mở đơn gốc và chọn Giao phần còn thiếu.' using errcode='22023';
  end if;
  select count(*)::integer into v_item_count$patch$);
  execute v_def;
end $$;

notify pgrst,'reload schema';
commit;
