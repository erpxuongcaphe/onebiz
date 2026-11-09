-- Scope partial deliveries to branch requests linked to a warehouse sales order.
begin;

create table public.warehouse_order_quantity_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.invoices(id),
  invoice_id uuid not null references public.invoices(id),
  product_id uuid not null,
  variant_id uuid,
  unit_key text not null,
  quantity numeric not null check (quantity > 0),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now()
);
create index warehouse_order_quantity_adjustments_order_idx
  on public.warehouse_order_quantity_adjustments(order_id);
alter table public.warehouse_order_quantity_adjustments enable row level security;
revoke all on public.warehouse_order_quantity_adjustments from public, anon, authenticated;
grant select on public.warehouse_order_quantity_adjustments to authenticated;
create policy warehouse_order_adjustments_read on public.warehouse_order_quantity_adjustments
  for select to authenticated using (exists (
    select 1 from public.invoices i where i.id=order_id
      and i.tenant_id=public.get_user_tenant_id()
      and public.user_has_branch_access(auth.uid(),i.branch_id)
      and public.user_has_permission(auth.uid(),'orders.view')
  ));

create function public.warehouse_order_open_quantities(p_order_id uuid, p_exclude_invoice_id uuid default null)
returns table(product_id uuid, variant_id uuid, unit_key text, remaining numeric)
language sql stable set search_path = '' as $$
  select q.product_id,q.variant_id,q.unit_key,sum(q.quantity)
  from (
    select ii.product_id,ii.variant_id,lower(btrim(ii.unit)) as unit_key,
           case when i.id=p_order_id then ii.quantity else -ii.quantity end as quantity
    from public.invoices parent
    join public.invoices i on i.tenant_id=parent.tenant_id and i.branch_id=parent.branch_id
      and (i.id=parent.id or (
        i.source_order_id=parent.id and i.source='internal' and i.status='completed'
        and i.deleted_at is null and i.voided_at is null and i.cancelled_at is null
        and i.id is distinct from p_exclude_invoice_id
      ))
    join public.invoice_items ii on ii.invoice_id=i.id
    where parent.id=p_order_id
    union all
    select a.product_id,a.variant_id,a.unit_key,a.quantity
    from public.warehouse_order_quantity_adjustments a
    join public.invoices issued on issued.id=a.invoice_id and issued.status='completed'
      and issued.voided_at is null and issued.cancelled_at is null and issued.deleted_at is null
    where a.order_id=p_order_id and a.invoice_id is distinct from p_exclude_invoice_id
  ) q
  group by q.product_id,q.variant_id,q.unit_key;
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
    select ii.*, greatest(0, least(
      case when lead(ii.id) over item_lines is null then coalesce(q.remaining,0) else ii.quantity end,
      coalesce(q.remaining,0) - coalesce(sum(ii.quantity) over
        (item_lines rows between unbounded preceding and 1 preceding),0)
    )) as keep
    from public.invoice_items ii
    left join public.warehouse_order_open_quantities(p_order_id) q
      on q.product_id=ii.product_id and q.variant_id is not distinct from ii.variant_id
      and q.unit_key=lower(btrim(ii.unit))
    where ii.invoice_id=p_order_id
    window item_lines as (partition by ii.product_id,ii.variant_id,lower(btrim(ii.unit)) order by ii.id)
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

create function public.confirm_warehouse_delivery_on_issue(
  p_order_id uuid, p_invoice_id uuid, p_session_id uuid
) returns void language plpgsql set search_path = '' as $$
declare
  v_changes jsonb;
  v_token text;
  v_actor uuid := auth.uid();
begin
  with planned as (
    select * from public.warehouse_order_open_quantities(p_order_id,p_invoice_id)
  ), shipped as (
    select product_id,variant_id,lower(btrim(unit)) unit_key,sum(quantity) quantity,
      min(product_name) product_name,min(unit) unit
    from public.invoice_items where invoice_id=p_invoice_id group by 1,2,3
  ), compared as (
    select coalesce(s.product_id,p.product_id) product_id,
      coalesce(s.variant_id,p.variant_id) variant_id,coalesce(s.unit_key,p.unit_key) unit_key,
      coalesce(s.product_name, original.product_name, p.product_id::text) product_name,
      coalesce(s.unit,original.unit,p.unit_key) unit,
      greatest(0,coalesce(p.remaining,0)) remaining,coalesce(s.quantity,0) quantity
    from planned p full join shipped s on s.product_id=p.product_id
      and coalesce(s.variant_id::text,'')=coalesce(p.variant_id::text,'') and s.unit_key=p.unit_key
    left join lateral (
      select ii.product_name,ii.unit from public.invoice_items ii
      where ii.invoice_id=p_order_id and ii.product_id=p.product_id
        and ii.variant_id is not distinct from p.variant_id and lower(btrim(ii.unit))=p.unit_key
      order by ii.id limit 1
    ) original on true
  )
  select jsonb_agg(to_jsonb(c) order by c.product_id,c.variant_id,c.unit_key) into v_changes
  from compared c where c.quantity<>c.remaining;
  if v_changes is null then return; end if;
  v_token := md5(jsonb_build_array(p_order_id,p_session_id,v_actor,v_changes)::text);
  if p_session_id is null or v_actor is null
    or v_token is distinct from current_setting('onebiz.warehouse_delivery_confirmation',true) then
    raise exception 'WAREHOUSE_DELIVERY_CONFIRMATION_REQUIRED'
      using errcode='P0001', detail=jsonb_build_object('token',v_token,'changes',v_changes)::text;
  end if;

  insert into public.warehouse_order_quantity_adjustments (
    order_id,invoice_id,product_id,variant_id,unit_key,quantity,confirmed_by
  )
  select p_order_id,p_invoice_id,c.product_id,c.variant_id,c.unit_key,c.quantity-c.remaining,v_actor
  from jsonb_to_recordset(v_changes) c(product_id uuid,variant_id uuid,unit_key text,quantity numeric,remaining numeric)
  where c.quantity>c.remaining;

  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
  select i.tenant_id,v_actor,'warehouse_delivery_difference_confirmed','sales_order',p_order_id,
    jsonb_build_object('invoice_id',p_invoice_id,'changes',v_changes)
  from public.invoices i where i.id=p_order_id;
end $$;
revoke all on function public.confirm_warehouse_delivery_on_issue(uuid,uuid,uuid) from public, anon, authenticated;


do $$
declare v_def text; v_anchor text;
begin
  select pg_get_functiondef('public.create_child_sale_from_order(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'v_item_count int;', 'v_item_count int; v_warehouse boolean;');
  v_anchor := 'v_child_code := public.next_code';
  if position(v_anchor in v_def)=0 or position('for share;' in v_def)=0 then
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
    perform public.confirm_warehouse_delivery_on_issue(v_parent.id,new.id,new.client_session_id);
    if exists (select 1 from public.warehouse_order_open_quantities(v_parent.id)
      where remaining>0) then return new; end if;
  end if;$patch$);
  execute v_def;

  select pg_get_functiondef('public.checkout_internal_pos_v2(jsonb)'::regprocedure) into v_def;
  v_anchor := 'payload jsonb:=p_checkout;';
  if position(v_anchor in v_def)=0 or position('result:=public._checkout_internal_pos_before_fnb_bridge_20261023(payload);' in v_def)=0 then
    raise exception 'Unexpected internal checkout function';
  end if;
  -- Keep the original payload fingerprint for retries after a successful checkout.
  v_def := replace(v_def,v_anchor,$patch$payload jsonb:=p_checkout - 'warehouseDeliveryConfirmation';
    v_confirmation text:=p_checkout->>'warehouseDeliveryConfirmation';$patch$);
  v_def := replace(v_def,'md5(p_checkout::text)', 'md5((p_checkout - ''warehouseDeliveryConfirmation'')::text)');
  v_def := replace(v_def,$patch$jsonb_set(p_checkout,'{customerId}'$patch$,$patch$jsonb_set(p_checkout - 'warehouseDeliveryConfirmation','{customerId}'$patch$);
  v_def := replace(v_def,'result:=public._checkout_internal_pos_before_fnb_bridge_20261023(payload);',$patch$
  perform set_config('onebiz.warehouse_delivery_confirmation',coalesce(v_confirmation,''),true);
  result:=public._checkout_internal_pos_before_fnb_bridge_20261023(payload);$patch$);
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
