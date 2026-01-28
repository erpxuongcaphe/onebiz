-- Document templates and print snapshots

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  template_type text not null,
  paper_size text not null check (paper_size in ('A4', 'A5', '80mm')),
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  layout jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, template_type, paper_size, version)
);

create index if not exists idx_document_templates_tenant_id on public.document_templates (tenant_id);
create index if not exists idx_document_templates_type_size on public.document_templates (template_type, paper_size);

alter table public.document_templates enable row level security;

create policy "document_templates: read"
on public.document_templates
for select
using (
  tenant_id = public.current_tenant_id()
  and (public.has_permission('settings.read') or public.has_permission('settings.update'))
);

create policy "document_templates: insert"
on public.document_templates
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('settings.update')
);

create policy "document_templates: update"
on public.document_templates
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('settings.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('settings.update')
);

create table if not exists public.document_prints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  template_id uuid references public.document_templates (id) on delete set null,
  template_type text not null,
  paper_size text not null,
  source_type text not null,
  source_id uuid,
  payload jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_prints_tenant_id on public.document_prints (tenant_id);
create index if not exists idx_document_prints_source on public.document_prints (source_type, source_id);

alter table public.document_prints enable row level security;

create policy "document_prints: read"
on public.document_prints
for select
using (
  tenant_id = public.current_tenant_id()
  and (
    public.has_permission('pos.read')
    or public.has_permission('finance.read')
    or public.has_permission('settings.read')
  )
);

create policy "document_prints: insert"
on public.document_prints
for insert
with check (
  tenant_id = public.current_tenant_id()
  and (
    public.has_permission('pos.payment.record')
    or public.has_permission('finance.*')
    or public.has_permission('settings.update')
  )
);
