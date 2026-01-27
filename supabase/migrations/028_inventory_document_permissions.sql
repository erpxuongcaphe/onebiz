-- OneBiz ERP - Add inventory document permissions to system roles

-- Admin
update public.roles
set permissions = (
  case
    when permissions ? 'inventory.document.read' then permissions
    else permissions || '[
      "inventory.document.read",
      "inventory.document.create",
      "inventory.document.update",
      "inventory.document.post"
    ]'::jsonb
  end
)
where is_system = true and name = 'Admin';

-- Manager
update public.roles
set permissions = (
  case
    when permissions ? 'inventory.document.read' then permissions
    else permissions || '[
      "inventory.document.read",
      "inventory.document.create",
      "inventory.document.update",
      "inventory.document.post"
    ]'::jsonb
  end
)
where is_system = true and name = 'Manager';
