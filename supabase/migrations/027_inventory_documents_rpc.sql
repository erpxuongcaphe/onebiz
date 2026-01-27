-- OneBiz ERP - Inventory documents posting RPC

create or replace function public.inventory_post_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  doc record;
  line record;
begin
  if not public.has_permission('inventory.document.post') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  select * into doc
  from public.inventory_documents
  where id = p_document_id and tenant_id = t_id
  limit 1;

  if doc.id is null then
    raise exception 'Document not found';
  end if;

  if doc.status <> 'draft' then
    raise exception 'Only draft documents can be posted';
  end if;

  if doc.doc_type = 'receipt' then
    if doc.warehouse_to_id is null then
      raise exception 'warehouse_to_id required';
    end if;
  elsif doc.doc_type = 'issue' then
    if doc.warehouse_from_id is null then
      raise exception 'warehouse_from_id required';
    end if;
  elsif doc.doc_type = 'transfer' then
    if doc.warehouse_from_id is null or doc.warehouse_to_id is null then
      raise exception 'warehouse_from_id and warehouse_to_id required';
    end if;
  end if;

  for line in
    select * from public.inventory_document_lines where document_id = doc.id and tenant_id = t_id
  loop
    if line.quantity <= 0 then
      raise exception 'Line quantity must be > 0';
    end if;

    if doc.doc_type = 'receipt' then
      perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_to_id, 'purchase', line.quantity, 'inventory_document', doc.id, doc.doc_number);
    elsif doc.doc_type = 'issue' then
      perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_from_id, 'adjustment', -line.quantity, 'inventory_document', doc.id, doc.doc_number);
    else
      perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_from_id, 'transfer_out', -line.quantity, 'inventory_document', doc.id, doc.doc_number);
      perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_to_id, 'transfer_in', line.quantity, 'inventory_document', doc.id, doc.doc_number);
    end if;
  end loop;

  update public.inventory_documents
  set status = 'posted', posted_by = auth.uid(), posted_at = now(), updated_at = now()
  where id = doc.id;
end;
$$;

grant execute on function public.inventory_post_document(uuid) to authenticated;
