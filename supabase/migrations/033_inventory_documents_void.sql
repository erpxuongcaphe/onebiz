-- OneBiz ERP - Void inventory document

alter table public.inventory_documents
add column if not exists void_by uuid references public.profiles (id) on delete set null;

alter table public.inventory_documents
add column if not exists void_at timestamptz;

alter table public.inventory_documents
add column if not exists void_reason text;

-- Add permission for void
-- (role mapping handled in 034)

create or replace function public.inventory_void_document(p_document_id uuid, p_reason text default null)
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
  if not public.has_permission('inventory.document.void') then
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

  if doc.status = 'void' then
    return;
  end if;

  -- If already posted, reverse stock movements
  if doc.status = 'posted' then
    for line in
      select * from public.inventory_document_lines where document_id = doc.id and tenant_id = t_id
    loop
      if doc.doc_type = 'receipt' then
        perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_to_id, 'adjustment', -line.quantity, 'inventory_document_void', doc.id, doc.doc_number);
      elsif doc.doc_type = 'issue' then
        perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_from_id, 'adjustment', line.quantity, 'inventory_document_void', doc.id, doc.doc_number);
      else
        -- transfer: move back
        perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_from_id, 'transfer_in', line.quantity, 'inventory_document_void', doc.id, doc.doc_number);
        perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_to_id, 'transfer_out', -line.quantity, 'inventory_document_void', doc.id, doc.doc_number);
      end if;
    end loop;
  end if;

  update public.inventory_documents
  set status = 'void',
      void_by = auth.uid(),
      void_at = now(),
      void_reason = p_reason,
      updated_at = now()
  where id = doc.id;
end;
$$;

grant execute on function public.inventory_void_document(uuid, text) to authenticated;
