-- OneBiz ERP - Audit log

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_tenant_time on public.audit_log (tenant_id, created_at desc);
create index if not exists idx_audit_log_entity on public.audit_log (tenant_id, entity_type, entity_id);

alter table public.audit_log enable row level security;

create policy "audit_log: read"
on public.audit_log
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('audit.read')
);

-- Generic trigger function
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  b_id uuid;
  entity text;
  entity_id text;
  before_row jsonb;
  after_row jsonb;
begin
  entity := tg_table_name;

  if (tg_op = 'INSERT') then
    after_row := to_jsonb(new);
    before_row := null;
    t_id := (after_row->>'tenant_id')::uuid;
    b_id := null;
    if (after_row ? 'branch_id') then
      begin
        b_id := (after_row->>'branch_id')::uuid;
      exception when others then
        b_id := null;
      end;
    end if;
    entity_id := coalesce(after_row->>'id', null);
  elsif (tg_op = 'UPDATE') then
    after_row := to_jsonb(new);
    before_row := to_jsonb(old);
    t_id := (after_row->>'tenant_id')::uuid;
    b_id := null;
    if (after_row ? 'branch_id') then
      begin
        b_id := (after_row->>'branch_id')::uuid;
      exception when others then
        b_id := null;
      end;
    end if;
    entity_id := coalesce(after_row->>'id', null);
  else
    after_row := null;
    before_row := to_jsonb(old);
    t_id := (before_row->>'tenant_id')::uuid;
    b_id := null;
    if (before_row ? 'branch_id') then
      begin
        b_id := (before_row->>'branch_id')::uuid;
      exception when others then
        b_id := null;
      end;
    end if;
    entity_id := coalesce(before_row->>'id', null);
  end if;

  insert into public.audit_log (
    tenant_id,
    branch_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after
  )
  values (
    t_id,
    b_id,
    auth.uid(),
    lower(tg_op),
    entity,
    entity_id,
    before_row,
    after_row
  );

  return coalesce(new, old);
end;
$$;

-- Attach audit triggers (inventory)
drop trigger if exists audit_inventory_products on public.inventory_products;
create trigger audit_inventory_products
after insert or update or delete on public.inventory_products
for each row execute procedure public.audit_row_change();

drop trigger if exists audit_inventory_categories on public.inventory_categories;
create trigger audit_inventory_categories
after insert or update or delete on public.inventory_categories
for each row execute procedure public.audit_row_change();

drop trigger if exists audit_inventory_warehouses on public.inventory_warehouses;
create trigger audit_inventory_warehouses
after insert or update or delete on public.inventory_warehouses
for each row execute procedure public.audit_row_change();
