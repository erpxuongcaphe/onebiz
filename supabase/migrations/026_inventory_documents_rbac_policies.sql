-- OneBiz ERP - Inventory documents policies using RBAC + branch scope

-- Documents
create policy "inventory_documents: read"
on public.inventory_documents
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.read')
  and (
    public.has_permission('branch.read_all')
    or branch_id = public.current_branch_id()
  )
);

create policy "inventory_documents: insert"
on public.inventory_documents
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.create')
  and (
    public.has_permission('branch.read_all')
    or branch_id = public.current_branch_id()
  )
);

create policy "inventory_documents: update"
on public.inventory_documents
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.update')
);

-- Lines
create policy "inventory_document_lines: read"
on public.inventory_document_lines
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.read')
);

create policy "inventory_document_lines: insert"
on public.inventory_document_lines
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.update')
);

create policy "inventory_document_lines: delete"
on public.inventory_document_lines
for delete
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.update')
);
