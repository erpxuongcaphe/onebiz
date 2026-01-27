-- OneBiz ERP - Inventory document permissions (void)

update public.roles
set permissions = (
  case
    when permissions ? 'inventory.document.void' then permissions
    else permissions || '["inventory.document.void"]'::jsonb
  end
)
where is_system = true and name in ('Admin', 'Manager');
