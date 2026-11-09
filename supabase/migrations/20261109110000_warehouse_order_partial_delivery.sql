-- Scope partial deliveries to branch requests linked to a warehouse sales order.
begin;

create table public.warehouse_order_quantity_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.invoices(id),
  draft_id uuid not null,
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
    from public.warehouse_order_quantity_adjustments a where a.order_id=p_order_id
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

create function public.confirm_warehouse_order_weighed_quantity(
  p_order_id uuid, p_draft_id uuid, p_expected_updated_at timestamptz
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := public.get_user_tenant_id();
  v_draft public.invoices%rowtype;
  v_parent public.invoices%rowtype;
  v_count integer;
begin
  if v_actor is null or v_tenant is null
    or not coalesce(public.user_has_permission(v_actor,'orders.create'),false) then
    raise exception 'Bạn cần quyền xử lý đơn đặt hàng để xác nhận lượng cân.' using errcode='42501';
  end if;
  -- Same lock order as the internal POS checkout.
  select * into v_draft from public.invoices where id=p_draft_id and tenant_id=v_tenant
    and source_order_id=p_order_id and status='draft' and deleted_at is null
    and voided_at is null and cancelled_at is null for update;
  if not found or v_draft.updated_at is distinct from p_expected_updated_at then
    raise exception 'Nháp đã thay đổi. Tải lại đơn gốc để kiểm tra lượng cân.' using errcode='22023';
  end if;
  select i.* into v_parent from public.invoices i
    join public.fnb_purchase_sales_order_links l on l.sales_order_id=i.id and l.tenant_id=i.tenant_id
    where i.id=p_order_id and i.tenant_id=v_tenant and i.branch_id=v_draft.branch_id
      and i.source='order' and i.status='draft' and i.deleted_at is null
    for no key update of i;
  if not found or not coalesce(public.user_has_branch_access(v_actor,v_parent.branch_id),false) then
    raise exception 'Không có quyền xác nhận ở chi nhánh này.' using errcode='42501';
  end if;
  if v_parent.fulfilled_by_id is not null or exists (
    select 1 from public.sales_order_processing_closures where order_id=p_order_id and closed_at is not null
  ) then
    raise exception 'Đơn gốc đã đóng xử lý.' using errcode='22023';
  end if;
  -- A weighing correction can only add quantity to an existing ordered item.
  if exists (
    select 1 from public.invoice_items d where d.invoice_id=p_draft_id and not exists (
      select 1 from public.invoice_items p where p.invoice_id=p_order_id
        and p.product_id=d.product_id and p.variant_id is not distinct from d.variant_id
        and lower(btrim(p.unit))=lower(btrim(d.unit))
    )
  ) then
    raise exception 'Nháp có mặt hàng ngoài đơn gốc. Kiểm tra lại nháp trước khi xác nhận.' using errcode='22023';
  end if;
  with draft as (
    select product_id,variant_id,lower(btrim(unit)) unit_key,sum(quantity) quantity
    from public.invoice_items where invoice_id=p_draft_id group by 1,2,3
  )
  insert into public.warehouse_order_quantity_adjustments (
    order_id,draft_id,product_id,variant_id,unit_key,quantity,confirmed_by
  )
  select p_order_id,p_draft_id,d.product_id,d.variant_id,d.unit_key,
    d.quantity-greatest(0,coalesce(q.remaining,0)),v_actor
  from draft d left join public.warehouse_order_open_quantities(p_order_id) q
    on q.product_id=d.product_id and q.variant_id is not distinct from d.variant_id and q.unit_key=d.unit_key
  where d.quantity>greatest(0,coalesce(q.remaining,0));
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function public.confirm_warehouse_order_weighed_quantity(uuid,uuid,timestamptz) from public, anon;
grant execute on function public.confirm_warehouse_order_weighed_quantity(uuid,uuid,timestamptz) to authenticated;

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
      raise exception 'Đợt giao vượt số lượng còn thiếu. Mở đơn gốc để xác nhận lượng cân vượt.' using errcode='22023';
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
