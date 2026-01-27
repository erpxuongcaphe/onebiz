-- OneBiz ERP - Guards to keep documents consistent
-- Prevent editing lines of non-draft documents.

create or replace function public.guard_inventory_document_draft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  doc_status text;
begin
  select status into doc_status
  from public.inventory_documents
  where id = coalesce(new.document_id, old.document_id);

  if doc_status is null then
    raise exception 'Document not found';
  end if;

  if doc_status <> 'draft' then
    raise exception 'Only draft documents can be edited';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_inventory_document_lines_guard on public.inventory_document_lines;
create trigger trg_inventory_document_lines_guard
before insert or update or delete on public.inventory_document_lines
for each row execute procedure public.guard_inventory_document_draft();
