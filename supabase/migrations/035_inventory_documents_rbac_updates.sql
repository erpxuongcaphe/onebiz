-- OneBiz ERP - Inventory documents RBAC policy updates

-- Allow updating lines under inventory.document.update
create policy "inventory_document_lines: update"
on public.inventory_document_lines
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.update')
);
