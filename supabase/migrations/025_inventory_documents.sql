-- OneBiz ERP - Inventory advanced documents (receipt/issue/transfer)

create table if not exists public.inventory_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete restrict,
  doc_number text not null,
  doc_type text not null check (doc_type in ('receipt', 'issue', 'transfer')),
  status text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  warehouse_from_id uuid references public.inventory_warehouses (id) on delete restrict,
  warehouse_to_id uuid references public.inventory_warehouses (id) on delete restrict,
  doc_date date not null default current_date,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  posted_by uuid references public.profiles (id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, doc_number)
);

create index if not exists idx_inventory_documents_tenant_branch_date on public.inventory_documents (tenant_id, branch_id, doc_date desc);
alter table public.inventory_documents enable row level security;

create table if not exists public.inventory_document_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  document_id uuid not null references public.inventory_documents (id) on delete cascade,
  product_id uuid not null references public.inventory_products (id) on delete restrict,
  quantity numeric(15,3) not null,
  unit_cost numeric(15,2),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_document_lines_doc on public.inventory_document_lines (document_id);
alter table public.inventory_document_lines enable row level security;

-- Defaults
drop trigger if exists trg_inventory_documents_branch_id on public.inventory_documents;
create trigger trg_inventory_documents_branch_id
before insert on public.inventory_documents
for each row execute procedure public.set_branch_id_from_context();

drop trigger if exists trg_inventory_document_lines_tenant_id on public.inventory_document_lines;
create trigger trg_inventory_document_lines_tenant_id
before insert on public.inventory_document_lines
for each row execute procedure public.set_tenant_id_from_context();
