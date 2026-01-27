-- OneBiz ERP - POS permissions for system roles + seed cashier role

-- Update seed_default_roles to include Cashier
create or replace function public.seed_default_roles(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roles (tenant_id, name, description, permissions, is_system)
  values
    (p_tenant_id, 'Super Admin', 'Full system access', '["*"]'::jsonb, true),
    (p_tenant_id, 'Admin', 'Administrative access', '[
      "branch.read_all",
      "audit.read",
      "inventory.*",
      "sales.*",
      "finance.*",
      "pos.*",
      "reports.*",
      "settings.*",
      "users.*",
      "roles.*"
    ]'::jsonb, true),
    (p_tenant_id, 'Manager', 'Department manager', '[
      "inventory.read",
      "inventory.product.*",
      "inventory.category.*",
      "inventory.warehouse.*",
      "inventory.stock.adjust",
      "inventory.movement.read",
      "pos.read"
    ]'::jsonb, true),
    (p_tenant_id, 'Cashier', 'POS cashier', '[
      "inventory.read",
      "pos.read",
      "pos.shift.open",
      "pos.shift.update",
      "pos.order.create",
      "pos.order.update",
      "pos.payment.record"
    ]'::jsonb, true),
    (p_tenant_id, 'Employee', 'Basic employee access', '[
      "inventory.read",
      "inventory.movement.read"
    ]'::jsonb, true)
  on conflict do nothing;
end;
$$;

-- Ensure Cashier role exists for existing tenants
insert into public.roles (tenant_id, name, description, permissions, is_system)
select t.id, 'Cashier', 'POS cashier', '[
  "inventory.read",
  "pos.read",
  "pos.shift.open",
  "pos.shift.update",
  "pos.order.create",
  "pos.order.update",
  "pos.payment.record"
]'::jsonb, true
from public.tenants t
where not exists (
  select 1 from public.roles r where r.tenant_id = t.id and r.name = 'Cashier'
);

-- Backfill Admin permissions
update public.roles
set permissions = (
  case
    when permissions ? 'pos.read' then permissions
    else permissions || '["pos.*"]'::jsonb
  end
)
where is_system = true and name = 'Admin';

update public.roles
set permissions = (
  case
    when permissions ? 'branch.read_all' then permissions
    else permissions || '["branch.read_all"]'::jsonb
  end
)
where is_system = true and name = 'Admin';
